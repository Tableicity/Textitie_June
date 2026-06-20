/**
 * Incremental extraction of the Professor escalation's `customerReply` field from
 * a STREAMING JSON response, so Co-Pilot can stage the draft the instant the
 * reply text is complete — without waiting for the slow fact-reasoning that
 * follows it in the same JSON object.
 *
 * The Professor prompt emits `customerReply` FIRST. SMS replies are atomic (we
 * can never send a partial message), so we do NOT surface tokens as they arrive;
 * we surface the COMPLETE decoded reply exactly once, the moment its closing
 * quote is seen. Everything else (facts, confidence, gate, learning) still flows
 * through the authoritative full-text `parseEscalationResponse` at stream end.
 *
 * Deliberately dependency-free: the need is narrow (one top-level string field),
 * and a hand-rolled scan that defers escape-decoding to `JSON.parse` is both
 * simpler and more robust than a streaming-JSON library.
 */

// Matches the `"customerReply"` key plus its colon and any surrounding
// whitespace. We then inspect whatever follows to find the string value.
const CUSTOMER_REPLY_KEY = /"customerReply"\s*:\s*/;

/**
 * Try to extract the fully-formed `customerReply` string from a (possibly
 * partial) accumulated buffer.
 *
 * Returns:
 *   - the decoded string (including "" for an explicitly empty value) once the
 *     value's closing quote has arrived;
 *   - `null` when the field is absent, not yet a string, or its closing quote
 *     has not streamed in yet (i.e. "ask again with more data").
 *
 * Pure; exported for unit testing.
 */
export function extractCustomerReply(buf: string): string | null {
  const m = CUSTOMER_REPLY_KEY.exec(buf);
  if (!m) return null;

  const afterKey = m.index + m[0].length;
  if (afterKey >= buf.length) return null; // value hasn't started streaming yet
  if (buf[afterKey] !== '"') return null; // value is null/number/not-a-string

  const valStart = afterKey + 1;
  let k = valStart;
  while (k < buf.length) {
    const c = buf[k];
    if (c === "\\") {
      // Skip the backslash AND the char it escapes; JSON.parse decodes it later.
      // If the escaped char hasn't streamed yet, k jumps past the end and we
      // fall through to "need more data".
      k += 2;
      continue;
    }
    if (c === '"') {
      const raw = buf.slice(valStart, k);
      try {
        // Re-wrap in quotes and let JSON decode all escapes (\" \\ \n \uXXXX …).
        return JSON.parse('"' + raw + '"') as string;
      } catch {
        // Malformed/partial escape — treat as not-ready; the authoritative
        // full-text parse at stream end is the fallback.
        return null;
      }
    }
    k++;
  }
  return null; // closing quote has not arrived yet
}

/**
 * Stateful, single-shot extractor over a stream of chunks. Feed each content
 * delta to the returned function; it returns the decoded reply exactly once (the
 * moment the value completes) and `null` on every other call. Non-empty gating
 * is the caller's responsibility.
 */
export function createCustomerReplyExtractor(): (chunk: string) => string | null {
  let buf = "";
  let fired = false;
  return (chunk: string): string | null => {
    if (fired) return null;
    buf += chunk;
    const out = extractCustomerReply(buf);
    if (out !== null) {
      fired = true;
      return out;
    }
    return null;
  };
}
