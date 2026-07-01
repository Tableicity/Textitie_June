import twilio from "twilio";
import { db, phoneNumbersTable } from "@workspace/db";
import { logger } from "./logger";
import {
  setDepartmentNumber,
  normalizePhoneE164,
  PhoneNumberConflictError,
} from "./phoneNumberRegistry";
import { applyInboundWebhookBySid } from "./twilioNumberWebhook";
import { getPublicWebhookConfig } from "./publicTwilioUrls";

/**
 * The Admin → Phone "pool" auto-assign primitive.
 *
 * "The pool" is EXACTLY the Admin → Phone (Telephony) page's "Available
 * Numbers" list: every number the connected Twilio account OWNS that is not yet
 * in the canonical `phone_numbers` registry. This module computes that set the
 * SAME way `routes/telephony.ts` does (owned − registered) so signup grabs the
 * next free number the operator sees on that page — it never searches/buys new
 * Twilio inventory.
 *
 * Contract: NEVER throws. Signup must succeed even if the pool is empty, Twilio
 * is unconfigured, or a webhook can't be wired. All failure modes return
 * `{ assigned: null, reason }` and are logged; the registry write is the source
 * of truth and a missed webhook is repairable via
 * `/phone-provisioning/repair-webhooks`.
 */

function getTwilioClient() {
  const sid = process.env["TWILIO_ACCOUNT_SID"];
  const token = process.env["TWILIO_AUTH_TOKEN"];
  if (!sid || !token) return null;
  return twilio(sid, token);
}

export interface PoolClaimResult {
  assigned: string | null;
  reason?: string;
}

/**
 * Claim the next available pool number and assign it to a tenant's department
 * (kind='department'), then best-effort point its inbound webhook at us.
 *
 * Gated on `getPublicWebhookConfig().available`: a number is only useful if
 * Twilio can deliver its inbound texts to us. In dev/preview (no public HTTPS
 * webhook) auto-assign is skipped entirely so throwaway signups never consume a
 * real (billed) number and no "deaf" number is ever handed out — mirroring the
 * purchase route's no_public_webhook guard.
 */
export async function claimPoolNumberForDepartment(
  tenantId: number,
  departmentId: number,
): Promise<PoolClaimResult> {
  const webhook = getPublicWebhookConfig();
  if (!webhook.available) {
    logger.info(
      { tenantId, departmentId, reason: webhook.reason },
      "Pool auto-assign skipped: no public webhook (dev/preview)",
    );
    return { assigned: null, reason: "no_public_webhook" };
  }

  const client = getTwilioClient();
  if (!client) {
    logger.info(
      { tenantId, departmentId },
      "Pool auto-assign skipped: Twilio not configured",
    );
    return { assigned: null, reason: "twilio_unconfigured" };
  }

  // The pool == Admin → Phone "Available Numbers": owned by the account minus
  // whatever the canonical registry has already assigned. Computed identically
  // to routes/telephony.ts.
  let owned: Awaited<ReturnType<typeof client.incomingPhoneNumbers.list>>;
  try {
    owned = await client.incomingPhoneNumbers.list({
      limit: 1000,
      pageSize: 100,
    });
  } catch (err) {
    logger.error(
      { err, tenantId },
      "Pool auto-assign: failed to list owned Twilio numbers",
    );
    return { assigned: null, reason: "twilio_list_failed" };
  }

  let takenSet: Set<string>;
  try {
    const registered = await db
      .select({ phoneNumber: phoneNumbersTable.phoneNumber })
      .from(phoneNumbersTable);
    takenSet = new Set(registered.map((r) => r.phoneNumber));
  } catch (err) {
    logger.error({ err, tenantId }, "Pool auto-assign: failed to read registry");
    return { assigned: null, reason: "registry_read_failed" };
  }

  const candidates = owned.filter(
    (n) => !!n.phoneNumber && !takenSet.has(n.phoneNumber),
  );

  if (candidates.length === 0) {
    logger.warn(
      { tenantId, departmentId },
      "Pool auto-assign: no available numbers in the pool",
    );
    return { assigned: null, reason: "pool_empty" };
  }

  // Walk candidates: the first one we can register wins. A concurrent signup
  // that grabbed the same number surfaces as PhoneNumberConflictError (the
  // registry's PK/onConflict guard) — we simply try the next candidate.
  for (const cand of candidates) {
    // normalizePhoneE164 returns null for empty input but THROWS
    // PhoneNumberValidationError for non-empty garbage — either way an
    // unroutable Twilio number is data we can't assign, so skip that candidate
    // rather than abort the whole claim (upholds the never-throws contract).
    let norm: string | null = null;
    try {
      norm = normalizePhoneE164(cand.phoneNumber);
    } catch {
      continue;
    }
    if (!norm) continue;

    try {
      await setDepartmentNumber(tenantId, departmentId, norm, cand.sid);
    } catch (err) {
      if (err instanceof PhoneNumberConflictError) {
        continue; // lost the race for this number — try the next
      }
      logger.error(
        { err, tenantId, candidate: norm },
        "Pool auto-assign: registry write failed",
      );
      return { assigned: null, reason: "registry_write_failed" };
    }

    // Claimed. Wire the inbound webhook best-effort (registry is source of
    // truth; a miss is repairable). applyInboundWebhookBySid re-checks the
    // public-webhook gate internally.
    try {
      const wired = await applyInboundWebhookBySid(client, cand.sid);
      if (!wired.ok) {
        logger.warn(
          { tenantId, phoneNumber: norm, reason: wired.reason },
          "Pool auto-assign: webhook wiring failed (repairable)",
        );
      }
    } catch (err) {
      logger.warn(
        { err, tenantId, phoneNumber: norm },
        "Pool auto-assign: webhook wiring threw (repairable)",
      );
    }

    logger.info(
      { tenantId, departmentId, phoneNumber: norm, sid: cand.sid },
      "Pool number auto-assigned to Demo Department",
    );
    return { assigned: norm };
  }

  logger.warn(
    { tenantId, departmentId },
    "Pool auto-assign: all candidate numbers were taken or unroutable",
  );
  return { assigned: null, reason: "pool_exhausted" };
}
