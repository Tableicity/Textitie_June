import { Router } from "express";
import twilio from "twilio";
import { db, departmentsTable, phoneNumbersTable } from "@workspace/db";
import { eq, and, isNotNull, ilike } from "drizzle-orm";
import { requireTenantAuth } from "../middleware/tenantAuth";
import { logger } from "../lib/logger";
import {
  setDepartmentNumber,
  normalizePhoneE164,
  classifyNumberType,
  PhoneNumberConflictError,
} from "../lib/phoneNumberRegistry";
import { getPublicWebhookConfig } from "../lib/publicTwilioUrls";
import { assertCanPurchaseNumber } from "../lib/phoneProvisioningGate";
import { assertPaidTier } from "../lib/paidTierGate";
import { syncCarrierBillingToStripe } from "../lib/carrierBilling";
import { getNeighborAreaCodes } from "../lib/areaCodeNeighbors";
import {
  applyInboundWebhookBySid,
  buildInboundWebhookParams,
} from "../lib/twilioNumberWebhook";

const router = Router();

function getTwilioClient() {
  const sid = process.env["TWILIO_ACCOUNT_SID"];
  const token = process.env["TWILIO_AUTH_TOKEN"];
  if (!sid || !token) return null;
  return twilio(sid, token);
}

const DEFAULT_DEPARTMENT_NAME = "Customer Service";

/**
 * Resolve the department a purchased number must land on. Every purchased number
 * MUST belong to a department so it is always recorded in the canonical
 * `phone_numbers` registry (no orphans). If the caller supplies a departmentId
 * we validate tenant ownership; otherwise we find-or-create the tenant's
 * "Customer Service" department.
 */
async function resolveDepartmentForPurchase(
  tenantId: number,
  providedId: unknown,
): Promise<{ id: number } | { error: { status: number; message: string } }> {
  if (providedId != null && providedId !== "") {
    const id = Number(providedId);
    if (!Number.isInteger(id)) {
      return { error: { status: 400, message: "Invalid departmentId" } };
    }
    const [dept] = await db
      .select({ id: departmentsTable.id })
      .from(departmentsTable)
      .where(and(eq(departmentsTable.id, id), eq(departmentsTable.tenantId, tenantId)))
      .limit(1);
    if (!dept) return { error: { status: 404, message: "Department not found" } };
    return { id: dept.id };
  }

  const [existing] = await db
    .select({ id: departmentsTable.id })
    .from(departmentsTable)
    .where(
      and(
        eq(departmentsTable.tenantId, tenantId),
        ilike(departmentsTable.name, DEFAULT_DEPARTMENT_NAME),
      ),
    )
    .limit(1);
  if (existing) return { id: existing.id };

  const [created] = await db
    .insert(departmentsTable)
    .values({
      tenantId,
      name: DEFAULT_DEPARTMENT_NAME,
      description: "Default department (auto-created for your first number).",
    })
    .returning({ id: departmentsTable.id });
  logger.info(
    { tenantId, departmentId: created.id },
    "Auto-created default Customer Service department for number purchase",
  );
  return { id: created.id };
}

router.get("/phone-numbers/available", requireTenantAuth, async (req, res) => {
  const client = getTwilioClient();
  if (!client) {
    res.status(503).json({ error: "Twilio not configured" });
    return;
  }
  const country = (req.query.country as string) || "US";
  const areaCode = req.query.areaCode as string | undefined;
  const contains = req.query.contains as string | undefined;
  const numberType: "local" | "toll_free" =
    (req.query.type as string) === "toll_free" ? "toll_free" : "local";
  const limit = Math.min(Number(req.query.limit) || 20, 50);

  try {
    const params: Record<string, unknown> = { limit };
    if (areaCode) params.areaCode = Number(areaCode);
    if (contains) params.contains = contains;

    const lookup = client.availablePhoneNumbers(country);
    const numbers =
      numberType === "toll_free"
        ? await lookup.tollFree.list(params)
        : await lookup.local.list(params);

    const results = numbers.map((n) => ({
      phoneNumber: n.phoneNumber,
      friendlyName: n.friendlyName,
      locality: n.locality,
      region: n.region,
      isoCountry: n.isoCountry,
      capabilities: n.capabilities,
      numberType,
    }));
    res.json(results);
  } catch (err) {
    req.log.error({ err, numberType }, "Failed to search available numbers");
    res.status(500).json({ error: "Failed to search numbers" });
  }
});

