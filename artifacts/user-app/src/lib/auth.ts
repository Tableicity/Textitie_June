import { setAuthHeaderGetter } from "@workspace/api-client-react";

const TOKEN_KEY = "sama_tenant_token";

export function getTenantToken() {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setTenantToken(token: string) {
  sessionStorage.setItem(TOKEN_KEY, token);
}

export function removeTenantToken() {
  sessionStorage.removeItem(TOKEN_KEY);
}

// Setup the auth header getter for the api client
setAuthHeaderGetter(() => {
  const token = getTenantToken();
  return token ? `Bearer ${token}` : null;
});
