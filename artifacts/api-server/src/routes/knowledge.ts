import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import multer from "multer";
import {
  db,
  tenantsTable,
  knowledgeDocumentsTable,
  knowledgeChunksTable,
  professorSessionsTable,
  professorMessagesTable,
  absorbedFactsTable,
  classroomFactsTable,
  type KnowledgeDocument,
  type ProfessorSession,
  type ClassroomVersion,
  type AbsorbedFact,
} from "@workspace/db";
import {
  AddLibraryUrlBody,
  AddLibraryTextBody,
  CreateProfessorSessionBody,
  SendProfessorMessageBody,
  UpdateAbsorbedFactStatusBody,
  UpdateAbsorbedFactCategoryBody,
  PushToClassroomBody,
} from "@workspace/api-zod";
import {
  createDocumentWithChunks,
  extractTextFromFile,
  extractTextFromUrl,
  extractFacts,
  retrieveLibraryContext,
  getCurrentClassroomVersion,
  estimateTokens,
  normalizeCategory,
  FACT_CATEGORIES,
  AUTO_LEARNED_REVIEW_STATUSES,
  approveAutoLearnedFact,
  rejectAutoLearnedFact,
  type ExtractedFact,
} from "../lib/knowledge";
import { publishClassroomSnapshot } from "../lib/classroomPublish";
import { professorClient, PROFESSOR_MODEL } from "../lib/grokClient";

/**
 * Professor / Library / Classroom routes — the Conductor-facing curation layer
 * of the LLM hierarchy. All paths live under `/tenants/:tenantId/...`, which is
 * NOT in conductorAuth's tenant-scoped allow-list, so these require Conductor
 * (admin) auth by default.
 */

const router: IRouter = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const MAX_ACTIVE_SESSIONS = 5;
const HISTORY_LIMIT = 20;

// Classroom publishing (versioning, advisory lock, supersede, snapshot insert,
// conflict flagging) is centralized in ../lib/classroomPublish so the Professor
// push here and the Brain push (routes/brain.ts) share one invariant. The same
// CLASSROOM_PUSH_LOCK also serializes the live-escalation path in ../lib/knowledge.

// --- shape mappers (strip internal-only columns from API payloads) -----------

function toDocApi(d: KnowledgeDocument) {
  return {
    id: d.id,
    tenantId: d.tenantId,
    sourceType: d.sourceType,
    title: d.title,
    sourceUrl: d.sourceUrl,
    fileName: d.fileName,
    mimeType: d.mimeType,
    tokenCount: d.tokenCount,
    status: d.status,
    createdAt: d.createdAt,
  };
}

function toSessionApi(s: ProfessorSession) {
  return {
    id: s.id,
    tenantId: s.tenantId,
    title: s.title,
    status: s.status,
    model: s.model,
    tokensUsed: s.tokensUsed,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

function toVersionApi(v: ClassroomVersion) {
  return {
    id: v.id,
    tenantId: v.tenantId,
    version: v.version,
    status: v.status,
    summary: v.summary,
    factCount: v.factCount,
    tokenCount: v.tokenCount,
    publishedAt: v.publishedAt,
  };
}

// --- helpers -----------------------------------------------------------------

function parseId(value: unknown): number | null {
  const n = parseInt(String(value), 10);
  return Number.isNaN(n) ? null : n;
}

async function getTenant(tenantId: number) {
  const [tenant] = await db
    .select()
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId));
  return tenant ?? null;
}

async function getSession(
  tenantId: number,
  sessionId: number,
): Promise<ProfessorSession | null> {
  const [s] = await db
    .select()
    .from(professorSessionsTable)
    .where(
      and(
        eq(professorSessionsTable.id, sessionId),
        eq(professorSessionsTable.tenantId, tenantId),
      ),
    );
  return s ?? null;
}

// Lazily migrate the legacy tenants.knowledge_base blob into a Library document
// the first time the Library is opened. Non-destructive — the column stays.
async function ensureLegacyMigrated(tenantId: number): Promise<void> {
  const existing = await db
    .select({ id: knowledgeDocumentsTable.id })
    .from(knowledgeDocumentsTable)
    .where(eq(knowledgeDocumentsTable.tenantId, tenantId))
    .limit(1);
  if (existing.length > 0) return;
  const tenant = await getTenant(tenantId);
  const blob = tenant?.knowledgeBase?.trim();
  if (!blob) return;
  await createDocumentWithChunks({
    tenantId,
    sourceType: "legacy",
    title: "Legacy knowledge base",
    extractedText: blob,
  });
}

