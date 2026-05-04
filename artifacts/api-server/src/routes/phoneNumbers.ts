import { Router } from "express";
import twilio from "twilio";
import { db, departmentsTable } from "@workspace/db";
import { eq, and, isNotNull } from "drizzle-orm";
import { requireTenantAuth } from "../middleware/tenantAuth";
import { logger } from "../lib/logger";

const router = Router();

function getTwilioClient() {
  const sid = process.env["TWILIO_ACCOUNT_SID"];
  const token = process.env["TWILIO_AUTH_TOKEN"];
  if (!sid || !token) return null;
  return twilio(sid, token);
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
  const limit = Math.min(Number(req.query.limit) || 20, 50);

  try {
    const params: Record<string, unknown> = { limit };
    if (areaCode) params.areaCode = Number(areaCode);
    if (contains) params.contains = contains;

    const numbers = await client
      .availablePhoneNumbers(country)
      .local.list(params);

    const results = numbers.map((n) => ({
      phoneNumber: n.phoneNumber,
      friendlyName: n.friendlyName,
      locality: n.locality,
      region: n.region,
      isoCountry: n.isoCountry,
      capabilities: n.capabilities,
    }));
    res.json(results);
  } catch (err) {
    req.log.error({ err }, "Failed to search available numbers");
    res.status(500).json({ error: "Failed to search numbers" });
  }
});

router.post("/phone-numbers/purchase", requireTenantAuth, async (req, res) => {
  const tenantId = req.tenantUser!.tenantId;
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

  if (departmentId) {
    const dept = await db
      .select({ id: departmentsTable.id })
      .from(departmentsTable)
      .where(and(eq(departmentsTable.id, departmentId), eq(departmentsTable.tenantId, tenantId)))
      .limit(1);
    if (dept.length === 0) {
      res.status(404).json({ error: "Department not found" });
      return;
    }
  }

  try {
    const purchased = await client.incomingPhoneNumbers.create({
      phoneNumber,
      friendlyName: `SAMA-${tenantId}`,
    });

    logger.info(
      { sid: purchased.sid, phoneNumber: purchased.phoneNumber, tenantId },
      "Phone number purchased from Twilio",
    );

    if (departmentId) {
      await db
        .update(departmentsTable)
        .set({ phoneNumber: purchased.phoneNumber, twilioSid: purchased.sid })
        .where(eq(departmentsTable.id, departmentId));
    }

    res.status(201).json({
      sid: purchased.sid,
      phoneNumber: purchased.phoneNumber,
      friendlyName: purchased.friendlyName,
      departmentId: departmentId || null,
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
  }
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
    const dept = await db
      .select({ id: departmentsTable.id })
      .from(departmentsTable)
      .where(and(eq(departmentsTable.id, departmentId), eq(departmentsTable.tenantId, tenantId)))
      .limit(1);
    if (dept.length === 0) {
      res.status(404).json({ error: "Department not found" });
      return;
    }
    const rows = await db
      .update(departmentsTable)
      .set({ phoneNumber, twilioSid: twilioSid || null })
      .where(eq(departmentsTable.id, departmentId))
      .returning();
    res.json(rows[0]);
  } catch (err) {
    req.log.error({ err }, "Failed to assign phone number");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
