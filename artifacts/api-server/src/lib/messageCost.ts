import { calculateSegments, type SmsEncoding } from "./smsUtils";

// ---------------------------------------------------------------------------
// Pure credit cost calculator. The single source of truth for "how many
// credits does THIS message cost" — used by every charge path (inbox, AI
// auto-send, campaigns, inbound). Deliberately side-effect-free and DB-free so
// it is trivially unit-testable and can never drift between paths.
//
// Rate card (product-owner locked):
//   - SMS: 1 credit per segment. GSM-7 160/153, UCS-2 70/67 (see smsUtils).
//     No long-text cap — a 4-segment text is 4 credits.
//   - MMS (a real media attachment OR a deliberate text→MMS wrap): FLAT 3
//     credits regardless of body length. Inbound MMS also 3.
// ---------------------------------------------------------------------------

/** Flat credit cost of any MMS (media-bearing) message. */
export const MMS_CREDITS = 3;

export type MessageChannel = "sms" | "mms";

export interface MessageCostInput {
  /** The message text. Empty/whitespace counts as the text it contains. */
  body: string;
  /** Twilio NumMedia (inbound) or attachment count (outbound). >0 ⇒ MMS. */
  mediaCount?: number;
  /** Force MMS pricing even with no media (deliberate text→MMS wrap). */
  forceMms?: boolean;
}

export interface MessageCost {
  /** Credits to charge: 3 for MMS, else segment count (0 for an empty SMS). */
  credits: number;
  channel: MessageChannel;
  /** Segment count of the body (informational; reported for both channels). */
  segments: number;
  encoding: SmsEncoding;
}

/**
 * Compute the credit cost of a single message. MMS short-circuits to a flat 3;
 * SMS bills one credit per segment. An empty SMS body costs 0 (nothing was
 * sent); a real outbound message always carries a body and so costs >= 1.
 */
export function calculateMessageCredits(input: MessageCostInput): MessageCost {
  const body = input.body ?? "";
  const seg = calculateSegments(body);
  const isMms = (input.mediaCount ?? 0) > 0 || (input.forceMms ?? false);

  if (isMms) {
    return {
      credits: MMS_CREDITS,
      channel: "mms",
      segments: seg.segmentCount,
      encoding: seg.encoding,
    };
  }

  return {
    credits: seg.segmentCount,
    channel: "sms",
    segments: seg.segmentCount,
    encoding: seg.encoding,
  };
}