// Pull a session's tenant name + Library-grounding context for a chat turn.
async function buildTurnContext(session: ProfessorSession, userContent: string) {
  const tenant = await getTenant(session.tenantId);
  const contextRows = await retrieveLibraryContext(
    session.tenantId,
    userContent,
  );
  // Label each chunk with its source so the Professor can actually cite the
  // tenant's Library (the prompt asks it to attribute Library-grounded facts).
  const libraryContext = contextRows
    .map((r) => {
      const src = r.sourceUrl ? `${r.title} — ${r.sourceUrl}` : r.title;
      return `[Source: ${src}]\n${r.text}`;
    })
    .join("\n\n---\n\n");
  return {
    tenantName: tenant?.name ?? "this tenant",
    libraryContext,
  };
}

function professorSystemPrompt(tenantName: string, libraryContext: string) {
  return `You are "the Professor" — a brilliant, well-read subject-matter expert working WITH a human curator to build and sharpen the knowledge base for "${tenantName}". This is a collaborative, two-way learning session, not a lookup service.

You draw on two sources of knowledge:
1. LIBRARY CONTEXT (below): the tenant's own curated sources. Treat these as authoritative for anything specific to "${tenantName}" — their policies, pricing, procedures, numbers, and voice. Prefer them over your own assumptions and cite them when you use them.
2. Your own deep expertise: you genuinely know business communication, SMS / A2P 10DLC compliance, customer support, marketing, and the tenant's domain. When the Library is empty, thin, or off-topic, DO NOT refuse and DO NOT ask the human to paste a source instead of thinking — answer fully and substantively from what you know.

Every turn:
- Engage the actual question and give a substantive, well-structured answer (respect any length the curator asks for).
- Move the curation forward: note what the Library is missing or where it is unverified, ask one sharp clarifying question, and propose concrete, atomic facts worth absorbing so the Students can reuse them later.
- Be explicit about provenance: separate what is grounded in the tenant's Library (cite it) from what is your own general expertise (offer to absorb it if the curator agrees).
- Never reply with "no library context available." Your intelligence leads; the Library augments you, it does not gate you.

LIBRARY CONTEXT:
${libraryContext || "(No tenant sources matched this turn — answer from your own expertise and help the curator decide what is worth capturing.)"}`;
}

// --- Library -----------------------------------------------------------------

router.get(
  "/tenants/:tenantId/library",
  async (req: Request, res: Response): Promise<void> => {
    const tenantId = parseId(req.params.tenantId);
    if (tenantId == null) {
      res.status(400).json({ error: "Invalid tenant id" });
      return;
    }
    await ensureLegacyMigrated(tenantId);
    const rows = await db
      .select()
      .from(knowledgeDocumentsTable)
      .where(eq(knowledgeDocumentsTable.tenantId, tenantId))
      .orderBy(desc(knowledgeDocumentsTable.createdAt));
    res.json(rows.map(toDocApi));
  },
);

// Shared ingest tail: persist the document, optionally absorb facts into a
// session, and return the LibraryIngestResult shape.
async function ingestAndRespond(
  req: Request,
  res: Response,
  opts: {
    tenantId: number;
    sourceType: "file" | "url" | "paste";
    title: string;
    extractedText: string;
    sourceUrl?: string | null;
    fileName?: string | null;
    mimeType?: string | null;
    sessionId?: number | null;
  },
): Promise<void> {
  const doc = await createDocumentWithChunks({
    tenantId: opts.tenantId,
    sourceType: opts.sourceType,
    title: opts.title,
    extractedText: opts.extractedText,
    sourceUrl: opts.sourceUrl ?? null,
    fileName: opts.fileName ?? null,
    mimeType: opts.mimeType ?? null,
  });

  let absorbedCount = 0;
  let session: ProfessorSession | null = null;

  if (opts.sessionId != null) {
    session = await getSession(opts.tenantId, opts.sessionId);
    if (session && session.status === "active") {
      try {
        const { facts, tokensUsed } = await extractFacts(
          opts.extractedText,
          doc.title,
        );
        if (facts.length > 0) {
          await db.insert(absorbedFactsTable).values(
            facts.map((f) => ({
              tenantId: opts.tenantId,
              sessionId: session!.id,
              documentId: doc.id,
              sourceLabel: doc.title,
              statement: f.statement,
              category: f.category,
              status: "draft",
              tokenCount: estimateTokens(f.statement),
            })),
          );
          absorbedCount = facts.length;
        }
        const [updated] = await db
          .update(professorSessionsTable)
          .set({
            tokensUsed:
              session.tokensUsed + doc.tokenCount + tokensUsed,
          })
          .where(eq(professorSessionsTable.id, session.id))
          .returning();
        if (updated) session = updated;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        req.log.error({ err: msg, documentId: doc.id }, "Fact extraction failed");
      }
    }
  }

  res.status(201).json({
    document: toDocApi(doc),
    absorbedCount,
    ...(session ? { session: toSessionApi(session) } : {}),
  });
}

