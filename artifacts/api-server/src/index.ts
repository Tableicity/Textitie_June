import app from "./app";
import { logger } from "./lib/logger";
import { checkSchema } from "./lib/schemaCheck";
import { seedSuperuser } from "./lib/seedSuperuser";
import { seedTenantUsers } from "./lib/seedTenantUsers";
import { seedDemoData } from "./lib/seedData";
import { startTimerEngine } from "./lib/timerEngine";
import { bootstrapHipaaState } from "./lib/hipaaBootstrap";
import {
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
  checkSchema().then(async (missing) => {
    await seedSuperuser(missing);
    await seedTenantUsers(missing);
    await seedDemoData(missing);
    await bootstrapHipaaState();

    // Populate the canonical phone_numbers table from the legacy denormalized
    // columns (idempotent), then surface any drift loudly. Gated on the table
    // existing so a not-yet-migrated environment still boots.
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
  });
});
