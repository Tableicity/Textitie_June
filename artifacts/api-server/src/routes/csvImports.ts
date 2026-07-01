import {
  Router,
  type IRouter,
  type Request,
  type Response,
} from "express";
import multer from "multer";
import Papa from "papaparse";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  tenantsTable,
  contactsTable,
  csvImportJobsTable,
  csvImportRowsTable,
  type CsvImportJob,
} from "@workspace/db";
import { FlipCsvImportLiveBody } from "@workspace/api-zod";
import { normalizePhoneE164 } from "../lib/phoneNumberRegistry";
import { pgErrorCode } from "../lib/migrationActions";
import { flipCsvImportLive, discardCsvImport } from "../lib/csvImportActions";

/**
 * CSV Contact Import — Conductor routes. A lighter, self-contained SIBLING of
 * the TextLine Migration ("Smasher"): the operator uploads a CSV, it is parsed
 * + staged (OUTSIDE the live contacts table), the operator reviews a summary,
 * then flips it live (INSERT new contacts + resolve duplicates per-import) or
 * discards it. The TextLine Migration build is never touched.
 *
 * All paths live under /tenants/:tenantId/csv-imports..., which is NOT in
 * conductorAuth's tenant-scoped allow-list, so they require Conductor (admin)
 * auth by default — same mechanism as the migrations + brain routers.
 *
 * The upload endpoint is multipart (outside the OpenAPI/generated client, like
 * the knowledge PDF upload); list/get/flip-live/discard are typed JSON.
 */

const router: IRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

// Cap on how many rows we insert per statement so a large CSV never blows the
// Postgres bind-parameter limit (~65k params / ~11 cols per row).
const ROW_INSERT_CHUNK = 500;
// How many example bad/dup rows to surface in the operator review summary.
const MAX_SAMPLE = 15;

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

function toJobApi(j: CsvImportJob) {
  return {
    id: j.id,
    tenantId: j.tenantId,
    source: j.source,
    status: j.status,
    originalFilename: j.originalFilename,
    summary: j.summary,
    createdBy: j.createdBy,
    createdAt: j.createdAt,
    updatedAt: j.updatedAt,
  };
}

// Canonical CSV columns -> accepted header aliases (compared lowercased).
const COLUMN_ALIASES: Record<string, string[]> = {
  phone: [
    "phone",
    "phone number",
    "phonenumber",
    "mobile",
    "cell",
    "cellphone",
    "number",
    "tel",
    "telephone",
  ],
  name: [
    "name",
    "full name",
    "fullname",
    "contact",
    "contact name",
    "customer",
    "customer name",
  ],
  email: ["email", "e-mail", "email address"],
  location: ["location", "city", "address", "region"],
  notes: ["notes", "note", "comment", "comments", "description"],
  tags: ["tags", "tag", "labels", "label", "groups", "group"],
};

/** Map each canonical column to the actual header key present in the file. */
function buildHeaderMap(fields: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  const lowerToActual = new Map<string, string>();
  for (const f of fields) lowerToActual.set(f.trim().toLowerCase(), f);
  for (const [canonical, aliases] of Object.entries(COLUMN_ALIASES)) {
    for (const alias of aliases) {
      const actual = lowerToActual.get(alias);
      if (actual) {
        map[canonical] = actual;
        break;
      }
    }
  }
  return map;
}

