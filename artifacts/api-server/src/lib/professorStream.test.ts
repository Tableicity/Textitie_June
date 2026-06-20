import { describe, it, expect } from "vitest";
import {
  extractCustomerReply,
  createCustomerReplyExtractor,
} from "./professorStream";

// Feed a string to the stateful extractor one character at a time and return
// the first non-null result (and the count of how many times it fired).
function feedCharByChar(full: string): { value: string | null; fires: number } {
  const push = createCustomerReplyExtractor();
  let value: string | null = null;
  let fires = 0;
  for (const ch of full) {
    const out = push(ch);
    if (out !== null) {
      fires++;
      if (value === null) value = out;
    }
  }
  return { value, fires };
}

// Feed an explicit list of chunks (to exercise specific split boundaries).
function feedChunks(chunks: string[]): string | null {
  const push = createCustomerReplyExtractor();
  let value: string | null = null;
  for (const c of chunks) {
    const out = push(c);
    if (out !== null && value === null) value = out;
  }
  return value;
}

describe("extractCustomerReply (pure)", () => {
  it("extracts a simple reply when customerReply is first", () => {
    const buf = '{"customerReply":"Hello there","confidence":"high"}';
    expect(extractCustomerReply(buf)).toBe("Hello there");
  });

  it("extracts even when customerReply is not the first field", () => {
    const buf =
      '{"confidence":"high","facts":[],"customerReply":"Later field","x":1}';
    expect(extractCustomerReply(buf)).toBe("Later field");
  });

  it("tolerates whitespace around the colon", () => {
    expect(extractCustomerReply('{ "customerReply"  :   "spaced" }')).toBe(
      "spaced",
    );
  });

  it("decodes an escaped double-quote inside the value", () => {
    const buf = '{"customerReply":"She said \\"hi\\" to me","confidence":"low"}';
    expect(extractCustomerReply(buf)).toBe('She said "hi" to me');
  });

  it("decodes an escaped backslash", () => {
    const buf = '{"customerReply":"path C:\\\\temp ok"}';
    expect(extractCustomerReply(buf)).toBe("path C:\\temp ok");
  });

  it("decodes an escaped newline", () => {
    const buf = '{"customerReply":"line1\\nline2"}';
    expect(extractCustomerReply(buf)).toBe("line1\nline2");
  });

  it("decodes a unicode escape", () => {
    const buf = '{"customerReply":"caf\\u00e9 time"}';
    expect(extractCustomerReply(buf)).toBe("café time");
  });

  it("returns an empty string for an explicitly empty value", () => {
    expect(extractCustomerReply('{"customerReply":"","confidence":"low"}')).toBe(
      "",
    );
  });

  it("returns null when the field is absent", () => {
    expect(extractCustomerReply('{"confidence":"high","facts":[]}')).toBeNull();
  });

  it("returns null when the value is JSON null (not a string)", () => {
    expect(extractCustomerReply('{"customerReply":null}')).toBeNull();
  });

  it("returns null when the closing quote has not arrived yet", () => {
    expect(extractCustomerReply('{"customerReply":"partial reply with no')).toBeNull();
  });

  it("returns null when only the key (no value) has arrived", () => {
    expect(extractCustomerReply('{"customerReply":')).toBeNull();
    expect(extractCustomerReply('{"customerReply": ')).toBeNull();
  });

  it("does not treat an escaped trailing quote as the terminator", () => {
    // The only quote is escaped, so the value is still open → not ready.
    expect(extractCustomerReply('{"customerReply":"ends with a quote \\"')).toBeNull();
  });
});

describe("createCustomerReplyExtractor (streaming)", () => {
  it("fires exactly once, char-by-char, with the full decoded reply", () => {
    const full =
      '{"customerReply":"Great question — onboarding takes ~3 days. Want to start?","confidence":"high","facts":[]}';
    const { value, fires } = feedCharByChar(full);
    expect(value).toBe(
      "Great question — onboarding takes ~3 days. Want to start?",
    );
    expect(fires).toBe(1);
  });

  it("handles the value spanning multiple chunks", () => {
    expect(
      feedChunks(['{"customerReply":"Hel', "lo ", 'world"}']),
    ).toBe("Hello world");
  });

  it("handles a chunk boundary in the middle of the key", () => {
    expect(
      feedChunks(['{"customer', 'Reply":"Hi there"}']),
    ).toBe("Hi there");
  });

  it("handles a chunk boundary between the colon and the opening quote", () => {
    expect(feedChunks(['{"customerReply":', '"value"}'])).toBe("value");
  });

  it("handles a chunk boundary in the middle of an escape sequence", () => {
    expect(feedChunks(['{"customerReply":"a\\', 'nb"}'])).toBe("a\nb");
  });

  it("handles a chunk boundary in the middle of a unicode escape", () => {
    expect(feedChunks(['{"customerReply":"caf\\u00', 'e9!"}'])).toBe("café!");
  });

  it("ignores everything after it has already fired", () => {
    const push = createCustomerReplyExtractor();
    expect(push('{"customerReply":"first"')).toBe("first");
    expect(push(',"customerReply":"second"')).toBeNull();
  });

  it("never fires when the reply field never closes", () => {
    const { value, fires } = feedCharByChar('{"customerReply":"unterminated...');
    expect(value).toBeNull();
    expect(fires).toBe(0);
  });
});
