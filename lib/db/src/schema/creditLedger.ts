import { pgTable, serial, integer, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";

// ---------------------------------------------------------------------------
// Append-only audit ledger + idempotency spine for EVERY credit movement
// (message charges, refunds, backup top-ups, grants). The materialized bucket
// balances on `tenants` (addon/backup/debt) + `usage_records` (included) are the
// fast path; this table is the durable proof of WHY a balance changed and the
// guard that a carrier retry / duplicate webhook never double-charges. Exactly
// one logical movement per (tenant_id, idempotency_key, reason) — the unique
// index makes a second attempt a no-op (mirrors ai_auto_replies).
// ---------------------------------------------------------------------------
export const creditLedgerTable = pgTable(
  "credit_ledger",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
    // Idempotency key, e.g. `outbound:<messageId>`, `inbound:<sid|messageId>`,
    // `campaign_message:<id>`, `refund:<messageId>`, `trial:<tenantId>`.
    idempotencyKey: text("idempotency_key").notNull(),
    // Movement kind (plain text, NO DB CHECK so a new reason can never 500 a
    // read): outbound_charge | inbound_charge | campaign_charge |
    // refund_rejected | pending_refund | backup_topup | grant | migration.
    reason: text("reason").notNull(),
    // inbound | outbound | null (non-message movements).
    direction: text("direction"),
    // sms | mms | null.
    channel: text("channel"),
    // The message's computed credit cost / grant magnitude (always >= 0).
    credits: integer("credits").notNull().default(0),
    // Signed per-bucket deltas applied by this movement: a charge is negative,
    // a grant/refund is positive. debtDelta positive = debt grew.
    includedDelta: integer("included_delta").notNull().default(0),
    addonDelta: integer("addon_delta").notNull().default(0),
    backupDelta: integer("backup_delta").notNull().default(0),
    debtDelta: integer("debt_delta").notNull().default(0),
    // Balance snapshots AFTER this movement (audit only; debt stored positive).
    includedRemainingAfter: integer("included_remaining_after"),
    addonAfter: integer("addon_after"),
    backupAfter: integer("backup_after"),
    debtAfter: integer("debt_after"),
    // Links for refund reversal + reporting. Plain ints (no FK) to dodge cross
    // table cascade surprises when a message/campaign_message is deleted.
    messageId: integer("message_id"),
    campaignMessageId: integer("campaign_message_id"),
    // The usage_records.period_start this Included draw counted against.
    periodStart: timestamp("period_start", { withTimezone: true }),
    // Carrier MessageSid, for cross-referencing delivery-status callbacks.
    externalId: text("external_id"),
    metadata: text("metadata"),
    status: text("status").notNull().default("applied"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    idemUnq: uniqueIndex("credit_ledger_tenant_key_reason_idx").on(
      t.tenantId,
      t.idempotencyKey,
      t.reason,
    ),
    messageIdx: index("credit_ledger_message_idx").on(t.tenantId, t.messageId),
    campaignMessageIdx: index("credit_ledger_campaign_message_idx").on(
      t.tenantId,
      t.campaignMessageId,
    ),
    periodIdx: index("credit_ledger_tenant_period_idx").on(t.tenantId, t.periodStart),
  }),
);

export type CreditLedgerEntry = typeof creditLedgerTable.$inferSelect;
