// Free-trial banner phase logic, extracted as a pure function so the escalation
// thresholds are unit-testable without a DOM harness.

// How close to expiry the banner escalates from the calm orange "normal" state
// to the red "urgent" state — BEFORE the trial actually expires. 72h (3 days)
// of runway gives the owner clear, repeated warning while they can still act.
export const TRIAL_URGENT_THRESHOLD_MS = 72 * 60 * 60 * 1000;

export type TrialBannerPhase = "normal" | "urgent" | "expired";

/**
 * Decide the trial banner phase from the server subscription status and the
 * client-computed milliseconds remaining until trialEndsAt.
 *   - "expired": server says expired, OR the countdown has hit/passed zero.
 *   - "urgent":  still trialing but within TRIAL_URGENT_THRESHOLD_MS of expiry.
 *   - "normal":  still trialing with comfortable runway (or no known deadline).
 * remainingMs === null means the deadline is unknown/malformed → treated as
 * "normal" (never falsely "urgent"/"expired" off a bad date).
 */
export function getTrialBannerPhase(
  status: string | undefined,
  remainingMs: number | null,
): TrialBannerPhase {
  if (status === "expired" || (remainingMs !== null && remainingMs <= 0)) {
    return "expired";
  }
  if (remainingMs !== null && remainingMs <= TRIAL_URGENT_THRESHOLD_MS) {
    return "urgent";
  }
  return "normal";
}
