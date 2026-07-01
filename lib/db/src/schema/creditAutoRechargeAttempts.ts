import { pgTable, serial, integer, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";

// ---------------------------------------------------------------------------
// Automatic backup credits (auto-recharge) attempt log + idempotency spine.
//
// One row per recharge EPISODE, created under the tenant claim lock BEFORE any
// Stripe call. The idempotencyKey is minted at claim time and passed to
// Stripe's PaymentIntent create as its idempotency key, so a crash-and-retry
// (via the timer reconciler) re-issues the SAME key and Stripe dedupes it
// within 24h → never a double charge.
//
// Lifecycle: 'claimed' (charge in flight / unknown) → 'succeeded' (PI confirmed
// + credits granted) | 'failed' (definitive decline or given up). A stale
// 'claimed' row is what the reconciler finalizes.
// ---------------------------------------------------------------------------

export const creditAutoRechargeAttemptsTable = pgTable(
  "credit_auto_recharge_attempts",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("claimed"),
    blocks: integer("blocks").notNull(),
    credits: integer("credits").notNull(),
    amountCents: integer("amount_cents").notNull(),
    // Passed to Stripe as the PaymentIntent idempotency key. Globally unique.
    idempotencyKey: text("idempotency_key").notNull(),
    paymentIntentId: text("payment_intent_id"),
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_auto_recharge_idem_key").on(table.idempotencyKey),
    index("ix_auto_recharge_tenant_status").on(table.tenantId, table.status),
    index("ix_auto_recharge_status_created").on(table.status, table.createdAt),
  ],
);

export type CreditAutoRechargeAttempt = typeof creditAutoRechargeAttemptsTable.$inferSelect;
