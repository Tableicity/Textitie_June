import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { logger } from "../lib/logger";
import { verifyToken } from "../routes/auth";

const REALM = "SAMA Conductor";
let openWarningEmitted = false;

export const conductorAuth: RequestHandler = (req, res, next) => {
  if (
    req.path === "/healthz" ||
    req.path.startsWith("/webhooks/") ||
    req.path === "/auth/login" ||
    req.path.startsWith("/tenant-auth/") ||
    req.path.startsWith("/conversations") ||
    req.path.startsWith("/departments") ||
    req.path.startsWith("/phone-numbers") ||
    req.path.startsWith("/agents")
  ) {
    next();
    return;
  }

  const header = req.header("authorization") ?? "";

  if (header.startsWith("Bearer ")) {
    const token = header.slice(7);
    const payload = verifyToken(token);
    if (payload && payload.scope !== "tenant") {
      next();
      return;
    }
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

  if (header.startsWith("Basic ")) {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const idx = decoded.indexOf(":");
    const user = idx >= 0 ? decoded.slice(0, idx) : decoded;
    const pass = idx >= 0 ? decoded.slice(idx + 1) : "";

    if (user === expectedUsername && safeEqual(pass, expectedPassword)) {
      next();
      return;
    }
  }

  const isAjax =
    req.header("x-requested-with") === "XMLHttpRequest" ||
    (req.header("accept") ?? "").includes("application/json");
  if (!isAjax) {
    res.set("WWW-Authenticate", `Basic realm="${REALM}", charset="UTF-8"`);
  }
  res.status(401).json({ error: "Conductor authentication required" });
};

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
