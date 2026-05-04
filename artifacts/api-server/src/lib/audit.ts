import type { Request } from "express";
import { db, auditLogsTable } from "@workspace/db";
import { logger } from "./logger";

export interface AuditEvent {
  action: string;
  entityType: string;
  entityId?: string | number | null;
  before?: unknown;
  after?: unknown;
}

export async function recordAudit(req: Request, evt: AuditEvent): Promise<void> {
  try {
    const tu = req.tenantUser;
    if (!tu) return;
    const ip =
      (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ||
      req.socket.remoteAddress ||
      null;
    const userAgent = (req.headers["user-agent"] as string | undefined) ?? null;
    await db.insert(auditLogsTable).values({
      tenantId: tu.tenantId,
      actorUserId: tu.tenantUserId,
      actorEmail: tu.email,
      action: evt.action,
      entityType: evt.entityType,
      entityId: evt.entityId == null ? null : String(evt.entityId),
      beforeJson: evt.before === undefined ? null : (evt.before as object | null),
      afterJson: evt.after === undefined ? null : (evt.after as object | null),
      ip,
      userAgent,
    });
  } catch (err) {
    logger.warn({ err, action: evt.action }, "Audit log write failed (non-blocking)");
  }
}
