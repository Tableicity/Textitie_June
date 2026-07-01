import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { getGetSubscriptionQueryKey } from "@workspace/api-client-react";
import { Clock, AlertTriangle, ArrowRight } from "lucide-react";
import { getTrialBannerPhase } from "./trialBanner.logic";

type TrialBannerProps = {
  status: string | undefined;
  trialEndsAt: string | null | undefined;
  billingBypass: boolean | undefined;
  isOwner: boolean;
};

// Human-friendly countdown: drop to finer units as the deadline nears so the
// last hour visibly ticks by the second.
function formatRemaining(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

/**
 * Persistent top-of-workspace banner for free-trial tenants. Three phases
 * (getTrialBannerPhase):
 *   - "normal"  → orange, live countdown while there is comfortable runway.
 *   - "urgent"  → red, live countdown once the trial is within
 *                 TRIAL_URGENT_THRESHOLD_MS of expiry (escalates BEFORE expiry).
 *   - "expired" → red, static "expired" message (server status "expired" OR the
 *                 client-side countdown reached zero before the lifecycle job).
 * Hidden for paid, never-trialed, and billingBypass ("treated as paid") tenants.
 */
export default function TrialBanner({
  status,
  trialEndsAt,
  billingBypass,
  isOwner,
}: TrialBannerProps) {
  const queryClient = useQueryClient();
  const [now, setNow] = useState(() => Date.now());
  const refetchedOnExpiry = useRef(false);

  const isTrialAccount = status === "trialing" || status === "expired";
  const active = isTrialAccount && !billingBypass;

  // Guard a null/malformed trialEndsAt so a bad date can't render "NaN".
  const endMs = trialEndsAt ? new Date(trialEndsAt).getTime() : null;
  const hasDeadline = endMs !== null && Number.isFinite(endMs);
  const remainingMs = hasDeadline ? (endMs as number) - now : null;

  const phase = getTrialBannerPhase(status, remainingMs);
  const expired = phase === "expired";
  const urgent = phase === "urgent";

  // Tick once a second — only while the banner is shown AND still counting down
  // (both "normal" and "urgent" count down; "expired" is static).
  useEffect(() => {
    if (!active || expired) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active, expired]);

  // When the client-side countdown crosses zero before the ~60s lifecycle job
  // flips status -> "expired", refetch the subscription once so the existing
  // full-screen expired mask mounts. (The server already hard-stops every
  // outbound send for expired tenants, so this is UX consistency only.)
  useEffect(() => {
    if (active && expired && status !== "expired" && !refetchedOnExpiry.current) {
      refetchedOnExpiry.current = true;
      queryClient.invalidateQueries({
        queryKey: getGetSubscriptionQueryKey(),
      });
    }
    if (!expired) refetchedOnExpiry.current = false;
  }, [active, expired, status, queryClient]);

  if (!active) return null;

  return (
    <div
      className={`flex items-center justify-center gap-3 px-4 py-2 text-sm font-medium text-white transition-colors ${
        phase === "normal" ? "bg-orange-500" : "bg-red-600"
      }`}
      data-testid="trial-countdown-banner"
      data-phase={phase}
      data-expired={expired ? "true" : "false"}
      data-urgent={urgent ? "true" : "false"}
    >
      {phase === "normal" ? (
        <Clock className="w-4 h-4 flex-shrink-0" />
      ) : (
        <AlertTriangle className="w-4 h-4 flex-shrink-0" />
      )}
      <span className="text-center">
        {expired ? (
          "Your free trial has expired."
        ) : remainingMs !== null ? (
          <>
            {urgent ? "Free trial ending soon — " : "Free trial — "}
            <span
              className="font-bold tabular-nums"
              data-testid="trial-countdown-remaining"
            >
              {formatRemaining(remainingMs)}
            </span>{" "}
            left
          </>
        ) : (
          "You're on a free trial."
        )}
      </span>
      {isOwner ? (
        <Link
          href="/billing"
          className="inline-flex items-center gap-1 rounded-md bg-white/20 px-2.5 py-1 text-xs font-semibold transition-colors hover:bg-white/30"
          data-testid="button-trial-upgrade"
        >
          {phase === "normal" ? "Upgrade" : "Upgrade now"}
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      ) : (
        <span className="text-xs opacity-90">Ask your owner to upgrade</span>
      )}
      {/* Announce the transition to urgent + expired — not every one-second tick. */}
      <span className="sr-only" role="status" aria-live="polite">
        {expired
          ? "Your free trial has expired."
          : urgent
            ? "Your free trial is ending soon."
            : ""}
      </span>
    </div>
  );
}
