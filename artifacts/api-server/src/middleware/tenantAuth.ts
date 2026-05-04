import type { RequestHandler } from "express";
import { verifyToken } from "../routes/auth";

export interface TenantAuthPayload {
  tenantUserId: number;
  tenantId: number;
  email: string;
  role: string;
  scope: "tenant";
}

declare global {
  namespace Express {
    interface Request {
      tenantUser?: TenantAuthPayload;
    }
  }
}

export const requireTenantAuth: RequestHandler = (req, res, next) => {
  const header = req.header("authorization") ?? "";
  if (!header.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const payload = verifyToken(header.slice(7));
  if (!payload || payload.scope !== "tenant") {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  req.tenantUser = payload as unknown as TenantAuthPayload;
  next();
};
