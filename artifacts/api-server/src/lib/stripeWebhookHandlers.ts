import { getStripeSync, getUncachableStripeClient } from "./stripeClient";
import { logger } from "./logger";
import {
  handleCheckoutSessionCompleted,
  handleSubscriptionUpdated,
  handleSubscriptionDeleted,
  handlePaymentSucceeded,
  handlePaymentFailed,
} from "./stripeCheckout";
import { db, tenantsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

async function resolveTenantFromCustomer(
  customerId: string,
): Promise<{ tenantId: number; tenantSlug: string; tierCode: string } | null> {
  const rows = await db
    .select({
      id: tenantsTable.id,
      slug: tenantsTable.slug,
      planTierCode: tenantsTable.planTierCode,
      tierCode: tenantsTable.tierCode,
    })
    .from(tenantsTable)
    .where(eq(tenantsTable.stripeCustomerId, customerId))
    .limit(1);

  if (rows.length === 0) return null;
  const t = rows[0];
  return {
    tenantId: t.id,
    tenantSlug: t.slug,
    tierCode: t.planTierCode ?? t.tierCode,
  };
}

export class WebhookHandlers {
  static async processWebhook(
    payload: Buffer,
    signature: string,
  ): Promise<void> {
    if (!Buffer.isBuffer(payload)) {
      throw new Error(
        "STRIPE WEBHOOK ERROR: Payload must be a Buffer. " +
          "Received type: " +
          typeof payload +
          ". " +
          "This usually means express.json() parsed the body before reaching this handler. " +
          "FIX: Ensure webhook route is registered BEFORE app.use(express.json()).",
      );
    }

    // processWebhook handles signature verification + DB sync internally.
    // We also parse the event ourselves for business logic.
    const sync = await getStripeSync();
    const stripe = await getUncachableStripeClient();

    // Retrieve the webhook secret from the managed webhook row if not in config
    let webhookSecret = process.env["STRIPE_WEBHOOK_SECRET"] ?? "";
    if (!webhookSecret) {
      // StripeSync manages its own webhook secret in stripe._managed_webhooks.
      // We'll let processWebhook verify; we parse raw JSON here for business logic.
    }

    // Run StripeSync's processWebhook for DB sync (handles its own secret lookup)
    await sync.processWebhook(payload, signature);

    // Now parse the event ourselves for application business logic
    // We use the raw payload and construct the event without verification
    // (verification was already done by sync.processWebhook above)
    let event: { type: string; data: { object: Record<string, unknown> } };
    try {
      event = JSON.parse(payload.toString()) as typeof event;
    } catch {
      logger.warn("Failed to parse Stripe webhook payload as JSON");
      return;
    }

    logger.info({ type: event.type }, "Processing Stripe business logic for webhook");

    try {
      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object as { id: string; metadata?: Record<string, string> };
          await handleCheckoutSessionCompleted(session.id);
          break;
        }

        case "customer.subscription.updated":
        case "customer.subscription.created": {
          const sub = event.data.object as {
            id: string;
            customer: string;
            status: string;
            trial_end: number | null;
            current_period_start: number | null;
            current_period_end: number | null;
            items?: {
              data?: Array<{
                current_period_start?: number | null;
                current_period_end?: number | null;
              }>;
            };
            metadata?: Record<string, string>;
          };
          const tierCode = sub.metadata?.tierCode;
          if (!tierCode) {
            logger.warn({ subId: sub.id }, "Subscription webhook missing tierCode metadata — skipping business logic");
            break;
          }
          const tenant = await resolveTenantFromCustomer(sub.customer);
          if (!tenant) {
            logger.warn({ customer: sub.customer }, "No tenant found for Stripe customer");
            break;
          }
          await handleSubscriptionUpdated(tenant.tenantId, tenant.tenantSlug, tierCode, {
            id: sub.id,
            status: sub.status,
            trial_end: sub.trial_end,
            current_period_start: sub.current_period_start,
            current_period_end: sub.current_period_end,
            items: sub.items,
          });
          break;
        }

        case "customer.subscription.deleted": {
          const sub = event.data.object as { id: string; customer: string };
          const tenant = await resolveTenantFromCustomer(sub.customer);
          if (!tenant) {
            logger.warn({ customer: sub.customer }, "No tenant found for Stripe customer on deletion");
            break;
          }
          await handleSubscriptionDeleted(tenant.tenantId, tenant.tenantSlug, sub.id);
          break;
        }

        case "invoice.payment_succeeded": {
          const invoice = event.data.object as {
            id: string;
            customer: string;
            amount_paid: number;
            billing_reason?: string;
          };
          // Skip the initial subscription creation invoice (handled by checkout.session.completed)
          if (invoice.billing_reason === "subscription_create") break;
          const tenant = await resolveTenantFromCustomer(invoice.customer);
          if (!tenant) break;
          await handlePaymentSucceeded(tenant.tenantId, invoice.amount_paid, invoice.id);
          break;
        }

        case "invoice.payment_failed": {
          const invoice = event.data.object as {
            id: string;
            customer: string;
            amount_due: number;
          };
          const tenant = await resolveTenantFromCustomer(invoice.customer);
          if (!tenant) break;
          await handlePaymentFailed(tenant.tenantId, invoice.amount_due, invoice.id);
          break;
        }

        default:
          logger.info({ type: event.type }, "Unhandled Stripe event type (no business logic)");
      }
    } catch (err) {
      logger.error({ err, type: event.type }, "Error handling Stripe webhook business logic");
    }
  }
}
