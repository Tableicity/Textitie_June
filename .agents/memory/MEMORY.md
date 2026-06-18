# Memory Index

- [Deploy secret reload](deploy-secrets-reload.md) — saving a Replit deployment secret does NOT restart prod; must republish. Verify go-live by the actual `from` number, not that the secret exists.
- [Prod data access](prod-data-access.md) — prod SQL (executeSql environment:"production") is READ-ONLY; prod data writes must go through the running app's Conductor API.
- [Tenants list strict parse](tenants-list-strict-parse.md) — one enum-invalid row 500s the whole `GET /api/tenants`; `tenants.region` is plain text with no DB CHECK.
- [Tenant vs Conductor API auth](tenant-api-auth-boundary.md) — tenant JWTs only pass conductorAuth's allow-listed prefixes; tenant UI must call tenant-scoped routes, never Conductor `/tenants/:id`.
- [Telephony go-live gates](telephony-golive.md) — number send/receive needs same Twilio acct + auto-wired inbound webhook (best-effort, all assign/purchase paths) + canonical phone_numbers routing; preview has no public URL.
- [Phone purchase test safety](phone-purchase-test-safety.md) — purchase route makes REAL Twilio buys; dev flags live in the workflow env not bash; verify the gate offline via esbuild bundle.
- [Prod schema provisioning & ownership](prod-schema-provisioning.md) — managed Postgres: prod schema is auto-migrated by Replit's Publish-time diff; never write prod migration scripts/deploy hooks/boot DDL; prod is read-only to the agent (writes via Conductor API).
- [Canonical phone routing](phone-number-canonical-routing.md) — one global `phone_numbers` table (PK = number) is the single routing truth; resolver fails closed; all writes go through phoneNumberRegistry.
- [Status tracking + scaffolding](regeneration-protocol.md) — `replit.md` is the single status source; don't recreate a gate ledger.
- [Twilio API from shell](twilio-api-from-shell.md) — verify message SIDs/line-type/TF-status by hitting Twilio REST from bash (creds in shell env, NOT code_execution sandbox); diagnose delivery disputes.
- [Outbound From resolution](telephony-from-resolution.md) — From resolved live per-send per-tenant; tenant may only send on a number it OWNS (never the global default = a real tenant's number) or convos split; number doubles as inbound key (1 two-way tenant/number); unowned → Twilio 21660; 10DLC badge cosmetic.
- [Two user systems](two-user-systems.md) — `users` (superusers @ /admin/) vs `tenant_users` (per-tenant agents/owner @ agent inbox); don't confuse them; never return passwordHash.
- [Orval operationId mangling](orval-operationid-mangling.md) — some operationIds codegen into garbage symbol names (filenames stay correct); reorder words verb-first and re-run codegen.
- [Stripe Checkout wiring](stripe-checkout-wiring.md) — live price IDs, stub customer guard, Stripe v22 type cast, tenant JWT scope gotcha, generated client call convention.
