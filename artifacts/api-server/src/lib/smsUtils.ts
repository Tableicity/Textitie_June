const GSM7_CHARS = new Set(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZ" +
  "ÄÖÑÜabcdefghijklmnopqrstuvwxyzäöñüà§"
);

const GSM7_EXTENDED = new Set("|^€{}[]~\\");

export type SmsEncoding = "GSM-7" | "UCS-2";

export interface SegmentInfo {
  charCount: number;
  segmentCount: number;
  encoding: SmsEncoding;
  charsPerSegment: number;
  charsRemaining: number;
}

function isGsm7(text: string): boolean {
  for (const ch of text) {
    if (!GSM7_CHARS.has(ch) && !GSM7_EXTENDED.has(ch)) {
      return false;
    }
  }
  return true;
}

function gsm7Length(text: string): number {
  let len = 0;
  for (const ch of text) {
    len += GSM7_EXTENDED.has(ch) ? 2 : 1;
  }
  return len;
}

export function calculateSegments(text: string): SegmentInfo {
  if (!text || text.length === 0) {
    return { charCount: 0, segmentCount: 0, encoding: "GSM-7", charsPerSegment: 160, charsRemaining: 160 };
  }

  const encoding: SmsEncoding = isGsm7(text) ? "GSM-7" : "UCS-2";

  if (encoding === "GSM-7") {
    const charCount = gsm7Length(text);
    if (charCount <= 160) {
      return { charCount, segmentCount: 1, encoding, charsPerSegment: 160, charsRemaining: 160 - charCount };
    }
    const segmentCount = Math.ceil(charCount / 153);
    const charsRemaining = segmentCount * 153 - charCount;
    return { charCount, segmentCount, encoding, charsPerSegment: 153, charsRemaining };
  }

  const charCount = text.length;
  if (charCount <= 70) {
    return { charCount, segmentCount: 1, encoding, charsPerSegment: 70, charsRemaining: 70 - charCount };
  }
  const segmentCount = Math.ceil(charCount / 67);
  const charsRemaining = segmentCount * 67 - charCount;
  return { charCount, segmentCount, encoding, charsPerSegment: 67, charsRemaining };
}

export interface ContactVars {
  first_name?: string;
  last_name?: string;
  full_name?: string;
  phone?: string;
}

export function extractContactVars(contactName: string | null, contactPhone: string): ContactVars {
  const parts = (contactName ?? "").trim().split(/\s+/);
  return {
    first_name: parts[0] || "there",
    last_name: parts.length > 1 ? parts.slice(1).join(" ") : "",
    full_name: contactName || "there",
    phone: contactPhone,
  };
}

export function injectVariables(template: string, vars: ContactVars): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    const value = vars[key as keyof ContactVars];
    return value !== undefined && value !== "" ? value : match;
  });
}
