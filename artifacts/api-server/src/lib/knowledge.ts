import { eq, and, desc, sql, type SQL } from "drizzle-orm";
import {
  db,
  knowledgeDocumentsTable,
  knowledgeChunksTable,
  classroomVersionsTable,
  classroomFactsTable,
  type ClassroomFact,
  type ClassroomVersion,
  type KnowledgeDocument,
} from "@workspace/db";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import * as dns from "node:dns/promises";
import type { LookupAddress, LookupOptions } from "node:dns";
import * as net from "node:net";
import * as http from "node:http";
import * as https from "node:https";
import { grokClient, PROFESSOR_MODEL } from "./grokClient";

/**
 * Knowledge service — extraction, chunking, token accounting, full-text
 * retrieval, fact extraction, and Professor chat for the LLM hierarchy.
 */

// "10M memory" is a token-budgeted Library, not a literal context window.
export const MEMORY_BUDGET_TOKENS = 10_000_000;

// Rough token estimate (~4 chars/token). Good enough for the memory meter; the
// live API usage numbers are authoritative for chat accounting.
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

// Split text into retrievable chunks on paragraph boundaries.
export function chunkText(text: string, maxChars = 1800): string[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) return [];
  const paragraphs = clean.split(/\n{2,}/);
  const chunks: string[] = [];
  let buf = "";
  for (const raw of paragraphs) {
    const para = raw.trim();
    if (!para) continue;
    if (para.length > maxChars) {
      if (buf) {
        chunks.push(buf);
        buf = "";
      }
      for (let start = 0; start < para.length; start += maxChars) {
        chunks.push(para.slice(start, start + maxChars));
      }
      continue;
    }
    if (buf && (buf + "\n\n" + para).length > maxChars) {
      chunks.push(buf);
      buf = para;
    } else {
      buf = buf ? buf + "\n\n" + para : para;
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}

export async function extractTextFromFile(
  buffer: Buffer,
  originalName: string,
): Promise<string> {
  const ext = originalName.split(".").pop()?.toLowerCase();
  if (ext === "pdf") {
    const data = new Uint8Array(buffer);
    const doc = await getDocument({ data, useSystemFonts: true }).promise;
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .filter(Boolean)
        .join(" ");
      if (text.trim()) pages.push(text.trim());
    }
    return pages.join("\n\n");
  }
  if (ext === "txt" || ext === "md" || ext === "csv") {
    return buffer.toString("utf-8").trim();
  }
  throw new Error(`Unsupported file type: .${ext}. Use PDF, TXT, MD, or CSV.`);
}

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article|header|footer)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(?:39|x27);/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const URL_FETCH_TIMEOUT_MS = 10_000;
const URL_MAX_BYTES = 3_000_000; // 3 MB
const URL_MAX_REDIRECTS = 4;

// Blocklist of non-public IP ranges (RFC1918, loopback, link-local, CGNAT,
// multicast, reserved, plus IPv6 ULA/link-local/loopback). net.BlockList
// automatically maps IPv4-mapped IPv6 addresses (e.g. ::ffff:127.0.0.1,
// ::ffff:7f00:1) onto the IPv4 rules below, so private mapped forms are caught
// without a dedicated ::ffff:0:0/96 entry — and adding that /96 would wrongly
// block every public IPv4 address.
function buildSsrfBlockList(): InstanceType<typeof net.BlockList> {
  const bl = new net.BlockList();
  // IPv4
  bl.addSubnet("0.0.0.0", 8, "ipv4"); // "this" network / 0.0.0.0
  bl.addSubnet("10.0.0.0", 8, "ipv4"); // private
  bl.addSubnet("100.64.0.0", 10, "ipv4"); // CGNAT
  bl.addSubnet("127.0.0.0", 8, "ipv4"); // loopback
  bl.addSubnet("169.254.0.0", 16, "ipv4"); // link-local
  bl.addSubnet("172.16.0.0", 12, "ipv4"); // private
  bl.addSubnet("192.0.0.0", 24, "ipv4"); // IETF protocol assignments
  bl.addSubnet("192.0.2.0", 24, "ipv4"); // documentation
  bl.addSubnet("192.168.0.0", 16, "ipv4"); // private
  bl.addSubnet("198.18.0.0", 15, "ipv4"); // benchmarking
  bl.addSubnet("198.51.100.0", 24, "ipv4"); // documentation
  bl.addSubnet("203.0.113.0", 24, "ipv4"); // documentation
  bl.addSubnet("224.0.0.0", 4, "ipv4"); // multicast
  bl.addSubnet("240.0.0.0", 4, "ipv4"); // reserved
  bl.addAddress("255.255.255.255", "ipv4"); // broadcast
  // IPv6
  bl.addAddress("::", "ipv6"); // unspecified
  bl.addAddress("::1", "ipv6"); // loopback
  bl.addSubnet("fc00::", 7, "ipv6"); // unique local
  bl.addSubnet("fe80::", 10, "ipv6"); // link local
  bl.addSubnet("ff00::", 8, "ipv6"); // multicast
  bl.addSubnet("2001:db8::", 32, "ipv6"); // documentation
  return bl;
}

