import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

const PHONE_RE = /\+?\d[\d\s\-().]{8,}\d/g;
const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/g;

const hipaaTenants = new Set<number>();

export function setHipaaEnabled(tenantId: number, enabled: boolean): void {
  if (enabled) hipaaTenants.add(tenantId);
  else hipaaTenants.delete(tenantId);
}

export function isHipaaActive(): boolean {
  return hipaaTenants.size > 0;
}

function redactPhi(s: string): string {
  return s.replace(PHONE_RE, "[REDACTED-PHONE]").replace(SSN_RE, "[REDACTED-SSN]");
}

function redactObject(obj: unknown): unknown {
  if (obj == null) return obj;
  if (typeof obj === "string") return redactPhi(obj);
  if (Array.isArray(obj)) return obj.map(redactObject);
  if (typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (k === "phone" || k === "phoneNumber" || k === "contactPhone" || k === "body") {
        out[k] = typeof v === "string" ? "[REDACTED-PHI]" : v;
      } else {
        out[k] = redactObject(v);
      }
    }
    return out;
  }
  return obj;
}

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
  ],
  formatters: {
    log(obj) {
      if (!isHipaaActive()) return obj;
      return redactObject(obj) as Record<string, unknown>;
    },
  },
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
