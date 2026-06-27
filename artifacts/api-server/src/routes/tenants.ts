import { Router, type IRouter, type Request } from "express";
import { eq, sql, and, isNull, desc } from "drizzle-orm";
import multer from "multer";
import twilio from "twilio";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  db,
  tenantsTable,
  tenantUsersTable,
  phoneNumbersTable,
  departmentsTable,
  conversationsTable,
} from "@workspace/db";
import {
  ListTenantsResponse,
  CreateTenantBody,
  GetTenantParams,
  GetTenantResponse,
  GetOwnedNumbersResponse,
  GetTenantUsersParams,
  GetTenantUsersResponse,
  UpdateTenantBody,
  UpdateTenantParams,
  UpdateTenantResponse,
  GetTenantDepartmentsParams,
  GetTenantDepartmentsResponse,
  AssignTenantDepartmentNumberParams,
  AssignTenantDepartmentNumberBody,
  AssignTenantDepartmentNumberResponse,
  CreateTenantDepartmentParams,
  CreateTenantDepartmentBody,
  CreateTenantDepartmentResponse,
  GetTenantUnassignedConversationsParams,
  GetTenantUnassignedConversationsResponse,
  AssignTenantConversationDepartmentParams,
  AssignTenantConversationDepartmentBody,
  AssignTenantConversationDepartmentResponse,
} from "@workspace/api-zod";
import { provisionChatwootInbox } from "../lib/chatwoot";
import { requireTenantAuth } from "../middleware/tenantAuth";
import {
  setTenantPrimaryNumber,
  setDepartmentNumber,
  PhoneNumberConflictError,
} from "../lib/phoneNumberRegistry";
import { applyInboundWebhookByNumber } from "../lib/twilioNumberWebhook";
import { syncCarrierBillingToStripe } from "../lib/carrierBilling";

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// Seed/demo tenants that seedDemoData re-creates on every boot. Deleting them is
// pointless (they come back next boot) and risky, so the destructive delete
// endpoint refuses them outright.
const PROTECTED_TENANT_SLUGS = new Set(["acme"]);

router.get("/tenants", async (_req, res): Promise<void> => {
  const rows = await db.select().from(tenantsTable).orderBy(tenantsTable.id);
  res.json(ListTenantsResponse.parse(rows));
});

function getTwilioClient() {
  const sid = process.env["TWILIO_ACCOUNT_SID"];
  const token = process.env["TWILIO_AUTH_TOKEN"];
  if (!sid || !token) return null;
  return twilio(sid, token);
}

/**
 * After a number is assigned through the registry — a tenant's PRIMARY number OR
 * a department number — point that number's inbound webhook at us so an
 * admin-injected (already-owned) number is never left "deaf". Best-effort: the
 * DB registry write is the source of truth; a webhook miss is logged and
 * repairable via /phone-provisioning/repair-webhooks. Also records the resolved
 * Twilio SID on the registry row so reconcile/repair treat an admin-injected
 * number the same as a purchased one.
 */
async function wireNumberWebhook(
  req: Request,
  phoneNumber: string,
): Promise<void> {
  try {
    const client = getTwilioClient();
    if (!client) return;
    const result = await applyInboundWebhookByNumber(client, phoneNumber);
    if (!result.ok) {
      req.log.warn(
        { phoneNumber, reason: result.reason },
        "Assigned number but did not set inbound webhook; run /phone-provisioning/repair-webhooks",
      );
      return;
    }
    req.log.info(
      { phoneNumber, sid: result.sid },
      "Set inbound webhook on assigned number",
    );
    try {
      await db
        .update(phoneNumbersTable)
        .set({ twilioSid: result.sid })
        .where(eq(phoneNumbersTable.phoneNumber, phoneNumber));
    } catch (sidErr) {
      req.log.warn(
        { err: sidErr, phoneNumber },
        "Set inbound webhook but failed to persist Twilio SID for number",
      );
    }
  } catch (err) {
    req.log.warn(
      { err, phoneNumber },
      "Failed to set inbound webhook on assigned number; run /phone-provisioning/repair-webhooks",
    );
  }
}