function cellStr(
  row: Record<string, unknown>,
  key: string | undefined,
): string | null {
  if (!key) return null;
  const v = row[key];
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function parseTags(raw: string | null): string[] | null {
  if (!raw) return null;
  const parts = raw
    .split(/[,;|]/)
    .map((t) => t.trim())
    .filter(Boolean);
  return parts.length ? Array.from(new Set(parts)) : null;
}

type RowStatus = "valid" | "duplicate" | "invalid";
type StagedRow = {
  rowNumber: number;
  phone: string | null;
  name: string | null;
  email: string | null;
  location: string | null;
  notes: string | null;
  tags: string[] | null;
  rawPayload: Record<string, unknown>;
  status: RowStatus;
  errorReason: string | null;
};

// --- Upload + stage (multipart) ---------------------------------------------

router.post(
  "/tenants/:tenantId/csv-imports",
  (req, res, next) => {
    upload.single("file")(req, res, (err: unknown) => {
      if (err) {
        const e = err as { code?: string; message?: string };
        if (e.code === "LIMIT_FILE_SIZE") {
          res
            .status(413)
            .json({ error: "File too large. Maximum size is 5MB." });
          return;
        }
        res.status(400).json({ error: `Upload error: ${e.message ?? err}` });
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

    const parsed = Papa.parse<Record<string, unknown>>(
      file.buffer.toString("utf8"),
      { header: true, skipEmptyLines: "greedy" },
    );
    const fields = parsed.meta.fields ?? [];
    const headerMap = buildHeaderMap(fields);
    if (!headerMap.phone) {
      res.status(400).json({
        error:
          "CSV must include a phone column (accepted headers: phone, phone number, mobile, cell, number).",
      });
      return;
    }

    const dataRows = parsed.data ?? [];
    if (dataRows.length === 0) {
      res.status(400).json({ error: "No data rows found in the CSV." });
      return;
    }

    // Stage every row: normalize + classify by phone validity first.
    const staged: StagedRow[] = [];
    const validPhones = new Set<string>();
    dataRows.forEach((row, i) => {
      const rowNumber = i + 2; // +1 header line, +1 to 1-index the data
      const rawPhone = cellStr(row, headerMap.phone);
      let phone: string | null = null;
      let status: RowStatus = "valid";
      let errorReason: string | null = null;
      try {
        phone = normalizePhoneE164(rawPhone);
        if (phone == null) {
          status = "invalid";
          errorReason = "Missing phone number";
        }
      } catch {
        status = "invalid";
        errorReason = `Unparseable phone number: "${rawPhone}"`;
        phone = null;
      }
      if (phone) validPhones.add(phone);
      staged.push({
        rowNumber,
        phone,
        name: cellStr(row, headerMap.name),
        email: cellStr(row, headerMap.email),
        location: cellStr(row, headerMap.location),
        notes: cellStr(row, headerMap.notes),
        tags: parseTags(cellStr(row, headerMap.tags)),
        rawPayload: row,
        status,
        errorReason,
      });
    });

    // Duplicate detection: which candidate phones already exist LIVE.
    const existing = new Set<string>();
    if (validPhones.size > 0) {
      const rows = await db
        .select({ phone: contactsTable.phone })
        .from(contactsTable)
        .where(
          and(
            eq(contactsTable.tenantId, tenantId),
            eq(contactsTable.isQuarantined, false),
            inArray(contactsTable.phone, Array.from(validPhones)),
          ),
        );
      for (const r of rows) existing.add(r.phone);
    }
    for (const s of staged) {
      if (s.status === "valid" && s.phone && existing.has(s.phone)) {
        s.status = "duplicate";
      }
    }

    const counts = { total: staged.length, valid: 0, duplicate: 0, invalid: 0 };
    for (const s of staged) counts[s.status] += 1;

    const summary = {
      ...counts,
      sampleInvalid: staged
        .filter((s) => s.status === "invalid")
        .slice(0, MAX_SAMPLE)
        .map((s) => ({ rowNumber: s.rowNumber, reason: s.errorReason })),
      sampleDuplicate: staged
        .filter((s) => s.status === "duplicate")
        .slice(0, MAX_SAMPLE)
        .map((s) => ({ rowNumber: s.rowNumber, phone: s.phone, name: s.name })),
      parseErrors: (parsed.errors ?? [])
        .slice(0, MAX_SAMPLE)
        .map((e) => ({ row: e.row ?? null, message: e.message })),
    };

    try {
      const job = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(csvImportJobsTable)
          .values({
            tenantId,
            source: "csv",
            status: "review",
            originalFilename: file.originalname,
            summary,
          })
          .returning();
        const values = staged.map((s) => ({
          jobId: created.id,
          tenantId,
          rowNumber: s.rowNumber,
          phone: s.phone,
          name: s.name,
          email: s.email,
          location: s.location,
          notes: s.notes,
          tags: s.tags,
          rawPayload: s.rawPayload,
          status: s.status,
          errorReason: s.errorReason,
        }));
        for (let i = 0; i < values.length; i += ROW_INSERT_CHUNK) {
          await tx
            .insert(csvImportRowsTable)
            .values(values.slice(i, i + ROW_INSERT_CHUNK));
        }
        return created;
      });
      res.status(201).json(toJobApi(job));
    } catch (err) {
      if (pgErrorCode(err) === "23505") {
        res.status(409).json({
          error:
            "An import is already awaiting review for this tenant. Flip it live or discard it first.",
        });
        return;
      }
      req.log.error({ err }, "CSV import upload failed");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// --- List --------------------------------------------------------------------

router.get(
  "/tenants/:tenantId/csv-imports",
  async (req: Request, res: Response): Promise<void> => {
    const tenantId = parseId(req.params.tenantId);
    if (tenantId == null) {
      res.status(400).json({ error: "Invalid tenant id" });
      return;
    }
    const jobs = await db
      .select()
      .from(csvImportJobsTable)
      .where(eq(csvImportJobsTable.tenantId, tenantId))
      .orderBy(desc(csvImportJobsTable.createdAt))
      .limit(50);
    res.json(jobs.map(toJobApi));
  },
);

// --- Get / status ------------------------------------------------------------

router.get(
  "/tenants/:tenantId/csv-imports/:jobId",
  async (req: Request, res: Response): Promise<void> => {
    const tenantId = parseId(req.params.tenantId);
    const jobId = parseId(req.params.jobId);
    if (tenantId == null || jobId == null) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const [job] = await db
      .select()
      .from(csvImportJobsTable)
      .where(
        and(
          eq(csvImportJobsTable.id, jobId),
          eq(csvImportJobsTable.tenantId, tenantId),
        ),
      );
    if (!job) {
      res.status(404).json({ error: "CSV import job not found" });
      return;
    }
    res.json(toJobApi(job));
  },
);

// --- Flip live ---------------------------------------------------------------

router.post(
  "/tenants/:tenantId/csv-imports/:jobId/flip-live",
  async (req: Request, res: Response): Promise<void> => {
    const tenantId = parseId(req.params.tenantId);
    const jobId = parseId(req.params.jobId);
    if (tenantId == null || jobId == null) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const parsed = FlipCsvImportLiveBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid input: duplicateResolution must be 'update' or 'skip'.",
      });
      return;
    }
    try {
      const result = await flipCsvImportLive(
        tenantId,
        jobId,
        parsed.data.duplicateResolution,
      );
      if (!result.ok) {
        if (result.reason === "missing") {
          res.status(404).json({ error: "CSV import job not found" });
          return;
        }
        res.status(400).json({
          error: `Job is not in a flippable state (status: ${result.current}).`,
        });
        return;
      }
    } catch (err) {
      req.log.error({ err }, "CSV import flip-live failed");
      res.status(500).json({ error: "Internal server error" });
      return;
    }
    const [job] = await db
      .select()
      .from(csvImportJobsTable)
      .where(
        and(
          eq(csvImportJobsTable.id, jobId),
          eq(csvImportJobsTable.tenantId, tenantId),
        ),
      );
    if (!job) {
      res.status(404).json({ error: "CSV import job not found" });
      return;
    }
    res.json(toJobApi(job));
  },
);

// --- Discard -----------------------------------------------------------------

router.post(
  "/tenants/:tenantId/csv-imports/:jobId/discard",
  async (req: Request, res: Response): Promise<void> => {
    const tenantId = parseId(req.params.tenantId);
    const jobId = parseId(req.params.jobId);
    if (tenantId == null || jobId == null) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    try {
      const result = await discardCsvImport(tenantId, jobId);
      if (!result.ok) {
        if (result.reason === "missing") {
          res.status(404).json({ error: "CSV import job not found" });
          return;
        }
        res.status(409).json({
          error: `Job is not in a discardable state (status: ${result.current}).`,
        });
        return;
      }
    } catch (err) {
      req.log.error({ err }, "CSV import discard failed");
      res.status(500).json({ error: "Internal server error" });
      return;
    }
    const [job] = await db
      .select()
      .from(csvImportJobsTable)
      .where(
        and(
          eq(csvImportJobsTable.id, jobId),
          eq(csvImportJobsTable.tenantId, tenantId),
        ),
      );
    if (!job) {
      res.status(404).json({ error: "CSV import job not found" });
      return;
    }
    res.json(toJobApi(job));
  },
);

export default router;