router.post(
  "/tenants/:tenantId/library/url",
  async (req: Request, res: Response): Promise<void> => {
    const tenantId = parseId(req.params.tenantId);
    if (tenantId == null) {
      res.status(400).json({ error: "Invalid tenant id" });
      return;
    }
    const parsed = AddLibraryUrlBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "A valid url is required" });
      return;
    }
    const tenant = await getTenant(tenantId);
    if (!tenant) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }
    let extracted: { title: string; text: string };
    try {
      extracted = await extractTextFromUrl(parsed.data.url);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: `Could not fetch the URL: ${msg}` });
      return;
    }
    if (!extracted.text.trim()) {
      res.status(400).json({ error: "No readable text found at that URL" });
      return;
    }
    await ingestAndRespond(req, res, {
      tenantId,
      sourceType: "url",
      title: extracted.title || parsed.data.url,
      extractedText: extracted.text,
      sourceUrl: parsed.data.url,
      sessionId: parsed.data.sessionId ?? null,
    });
  },
);

router.post(
  "/tenants/:tenantId/library/text",
  async (req: Request, res: Response): Promise<void> => {
    const tenantId = parseId(req.params.tenantId);
    if (tenantId == null) {
      res.status(400).json({ error: "Invalid tenant id" });
      return;
    }
    const parsed = AddLibraryTextBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "title and text are required" });
      return;
    }
    const tenant = await getTenant(tenantId);
    if (!tenant) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }
    await ingestAndRespond(req, res, {
      tenantId,
      sourceType: "paste",
      title: parsed.data.title,
      extractedText: parsed.data.text,
      sessionId: parsed.data.sessionId ?? null,
    });
  },
);

router.post(
  "/tenants/:tenantId/library/file",
  (req, res, next) => {
    upload.single("file")(req, res, (err) => {
      if (err) {
        if (err.code === "LIMIT_FILE_SIZE") {
          res
            .status(413)
            .json({ error: "File too large. Maximum size is 5MB." });
          return;
        }
        res.status(400).json({ error: `Upload error: ${err.message}` });
        return;
      }
      next();
    });
  },
  async (req: Request, res: Response): Promise<void> => {
    const tenantId = parseId(req.params.tenantId);
    if (tenantId == null) {
      res.status(400).json({ error: "Invalid tenant id" });
      return;
    }
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }
    const tenant = await getTenant(tenantId);
    if (!tenant) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }
    let extractedText: string;
    try {
      extractedText = await extractTextFromFile(file.buffer, file.originalname);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: msg });
      return;
    }
    if (!extractedText.trim()) {
      res.status(400).json({ error: "No text content extracted from file" });
      return;
    }
    const rawSession = req.body?.sessionId;
    const sessionId =
      rawSession != null && String(rawSession).length > 0
        ? parseId(rawSession)
        : null;
    await ingestAndRespond(req, res, {
      tenantId,
      sourceType: "file",
      title: file.originalname,
      extractedText,
      fileName: file.originalname,
      mimeType: file.mimetype,
      sessionId,
    });
  },
);

router.delete(
  "/tenants/:tenantId/library/:documentId",
  async (req: Request, res: Response): Promise<void> => {
    const tenantId = parseId(req.params.tenantId);
    const documentId = parseId(req.params.documentId);
    if (tenantId == null || documentId == null) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const [doc] = await db
      .select({ id: knowledgeDocumentsTable.id })
      .from(knowledgeDocumentsTable)
      .where(
        and(
          eq(knowledgeDocumentsTable.id, documentId),
          eq(knowledgeDocumentsTable.tenantId, tenantId),
        ),
      );
    if (!doc) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    await db
      .delete(knowledgeChunksTable)
      .where(eq(knowledgeChunksTable.documentId, documentId));
    await db
      .delete(knowledgeDocumentsTable)
      .where(eq(knowledgeDocumentsTable.id, documentId));
    res.json({ success: true });
  },
);

