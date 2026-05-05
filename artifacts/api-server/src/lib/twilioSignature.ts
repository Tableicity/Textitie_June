import type { RequestHandler } from "express";
import twilio from "twilio";
import { logger } from "./logger";

/**
 * Validates the `X-Twilio-Signature` header on incoming Twilio webhooks.
 *
 * Without this guard, any caller who can reach our public webhook URL can
 * mark messages delivered/failed (corrupting billing, audit, analytics) or
 * inject fake inbound texts. Twilio signs every request with the auth token
 * and the exact URL it called; we recompute the signature here and compare.
 *
 * Behaviour:
 *  - `TWILIO_AUTH_TOKEN` unset → log a warning and skip (local dev / curl
 *    tests). We never want to silently drop production traffic, so the
 *    skip is gated on the secret being absent.
 *  - Header missing or signature mismatch → 403 (Twilio will retry).
 *
 * The URL passed to `validateRequest` must match the URL Twilio called
 * exactly, including query string and the public host (we sit behind
 * Replit's reverse proxy so `req.host` is the internal port).
 */
export function requireTwilioSignature(): RequestHandler {
  return (req, res, next) => {
    const authToken = process.env["TWILIO_AUTH_TOKEN"];
    if (!authToken) {
      logger.warn(
        { path: req.originalUrl },
        "Twilio webhook signature check SKIPPED (TWILIO_AUTH_TOKEN unset)",
      );
      next();
      return;
    }

    const signature = req.get("x-twilio-signature");
    if (!signature) {
      logger.warn(
        { path: req.originalUrl, ip: req.ip },
        "Twilio webhook rejected: missing X-Twilio-Signature header",
      );
      res.status(403).json({ error: "Missing Twilio signature" });
      return;
    }

    const forwardedHost = req.get("x-forwarded-host") ?? req.get("host");
    const proto = req.get("x-forwarded-proto") ?? "https";
    const url = `${proto}://${forwardedHost}${req.originalUrl}`;
    const params = (req.body ?? {}) as Record<string, string>;

    const valid = twilio.validateRequest(authToken, signature, url, params);
    if (!valid) {
      logger.warn(
        { path: req.originalUrl, url, ip: req.ip },
        "Twilio webhook rejected: signature mismatch",
      );
      res.status(403).json({ error: "Invalid Twilio signature" });
      return;
    }

    next();
  };
}