// Numbers actually owned by the platform Twilio account. The admin assigns a
// tenant's From/inbound number by PICKING from this list, so a tenant can never
// be pointed at a number the account does not own (the Twilio 21660 trap that
// stranded ACME). Registered before "/tenants/:id" so the literal path is not
// captured as the :id param.
router.get("/tenants/owned-numbers", async (req, res): Promise<void> => {
  const client = getTwilioClient();
  if (!client) {
    res.json(GetOwnedNumbersResponse.parse({ configured: false, numbers: [] }));
    return;
  }
  try {
    const list = await client.incomingPhoneNumbers.list({ limit: 100 });
    const numbers = list
      .filter((n) => !!n.phoneNumber)
      .map((n) => ({
        phoneNumber: n.phoneNumber,
        friendlyName: n.friendlyName || n.phoneNumber,
      }));
    res.json(GetOwnedNumbersResponse.parse({ configured: true, numbers }));
  } catch (err) {
    req.log.error({ err }, "Failed to list owned Twilio numbers");
    res.status(502).json({ error: "Failed to fetch numbers from Twilio" });
  }
});

router.post("/tenants", async (req, res): Promise<void> => {
  const parsed = CreateTenantBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  let chatwootAccountId = parsed.data.chatwootAccountId ?? null;
  let chatwootInboxId = parsed.data.chatwootInboxId ?? null;

  if (!chatwootAccountId && !chatwootInboxId) {
    const provision = await provisionChatwootInbox(parsed.data.name);
    if (provision.status === "created") {
      chatwootAccountId = provision.accountId;
      chatwootInboxId = provision.inboxId;
      req.log.info(
        { inboxId: chatwootInboxId, accountId: chatwootAccountId },
        "Auto-provisioned Chatwoot inbox",
      );
    } else {
      req.log.info(
        { provisionStatus: provision.status, detail: provision.detail },
        "Chatwoot auto-provision skipped",
      );
    }
  }

  const [row] = await db
    .insert(tenantsTable)
    .values({
      slug: parsed.data.slug,
      name: parsed.data.name,
      region: parsed.data.region,
      tierCode: parsed.data.tierCode,
      sovereignToggle: parsed.data.sovereignToggle ?? false,
      phoneNumber: null,
      chatwootAccountId,
      chatwootInboxId,
      knowledgeBase: parsed.data.knowledgeBase ?? null,
    })
    .returning();
  req.log.info({ tenantId: row?.id, slug: row?.slug }, "Tenant created");

  // Register the primary number through the canonical registry (the single
  // source of truth) instead of trusting the denormalized column on its own.
  if (parsed.data.phoneNumber) {
    try {
      const result = await setTenantPrimaryNumber(
        row!.id,
        parsed.data.phoneNumber,
      );
      row!.phoneNumber = result.phoneNumber;
      if (result.phoneNumber) {
        await wireNumberWebhook(req, result.phoneNumber);
      }
    } catch (err) {
      if (err instanceof PhoneNumberConflictError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }
  }

  res.status(201).json(GetTenantResponse.parse(row));
});

router.get("/tenants/:id", async (req, res): Promise<void> => {
  const params = GetTenantParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .select()
    .from(tenantsTable)
    .where(eq(tenantsTable.id, params.data.id));
  if (!row) {
    res.status(404).json({ error: "Tenant not found" });
    return;
  }
  res.json(GetTenantResponse.parse(row));
});

// Login users (owner + agents) attached to a tenant. Conductor-scoped read so
// the admin can see exactly who signs into a tenant account. Never returns the
// password hash.
router.get("/tenants/:id/users", async (req, res): Promise<void> => {
  const params = GetTenantUsersParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const rows = await db
    .select({
      id: tenantUsersTable.id,
      email: tenantUsersTable.email,
      name: tenantUsersTable.name,
      role: tenantUsersTable.role,
      status: tenantUsersTable.status,
      phone: tenantUsersTable.phone,
      createdAt: tenantUsersTable.createdAt,
    })
    .from(tenantUsersTable)
    .where(eq(tenantUsersTable.tenantId, params.data.id))
    .orderBy(tenantUsersTable.id);
  res.json(
    GetTenantUsersResponse.parse({
      users: rows.map((r) => ({
        ...r,
        createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : undefined,
      })),
    }),
  );
});

// Department helper: project a department row into the API shape (id, name,
// description, routing strategy + its assigned number). Shared by the list and
// assign endpoints so both return an identical TenantDepartment.
const departmentColumns = {
  id: departmentsTable.id,
  tenantId: departmentsTable.tenantId,
  name: departmentsTable.name,
  phoneNumber: departmentsTable.phoneNumber,
  twilioSid: departmentsTable.twilioSid,
  description: departmentsTable.description,
  routingStrategy: departmentsTable.routingStrategy,
} as const;

// All of a tenant's departments and their assigned numbers. Conductor-scoped so
// the operator can wire a department's number exactly like the tenant app does.
router.get("/tenants/:id/departments", async (req, res): Promise<void> => {
  const params = GetTenantDepartmentsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const rows = await db
    .select(departmentColumns)
    .from(departmentsTable)
    .where(eq(departmentsTable.tenantId, params.data.id))
    .orderBy(departmentsTable.id);
  res.json(GetTenantDepartmentsResponse.parse({ departments: rows }));
});

// Assign (or clear, with phoneNumber=null) an owned number for one of a tenant's
// departments. A number is the account primary XOR one department's number; if
// the supplied number is currently this tenant's primary, the registry frees it
// from primary in the same transaction (allowReclaimFromOwnPrimary).
router.post(
  "/tenants/:id/departments/:departmentId/number",
  async (req, res): Promise<void> => {
    const params = AssignTenantDepartmentNumberParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const body = AssignTenantDepartmentNumberBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }
    const { id: tenantId, departmentId } = params.data;
    const raw = body.data.phoneNumber;
    // Server-side E.164 guard mirrors the primary-number path: a malformed
    // number would silently break inbound routing for this department.
    if (raw !== null && raw !== "" && !/^\+[1-9]\d{6,14}$/.test(raw)) {
      res
        .status(400)
        .json({ error: "phoneNumber must be E.164 format, e.g. +19094904265" });
      return;
    }

    // The department must belong to this tenant — never let a Conductor assign a
    // number to a department row that lives under another tenant.
    const [dept] = await db
      .select({ id: departmentsTable.id })
      .from(departmentsTable)
      .where(
        and(
          eq(departmentsTable.id, departmentId),
          eq(departmentsTable.tenantId, tenantId),
        ),
      );
    if (!dept) {
      res.status(404).json({ error: "Department not found for tenant" });
      return;
    }

    const normalized = raw === "" || raw == null ? null : raw;
    try {
      await setDepartmentNumber(
        tenantId,
        departmentId,
        normalized,
        body.data.twilioSid ?? null,
        { allowReclaimFromOwnPrimary: true },
      );
    } catch (err) {
      if (err instanceof PhoneNumberConflictError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }

    // Best-effort post-assign side effects. Wiring the inbound webhook only
    // applies when a number is actually set (skip on unassign). Carrier billing
    // counts every owned number regardless of primary-vs-department, but a
    // primary→department reclaim can null the tenant's primary, so reconcile
    // either way. Neither failure is fatal: the registry write already committed
    // and both are recoverable via reconcile/repair.
    if (normalized) {
      await wireNumberWebhook(req, normalized);
    }
    try {
      await syncCarrierBillingToStripe(
        tenantId,
        "conductor_department_number_change",
      );
    } catch (syncErr) {
      req.log.error(
        { err: syncErr, tenantId, departmentId },
        "CRITICAL: carrier billing sync failed after department number change — tenant billing may be stale until reconciled",
      );
    }

    const [department] = await db
      .select(departmentColumns)
      .from(departmentsTable)
      .where(eq(departmentsTable.id, departmentId));
    const [tenant] = await db
      .select({ phoneNumber: tenantsTable.phoneNumber })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, tenantId));
    req.log.info(
      { tenantId, departmentId, phoneNumber: normalized },
      "Conductor assigned department number",
    );
    res.json(
      AssignTenantDepartmentNumberResponse.parse({
        department,
        tenantPhoneNumber: tenant?.phoneNumber ?? null,
      }),
    );
  },
);