// --- Professor sessions ------------------------------------------------------

router.get(
  "/tenants/:tenantId/professor/sessions",
  async (req: Request, res: Response): Promise<void> => {
    const tenantId = parseId(req.params.tenantId);
    if (tenantId == null) {
      res.status(400).json({ error: "Invalid tenant id" });
      return;
    }
    const rows = await db
      .select()
      .from(professorSessionsTable)
      .where(eq(professorSessionsTable.tenantId, tenantId))
      .orderBy(desc(professorSessionsTable.createdAt));
    res.json(rows.map(toSessionApi));
  },
);

router.post(
  "/tenants/:tenantId/professor/sessions",
  async (req: Request, res: Response): Promise<void> => {
    const tenantId = parseId(req.params.tenantId);
    if (tenantId == null) {
      res.status(400).json({ error: "Invalid tenant id" });
      return;
    }
    const parsed = CreateProfessorSessionBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid session input" });
      return;
    }
    const tenant = await getTenant(tenantId);
    if (!tenant) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }
    const active = await db
      .select({ id: professorSessionsTable.id })
      .from(professorSessionsTable)
      .where(
        and(
          eq(professorSessionsTable.tenantId, tenantId),
          eq(professorSessionsTable.status, "active"),
        ),
      );
    if (active.length >= MAX_ACTIVE_SESSIONS) {
      res.status(409).json({
        error: `You have ${MAX_ACTIVE_SESSIONS} active Professor sessions. Push to Classroom (or archive a session) before starting a new one.`,
      });
      return;
    }
    const total = await db
      .select({ id: professorSessionsTable.id })
      .from(professorSessionsTable)
      .where(eq(professorSessionsTable.tenantId, tenantId));
    const title =
      parsed.data.title?.trim() || `Session ${total.length + 1}`;
    const [row] = await db
      .insert(professorSessionsTable)
      .values({
        tenantId,
        title,
        status: "active",
        model: PROFESSOR_MODEL,
      })
      .returning();
    if (!row) {
      res.status(500).json({ error: "Failed to create session" });
      return;
    }
    res.status(201).json(toSessionApi(row));
  },
);

router.post(
  "/tenants/:tenantId/professor/sessions/:sessionId/archive",
  async (req: Request, res: Response): Promise<void> => {
    const tenantId = parseId(req.params.tenantId);
    const sessionId = parseId(req.params.sessionId);
    if (tenantId == null || sessionId == null) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const session = await getSession(tenantId, sessionId);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    const [row] = await db
      .update(professorSessionsTable)
      .set({ status: "archived" })
      .where(eq(professorSessionsTable.id, sessionId))
      .returning();
    res.json(toSessionApi(row ?? session));
  },
);

// --- Professor chat ----------------------------------------------------------

router.get(
  "/tenants/:tenantId/professor/sessions/:sessionId/messages",
  async (req: Request, res: Response): Promise<void> => {
    const tenantId = parseId(req.params.tenantId);
    const sessionId = parseId(req.params.sessionId);
    if (tenantId == null || sessionId == null) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const session = await getSession(tenantId, sessionId);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    const rows = await db
      .select()
      .from(professorMessagesTable)
      .where(eq(professorMessagesTable.sessionId, sessionId))
      .orderBy(professorMessagesTable.createdAt);
    res.json(rows);
  },
);

