import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import multer from "multer";
import {
  db,
  tenantsTable,
  knowledgeDocumentsTable,
  knowledgeChunksTable,
  professorSessionsTable,
  professorMessagesTable,
  absorbedFactsTable,
  classroomVersionsTable,
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
} from "../lib/knowledge";
import { grokClient, PROFESSOR_MODEL } from "../lib/grokClient";

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
  const libraryContext = contextRows.map((r) => r.text).join("\n\n---\n\n");
  return {
    tenantName: tenant?.name ?? "this tenant",
    libraryContext,
  };
}

function professorSystemPrompt(tenantName: string, libraryContext: string) {
  return `You are "the Professor", a niche subject-matter expert helping a human curate a per-tenant knowledge base for "${tenantName}". You absorb provided sources and answer the human's questions to refine, organize, and verify knowledge that lightweight "student" assistants will later use to answer customer messages. Be substantive but concise. Ground answers in the LIBRARY CONTEXT when relevant; if the context is empty or insufficient, say so and ask for the source.

LIBRARY CONTEXT:
${libraryContext || "(no sources retrieved for this query)"}`;
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
            facts.map((statement) => ({
              tenantId: opts.tenantId,
              sessionId: session!.id,
              documentId: doc.id,
              sourceLabel: doc.title,
              statement,
              status: "draft",
              tokenCount: estimateTokens(statement),
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

    const oai = grokClient();
    let replyText: string;
    let tokensUsed: number;
    let stubbed: boolean;
    if (!oai) {
      replyText =
        "[Professor offline — set the GROK_KEYS secret to enable live curation.]";
      tokensUsed = 0;
      stubbed = true;
    } else {
      try {
        const resp = await oai.chat.completions.create({
          model: PROFESSOR_MODEL,
          temperature: 0.3,
          max_tokens: 1000,
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

    const oai = grokClient();
    let replyText = "";
    let usageTokens = 0;
    let stubbed = false;

    if (!oai) {
      replyText =
        "[Professor offline — set the GROK_KEYS secret to enable live curation.]";
      stubbed = true;
      send("token", { delta: replyText });
    } else {
      try {
        const stream = await oai.chat.completions.create({
          model: PROFESSOR_MODEL,
          temperature: 0.3,
          max_tokens: 1000,
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
      .set({ status: parsed.data.status })
      .where(eq(absorbedFactsTable.id, factId))
      .returning();
    res.json(row ?? fact);
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
    const baseWhere = and(
      eq(absorbedFactsTable.tenantId, tenantId),
      eq(absorbedFactsTable.status, "published"),
    );
    const factsToPublish: AbsorbedFact[] =
      sessionIds.length > 0
        ? await db
            .select()
            .from(absorbedFactsTable)
            .where(
              and(baseWhere, inArray(absorbedFactsTable.sessionId, sessionIds)),
            )
        : await db.select().from(absorbedFactsTable).where(baseWhere);

    if (factsToPublish.length === 0) {
      res.status(400).json({
        error:
          "Nothing to publish — accept (✓) some absorbed facts before pushing to the Classroom.",
      });
      return;
    }

    const [latest] = await db
      .select({ version: classroomVersionsTable.version })
      .from(classroomVersionsTable)
      .where(eq(classroomVersionsTable.tenantId, tenantId))
      .orderBy(desc(classroomVersionsTable.version))
      .limit(1);
    const nextVersion = (latest?.version ?? 0) + 1;
    const tokenCount = factsToPublish.reduce(
      (sum, f) => sum + (f.tokenCount ?? 0),
      0,
    );

    const snapshot = await db.transaction(async (tx) => {
      await tx
        .update(classroomVersionsTable)
        .set({ status: "superseded" })
        .where(
          and(
            eq(classroomVersionsTable.tenantId, tenantId),
            eq(classroomVersionsTable.status, "published"),
          ),
        );
      const [version] = await tx
        .insert(classroomVersionsTable)
        .values({
          tenantId,
          version: nextVersion,
          status: "published",
          summary: parsed.data.summary ?? null,
          factCount: factsToPublish.length,
          tokenCount,
        })
        .returning();
      if (!version) throw new Error("Failed to create classroom version");
      const facts = await tx
        .insert(classroomFactsTable)
        .values(
          factsToPublish.map((f) => ({
            tenantId,
            versionId: version.id,
            sourceLabel: f.sourceLabel,
            statement: f.statement,
            tokenCount: f.tokenCount,
          })),
        )
        .returning();
      await tx
        .update(absorbedFactsTable)
        .set({ status: "published" })
        .where(
          inArray(
            absorbedFactsTable.id,
            factsToPublish.map((f) => f.id),
          ),
        );
      // Free the active-session slots that fed this Classroom version.
      if (sessionIds.length > 0) {
        await tx
          .update(professorSessionsTable)
          .set({ status: "pushed" })
          .where(
            and(
              eq(professorSessionsTable.tenantId, tenantId),
              inArray(professorSessionsTable.id, sessionIds),
            ),
          );
      } else {
        await tx
          .update(professorSessionsTable)
          .set({ status: "pushed" })
          .where(
            and(
              eq(professorSessionsTable.tenantId, tenantId),
              eq(professorSessionsTable.status, "active"),
            ),
          );
      }
      return { version, facts };
    });

    res.status(201).json({
      version: toVersionApi(snapshot.version),
      facts: snapshot.facts,
      factCount: snapshot.facts.length,
    });
  },
);

export default router;