// Create a department for a tenant. Conductor-scoped so the operator can stand up
// a department (e.g. "Customer Service") before assigning it a number and moving
// conversations into it — mirrors the tenant-side create but without tenant auth.
router.post("/tenants/:id/departments", async (req, res): Promise<void> => {
  const params = CreateTenantDepartmentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = CreateTenantDepartmentBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const tenantId = params.data.id;
  const name = body.data.name.trim();
  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  // The tenant must exist — departments.tenant_id is an FK, so a missing tenant
  // would 500 on insert; fail with a clean 404 instead.
  const [tenant] = await db
    .select({ id: tenantsTable.id })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId));
  if (!tenant) {
    res.status(404).json({ error: "Tenant not found" });
    return;
  }

  // App-level, case-insensitive duplicate-name guard for this operator flow.
  // There is no DB unique on (tenant_id, name) (the tenant side allows dups); we
  // accept the small concurrency race rather than add a constraint.
  const dup = await db
    .select({ id: departmentsTable.id })
    .from(departmentsTable)
    .where(
      and(
        eq(departmentsTable.tenantId, tenantId),
        sql`lower(${departmentsTable.name}) = lower(${name})`,
      ),
    )
    .limit(1);
  if (dup.length > 0) {
    res.status(409).json({
      error: "A department with this name already exists for the tenant",
    });
    return;
  }

  const description =
    typeof body.data.description === "string" &&
    body.data.description.trim().length > 0
      ? body.data.description.trim()
      : null;
  const values: typeof departmentsTable.$inferInsert = {
    tenantId,
    name,
    description,
  };
  // Only override the DB default (round_robin) when a strategy is supplied.
  if (body.data.routingStrategy) {
    values.routingStrategy = body.data.routingStrategy;
  }

  const [created] = await db
    .insert(departmentsTable)
    .values(values)
    .returning({ id: departmentsTable.id });
  req.log.info(
    { tenantId, departmentId: created.id, name },
    "Conductor created department",
  );

  const [department] = await db
    .select(departmentColumns)
    .from(departmentsTable)
    .where(eq(departmentsTable.id, created.id));
  res.status(200).json(CreateTenantDepartmentResponse.parse(department));
});