// Non-streaming chat turn (in-contract fallback for the SSE route below).
router.post(
  "/tenants/:tenantId/professor/sessions/:sessionId/messages",
  async (req: Request, res: Response): Promise<void> => {
    const tenantId = parseId(req.params.tenantId);
    const sessionId = parseId(req.params.sessionId);
    if (tenantId == null || sessionId == null) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const parsed = SendProfessorMessageBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Message content is required" });
      return;
    }
    const session = await getSession(tenantId, sessionId);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    const content = parsed.data.content.trim();
    const [userMessage] = await db
      .insert(professorMessagesTable)
      .values({
        sessionId,
        tenantId,
        role: "user",
        content,
        tokenCount: estimateTokens(content),
      })
      .returning();

    const { tenantName, libraryContext } = await buildTurnContext(
      session,
      content,
    );
    const historyRows = await db
      .select()
      .from(professorMessagesTable)
      .where(eq(professorMessagesTable.sessionId, sessionId))
      .orderBy(desc(professorMessagesTable.createdAt))
      .limit(HISTORY_LIMIT);
    const history = historyRows
      .reverse()
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

    const oai = professorClient();
    let replyText: string;
    let tokensUsed: number;
    let stubbed: boolean;
    if (!oai) {
      replyText =
        "[Professor offline — connect the Professor AI provider to enable live curation.]";
      tokensUsed = 0;
      stubbed = true;
    } else {
      try {
        const resp = await oai.chat.completions.create({
          model: PROFESSOR_MODEL,
          temperature: 0.3,
          max_tokens: 1500,
          messages: [
            {
              role: "system",
              content: professorSystemPrompt(tenantName, libraryContext),
            },
            ...history,
          ],
        });
        replyText = resp.choices[0]?.message?.content?.trim() ?? "";
        tokensUsed = resp.usage?.total_tokens ?? 0;
        stubbed = false;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        req.log.error({ err: msg, sessionId }, "Professor reply failed");
        res.status(502).json({ error: `Professor model error: ${msg}` });
        return;
      }
    }

    const [assistantMessage] = await db
      .insert(professorMessagesTable)
      .values({
        sessionId,
        tenantId,
        role: "assistant",
        content: replyText,
        tokenCount: tokensUsed || estimateTokens(replyText),
      })
      .returning();

    const [updatedSession] = await db
      .update(professorSessionsTable)
      .set({
        tokensUsed:
          session.tokensUsed +
          (userMessage?.tokenCount ?? 0) +
          (tokensUsed || estimateTokens(replyText)),
      })
      .where(eq(professorSessionsTable.id, sessionId))
      .returning();

    res.status(201).json({
      userMessage,
      assistantMessage,
      session: toSessionApi(updatedSession ?? session),
      stubbed,
    });
  },
);

// Streaming chat turn (SSE over POST). Not modeled in OpenAPI; the UI prefers
// this and falls back to the non-streaming route above.
router.post(
  "/tenants/:tenantId/professor/sessions/:sessionId/stream",
  async (req: Request, res: Response): Promise<void> => {
    const tenantId = parseId(req.params.tenantId);
    const sessionId = parseId(req.params.sessionId);
    if (tenantId == null || sessionId == null) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const parsed = SendProfessorMessageBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Message content is required" });
      return;
    }
    const session = await getSession(tenantId, sessionId);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    const content = parsed.data.content.trim();
    const [userMessage] = await db
      .insert(professorMessagesTable)
      .values({
        sessionId,
        tenantId,
        role: "user",
        content,
        tokenCount: estimateTokens(content),
      })
      .returning();

    const { tenantName, libraryContext } = await buildTurnContext(
      session,
      content,
    );
    const historyRows = await db
      .select()
      .from(professorMessagesTable)
      .where(eq(professorMessagesTable.sessionId, sessionId))
      .orderBy(desc(professorMessagesTable.createdAt))
      .limit(HISTORY_LIMIT);
    const history = historyRows
      .reverse()
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    send("user", userMessage);

    const oai = professorClient();
    let replyText = "";
    let usageTokens = 0;
    let stubbed = false;

    if (!oai) {
      replyText =
        "[Professor offline — connect the Professor AI provider to enable live curation.]";
      stubbed = true;
      send("token", { delta: replyText });
    } else {
      try {
        const stream = await oai.chat.completions.create({
          model: PROFESSOR_MODEL,
          temperature: 0.3,
          max_tokens: 1500,
          stream: true,
          stream_options: { include_usage: true },
          messages: [
            {
              role: "system",
              content: professorSystemPrompt(tenantName, libraryContext),
            },
            ...history,
          ],
        });
        for await (const part of stream) {
          const delta = part.choices[0]?.delta?.content ?? "";
          if (delta) {
            replyText += delta;
            send("token", { delta });
          }
          if (part.usage?.total_tokens) usageTokens = part.usage.total_tokens;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        req.log.error({ err: msg, sessionId }, "Professor stream failed");
        send("error", { error: `Professor model error: ${msg}` });
        res.end();
        return;
      }
    }

    const tokenCount = usageTokens || estimateTokens(replyText);
    const [assistantMessage] = await db
      .insert(professorMessagesTable)
      .values({
        sessionId,
        tenantId,
        role: "assistant",
        content: replyText,
        tokenCount,
      })
      .returning();
    const [updatedSession] = await db
      .update(professorSessionsTable)
      .set({
        tokensUsed:
          session.tokensUsed + (userMessage?.tokenCount ?? 0) + tokenCount,
      })
      .where(eq(professorSessionsTable.id, sessionId))
      .returning();

    send("done", {
      assistantMessage,
      session: toSessionApi(updatedSession ?? session),
      stubbed,
    });
    res.end();
  },
);

