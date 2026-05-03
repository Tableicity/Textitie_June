import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { logger } from "../lib/logger";

const REALM = "SAMA Conductor";
let openWarningEmitted = false;

/**
 * HTTP Basic Auth gate for "Conductor Mode".
 *
 * - Bypassed for /healthz (load balancer probes) and /webhooks/* (inbound from
 *   carriers — Twilio cannot send Basic Auth).
 * - Bypassed entirely if CONDUCTOR_PASSWORD is unset (with a one-time WARN);
 *   set the secret to enforce.
 * - Username defaults to "conductor", overridable via CONDUCTOR_USERNAME.
 */
export const conductorAuth: RequestHandler = (req, res, next) => {
  if (req.path === "/healthz" || req.path.startsWith("/webhooks/")) {
    next();
    return;
  }

  const expectedPassword = process.env["CONDUCTOR_PASSWORD"];
  if (!expectedPassword) {
    if (!openWarningEmitted) {
      logger.warn(
        "CONDUCTOR_PASSWORD not set — Control Plane is OPEN. Set the secret to enforce Basic Auth.",
      );
      openWarningEmitted = true;
    }
    next();
    return;
  }

  const expectedUsername = process.env["CONDUCTOR_USERNAME"] ?? "conductor";
  const header = req.header("authorization") ?? "";

  if (header.startsWith("Basic ")) {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const idx = decoded.indexOf(":");
    const user = idx >= 0 ? decoded.slice(0, idx) : decoded;
    const pass = idx >= 0 ? decoded.slice(idx + 1) : "";

    if (
      user === expectedUsername &&
      safeEqual(pass, expectedPassword)
    ) {
      next();
      return;
    }
  }

  res.set("WWW-Authenticate", `Basic realm="${REALM}", charset="UTF-8"`);
  res.status(401).json({ error: "Conductor authentication required" });
};

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