// When the carrier is sold out of an area code (common for older NPAs like 909),
// suggest geographically nearby area codes that DO currently have stock so the
// customer can pick a working alternative instead of hitting a dead end.
router.get(
  "/phone-numbers/area-code-suggestions",
  requireTenantAuth,
  async (req, res) => {
    const client = getTwilioClient();
    if (!client) {
      res.status(503).json({ error: "Twilio not configured" });
      return;
    }
    const areaCode = (req.query.areaCode as string | undefined)?.trim();
    const country = (req.query.country as string) || "US";
    if (!areaCode || !/^\d{3}$/.test(areaCode)) {
      res.status(400).json({ error: "A 3-digit areaCode is required" });
      return;
    }

    const neighbors = getNeighborAreaCodes(areaCode).slice(0, 8);
    if (neighbors.length === 0) {
      res.json({ areaCode, suggestions: [] });
      return;
    }

    // Re-verify each candidate against LIVE carrier stock (in parallel) so we
    // never suggest an area code that is itself sold out.
    type Suggestion = {
      areaCode: string;
      locality: string | null;
      region: string | null;
    };
    const lookup = client.availablePhoneNumbers(country);
    const checks = await Promise.allSettled(
      neighbors.map(async (nb): Promise<Suggestion | null> => {
        const numbers = await lookup.local.list({
          areaCode: Number(nb),
          limit: 1,
        });
        if (numbers.length === 0) return null;
        const first = numbers[0];
        return {
          areaCode: nb,
          locality: first?.locality ?? null,
          region: first?.region ?? null,
        };
      }),
    );

    const suggestions: Suggestion[] = [];
    for (const r of checks) {
      if (r.status === "fulfilled" && r.value) {
        suggestions.push(r.value);
        if (suggestions.length >= 5) break;
      }
    }

    res.json({ areaCode, suggestions });
  },
);

router.post("/phone-numbers/purchase", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;

  // 1. Eligibility gate (feature flag + Twilio configured + billing stub). The
  //    ONLY place purchase eligibility is decided.
  const gate = await assertCanPurchaseNumber(tenantId);
  if (!gate.ok) {
    res.status(gate.status).json({ error: gate.message, code: gate.code });
    return;
  }

  const client = getTwilioClient();
  if (!client) {
    res.status(503).json({ error: "Twilio not configured" });
    return;
  }

  const { phoneNumber, departmentId } = req.body ?? {};
  if (!phoneNumber) {
    res.status(400).json({ error: "phoneNumber is required" });
    return;
  }

  // 2. Normalize + validate the number BEFORE we spend money at Twilio.
  let normalized: string | null;
  try {
    normalized = normalizePhoneE164(phoneNumber);
  } catch {
    res.status(400).json({ error: "Invalid phone number." });
    return;
  }
  if (!normalized) {
    res.status(400).json({ error: "phoneNumber is required" });
    return;
  }

  // 3. Fail before buying if this number already belongs to another tenant.
  const [conflict] = await db
    .select({ tenantId: phoneNumbersTable.tenantId })
    .from(phoneNumbersTable)
    .where(eq(phoneNumbersTable.phoneNumber, normalized))
    .limit(1);
  if (conflict && conflict.tenantId !== tenantId) {
    res
      .status(409)
      .json({ error: "This number is already assigned to another account." });
    return;
  }

  // 4. A purchased number is useless if Twilio can't deliver inbound texts to
  //    us. Refuse to buy a "deaf" number when no public webhook URL exists
  //    (dev/preview without PUBLIC_WEBHOOK_BASE_URL).
  const webhook = getPublicWebhookConfig();
  if (!webhook.available) {
    res.status(409).json({
      error: `Cannot purchase a number yet — inbound texts could not be delivered. ${webhook.reason}`,
      code: "no_public_webhook",
    });
    return;
  }

  // 5. Resolve the department (provided, or auto-created Customer Service)
  //    BEFORE the irreversible Twilio purchase. Cheap + reversible first.
  const deptResult = await resolveDepartmentForPurchase(tenantId, departmentId);
  if ("error" in deptResult) {
    res.status(deptResult.error.status).json({ error: deptResult.error.message });
    return;
  }
  const resolvedDeptId = deptResult.id;

  // 6. Buy from Twilio WITH the inbound webhook wired in the same call.
  let purchased: Awaited<
    ReturnType<typeof client.incomingPhoneNumbers.create>
  >;
  try {
    purchased = await client.incomingPhoneNumbers.create({
      phoneNumber: normalized,
      friendlyName: `SAMA-${tenantId}`,
      ...buildInboundWebhookParams(webhook),
    });
  } catch (err: unknown) {
    const twilioErr = err as { code?: number; message?: string };
    req.log.error(
      { err, twilioCode: twilioErr.code },
      "Failed to purchase phone number",
    );
    res.status(500).json({
      error: "Failed to purchase number",
      detail: twilioErr.message,
    });
    return;
  }

  logger.info(
    {
      sid: purchased.sid,
      phoneNumber: purchased.phoneNumber,
      tenantId,
      departmentId: resolvedDeptId,
      smsUrl: webhook.smsUrl,
    },
    "Phone number purchased from Twilio with inbound webhook configured",
  );

  // 7. Record in the canonical registry. If this fails AFTER the purchase, the
  //    number is bought but unattached — release it so we don't leave a billed
  //    orphan (nothing is wired to it yet).
  try {
    await setDepartmentNumber(
      tenantId,
      resolvedDeptId,
      purchased.phoneNumber,
      purchased.sid,
    );
  } catch (err) {
    try {
      await client.incomingPhoneNumbers(purchased.sid).remove();
      logger.warn(
        { sid: purchased.sid, phoneNumber: purchased.phoneNumber, tenantId },
        "Released just-purchased number after registry write failed (no orphan)",
      );
    } catch (releaseErr) {
      logger.error(
        {
          sid: purchased.sid,
          phoneNumber: purchased.phoneNumber,
          tenantId,
          err: releaseErr,
        },
        "CRITICAL: registry write failed AND release failed — orphaned Twilio number, manual cleanup required (run /phone-provisioning/reconcile)",
      );
    }
    if (err instanceof PhoneNumberConflictError) {
      res.status(409).json({ error: err.message });
      return;
    }
    req.log.error({ err }, "Failed to record purchased number");
    res.status(500).json({ error: "Failed to record purchased number" });
    return;
  }

  // 8. Reconcile carrier billing add-ons (best-effort). The number is bought
  //    and recorded; a Stripe sync failure must NOT fail the request or orphan
  //    the number — underbilling is recoverable via reconciliation, a failed
  //    purchase rollback is not. Log loudly so it can be caught.
  try {
    await syncCarrierBillingToStripe(tenantId, "number_purchase");
  } catch (err) {
    logger.error(
      { err, tenantId, phoneNumber: purchased.phoneNumber },
      "CRITICAL: carrier billing sync failed after purchase — tenant may be underbilled until reconciled",
    );
  }

  res.status(201).json({
    sid: purchased.sid,
    phoneNumber: purchased.phoneNumber,
    friendlyName: purchased.friendlyName,
    departmentId: resolvedDeptId,
    numberType: classifyNumberType(purchased.phoneNumber),
    webhookConfigured: true,
  });
});