// All of a tenant's conversations that still have no department (department_id IS
// NULL), excluding quarantined imports. Conductor-scoped; powers the Admin
// "Unassigned conversations" cleanup list. Capped to keep the payload bounded.
router.get(
  "/tenants/:id/conversations/unassigned",
  async (req, res): Promise<void> => {
    const params = GetTenantUnassignedConversationsParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const tenantId = params.data.id;
    const rows = await db
      .select({
        id: conversationsTable.id,
        tenantId: conversationsTable.tenantId,
        departmentId: conversationsTable.departmentId,
        contactName: conversationsTable.contactName,
        contactPhone: conversationsTable.contactPhone,
        status: conversationsTable.status,
        lastMessageAt: conversationsTable.lastMessageAt,
        createdAt: conversationsTable.createdAt,
      })
      .from(conversationsTable)
      .where(
        and(
          eq(conversationsTable.tenantId, tenantId),
          isNull(conversationsTable.departmentId),
          eq(conversationsTable.isQuarantined, false),
        ),
      )
      .orderBy(desc(conversationsTable.lastMessageAt))
      .limit(100);
    res.json(
      GetTenantUnassignedConversationsResponse.parse({ conversations: rows }),
    );
  },
);

// Move a conversation into a department (or clear it with departmentId=null),
// keeping all history. Conductor-scoped. Both the conversation and the target
// department must belong to the tenant (IDOR guard). Only department_id changes —
// ownership / agent routing is deliberately left untouched.
router.patch(
  "/tenants/:id/conversations/:conversationId",
  async (req, res): Promise<void> => {
    const params = AssignTenantConversationDepartmentParams.safeParse(
      req.params,
    );
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const body = AssignTenantConversationDepartmentBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }
    const { id: tenantId, conversationId } = params.data;
    const departmentId = body.data.departmentId;

    const [conv] = await db
      .select({
        id: conversationsTable.id,
        departmentId: conversationsTable.departmentId,
      })
      .from(conversationsTable)
      .where(
        and(
          eq(conversationsTable.id, conversationId),
          eq(conversationsTable.tenantId, tenantId),
          eq(conversationsTable.isQuarantined, false),
        ),
      );
    if (!conv) {
      res.status(404).json({ error: "Conversation not found for tenant" });
      return;
    }

    // A non-null target department must belong to this tenant.
    if (departmentId !== null) {
      const [dept] = await db
        .select({ id: departmentsTable.id })
        .from(departmentsTable)
        .where(
          and(
            eq(departmentsTable.id, departmentId),
            eq(departmentsTable.tenantId, tenantId),
          ),
        );
      if (!dept) {
        res.status(404).json({ error: "Department not found for tenant" });
        return;
      }
    }

    const [updated] = await db
      .update(conversationsTable)
      .set({ departmentId })
      .where(eq(conversationsTable.id, conversationId))
      .returning({
        id: conversationsTable.id,
        tenantId: conversationsTable.tenantId,
        departmentId: conversationsTable.departmentId,
        contactName: conversationsTable.contactName,
        contactPhone: conversationsTable.contactPhone,
        status: conversationsTable.status,
        lastMessageAt: conversationsTable.lastMessageAt,
        createdAt: conversationsTable.createdAt,
      });
    req.log.info(
      {
        tenantId,
        conversationId,
        previousDepartmentId: conv.departmentId,
        departmentId,
      },
      "Conductor moved conversation department",
    );
    res.json(AssignTenantConversationDepartmentResponse.parse(updated));
  },
);

