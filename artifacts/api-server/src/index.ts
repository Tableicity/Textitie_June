import app from "./app";
import { logger } from "./lib/logger";
import { checkSchema } from "./lib/schemaCheck";
import { seedSuperuser } from "./lib/seedSuperuser";
import { seedTenantUsers } from "./lib/seedTenantUsers";
import { seedDemoData } from "./lib/seedData";
import { startTimerEngine } from "./lib/timerEngine";
import { startInboundAiWorker } from "./lib/inboundAiWorker";
import { startMigrationWorker } from "./lib/migrationWorker";
import { startMigrationPhase3Worker } from "./lib/migrationPhase3Worker";
import { bootstrapHipaaState } from "./lib/hipaaBootstrap";
import {
  ensurePhoneNumbersSchema,
  backfillPhoneNumbers,
  detectPhoneNumberDrift,
} from "./lib/phoneNumberRegistry";
import { runMigrations } from "stripe-replit-sync";
import { getStripeSync } from "./lib/stripeClient";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function initStripe() {
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) {
    logger.warn("DATABASE_URL not set — skipping Stripe init");
    return;
  }
  try {
    // runMigrations creates the stripe schema + all tables via pg-node-migrations.
    // It is idempotent: a populated _migrations table is a no-op; an absent schema
    // runs all 52 migrations. Must run BEFORE StripeSync touches any table.
    await runMigrations({ databaseUrl });
    logger.info("Stripe schema migrations complete");
    const stripeSync = await getStripeSync();
    await stripeSync.syncBackfill();
    logger.info("Stripe schema & data synced");
    const webhookBase = `https://${(process.env["REPLIT_DOMAINS"] ?? "").split(",")[0]}`;
    await stripeSync.findOrCreateManagedWebhook(`${webhookBase}/api/stripe/webhook`);
    logger.info("Stripe initialized");
  } catch (err) {
    logger.error({ err }, "Stripe init failed — continuing without Stripe");
  }
}

await initStripe();

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  // Self-provision the canonical phone_numbers table FIRST (idempotent). The
  // autoscale deploy has no migration step and dev/prod are separate databases
  // (the owner publishes prod, the agent only touches dev), so this boot DDL is
  // how the table reaches prod — automatically, when the owner publishes. No-op
  // in dev where the table already exists.
  ensurePhoneNumbersSchema()
    .catch((err) => logger.error({ err }, "ensurePhoneNumbersSchema failed"))
    .then(() => checkSchema())
    .then(async (missing) => {
      // phone_numbers is load-bearing: inbound routing reads it and FAILS CLOSED.
      // If provisioning failed (table still missing), refuse to serve in
      // production rather than silently stalling every inbound text.
      if (missing.includes("phone_numbers")) {
        if (process.env["NODE_ENV"] === "production") {
          logger.fatal(
            "phone_numbers table missing after provisioning — refusing to start in production",
          );
          process.exit(1);
        }
        logger.error(
          "phone_numbers table missing — inbound routing will fail closed (continuing in non-production)",
        );
      }

      await seedSuperuser(missing);
      await seedTenantUsers(missing);
      await seedDemoData(missing);
      await bootstrapHipaaState();

      // Backfill the canonical table from the legacy denormalized columns
      // (idempotent), then surface any drift loudly. Skipped only if the table
      // could not be provisioned (non-production, per the guard above).
      if (!missing.includes("phone_numbers")) {
        try {
          await backfillPhoneNumbers();
          await detectPhoneNumberDrift();
        } catch (err) {
          logger.error({ err }, "Phone number backfill/drift check failed");
        }
      }

      if (!missing.includes("automation_rules")) {
        startTimerEngine();
      }

      if (!missing.includes("conversation_inbound_ai_stages")) {
        startInboundAiWorker();
      }

      if (!missing.includes("migration_jobs")) {
        startMigrationWorker();
        startMigrationPhase3Worker();
      }
    });
});