const SSRF_BLOCKLIST = buildSsrfBlockList();

function ipIsBlocked(ip: string): boolean {
  const fam = net.isIP(ip);
  if (fam === 4) return SSRF_BLOCKLIST.check(ip, "ipv4");
  if (fam === 6) return SSRF_BLOCKLIST.check(ip, "ipv6");
  return true; // not a recognizable IP literal → reject
}

// Custom DNS resolver bound to the actual socket connection. By resolving the
// hostname here and handing the socket only validated public IPs, we close the
// DNS-rebinding (TOCTOU) window — the connection can never reach an address
// that was not checked. Used as the http/https `lookup` option.
function safeLookup(
  hostname: string,
  options: LookupOptions,
  callback: (
    err: NodeJS.ErrnoException | null,
    address: string | LookupAddress[],
    family?: number,
  ) => void,
): void {
  const wantAll = typeof options === "object" && options?.all === true;
  const family =
    typeof options === "object" ? (options?.family ?? 0) : Number(options) || 0;
  dns
    .lookup(hostname, { all: true, family, verbatim: true })
    .then((addrs) => {
      const safe = addrs.filter((a) => !ipIsBlocked(a.address));
      if (safe.length === 0) {
        callback(
          Object.assign(
            new Error("URL resolves to a non-public address"),
            { code: "ENOTFOUND" },
          ),
          "",
        );
        return;
      }
      if (wantAll) {
        callback(null, safe);
      } else {
        callback(null, safe[0]!.address, safe[0]!.family);
      }
    })
    .catch((err) => callback(err as NodeJS.ErrnoException, ""));
}

// SSRF guard for literal-IP hosts and protocol. Integer/hex/octal IPv4 hosts
// (e.g. http://2130706433) are normalized to dotted-decimal by the WHATWG URL
// parser, so they are caught here. Hostnames are validated at connect time by
// safeLookup, which pins the socket to a checked address.
function assertPublicHttpUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("Invalid URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("Only http and https URLs are allowed");
  }
  if (net.isIP(u.hostname) && ipIsBlocked(u.hostname)) {
    throw new Error("URL points to a non-public address");
  }
  return u;
}

function openRequest(
  u: URL,
): Promise<{ res: http.IncomingMessage; req: http.ClientRequest }> {
  return new Promise((resolve, reject) => {
    const mod = u.protocol === "https:" ? https : http;
    const req = mod.request(
      u,
      {
        method: "GET",
        lookup: safeLookup as unknown as net.LookupFunction,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; TextitieProfessor/1.0)",
          Accept:
            "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
          "Accept-Encoding": "identity",
        },
      },
      (res) => resolve({ res, req }),
    );
    req.on("error", reject);
    req.end();
  });
}

function readStreamCapped(
  stream: http.IncomingMessage,
  maxBytes: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    stream.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        stream.destroy();
        reject(new Error("Remote document is too large"));
        return;
      }
      chunks.push(chunk);
    });
    stream.on("end", () =>
      resolve(Buffer.concat(chunks).toString("utf-8")),
    );
    stream.on("error", reject);
  });
}

export async function extractTextFromUrl(
  url: string,
): Promise<{ title: string; text: string }> {
  let current = url;
  for (let hop = 0; hop <= URL_MAX_REDIRECTS; hop++) {
    const u = assertPublicHttpUrl(current);
    const { res, req } = await openRequest(u);
    const timer = setTimeout(
      () => req.destroy(new Error("Request timed out")),
      URL_FETCH_TIMEOUT_MS,
    );
    try {
      const status = res.statusCode ?? 0;
      // Manual redirect handling so each hop is re-validated by assertPublicHttpUrl
      // and re-resolved by safeLookup (no redirect can bounce us to a private IP).
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume(); // drain the redirect body
        current = new URL(res.headers.location, current).toString();
        continue;
      }
      if (status < 200 || status >= 400) {
        res.resume();
        throw new Error(`Fetch failed: HTTP ${status}`);
      }
      const len = res.headers["content-length"];
      if (len && Number(len) > URL_MAX_BYTES) {
        res.destroy();
        throw new Error("Remote document is too large");
      }
      const html = await readStreamCapped(res, URL_MAX_BYTES);
      const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      const title = titleMatch
        ? htmlToText(titleMatch[1]).slice(0, 200)
        : current;
      const text = htmlToText(html);
      return { title, text };
    } finally {
      clearTimeout(timer);
      req.destroy();
    }
  }
  throw new Error("Too many redirects");
}