router.patch("/tenants/:id", async (req, res): Promise<void> => {
  const params = UpdateTenantParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = UpdateTenantBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  // Server-side E.164 guard: an invalid phone here would silently break
  // resolveTenantByPhoneNumber() and inbound texts would never route.
  if (
    "phoneNumber" in body.data &&
    body.data.phoneNumber !== null &&
    body.data.phoneNumber !== undefined &&
    body.data.phoneNumber !== "" &&
    !/^\+[1-9]\d{6,14}$/.test(body.data.phoneNumber)
  ) {
    res
      .status(400)
      .json({ error: "phoneNumber must be E.164 format, e.g. +19094904265" });
    return;
  }
  const hasPhone = "phoneNumber" in body.data;
  const patch: Record<string, unknown> = {};
  for (const k of [
    "name",
    "region",
    "tierCode",
    "sovereignToggle",
    "chatwootAccountId",
    "chatwootInboxId",
    "knowledgeBase",
    "brandScope",
    "fallbackPhrase",
    "autopilotHoldingPhrase",
    "unregisteredSurchargeEnabled",
  ] as const) {
    if (k in body.data) patch[k] = body.data[k];
  }
  const surchargeChanged = "unregisteredSurchargeEnabled" in body.data;
  if (!hasPhone && Object.keys(patch).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  const [existing] = await db
    .select({ id: tenantsTable.id })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "Tenant not found" });
    return;
  }

  if (Object.keys(patch).length > 0) {
    await db
      .update(tenantsTable)
      .set(patch)
      .where(eq(tenantsTable.id, params.data.id));
  }

  // Phone number ownership is written only through the canonical registry, so
  // inbound routing and the denormalized column can never disagree.
  if (hasPhone) {
    const raw = body.data.phoneNumber;
    try {
      const result = await setTenantPrimaryNumber(
        params.data.id,
        raw === "" || raw == null ? null : raw,
      );
      if (result.phoneNumber) {
        await wireNumberWebhook(req, result.phoneNumber);
      }
    } catch (err) {
      if (err instanceof PhoneNumberConflictError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }
  }

  // Both waiving/re-enabling the surcharge AND assigning/unassigning the primary
  // number change the tenant's recurring add-on quantities (local-number count
  // and surcharge count), so reconcile Stripe whenever either changes.
  // Best-effort: the change is already persisted and underbilling is recoverable
  // via reconciliation — never fail the request on a sync error.
  if (surchargeChanged || hasPhone) {
    const reason = surchargeChanged
      ? hasPhone
        ? "conductor_surcharge_and_phone_change"
        : "surcharge_toggle"
      : "conductor_phone_change";
    try {
      await syncCarrierBillingToStripe(params.data.id, reason);
    } catch (syncErr) {
      req.log.error(
        { err: syncErr, tenantId: params.data.id, reason },
        "CRITICAL: carrier billing sync failed after tenant change — tenant billing may be stale until reconciled",
      );
    }
  }

  const [row] = await db
    .select()
    .from(tenantsTable)
    .where(eq(tenantsTable.id, params.data.id));
  req.log.info(
    {
      tenantId: params.data.id,
      fields: [...Object.keys(patch), ...(hasPhone ? ["phoneNumber"] : [])],
    },
    "Tenant patched",
  );
  res.json(UpdateTenantResponse.parse(row));
});

