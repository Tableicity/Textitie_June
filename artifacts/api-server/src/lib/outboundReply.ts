import { db, messagesTable, departmentsTable, tenantsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { checkOutboundCompliance } from "./compliance";
import { guardOutboundFrom } from "./outboundFrom";
import { getSender } from "./senders";
import type { SendStatus } from "./senders/types";
import { rebrandAndLog } from "./brandSafety";
import { getTenantExtraCompetitors } from "./brandSafetyStore";
import {
  isDemoTextingBlockedForTenant,
  PAYWALL_NEW_CONTACT_MESSAGE,
} from "./demoTextingGate";

type MessageRow = typeof messagesTable.$inferSelect;

export type OutboundReplyResult =
  | {
      ok: true;
      messageRow: MessageRow;
      status: SendStatus;
      sendSummary: string | null;
    }
  | {
      ok: false;
      reason:
        | "compliance"
        | "no_sending_number"
        | "number_not_owned"
        | "paywall_new_contact";
      errorMessage: string;
      complianceReason?: string;
    };

/**
 * Single source of truth for sending an outbound SMS into an existing
 * conversation, persist-first. Used by the agent reply route AND the B4 gated
 * auto-send path so the two can never drift.
 *
 * Flow (mirrors the original conversations.ts logic exactly):
 *  1. (optional) checkOutboundCompliance — run at SEND time to avoid TOCTOU.
 *  2. Resolve the From number: department.phone_number ⇒ tenant.phone_number.
 *  3. guardOutboundFrom — fail closed if the tenant owns no sending number
 *     rather than silently borrowing the global default (another tenant's
 *     number), which would split replies into the wrong inbox.
 *  4. Insert the outbound row as 'pending' BEFORE calling the carrier so a crash
 *     mid-send can never leave a delivered message unrecorded.
 *  5. send() via the active sender, then update the row to sent/failed.
 *
 * Callers own conversation lookup, lastMessageAt bumps, usage metering,
 * eventBus publishes, Chatwoot mirroring, and HTTP status mapping.
 */
export async function sendConversationReply(opts: {
  tenantId: number;
  tenantSlug: string;
  conversationId: number;
  contactPhone: string;
  departmentId: number | null;
  body: string;
  senderName: string;
  conductorAuthorized: boolean;
  /** Defaults to true. Set false only if the caller just ran the check. */
  runComplianceCheck?: boolean;
  /**
   * When true, rewrite competitor names in `body` to the canonical brand before
   * persisting + sending (brand-safety Layer 1). AI auto-send paths pass true;
   * human sends default false so an agent's deliberate wording is respected.
   */
  scrubBrand?: boolean;
}): Promise<OutboundReplyResult> {
  const {
    tenantId,
    tenantSlug,
    conversationId,
    contactPhone,
    departmentId,
    body,
    senderName,
    conductorAuthorized,
  } = opts;

  // Demo paywall (authoritative): an unpaid/demo tenant may text only the phone
  // it signed up with. Block before scrub/compliance/from-resolution/persist so a
  // gated send never creates a message row, burns usage, or reaches the carrier.
  if (await isDemoTextingBlockedForTenant(tenantId, contactPhone)) {
    return {
      ok: false,
      reason: "paywall_new_contact",
      errorMessage: PAYWALL_NEW_CONTACT_MESSAGE,
    };
  }

  const runCompliance = opts.runComplianceCheck ?? true;
  let outboundBody = body;
  if (opts.scrubBrand ?? false) {
    const extraCompetitors = await getTenantExtraCompetitors(tenantId);
    outboundBody = rebrandAndLog(
      body,
      {
        tenantId,
        conversationId,
        surface: "ai_reply",
        site: "sendConversationReply",
      },
      { extraCompetitors },
    );
  }

  if (runCompliance) {
    const compliance = await checkOutboundCompliance(tenantId, tenantSlug, contactPhone);
    if (!compliance.ok) {
      return {
        ok: false,
        reason: "compliance",
        errorMessage: compliance.message,
        complianceReason: compliance.reason,
      };
    }
  }

  let fromOverride: string | null = null;
  if (departmentId) {
    const dept = await db
      .select({ phoneNumber: departmentsTable.phoneNumber })
      .from(departmentsTable)
      .where(and(eq(departmentsTable.id, departmentId), eq(departmentsTable.tenantId, tenantId)))
      .limit(1);
    fromOverride = dept[0]?.phoneNumber ?? null;
  }
  if (!fromOverride) {
    const tenant = await db
      .select({ phoneNumber: tenantsTable.phoneNumber })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, tenantId))
      .limit(1);
    fromOverride = tenant[0]?.phoneNumber ?? null;
  }

  const fromGuard = guardOutboundFrom({ tenantId, fromOverride });
  if (!fromGuard.ok) {
    return { ok: false, reason: fromGuard.reason, errorMessage: fromGuard.message };
  }

  const [pendingRow] = await db
    .insert(messagesTable)
    .values({
      conversationId,
      direction: "outbound",
      body: outboundBody,
      senderName,
      read: true,
      status: "pending",
    })
    .returning();

  const sender = getSender();
  const sendResult = await sender.send({
    to: contactPhone,
    body: outboundBody,
    tenantId,
    conductorAuthorized,
    fromOverride,
    messageId: pendingRow.id,
  });

  const finalStatus = sendResult.status === "sent" ? "sent" : "failed";
  const [updatedRow] = await db
    .update(messagesTable)
    .set({
      status: finalStatus,
      externalId: sendResult.externalId ?? null,
      errorMessage: sendResult.status === "sent" ? null : sendResult.responseSummary,
    })
    .where(eq(messagesTable.id, pendingRow.id))
    .returning();

  return {
    ok: true,
    messageRow: updatedRow,
    status: sendResult.status,
    sendSummary: sendResult.responseSummary,
  };
}