export async function createDocumentWithChunks(input: {
  tenantId: number;
  sourceType: "file" | "url" | "paste" | "legacy";
  title: string;
  extractedText: string;
  sourceUrl?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  createdBy?: number | null;
}): Promise<KnowledgeDocument> {
  const tokenCount = estimateTokens(input.extractedText);
  const chunks = chunkText(input.extractedText);
  return await db.transaction(async (tx) => {
    const [doc] = await tx
      .insert(knowledgeDocumentsTable)
      .values({
        tenantId: input.tenantId,
        sourceType: input.sourceType,
        title: input.title,
        extractedText: input.extractedText,
        sourceUrl: input.sourceUrl ?? null,
        fileName: input.fileName ?? null,
        mimeType: input.mimeType ?? null,
        tokenCount,
        status: "ready",
        createdBy: input.createdBy ?? null,
      })
      .returning();
    if (!doc) throw new Error("Failed to insert knowledge document");
    if (chunks.length > 0) {
      await tx.insert(knowledgeChunksTable).values(
        chunks.map((c, i) => ({
          tenantId: input.tenantId,
          documentId: doc.id,
          chunkIndex: i,
          text: c,
          tokenCount: estimateTokens(c),
        })),
      );
    }
    return doc;
  });
}

// Full-text retrieval over the tenant's Library, for grounding Professor chat.
export async function retrieveLibraryContext(
  tenantId: number,
  query: string,
  limit = 8,
): Promise<
  { text: string; documentId: number; title: string; sourceUrl: string | null }[]
> {
  const q = query.trim();
  if (!q) return [];

  const runSearch = (tsquery: SQL) =>
    db
      .select({
        text: knowledgeChunksTable.text,
        documentId: knowledgeChunksTable.documentId,
        title: knowledgeDocumentsTable.title,
        sourceUrl: knowledgeDocumentsTable.sourceUrl,
      })
      .from(knowledgeChunksTable)
      .innerJoin(
        knowledgeDocumentsTable,
        eq(knowledgeChunksTable.documentId, knowledgeDocumentsTable.id),
      )
      .where(
        and(
          eq(knowledgeChunksTable.tenantId, tenantId),
          sql`to_tsvector('english', ${knowledgeChunksTable.text}) @@ ${tsquery}`,
        ),
      )
      .orderBy(
        sql`ts_rank(to_tsvector('english', ${knowledgeChunksTable.text}), ${tsquery}) DESC`,
      )
      .limit(limit);

  // 1) Precise: websearch_to_tsquery ANDs every lexeme — great for tight
  //    queries. 2) Fallback: the same normalized lexemes OR-ed together, so
  //    conversational phrasing ("tell me in 250 words why ...") can't zero out
  //    the match just because filler words ("250", "words") aren't in any
  //    source. We re-rank by ts_rank either way, so the best chunks float up.
  const precise = sql`websearch_to_tsquery('english', ${q})`;
  let rows = await runSearch(precise);
  if (rows.length === 0) {
    const loose = sql`replace(websearch_to_tsquery('english', ${q})::text, '&', '|')::tsquery`;
    rows = await runSearch(loose);
  }
  return rows;
}

export async function getCurrentClassroomVersion(
  tenantId: number,
): Promise<ClassroomVersion | null> {
  const [v] = await db
    .select()
    .from(classroomVersionsTable)
    .where(
      and(
        eq(classroomVersionsTable.tenantId, tenantId),
        eq(classroomVersionsTable.status, "published"),
      ),
    )
    .orderBy(desc(classroomVersionsTable.version))
    .limit(1);
  return v ?? null;
}