router.get("/phone-numbers", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  try {
    const departments = await db
      .select({
        departmentId: departmentsTable.id,
        departmentName: departmentsTable.name,
        phoneNumber: departmentsTable.phoneNumber,
        twilioSid: departmentsTable.twilioSid,
      })
      .from(departmentsTable)
      .where(
        and(
          eq(departmentsTable.tenantId, tenantId),
          isNotNull(departmentsTable.phoneNumber),
        ),
      );
    res.json(departments);
  } catch (err) {
    req.log.error({ err }, "Failed to list phone numbers");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/phone-numbers/assign", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
  const { phoneNumber, twilioSid, departmentId } = req.body ?? {};
  if (!departmentId || !phoneNumber) {
    res.status(400).json({ error: "departmentId and phoneNumber required" });
    return;
  }
  try {
    // Paid-tier gate: self-serve number assignment claims a platform-owned
    // (Twilio-billed) number, so it is a paid feature just like purchase —
    // without this, a trial tenant could claim unlimited pool numbers via
    // direct API call even though the UI never offers it.
    const paid = await assertPaidTier(tenantId, "Assigning a number");
    if (!paid.ok) {
      res.status(paid.status).json({ error: paid.message, code: paid.code });
      return;
    }
    const dept = await db
      .select({ id: departmentsTable.id })
      .from(departmentsTable)
      .where(and(eq(departmentsTable.id, departmentId), eq(departmentsTable.tenantId, tenantId)))
      .limit(1);
    if (dept.length === 0) {
      res.status(404).json({ error: "Department not found" });
      return;
    }
    try {
      await setDepartmentNumber(
        tenantId,
        departmentId,
        phoneNumber,
        twilioSid || null,
      );
    } catch (err) {
      if (err instanceof PhoneNumberConflictError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }

    // Best-effort: ensure this number's inbound webhook points at us. The
    // registry move is what matters; a webhook failure must not fail the assign
    // (use /phone-provisioning/repair-webhooks to fix later).
    if (twilioSid) {
      try {
        const client = getTwilioClient();
        if (client) {
          const wh = await applyInboundWebhookBySid(client, twilioSid);
          if (!wh.ok) {
            req.log.warn(
              { twilioSid, reason: wh.reason },
              "Assigned number but did not set inbound webhook; run /phone-provisioning/repair-webhooks",
            );
          }
        }
      } catch (whErr) {
        req.log.warn(
          { err: whErr, twilioSid },
          "Assigned number but failed to (re)set inbound webhook; run /phone-provisioning/repair-webhooks",
        );
      }
    }

    // Reconcile carrier billing — assigning can bring a new number into the
    // registry (changing local/toll-free counts). Best-effort; never fail the
    // assign on a Stripe sync error.
    try {
      await syncCarrierBillingToStripe(tenantId, "number_assign");
    } catch (syncErr) {
      logger.error(
        { err: syncErr, tenantId, phoneNumber },
        "CRITICAL: carrier billing sync failed after assign — tenant may be underbilled until reconciled",
      );
    }

    const [updated] = await db
      .select()
      .from(departmentsTable)
      .where(eq(departmentsTable.id, departmentId));
    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to assign phone number");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
