// Local-only A2P opt-in profile (Full Name + Phone).
// Captured on Login as Twilio reviewer evidence; not transmitted to backend.
//
// Scoping: profiles are keyed by the email the user typed/authenticated as,
// so a shared browser cannot leak User A's name/phone to User B. We also
// remember the most-recent email so the Login form can prefill itself
// before the user has authenticated.

const PROFILE_PREFIX = "textitie_profile_v2:";
const LAST_EMAIL_KEY = "textitie_last_email_v1";

export type LocalProfile = {
  fullName: string;
  phone: string;
};

const EMPTY: LocalProfile = { fullName: "", phone: "" };

function normEmail(email: string): string {
  return email.trim().toLowerCase();
}

function keyFor(email: string): string {
  return PROFILE_PREFIX + normEmail(email);
}

export function getLocalProfile(email: string): LocalProfile {
  const e = normEmail(email);
  if (!e) return { ...EMPTY };
  try {
    const raw = localStorage.getItem(keyFor(e));
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw);
    return {
      fullName: typeof parsed.fullName === "string" ? parsed.fullName : "",
      phone: typeof parsed.phone === "string" ? parsed.phone : "",
    };
  } catch {
    return { ...EMPTY };
  }
}

export function setLocalProfile(email: string, p: LocalProfile): void {
  const e = normEmail(email);
  if (!e) return;
  try {
    localStorage.setItem(keyFor(e), JSON.stringify(p));
  } catch {
    /* storage may be disabled — silently no-op */
  }
}

export function clearLocalProfile(email: string): void {
  const e = normEmail(email);
  if (!e) return;
  try {
    localStorage.removeItem(keyFor(e));
  } catch {
    /* no-op */
  }
}

export function getLastEmail(): string {
  try {
    return localStorage.getItem(LAST_EMAIL_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setLastEmail(email: string): void {
  const e = normEmail(email);
  try {
    if (e) localStorage.setItem(LAST_EMAIL_KEY, e);
    else localStorage.removeItem(LAST_EMAIL_KEY);
  } catch {
    /* no-op */
  }
}

export function clearLastEmail(): void {
  try {
    localStorage.removeItem(LAST_EMAIL_KEY);
  } catch {
    /* no-op */
  }
}

// Format a string of digits as a US phone number: (XXX) XXX-XXXX.
// Accepts pasted "+1XXXXXXXXXX" / "1XXXXXXXXXX" by stripping the country code.
export function formatUSPhone(raw: string): string {
  let d = raw.replace(/\D/g, "");
  // Drop a leading "1" country code if it pushes us to 11 digits.
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  d = d.slice(0, 10);
  if (d.length === 0) return "";
  if (d.length < 4) return `(${d}`;
  if (d.length < 7) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}