// Conductor-triggered manual reconciliation of a tenant's carrier add-on items
// against the DB-derived snapshot (the source of truth). This is the recovery
// path for the best-effort post-commit syncs (purchase / assign / surcharge
// toggle / subscription activation): if any of those swallowed a Stripe error,
// an operator — or a scheduled job hitting this endpoint — can force the
// subscription back in line, so "underbilling until reconciled" can't become
// "underbilling forever". Conductor-scoped via the `/api` mount.
router.post(
  "/tenants/:id/reconcile-carrier-billing",
  async (req, res): Promise<void> => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid tenant id" });
      return;
    }
    const [tenant] = await db
      .select({ id: tenantsTable.id })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, id));
    if (!tenant) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }
    try {
      const result = await syncCarrierBillingToStripe(
        id,
        "conductor_manual_reconcile",
      );
      req.log.info(
        { tenantId: id, mode: result.mode },
        "Carrier billing reconciled via Conductor",
      );
      res.json({ tenantId: id, mode: result.mode, snapshot: result.snapshot });
    } catch (err) {
      req.log.error(
        { err, tenantId: id },
        "Carrier billing manual reconcile failed",
      );
      res.status(502).json({ error: "Carrier billing reconciliation failed" });
    }
  },
);

// Permanently delete a tenant and all of its scoped data. Conductor-only
// (inherited from the `/api` mount) and DESTRUCTIVE, so the caller must echo the
// tenant's slug (`?slug=` or JSON body `{ "slug": ... }`) to prove they mean
// THIS account — an :id fat-finger can't silently wipe the wrong tenant.
//
// Several children of `tenants` are ON DELETE NO ACTION (conversations,
// departments, contacts, dispositions, reminders, tenant_users) and messages ->
// conversations is NO ACTION too, so we delete those explicitly in dependency
// order inside one transaction; the remaining children are ON DELETE CASCADE and
// go when the tenant row is removed.
router.delete("/tenants/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid tenant id" });
    return;
  }

  const bodySlug =
    req.body && typeof req.body.slug === "string" ? req.body.slug : null;
  const confirmSlug =
    (typeof req.query.slug === "string" ? req.query.slug : null) ?? bodySlug;

  const [tenant] = await db
    .select({
      id: tenantsTable.id,
      slug: tenantsTable.slug,
      name: tenantsTable.name,
    })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, id));
  if (!tenant) {
    res.status(404).json({ error: "Tenant not found" });
    return;
  }
  if (PROTECTED_TENANT_SLUGS.has(tenant.slug)) {
    res.status(403).json({
      error: `Tenant "${tenant.slug}" is a protected seed tenant and cannot be deleted.`,
    });
    return;
  }
  if (confirmSlug !== tenant.slug) {
    res.status(400).json({
      error: `Confirmation required: pass slug="${tenant.slug}" (this tenant's slug) to confirm deletion.`,
    });
    return;
  }

  await db.transaction(async (tx) => {
    await tx.execute(
      sql`DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE tenant_id = ${id})`,
    );
    await tx.execute(sql`DELETE FROM reminders WHERE tenant_id = ${id}`);
    await tx.execute(sql`DELETE FROM conversations WHERE tenant_id = ${id}`);
    await tx.execute(sql`DELETE FROM contacts WHERE tenant_id = ${id}`);
    await tx.execute(sql`DELETE FROM dispositions WHERE tenant_id = ${id}`);
    await tx.execute(sql`DELETE FROM departments WHERE tenant_id = ${id}`);
    await tx.execute(sql`DELETE FROM tenant_users WHERE tenant_id = ${id}`);
    await tx.execute(sql`DELETE FROM tenants WHERE id = ${id}`);
  });

  req.log.warn(
    { tenantId: id, slug: tenant.slug },
    "Tenant permanently deleted via Conductor",
  );
  res.json({
    success: true,
    deleted: { id: tenant.id, slug: tenant.slug, name: tenant.name },
  });
});

