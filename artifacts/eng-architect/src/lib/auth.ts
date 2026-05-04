import { setAuthHeaderGetter } from "@workspace/api-client-react";

const STORAGE_KEY = "sama_auth_token";

export function getStoredAuthHeader(): string | null {
  const token = sessionStorage.getItem(STORAGE_KEY);
  return token ? `Bearer ${token}` : null;
}

export function storeToken(token: string): void {
  sessionStorage.setItem(STORAGE_KEY, token);
  setAuthHeaderGetter(() => {
    const t = sessionStorage.getItem(STORAGE_KEY);
    return t ? `Bearer ${t}` : null;
  });
}

export function clearAuth(): void {
  sessionStorage.removeItem(STORAGE_KEY);
  setAuthHeaderGetter(null);
}

export function initAuth(): boolean {
  const token = sessionStorage.getItem(STORAGE_KEY);
  if (token) {
    setAuthHeaderGetter(() => {
      const t = sessionStorage.getItem(STORAGE_KEY);
      return t ? `Bearer ${t}` : null;
    });
    return true;
  }
  return false;
}

export async function loginWithEmail(
  email: string,
  password: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    const resp = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ email, password }),
    });

    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      return { ok: false, error: data.error || "Invalid credentials" };
    }

    const data = await resp.json();
    storeToken(data.token);
    return { ok: true };
  } catch {
    return { ok: false, error: "Connection error" };
  }
}