// --- Absorbed facts ----------------------------------------------------------

router.get(
  "/tenants/:tenantId/professor/sessions/:sessionId/absorbed",
  async (req: Request, res: Response): Promise<void> => {
    const tenantId = parseId(req.params.tenantId);
    const sessionId = parseId(req.params.sessionId);
    if (tenantId == null || sessionId == null) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const rows = await db
      .select()
      .from(absorbedFactsTable)
      .where(
        and(
          eq(absorbedFactsTable.tenantId, tenantId),
          eq(absorbedFactsTable.sessionId, sessionId),
        ),
      )
      .orderBy(desc(absorbedFactsTable.createdAt));
    res.json(rows);
  },
);

router.post(
  "/tenants/:tenantId/professor/absorbed/:factId/status",
  async (req: Request, res: Response): Promise<void> => {
    const tenantId = parseId(req.params.tenantId);
    const factId = parseId(req.params.factId);
    if (tenantId == null || factId == null) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const parsed = UpdateAbsorbedFactStatusBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "status must be draft, published, or rejected" });
      return;
    }
    const [fact] = await db
      .select()
      .from(absorbedFactsTable)
      .where(
        and(
          eq(absorbedFactsTable.id, factId),
          eq(absorbedFactsTable.tenantId, tenantId),
        ),
      );
    if (!fact) {
      res.status(404).json({ error: "Fact not found" });
      return;
    }
    const [row] = await db
      .update(absorbedFactsTable)
      // Resolving a fact (accept/reject) also clears any conflict flag the
      // Librarian set — the contradiction has been adjudicated by a human.
      .set({ status: parsed.data.status, conflictReason: null })
      .where(eq(absorbedFactsTable.id, factId))
      .returning();
    res.json(row ?? fact);
  },
);

// Let the Conductor correct a mis-classified fact's routing category before it
// is pushed to the Classroom. Validated app-side (normalizeCategory) so a bad
// value can never persist or 500 a later list query.
router.post(
  "/tenants/:tenantId/professor/absorbed/:factId/category",
  async (req: Request, res: Response): Promise<void> => {
    const tenantId = parseId(req.params.tenantId);
    const factId = parseId(req.params.factId);
    if (tenantId == null || factId == null) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const parsed = UpdateAbsorbedFactCategoryBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: `category must be one of: ${FACT_CATEGORIES.join(", ")}`,
      });
      return;
    }
    const [fact] = await db
      .select()
      .from(absorbedFactsTable)
      .where(
        and(
          eq(absorbedFactsTable.id, factId),
          eq(absorbedFactsTable.tenantId, tenantId),
        ),
      );
    if (!fact) {
      res.status(404).json({ error: "Fact not found" });
      return;
    }
    const [row] = await db
      .update(absorbedFactsTable)
      .set({ category: normalizeCategory(parsed.data.category) })
      .where(eq(absorbedFactsTable.id, factId))
      .returning();
    res.json(row ?? fact);
  },
);