// Retrieval over the published Classroom, for the Student. Falls back to the
// top facts of the current version when FTS finds no lexical match.
export async function retrieveClassroomFacts(
  tenantId: number,
  query: string,
  limit = 12,
): Promise<ClassroomFact[]> {
  const version = await getCurrentClassroomVersion(tenantId);
  if (!version) return [];
  const q = query.trim();
  if (q) {
    const rows = await db
      .select()
      .from(classroomFactsTable)
      .where(
        and(
          eq(classroomFactsTable.versionId, version.id),
          sql`to_tsvector('english', ${classroomFactsTable.statement}) @@ websearch_to_tsquery('english', ${q})`,
        ),
      )
      .orderBy(
        sql`ts_rank(to_tsvector('english', ${classroomFactsTable.statement}), websearch_to_tsquery('english', ${q})) DESC`,
      )
      .limit(limit);
    if (rows.length > 0) return rows;
  }
  return await db
    .select()
    .from(classroomFactsTable)
    .where(eq(classroomFactsTable.versionId, version.id))
    .limit(limit);
}

function parseFactArray(text: string): string[] {
  let t = text.trim();
  t = t.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = t.indexOf("[");
  const end = t.lastIndexOf("]");
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  try {
    const arr: unknown = JSON.parse(t);
    if (Array.isArray(arr)) {
      return arr
        .map((x) => String(x).trim())
        .filter((s) => s.length > 0)
        .slice(0, 25);
    }
  } catch {
    // fall through
  }
  return [];
}

// Ask the Professor model to extract atomic facts from a source document.
export async function extractFacts(
  sourceText: string,
  sourceLabel: string,
): Promise<{ facts: string[]; tokensUsed: number }> {
  const oai = grokClient();
  if (!oai) return { facts: [], tokensUsed: 0 };
  const trimmed = sourceText.slice(0, 12000);
  const resp = await oai.chat.completions.create({
    model: PROFESSOR_MODEL,
    temperature: 0.1,
    max_tokens: 1400,
    messages: [
      {
        role: "system",
        content:
          "You extract atomic, standalone facts from a source document for a customer-support knowledge base. Return ONLY a JSON array of concise fact strings — each a single self-contained sentence, no numbering, no markdown. Maximum 15 facts. Omit fluff, marketing, and navigation text.",
      },
      { role: "user", content: `SOURCE: ${sourceLabel}\n\n${trimmed}` },
    ],
  });
  const text = resp.choices[0]?.message?.content?.trim() ?? "";
  return { facts: parseFactArray(text), tokensUsed: resp.usage?.total_tokens ?? 0 };
}

// One Professor chat turn, grounded in retrieved Library context.
export async function professorReply(opts: {
  tenantName: string;
  libraryContext: string;
  history: { role: "user" | "assistant"; content: string }[];
}): Promise<{ content: string; tokensUsed: number; stubbed: boolean }> {
  const oai = grokClient();
  if (!oai) {
    return {
      content:
        "[Professor offline — set the GROK_KEYS secret to enable live curation.]",
      tokensUsed: 0,
      stubbed: true,
    };
  }
  const system = `You are "the Professor" — a brilliant, well-read subject-matter expert working WITH a human curator to build and sharpen the knowledge base for "${opts.tenantName}". This is a collaborative, two-way learning session, not a lookup service.

You draw on two sources of knowledge:
1. LIBRARY CONTEXT (below): the tenant's own curated sources. Treat these as authoritative for anything specific to "${opts.tenantName}" — their policies, pricing, procedures, numbers, and voice. Prefer them over your own assumptions and cite them when you use them.
2. Your own deep expertise: you genuinely know business communication, SMS / A2P 10DLC compliance, customer support, marketing, and the tenant's domain. When the Library is empty, thin, or off-topic, DO NOT refuse and DO NOT ask the human to paste a source instead of thinking — answer fully and substantively from what you know.

Every turn:
- Engage the actual question and give a substantive, well-structured answer (respect any length the curator asks for).
- Move the curation forward: note what the Library is missing or where it is unverified, ask one sharp clarifying question, and propose concrete, atomic facts worth absorbing so the Students can reuse them later.
- Be explicit about provenance: separate what is grounded in the tenant's Library (cite it) from what is your own general expertise (offer to absorb it if the curator agrees).
- Never reply with "no library context available." Your intelligence leads; the Library augments you, it does not gate you.

LIBRARY CONTEXT:
${opts.libraryContext || "(No tenant sources matched this turn — answer from your own expertise and help the curator decide what is worth capturing.)"}`;
  const resp = await oai.chat.completions.create({
    model: PROFESSOR_MODEL,
    temperature: 0.3,
    max_tokens: 1500,
    messages: [{ role: "system", content: system }, ...opts.history],
  });
  const content = resp.choices[0]?.message?.content?.trim() ?? "";
  return {
    content,
    tokensUsed: resp.usage?.total_tokens ?? 0,
    stubbed: false,
  };
}
