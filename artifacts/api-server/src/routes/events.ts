import { Router } from "express";
import { verifyToken } from "./auth";
import { eventBus, type RealtimeEvent } from "../lib/eventBus";
import { logger } from "../lib/logger";

const router = Router();

/**
 * Server-Sent Events stream for the agent inbox.
 *
 * EventSource cannot set Authorization headers, so the JWT is passed via the
 * `token` query param. Same JWT issued by /tenant-auth/verify-mfa.
 *
 * Stream emits:
 *   event: message    data: { conversationId, direction }
 *   event: conversation data: { conversationId }
 *   event: ping       data: { ts }    (every 25s, keeps proxies from killing the connection)
 */
router.get("/events/stream", (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const payload = token ? verifyToken(token) : null;
  if (!payload || payload.scope !== "tenant") {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const tenantId = payload.tenantId as number;
  const tenantUserId = payload.tenantUserId as number;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  res.write(`: connected tenantId=${tenantId}\n\n`);

  const send = (event: RealtimeEvent): void => {
    const name =
      event.type === "message:new"
        ? "message"
        : event.type === "conversation:new"
          ? "conversation"
          : "event";
    res.write(`event: ${name}\n`);
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  const unsubscribe = eventBus.subscribe(tenantId, send);

  const ping = setInterval(() => {
    res.write(`event: ping\ndata: {"ts":${Date.now()}}\n\n`);
  }, 25_000);

  const cleanup = () => {
    clearInterval(ping);
    unsubscribe();
    logger.info({ tenantId, tenantUserId }, "SSE client disconnected");
  };

  req.on("close", cleanup);
  req.on("error", cleanup);

  logger.info({ tenantId, tenantUserId }, "SSE client connected");
});

export default router;
