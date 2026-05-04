import { db, tenantUsersTable, departmentMembersTable } from "@workspace/db";
import { eq, and, asc } from "drizzle-orm";
import { logger } from "./logger";

export type RoutingStrategy = "round_robin" | "load_balanced" | "last_assigned";

interface RoutableAgent {
  id: number;
  status: string;
  lastAssignedAt: Date | null;
}

export async function pickAgent(
  departmentId: number,
  tenantId: number,
  strategy: RoutingStrategy,
): Promise<number | null> {
  try {
    const members = await db
      .select({
        id: tenantUsersTable.id,
        status: tenantUsersTable.status,
        lastAssignedAt: tenantUsersTable.lastAssignedAt,
      })
      .from(departmentMembersTable)
      .innerJoin(tenantUsersTable, eq(departmentMembersTable.tenantUserId, tenantUsersTable.id))
      .where(
        and(
          eq(departmentMembersTable.departmentId, departmentId),
          eq(tenantUsersTable.tenantId, tenantId),
          eq(tenantUsersTable.status, "online"),
        ),
      );

    if (members.length === 0) return null;

    switch (strategy) {
      case "round_robin":
        return roundRobin(members);
      case "load_balanced":
        return loadBalanced(members, tenantId);
      case "last_assigned":
        return lastAssigned(members);
      default:
        return roundRobin(members);
    }
  } catch (err) {
    logger.error({ err, departmentId, strategy }, "Routing engine error");
    return null;
  }
}

function roundRobin(agents: RoutableAgent[]): number {
  const sorted = [...agents].sort((a, b) => {
    const aTime = a.lastAssignedAt?.getTime() ?? 0;
    const bTime = b.lastAssignedAt?.getTime() ?? 0;
    return aTime - bTime;
  });
  return sorted[0].id;
}

async function loadBalanced(agents: RoutableAgent[], tenantId: number): Promise<number> {
  const { conversationsTable } = await import("@workspace/db");
  const counts = new Map<number, number>();
  for (const agent of agents) {
    const rows = await db
      .select({ id: conversationsTable.id })
      .from(conversationsTable)
      .where(
        and(
          eq(conversationsTable.assignedUserId, agent.id),
          eq(conversationsTable.tenantId, tenantId),
          eq(conversationsTable.status, "open"),
        ),
      );
    counts.set(agent.id, rows.length);
  }

  let minAgent = agents[0].id;
  let minCount = counts.get(agents[0].id) ?? 0;
  for (const agent of agents) {
    const c = counts.get(agent.id) ?? 0;
    if (c < minCount) {
      minCount = c;
      minAgent = agent.id;
    }
  }
  return minAgent;
}

function lastAssigned(agents: RoutableAgent[]): number {
  const sorted = [...agents].sort((a, b) => {
    const aTime = a.lastAssignedAt?.getTime() ?? 0;
    const bTime = b.lastAssignedAt?.getTime() ?? 0;
    return bTime - aTime;
  });
  return sorted[0].id;
}
