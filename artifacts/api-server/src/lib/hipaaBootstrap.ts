import { db, tenantsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { setHipaaEnabled } from "./logger";

export async function bootstrapHipaaState(): Promise<void> {
  const rows = await db
    .select({ id: tenantsTable.id, hipaaEnabled: tenantsTable.hipaaEnabled })
    .from(tenantsTable)
    .where(eq(tenantsTable.hipaaEnabled, true));
  for (const r of rows) {
    setHipaaEnabled(r.id, true);
  }
}