router.post(
  "/tenants/:id/knowledge-upload",
  requireTenantAuth,
  (req, res, next) => {
    upload.single("file")(req, res, (err) => {
      if (err) {
        if (err.code === "LIMIT_FILE_SIZE") {
          res.status(413).json({ error: "File too large. Maximum size is 5MB." });
          return;
        }
        res.status(400).json({ error: `Upload error: ${err.message}` });
        return;
      }
      next();
    });
  },
  async (req, res): Promise<void> => {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid tenant id" });
      return;
    }
    // Tenant-scoped: a tenant user may only upload to their own tenant.
    if (!req.tenantUser || req.tenantUser.tenantId !== id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }

    const ext = file.originalname.split(".").pop()?.toLowerCase();
    let extractedText = "";

    if (ext === "pdf") {
      try {
        const data = new Uint8Array(file.buffer);
        const doc = await getDocument({ data, useSystemFonts: true }).promise;
        const pages: string[] = [];
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          const content = await page.getTextContent();
          const text = content.items
            .filter((item: any) => "str" in item)
            .map((item: any) => item.str)
            .join(" ");
          if (text.trim()) pages.push(text.trim());
        }
        extractedText = pages.join("\n\n");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        req.log.error({ err: msg }, "PDF parse failed");
        res.status(400).json({ error: `Failed to parse PDF: ${msg}` });
        return;
      }
    } else if (ext === "txt" || ext === "md" || ext === "csv") {
      extractedText = file.buffer.toString("utf-8").trim();
    } else {
      res
        .status(400)
        .json({ error: `Unsupported file type: .${ext}. Use PDF, TXT, MD, or CSV.` });
      return;
    }

    if (!extractedText) {
      res.status(400).json({ error: "No text content extracted from file" });
      return;
    }

    const [tenant] = await db
      .select()
      .from(tenantsTable)
      .where(eq(tenantsTable.id, id));
    if (!tenant) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }

    const separator = "\n\n--- Uploaded from: " + file.originalname + " ---\n\n";
    const newKb = (tenant.knowledgeBase ?? "") + separator + extractedText;

    const [updated] = await db
      .update(tenantsTable)
      .set({ knowledgeBase: newKb })
      .where(eq(tenantsTable.id, id))
      .returning();

    req.log.info(
      {
        tenantId: id,
        fileName: file.originalname,
        extractedChars: extractedText.length,
      },
      "Knowledge base file uploaded",
    );

    res.json({
      success: true,
      fileName: file.originalname,
      extractedChars: extractedText.length,
      totalKbChars: updated?.knowledgeBase?.length ?? 0,
    });
  },
);

export default router;
