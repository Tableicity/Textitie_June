import { logger } from "../logger";

export interface HubSpotContactPayload {
  phone: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  tags?: string[];
}

export interface HubSpotEngagementPayload {
  externalContactId: string;
  type: "NOTE" | "TASK";
  body: string;
  metadata?: Record<string, unknown>;
}

export interface HubSpotClient {
  upsertContact(p: HubSpotContactPayload): Promise<{ externalId: string }>;
  logEngagement(p: HubSpotEngagementPayload): Promise<{ externalId: string }>;
}

export interface SimLogEntry {
  at: string;
  tenantId: number;
  op: string;
  payload: unknown;
  externalId: string;
}

const SIM_LOG_LIMIT = 100;
const simLogByTenant = new Map<number, SimLogEntry[]>();

function pushLog(tenantId: number, entry: SimLogEntry): void {
  const arr = simLogByTenant.get(tenantId) ?? [];
  arr.unshift(entry);
  if (arr.length > SIM_LOG_LIMIT) arr.length = SIM_LOG_LIMIT;
  simLogByTenant.set(tenantId, arr);
}

export function getSimLog(tenantId: number): SimLogEntry[] {
  return simLogByTenant.get(tenantId) ?? [];
}

export class StubHubSpotClient implements HubSpotClient {
  constructor(private readonly tenantId: number) {}

  async upsertContact(p: HubSpotContactPayload): Promise<{ externalId: string }> {
    await new Promise((r) => setTimeout(r, 50));
    const externalId = `stub_hs_contact_${Buffer.from(p.phone).toString("hex").slice(0, 12)}`;
    pushLog(this.tenantId, {
      at: new Date().toISOString(),
      tenantId: this.tenantId,
      op: "upsertContact",
      payload: p,
      externalId,
    });
    logger.info({ tenantId: this.tenantId, externalId }, "[HubSpot Stub] upsertContact");
    return { externalId };
  }

  async logEngagement(p: HubSpotEngagementPayload): Promise<{ externalId: string }> {
    await new Promise((r) => setTimeout(r, 50));
    const externalId = `stub_hs_engagement_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    pushLog(this.tenantId, {
      at: new Date().toISOString(),
      tenantId: this.tenantId,
      op: "logEngagement",
      payload: p,
      externalId,
    });
    logger.info({ tenantId: this.tenantId, externalId }, "[HubSpot Stub] logEngagement");
    return { externalId };
  }
}

export function getHubSpotClient(tenantId: number): HubSpotClient {
  return new StubHubSpotClient(tenantId);
}
