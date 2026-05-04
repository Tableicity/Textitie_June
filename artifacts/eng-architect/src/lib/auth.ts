import { setAuthHeaderGetter } from "@workspace/api-client-react";

const STORAGE_KEY = "sama_conductor_auth";

export function getStoredAuthHeader(): string | null {
  return sessionStorage.getItem(STORAGE_KEY);
}

export function storeAuthHeader(username: string, password: string): void {
  const header = `Basic ${btoa(`${username}:${password}`)}`;
  sessionStorage.setItem(STORAGE_KEY, header);
  setAuthHeaderGetter(() => sessionStorage.getItem(STORAGE_KEY));
}

export function clearAuth(): void {
  sessionStorage.removeItem(STORAGE_KEY);
  setAuthHeaderGetter(null);
}

export function initAuth(): boolean {
  const stored = getStoredAuthHeader();
  if (stored) {
    setAuthHeaderGetter(() => sessionStorage.getItem(STORAGE_KEY));
    return true;
  }
  return false;
}

export async function validateCredentials(username: string, password: string): Promise<boolean> {
  const header = `Basic ${btoa(`${username}:${password}`)}`;
  try {
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    const resp = await fetch(`${base}/api/tenants`, {
      headers: {
        Authorization: header,
        "X-Requested-With": "XMLHttpRequest",
        Accept: "application/json",
      },
    });
    return resp.ok;
  } catch {
    return false;
  }
}
