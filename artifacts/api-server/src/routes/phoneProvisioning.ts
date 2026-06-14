import { Router } from "express";
import twilio from "twilio";
import { db, phoneNumbersTable } from "@workspace/db";
import { getPublicWebhookConfig } from "../lib/publicTwilioUrls";

/**
 * Conductor-only phone-number provisioning diagnostics.
 *
 * IMPORTANT: these routes live under `/phone-provisioning/*` ON PURPOSE.
 * `conductorAuth` bypasses `/phone-numbers` (the tenant self-serve surface), so
 * mounting reconciliation there would leave it UNAUTHENTICATED. `/phone-
 * provisioning` is not on the bypass list, so `conductorAuth` enforces here.
 */

const router = Router();

function getTwilioClient() {
  const sid = process.env["TWILIO_ACCOUNT_SID"];
  const token = process.env["TWILIO_AUTH_TOKEN"];
  if (!sid || !token) return null;
  return twilio(sid, token);
}

/**
 * GET /phone-provisioning/reconcile
 * Diff the Twilio account's owned numbers against the canonical `phone_numbers`
 * registry. On-demand only (Twilio API calls add latency / rate-limit risk, so
 * never run this at boot — boot already runs the DB-only `detectPhoneNumberDrift`).
 */
router.get("/phone-provisioning/reconcile", async (req, res) => {
  const client = getTwilioClient();
  if (!client) {
    res.status(503).json({ error: "Twilio not configured" });
    return;
  }

  try {
    const twilioNumbers = await client.incomingPhoneNumbers.list({ limit: 1000 });
    const registry = await db
      .select({
        phoneNumber: phoneNumbersTable.phoneNumber,
        tenantId: phoneNumbersTable.tenantId,
        departmentId: phoneNumbersTable.departmentId,
        twilioSid: phoneNumbersTable.twilioSid,
      })
      .from(phoneNumbersTable);

    const regByNumber = new Map(registry.map((r) => [r.phoneNumber, r]));
    const twByNumber = new Map(twilioNumbers.map((n) => [n.phoneNumber, n]));

    const webhook = getPublicWebhookConfig();
    const expectedSmsUrl = webhook.available ? webhook.smsUrl : null;

    // On Twilio but not in our registry — billed orphans (or pre-existing).
    const orphans = twilioNumbers
      .filter((n) => !regByNumber.has(n.phoneNumber))
      .map((n) => ({
        phoneNumber: n.phoneNumber,
        sid: n.sid,
        smsUrl: n.smsUrl || null,
      }));

    // In our registry but not on Twilio — stale rows pointing at numbers we no
    // longer own.
    const ghosts = registry
      .filter((r) => !twByNumber.has(r.phoneNumber))
      .map((r) => ({
        phoneNumber: r.phoneNumber,
        tenantId: r.tenantId,
        departmentId: r.departmentId,
      }));

    // Registered numbers whose Twilio inbound webhook does not point at us.
    const webhookMismatches = expectedSmsUrl
      ? twilioNumbers
          .filter(
            (n) =>
              regByNumber.has(n.phoneNumber) && n.smsUrl !== expectedSmsUrl,
          )
          .map((n) => ({
            phoneNumber: n.phoneNumber,
            sid: n.sid,
            currentSmsUrl: n.smsUrl || null,
            expectedSmsUrl,
          }))
      : [];

    res.json({
      twilioCount: twilioNumbers.length,
      registryCount: registry.length,
      expectedSmsUrl,
      orphans,
      ghosts,
      webhookMismatches,
    });
  } catch (err) {
    req.log.error({ err }, "Phone provisioning reconcile failed");
    res.status(500).json({ error: "Reconcile failed" });
  }
});

/**
 * POST /phone-provisioning/repair-webhooks
 * Set `smsUrl` to the current public URL on every Twilio number that IS in our
 * registry but has a mismatched/absent webhook. Only touches registered numbers
 * (never reconfigures unknown/orphan numbers automatically).
 */
router.post("/phone-provisioning/repair-webhooks", async (req, res) => {
  const client = getTwilioClient();
  if (!client) {
    res.status(503).json({ error: "Twilio not configured" });
    return;
  }

  const webhook = getPublicWebhookConfig();
  if (!webhook.available) {
    res.status(409).json({ error: webhook.reason, code: "no_public_webhook" });
    return;
  }

  try {
    const registry = await db
      .select({ phoneNumber: phoneNumbersTable.phoneNumber })
      .from(phoneNumbersTable);
    const registered = new Set(registry.map((r) => r.phoneNumber));

    const twilioNumbers = await client.incomingPhoneNumbers.list({ limit: 1000 });
    const repaired: { phoneNumber: string; sid: string }[] = [];

    for (const n of twilioNumbers) {
      if (!registered.has(n.phoneNumber)) continue;
      if (n.smsUrl === webhook.smsUrl) continue;
      await client.incomingPhoneNumbers(n.sid).update({
        smsUrl: webhook.smsUrl,
        smsMethod: webhook.smsMethod,
      });
      repaired.push({ phoneNumber: n.phoneNumber, sid: n.sid });
    }

    req.log.info(
      { repairedCount: repaired.length, smsUrl: webhook.smsUrl },
      "Repaired inbound webhooks for registered numbers",
    );
    res.json({ repairedCount: repaired.length, repaired, smsUrl: webhook.smsUrl });
  } catch (err) {
    req.log.error({ err }, "Phone provisioning repair-webhooks failed");
    res.status(500).json({ error: "Repair failed" });
  }
});

export default router;
