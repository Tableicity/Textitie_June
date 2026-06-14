import app from "./app";
import { logger } from "./lib/logger";
import { checkSchema } from "./lib/schemaCheck";
import { seedSuperuser } from "./lib/seedSuperuser";
import { seedTenantUsers } from "./lib/seedTenantUsers";
import { seedDemoData } from "./lib/seedData";
import { startTimerEngine } from "./lib/timerEngine";
import { bootstrapHipaaState } from "./lib/hipaaBootstrap";
import {
  ensurePhoneNumbersSchema,
  backfillPhoneNumbers,
  detectPhoneNumberDrift,
} from "./lib/phoneNumberRegistry";

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

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  // Self-provision the canonical phone_numbers table FIRST (idempotent). The
  // autoscale deploy has no migration step and dev/prod are separate databases,
  // so this is how the table reaches prod — automatically, on republish. No-op
  // in dev where the table already exists.
  ensurePhoneNumbersSchema()
    .catch((err) =>
      logger.error({ err }, "ensurePhoneNumbersSchema failed (continuing)"),
    )
    .then(() => checkSchema())
    .then(async (missing) => {
      await seedSuperuser(missing);
      await seedTenantUsers(missing);
      await seedDemoData(missing);
      await bootstrapHipaaState();

      // Backfill the canonical table from the legacy denormalized columns
      // (idempotent), then surface any drift loudly.
      try {
        await backfillPhoneNumbers();
        await detectPhoneNumberDrift();
      } catch (err) {
        logger.error({ err }, "Phone number backfill/drift check failed");
      }

      if (!missing.includes("automation_rules")) {
        startTimerEngine();
      }
    });
});
