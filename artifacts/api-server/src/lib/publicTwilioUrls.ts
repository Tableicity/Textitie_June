/**
 * Resolve the public HTTPS base URL that Twilio can reach for webhooks.
 *
 * Twilio rejects non-public callback URLs (localhost, *.replit.dev preview
 * domains), so we only return a usable config when we have a real published
 * domain or an explicit override. This is the single source of truth for the
 * inbound SMS webhook (`smsUrl`) wired onto purchased/assigned numbers AND the
 * delivery `statusCallback` used by the outbound sender — keep both on this
 * helper so a number is never left "deaf" with a mismatched URL.
 *
 * Resolution order:
 *   1. PUBLIC_WEBHOOK_BASE_URL — explicit override. Lets a dev/preview env point
 *      purchased numbers at the *production* webhook (numbers are bought against
 *      the real Twilio account regardless of which env initiates the purchase).
 *   2. First REPLIT_DOMAINS host that is NOT *.replit.dev — i.e. a published
 *      `.replit.app` deployment or a custom domain.
 */

export interface PublicWebhookConfig {
  available: true;
  baseUrl: string;
  smsUrl: string;
  smsMethod: "POST";
  statusCallbackUrl: string;
}

export interface PublicWebhookUnavailable {
  available: false;
  reason: string;
}

export type PublicWebhookResult = PublicWebhookConfig | PublicWebhookUnavailable;

function normalizeBase(value: string): string | null {
  let v = value.trim();
  if (!v) return null;
  if (!/^https?:\/\//i.test(v)) v = `https://${v}`;
  try {
    const url = new URL(v);
    // Twilio requires HTTPS for production webhooks.
    if (url.protocol !== "https:") return null;
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

/**
 * Returns the resolved public HTTPS base URL (no trailing slash), or null when
 * only a preview/non-public URL is available.
 */
export function resolvePublicBaseUrl(): string | null {
  const explicit = process.env["PUBLIC_WEBHOOK_BASE_URL"]?.trim();
  if (explicit) {
    const normalized = normalizeBase(explicit);
    if (normalized) return normalized;
  }

  const domains = process.env["REPLIT_DOMAINS"];
  if (!domains) return null;
  for (const raw of domains.split(",")) {
    const host = raw.trim();
    if (!host) continue;
    // Preview domains end with `.replit.dev`; Twilio will reject them.
    if (host.endsWith(".replit.dev")) continue;
    return `https://${host}`;
  }
  return null;
}

export function getPublicWebhookConfig(): PublicWebhookResult {
  const base = resolvePublicBaseUrl();
  if (!base) {
    return {
      available: false,
      reason:
        "No public HTTPS webhook URL is available (REPLIT_DOMAINS is a preview domain and PUBLIC_WEBHOOK_BASE_URL is not set). Publish the app, or set PUBLIC_WEBHOOK_BASE_URL to the production domain.",
    };
  }
  return {
    available: true,
    baseUrl: base,
    smsUrl: `${base}/api/webhooks/twilio`,
    smsMethod: "POST",
    statusCallbackUrl: `${base}/api/webhooks/twilio/status`,
  };
}