// Turn a Professor chat ANSWER into draft absorbed facts. This is the bridge
// that lets the external knowledge the Professor brings in conversation flow to
// the Classroom — not just facts extracted from attached sources. Idempotent
// per message: re-absorbing the same answer returns its existing facts.
router.post(
  "/tenants/:tenantId/professor/sessions/:sessionId/messages/:messageId/absorb",
  async (req: Request, res: Response): Promise<void> => {
    const tenantId = parseId(req.params.tenantId);
    const sessionId = parseId(req.params.sessionId);
    const messageId = parseId(req.params.messageId);
    if (tenantId == null || sessionId == null || messageId == null) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const session = await getSession(tenantId, sessionId);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    if (session.status !== "active") {
      res.status(400).json({ error: "Only active sessions can absorb knowledge." });
      return;
    }
    const [message] = await db
      .select()
      .from(professorMessagesTable)
      .where(
        and(
          eq(professorMessagesTable.id, messageId),
          eq(professorMessagesTable.sessionId, sessionId),
          eq(professorMessagesTable.tenantId, tenantId),
        ),
      );
    if (!message) {
      res.status(404).json({ error: "Message not found" });
      return;
    }
    if (message.role !== "assistant") {
      res.status(400).json({ error: "Only the Professor's answers can be absorbed." });
      return;
    }

    // Idempotent: if this answer was already absorbed, return its facts as-is
    // instead of re-extracting (and duplicating) them.
    const existing = await db
      .select()
      .from(absorbedFactsTable)
      .where(
        and(
          eq(absorbedFactsTable.tenantId, tenantId),
          eq(absorbedFactsTable.messageId, messageId),
        ),
      )
      .orderBy(desc(absorbedFactsTable.createdAt));
    if (existing.length > 0) {
      res.json({
        absorbedCount: existing.length,
        facts: existing,
        session: toSessionApi(session),
        stubbed: false,
      });
      return;
    }

    const online = professorClient() != null;
    let facts: ExtractedFact[];
    let tokensUsed: number;
    try {
      const out = await extractFacts(message.content, "Professor answer");
      facts = out.facts;
      tokensUsed = out.tokensUsed;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      req.log.error({ err: msg, messageId }, "Absorb answer failed");
      res.status(502).json({ error: `Could not absorb answer: ${msg}` });
      return;
    }

    // Serialize the check-then-insert per message so two concurrent absorb
    // calls for the same answer can't both insert (duplicate facts). The slow
    // Grok extraction above runs OUTSIDE this lock; the advisory lock guards
    // only the short critical section and releases at transaction end.
    const { facts: resultFacts, session: resultSession } = await db.transaction(
      async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(${tenantId}, ${messageId})`,
        );
        const raced = await tx
          .select()
          .from(absorbedFactsTable)
          .where(
            and(
              eq(absorbedFactsTable.tenantId, tenantId),
              eq(absorbedFactsTable.messageId, messageId),
            ),
          )
          .orderBy(desc(absorbedFactsTable.createdAt));
        if (raced.length > 0) {
          // Another absorb of this answer won the race; return its facts and
          // don't double-count this (wasted) extraction's tokens.
          return { facts: raced, session };
        }
        let inserted: AbsorbedFact[] = [];
        if (facts.length > 0) {
          inserted = await tx
            .insert(absorbedFactsTable)
            .values(
              facts.map((f) => ({
                tenantId,
                sessionId,
                messageId,
                documentId: null,
                sourceLabel: "Professor answer",
                statement: f.statement,
                category: f.category,
                status: "draft",
                tokenCount: estimateTokens(f.statement),
              })),
            )
            .returning();
        }
        const [updatedSession] = await tx
          .update(professorSessionsTable)
          .set({ tokensUsed: session.tokensUsed + tokensUsed })
          .where(eq(professorSessionsTable.id, sessionId))
          .returning();
        return { facts: inserted, session: updatedSession ?? session };
      },
    );

    res.json({
      absorbedCount: resultFacts.length,
      facts: resultFacts,
      session: toSessionApi(resultSession),
      stubbed: !online,
    });
  },
);

// --- Classroom ---------------------------------------------------------------

router.get(
  "/tenants/:tenantId/classroom",
  async (req: Request, res: Response): Promise<void> => {
    const tenantId = parseId(req.params.tenantId);
    if (tenantId == null) {
      res.status(400).json({ error: "Invalid tenant id" });
      return;
    }
    const version = await getCurrentClassroomVersion(tenantId);
    if (!version) {
      res.json({ facts: [], factCount: 0 });
      return;
    }
    const facts = await db
      .select()
      .from(classroomFactsTable)
      .where(eq(classroomFactsTable.versionId, version.id));
    res.json({
      version: toVersionApi(version),
      facts,
      factCount: facts.length,
    });
  },
);

router.post(
  "/tenants/:tenantId/classroom/push",
  async (req: Request, res: Response): Promise<void> => {
    const tenantId = parseId(req.params.tenantId);
    if (tenantId == null) {
      res.status(400).json({ error: "Invalid tenant id" });
      return;
    }
    const parsed = PushToClassroomBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid push input" });
      return;
    }
    const tenant = await getTenant(tenantId);
    if (!tenant) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }
    const sessionIds = parsed.data.sessionIds ?? [];

    // Human-in-the-loop gate: only facts the Conductor explicitly ACCEPTED
    // (status "published") reach the Classroom. Unreviewed "draft" facts and
    // "rejected" facts are never pushed.
    //
    // A Classroom push is ALWAYS a FULL SNAPSHOT of this tenant's entire
    // published absorbed-fact union (Professor + approved Brain), never a
    // per-session subset — a per-session subset would silently drop Brain facts
    // (and other sessions') from the live Classroom when it supersedes the prior
    // version. sessionIds only selects which Professor sessions to mark "pushed"
    // (a Professor-flow side effect); it is NOT a fact filter.
    const factsToPublish: AbsorbedFact[] = await db
      .select()
      .from(absorbedFactsTable)
      .where(
        and(
          eq(absorbedFactsTable.tenantId, tenantId),
          // Include provisional self-learned ("auto_published") facts so a human
          // push re-snapshots them instead of silently dropping them from the
          // live Classroom; the Librarian then adjudicates them in this push.
          inArray(absorbedFactsTable.status, ["published", "auto_published"]),
        ),
      );

    if (factsToPublish.length === 0) {
      res.status(400).json({
        error:
          "Nothing to publish — accept (✓) some absorbed facts before pushing to the Classroom.",
      });
      return;
    }

    // Snapshot the accepted Professor facts into a new Classroom version via the
    // shared publisher. markSessions preserves the existing behavior: free the
    // explicitly-pushed sessions, or every active session on a full push.
    const outcome = await publishClassroomSnapshot({
      tenantId,
      factsToPublish,
      summary: parsed.data.summary ?? null,
      markSessions:
        sessionIds.length > 0
          ? { mode: "ids", sessionIds }
          : { mode: "active" },
    });

    if (!outcome.ok) {
      res.status(400).json({
        error:
          "All accepted facts are in conflict — resolve the flagged contradictions before publishing.",
        conflictCount: outcome.conflictCount,
      });
      return;
    }

    res.status(201).json({
      version: toVersionApi(outcome.version),
      facts: outcome.facts,
      factCount: outcome.facts.length,
      mergedCount: outcome.mergedCount,
      conflictCount: outcome.conflictCount,
    });
  },
);

// Auto-Learned review queue (Conductor-only). Surfaces self-learned facts that
// the Professor live-escalation persisted without a human in the loop:
// `auto_published` (live-provisional, groundable now) and `conflict` (held,
// NOT groundable). The operator approves each into `published` truth or rejects
// it (which also removes a groundable row from the live Classroom). The
// classroom mutations + counts live in the lib helpers under the push lock.
router.get(
  "/tenants/:tenantId/knowledge/auto-learned",
  async (req: Request, res: Response): Promise<void> => {
    const tenantId = parseId(req.params.tenantId);
    if (tenantId == null) {
      res.status(400).json({ error: "Invalid tenant id" });
      return;
    }
    const rows = await db
      .select()
      .from(absorbedFactsTable)
      .where(
        and(
          eq(absorbedFactsTable.tenantId, tenantId),
          inArray(absorbedFactsTable.status, [...AUTO_LEARNED_REVIEW_STATUSES]),
        ),
      )
      .orderBy(desc(absorbedFactsTable.createdAt));
    res.json(rows);
  },
);

router.post(
  "/tenants/:tenantId/knowledge/auto-learned/:factId/approve",
  async (req: Request, res: Response): Promise<void> => {
    const tenantId = parseId(req.params.tenantId);
    const factId = parseId(req.params.factId);
    if (tenantId == null || factId == null) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const outcome = await approveAutoLearnedFact(tenantId, factId);
    if (!outcome.ok) {
      if (outcome.reason === "not_found") {
        res.status(404).json({ error: "Fact not found" });
        return;
      }
      res.status(409).json({
        error: "Fact is not awaiting review (already approved or rejected).",
      });
      return;
    }
    res.json(outcome.fact);
  },
);

router.post(
  "/tenants/:tenantId/knowledge/auto-learned/:factId/reject",
  async (req: Request, res: Response): Promise<void> => {
    const tenantId = parseId(req.params.tenantId);
    const factId = parseId(req.params.factId);
    if (tenantId == null || factId == null) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const outcome = await rejectAutoLearnedFact(tenantId, factId);
    if (!outcome.ok) {
      if (outcome.reason === "not_found") {
        res.status(404).json({ error: "Fact not found" });
        return;
      }
      res.status(409).json({
        error: "Fact is not awaiting review (already approved or rejected).",
      });
      return;
    }
    res.json(outcome.fact);
  },
);

export default router;
