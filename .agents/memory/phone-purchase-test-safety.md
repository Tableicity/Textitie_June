---
name: Phone purchase test safety
description: How to test the self-serve number-purchase route without spending real money, and the dev-env-vs-bash env split that hides it.
---

# Testing the phone-number purchase route

**The purchase route makes a REAL Twilio purchase against the platform's live Twilio account — real money.** `POST /api/phone-numbers/purchase` calls `incomingPhoneNumbers.create`. Never test it with a real *available* number. If you must hit it live, use a clearly-bogus E.164 (e.g. `+15555550123`) — Twilio returns a 404 "resource not found" and nothing is purchased.

**Why curl alone can't prove the gate branches:** the running workflow's env has `ENABLE_SELF_SERVE_PHONE_PURCHASE=true` and the Twilio creds, but the agent's interactive bash shell does **not** inherit them (Replit injects secrets/flags into workflows, not the shell). So a curl through the live server runs with the flag ON (purchase proceeds to Twilio), while `node -e` in bash sees the flag unset.

**How to verify the gate (`assertCanPurchaseNumber`) deterministically, offline:** bundle just the gate with esbuild (reuse `artifacts/api-server/build.mjs` externals: `*.node`, `pg-native`) into a temp `.mjs`, then run it under `env -u ENABLE_SELF_SERVE_PHONE_PURCHASE …` / `ENABLE_SELF_SERVE_PHONE_PURCHASE=true TWILIO_ACCOUNT_SID=x …`. The 403 path returns before any DB/Twilio call, so no live DB or Twilio is needed. `tsx` is NOT installed and `@workspace/db` resolves to TS source, so you can't `tsx` it directly — esbuild bundling is the path.

**MFA for a tenant JWT in dev:** `POST /api/tenant-auth/login` returns a `pendingToken` and `console.log`s a `[LAB CODE] Code for <email>: NNNNNN` line to the api-server workflow logs; `POST /api/tenant-auth/verify-mfa` with `{pendingToken, code}` returns the real `token`. Seeded demo agent: `agent@acme.test` (tenant `acme`, id 1).
