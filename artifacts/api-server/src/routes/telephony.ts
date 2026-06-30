import { Router } from "express";
import twilio from "twilio";
import { db, phoneNumbersTable, tenantsTable, departmentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { GetTelephonyNumbersResponse } from "@workspace/api-zod";

const router = Router();

function getTwilioClient() {
  const sid = process.env["TWILIO_ACCOUNT_SID"];
  const token = process.env["TWILIO_AUTH_TOKEN"];
  if (!sid || !token) return null;
  return twilio(sid, token);
}

/**
 * Conductor-only platform-wide telephony overview. NOT a tenant route — it
 * lives under `/telephony` precisely so it is NOT in the conductorAuth bypass
 * allow-list and therefore requires Conductor auth.
 *
 * Returns two lists:
 *   - `assigned`: every row of the canonical `phone_numbers` registry joined
 *     with its tenant (name + slug) and department (name, nullable). This is
 *     the single source of truth for which number belongs to which tenant.
 *   - `available`: numbers the platform Twilio account OWNS but that are NOT
 *     present in the registry (i.e. free inventory ready to be assigned).
 */
router.get("/telephony/numbers", async (req, res): Promise<void> => {
  try {
    const rows = await db
      .select({
        phoneNumber: phoneNumbersTable.phoneNumber,
        numberType: phoneNumbersTable.numberType,
        registrationStatus: phoneNumbersTable.registrationStatus,
        kind: phoneNumbersTable.kind,
        twilioSid: phoneNumbersTable.twilioSid,
        tenantId: phoneNumbersTable.tenantId,
        tenantName: tenantsTable.name,
        tenantSlug: tenantsTable.slug,
        departmentId: phoneNumbersTable.departmentId,
        departmentName: departmentsTable.name,
        createdAt: phoneNumbersTable.createdAt,
      })
      .from(phoneNumbersTable)
      .innerJoin(tenantsTable, eq(phoneNumbersTable.tenantId, tenantsTable.id))
      .leftJoin(
        departmentsTable,
        eq(phoneNumbersTable.departmentId, departmentsTable.id),
      )
      .orderBy(tenantsTable.name, phoneNumbersTable.phoneNumber);

    const assigned = rows.map((r) => ({
      ...r,
      createdAt:
        r.createdAt instanceof Date
          ? r.createdAt.toISOString()
          : String(r.createdAt),
    }));
    const assignedSet = new Set(assigned.map((a) => a.phoneNumber));

    const client = getTwilioClient();
    let configured = false;
    let available: { phoneNumber: string; friendlyName: string }[] = [];

    if (client) {
      configured = true;
      try {
        // Auto-paginate (pageSize 100) up to a sane ceiling so the overview
        // reflects ALL owned numbers, not just the first page, on larger
        // accounts. 1000 is far above any realistic platform inventory.
        const list = await client.incomingPhoneNumbers.list({
          limit: 1000,
          pageSize: 100,
        });
        available = list
          .filter((n) => !!n.phoneNumber && !assignedSet.has(n.phoneNumber))
          .map((n) => ({
            phoneNumber: n.phoneNumber,
            friendlyName: n.friendlyName || n.phoneNumber,
          }));
      } catch (err) {
        // Twilio is configured but the live inventory call failed. Surface the
        // assigned registry (our own data) rather than 500-ing the whole page;
        // the available list just renders empty.
        req.log.error(
          { err },
          "Failed to list owned Twilio numbers for telephony overview",
        );
        available = [];
      }
    }

    res.json(
      GetTelephonyNumbersResponse.parse({ configured, available, assigned }),
    );
  } catch (err) {
    req.log.error({ err }, "Failed to build telephony overview");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
