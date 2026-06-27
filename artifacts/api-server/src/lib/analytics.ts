import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

export interface AnalyticsRange {
  tenantId: number;
  from: Date;
  to: Date;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function int(v: unknown): number {
  const n = num(v);
  return n === null ? 0 : Math.round(n);
}

export interface OverviewResult {
  totalConversations: number;
  openConversations: number;
  closedConversations: number;
  inboundMessages: number;
  outboundMessages: number;
  avgResponseSeconds: number | null;
  medianResponseSeconds: number | null;
  p90ResponseSeconds: number | null;
  avgResolutionSeconds: number | null;
  medianResolutionSeconds: number | null;
  resolutionRate: number | null;
}

export async function getOverview({ tenantId, from, to }: AnalyticsRange): Promise<OverviewResult> {
  const result = await db.execute(sql`
    WITH conv AS (
      SELECT id, status, created_at, last_message_at
      FROM conversations
      WHERE tenant_id = ${tenantId}
        AND is_quarantined = false
        AND created_at >= ${from}
        AND created_at <= ${to}
    ),
    ttfr AS (
      SELECT
        c.id,
        EXTRACT(EPOCH FROM (
          (SELECT MIN(created_at) FROM messages WHERE conversation_id = c.id AND direction = 'outbound')
          - (SELECT MIN(created_at) FROM messages WHERE conversation_id = c.id AND direction = 'inbound')
        )) AS ttfr_seconds
      FROM conv c
    ),
    res AS (
      SELECT id, EXTRACT(EPOCH FROM (last_message_at - created_at)) AS res_seconds
      FROM conv
      WHERE status = 'closed' AND last_message_at IS NOT NULL
    )
    SELECT
      (SELECT COUNT(*)::int FROM conv) AS total_conversations,
      (SELECT COUNT(*)::int FROM conv WHERE status = 'open') AS open_conversations,
      (SELECT COUNT(*)::int FROM conv WHERE status = 'closed') AS closed_conversations,
      (SELECT COUNT(*)::int FROM messages m JOIN conv c ON c.id = m.conversation_id WHERE m.direction = 'inbound') AS inbound_messages,
      (SELECT COUNT(*)::int FROM messages m JOIN conv c ON c.id = m.conversation_id WHERE m.direction = 'outbound') AS outbound_messages,
      (SELECT AVG(ttfr_seconds) FROM ttfr WHERE ttfr_seconds > 0) AS avg_response_seconds,
      (SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ttfr_seconds) FROM ttfr WHERE ttfr_seconds > 0) AS median_response_seconds,
      (SELECT PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY ttfr_seconds) FROM ttfr WHERE ttfr_seconds > 0) AS p90_response_seconds,
      (SELECT AVG(res_seconds) FROM res WHERE res_seconds > 0) AS avg_resolution_seconds,
      (SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY res_seconds) FROM res WHERE res_seconds > 0) AS median_resolution_seconds
  `);
  const r = (result.rows[0] ?? {}) as Record<string, unknown>;
  const total = int(r.total_conversations);
  const closed = int(r.closed_conversations);
  return {
    totalConversations: total,
    openConversations: int(r.open_conversations),
    closedConversations: closed,
    inboundMessages: int(r.inbound_messages),
    outboundMessages: int(r.outbound_messages),
    avgResponseSeconds: num(r.avg_response_seconds),
    medianResponseSeconds: num(r.median_response_seconds),
    p90ResponseSeconds: num(r.p90_response_seconds),
    avgResolutionSeconds: num(r.avg_resolution_seconds),
    medianResolutionSeconds: num(r.median_resolution_seconds),
    resolutionRate: total > 0 ? closed / total : null,
  };
}

export interface VolumePoint {
  bucket: string;
  newConversations: number;
  inboundMessages: number;
  outboundMessages: number;
}

export async function getVolume({ tenantId, from, to }: AnalyticsRange): Promise<VolumePoint[]> {
  const result = await db.execute(sql`
    WITH days AS (
      SELECT generate_series(
        date_trunc('day', ${from}::timestamptz),
        date_trunc('day', ${to}::timestamptz),
        interval '1 day'
      ) AS bucket
    ),
    convs AS (
      SELECT date_trunc('day', created_at) AS bucket, COUNT(*)::int AS n
      FROM conversations
      WHERE tenant_id = ${tenantId} AND is_quarantined = false AND created_at >= ${from} AND created_at <= ${to}
      GROUP BY 1
    ),
    msgs AS (
      SELECT
        date_trunc('day', m.created_at) AS bucket,
        SUM(CASE WHEN m.direction = 'inbound' THEN 1 ELSE 0 END)::int AS inbound,
        SUM(CASE WHEN m.direction = 'outbound' THEN 1 ELSE 0 END)::int AS outbound
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE c.tenant_id = ${tenantId} AND c.is_quarantined = false AND m.created_at >= ${from} AND m.created_at <= ${to}
      GROUP BY 1
    )
    SELECT
      to_char(d.bucket, 'YYYY-MM-DD') AS bucket,
      COALESCE(convs.n, 0)::int AS new_conversations,
      COALESCE(msgs.inbound, 0)::int AS inbound_messages,
      COALESCE(msgs.outbound, 0)::int AS outbound_messages
    FROM days d
    LEFT JOIN convs ON convs.bucket = d.bucket
    LEFT JOIN msgs ON msgs.bucket = d.bucket
    ORDER BY d.bucket
  `);
  return result.rows.map((r) => {
    const row = r as Record<string, unknown>;
    return {
      bucket: String(row.bucket),
      newConversations: int(row.new_conversations),
      inboundMessages: int(row.inbound_messages),
      outboundMessages: int(row.outbound_messages),
    };
  });
}

export interface AgentKpi {
  agentId: number | null;
  agentName: string;
  conversationsHandled: number;
  messagesSent: number;
  avgResponseSeconds: number | null;
  resolvedCount: number;
}

export async function getAgentKpis({ tenantId, from, to }: AnalyticsRange): Promise<AgentKpi[]> {
  const result = await db.execute(sql`
    WITH conv AS (
      SELECT id, status, assigned_user_id, created_at, last_message_at
      FROM conversations
      WHERE tenant_id = ${tenantId} AND is_quarantined = false AND created_at >= ${from} AND created_at <= ${to}
    ),
    ttfr AS (
      SELECT
        c.assigned_user_id,
        EXTRACT(EPOCH FROM (
          (SELECT MIN(created_at) FROM messages WHERE conversation_id = c.id AND direction = 'outbound')
          - (SELECT MIN(created_at) FROM messages WHERE conversation_id = c.id AND direction = 'inbound')
        )) AS ttfr_seconds
      FROM conv c
      WHERE c.assigned_user_id IS NOT NULL
    ),
    sent AS (
      SELECT c.assigned_user_id, COUNT(*)::int AS n
      FROM messages m
      JOIN conv c ON c.id = m.conversation_id
      WHERE m.direction = 'outbound' AND c.assigned_user_id IS NOT NULL
      GROUP BY c.assigned_user_id
    )
    SELECT
      u.id AS agent_id,
      u.name AS agent_name,
      (SELECT COUNT(*)::int FROM conv WHERE assigned_user_id = u.id) AS conversations_handled,
      COALESCE((SELECT n FROM sent WHERE assigned_user_id = u.id), 0) AS messages_sent,
      (SELECT AVG(ttfr_seconds) FROM ttfr WHERE assigned_user_id = u.id AND ttfr_seconds > 0) AS avg_response_seconds,
      (SELECT COUNT(*)::int FROM conv WHERE assigned_user_id = u.id AND status = 'closed') AS resolved_count
    FROM tenant_users u
    WHERE u.tenant_id = ${tenantId}
    ORDER BY conversations_handled DESC, u.name ASC
  `);
  return result.rows.map((r) => {
    const row = r as Record<string, unknown>;
    return {
      agentId: row.agent_id === null ? null : int(row.agent_id),
      agentName: String(row.agent_name ?? "Unknown"),
      conversationsHandled: int(row.conversations_handled),
      messagesSent: int(row.messages_sent),
      avgResponseSeconds: num(row.avg_response_seconds),
      resolvedCount: int(row.resolved_count),
    };
  });
}

export interface DepartmentKpi {
  departmentId: number | null;
  departmentName: string;
  conversations: number;
  avgResponseSeconds: number | null;
  avgResolutionSeconds: number | null;
  resolvedCount: number;
}

export async function getDepartmentKpis({ tenantId, from, to }: AnalyticsRange): Promise<DepartmentKpi[]> {
  const result = await db.execute(sql`
    WITH conv AS (
      SELECT id, status, department_id, created_at, last_message_at
      FROM conversations
      WHERE tenant_id = ${tenantId} AND is_quarantined = false AND created_at >= ${from} AND created_at <= ${to}
    ),
    ttfr AS (
      SELECT
        c.department_id,
        EXTRACT(EPOCH FROM (
          (SELECT MIN(created_at) FROM messages WHERE conversation_id = c.id AND direction = 'outbound')
          - (SELECT MIN(created_at) FROM messages WHERE conversation_id = c.id AND direction = 'inbound')
        )) AS ttfr_seconds
      FROM conv c
    ),
    res AS (
      SELECT department_id, EXTRACT(EPOCH FROM (last_message_at - created_at)) AS res_seconds
      FROM conv WHERE status = 'closed' AND last_message_at IS NOT NULL
    )
    SELECT
      d.id AS department_id,
      d.name AS department_name,
      (SELECT COUNT(*)::int FROM conv WHERE department_id = d.id) AS conversations,
      (SELECT AVG(ttfr_seconds) FROM ttfr WHERE department_id = d.id AND ttfr_seconds > 0) AS avg_response_seconds,
      (SELECT AVG(res_seconds) FROM res WHERE department_id = d.id AND res_seconds > 0) AS avg_resolution_seconds,
      (SELECT COUNT(*)::int FROM conv WHERE department_id = d.id AND status = 'closed') AS resolved_count
    FROM departments d
    WHERE d.tenant_id = ${tenantId}
    ORDER BY conversations DESC, d.name ASC
  `);
  return result.rows.map((r) => {
    const row = r as Record<string, unknown>;
    return {
      departmentId: row.department_id === null ? null : int(row.department_id),
      departmentName: String(row.department_name ?? "Unassigned"),
      conversations: int(row.conversations),
      avgResponseSeconds: num(row.avg_response_seconds),
      avgResolutionSeconds: num(row.avg_resolution_seconds),
      resolvedCount: int(row.resolved_count),
    };
  });
}

export interface ConversationExportRow {
  conversationId: number;
  contactPhone: string;
  contactName: string | null;
  status: string;
  departmentName: string | null;
  agentName: string | null;
  createdAt: string;
  lastMessageAt: string | null;
  inboundCount: number;
  outboundCount: number;
  firstResponseSeconds: number | null;
  resolutionSeconds: number | null;
}

export async function getConversationExport({ tenantId, from, to }: AnalyticsRange): Promise<ConversationExportRow[]> {
  const result = await db.execute(sql`
    SELECT
      c.id AS conversation_id,
      c.contact_phone,
      c.contact_name,
      c.status,
      d.name AS department_name,
      u.name AS agent_name,
      c.created_at,
      c.last_message_at,
      (SELECT COUNT(*)::int FROM messages WHERE conversation_id = c.id AND direction = 'inbound') AS inbound_count,
      (SELECT COUNT(*)::int FROM messages WHERE conversation_id = c.id AND direction = 'outbound') AS outbound_count,
      EXTRACT(EPOCH FROM (
        (SELECT MIN(created_at) FROM messages WHERE conversation_id = c.id AND direction = 'outbound')
        - (SELECT MIN(created_at) FROM messages WHERE conversation_id = c.id AND direction = 'inbound')
      )) AS first_response_seconds,
      CASE WHEN c.status = 'closed' AND c.last_message_at IS NOT NULL
        THEN EXTRACT(EPOCH FROM (c.last_message_at - c.created_at))
        ELSE NULL
      END AS resolution_seconds
    FROM conversations c
    LEFT JOIN departments d ON d.id = c.department_id
    LEFT JOIN tenant_users u ON u.id = c.assigned_user_id
    WHERE c.tenant_id = ${tenantId} AND c.is_quarantined = false AND c.created_at >= ${from} AND c.created_at <= ${to}
    ORDER BY c.created_at DESC
  `);
  return result.rows.map((r) => {
    const row = r as Record<string, unknown>;
    const ttfr = num(row.first_response_seconds);
    return {
      conversationId: int(row.conversation_id),
      contactPhone: String(row.contact_phone ?? ""),
      contactName: row.contact_name ? String(row.contact_name) : null,
      status: String(row.status ?? ""),
      departmentName: row.department_name ? String(row.department_name) : null,
      agentName: row.agent_name ? String(row.agent_name) : null,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
      lastMessageAt: row.last_message_at
        ? row.last_message_at instanceof Date
          ? row.last_message_at.toISOString()
          : String(row.last_message_at)
        : null,
      inboundCount: int(row.inbound_count),
      outboundCount: int(row.outbound_count),
      firstResponseSeconds: ttfr !== null && ttfr > 0 ? ttfr : null,
      resolutionSeconds: num(row.resolution_seconds),
    };
  });
}

export function toCsv(rows: ConversationExportRow[]): string {
  const headers = [
    "conversation_id",
    "contact_phone",
    "contact_name",
    "status",
    "department",
    "agent",
    "created_at",
    "last_message_at",
    "inbound_count",
    "outbound_count",
    "first_response_seconds",
    "resolution_seconds",
  ];
  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    let s = String(v);
    // Defuse CSV formula injection (Excel/Sheets execute cells starting with = + - @ \t \r)
    if (s.length > 0 && /^[=+\-@\t\r]/.test(s)) {
      s = `'${s}`;
    }
    if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.conversationId,
        r.contactPhone,
        r.contactName,
        r.status,
        r.departmentName,
        r.agentName,
        r.createdAt,
        r.lastMessageAt,
        r.inboundCount,
        r.outboundCount,
        r.firstResponseSeconds !== null ? r.firstResponseSeconds.toFixed(2) : "",
        r.resolutionSeconds !== null ? r.resolutionSeconds.toFixed(2) : "",
      ].map(escape).join(","),
    );
  }
  return lines.join("\n");
}
