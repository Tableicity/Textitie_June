# Memory Index

- [Deploy secret reload](deploy-secrets-reload.md) — saving a Replit deployment secret does NOT restart prod; must republish. Verify go-live by the actual `from` number, not that the secret exists.
- [Prod data access](prod-data-access.md) — prod SQL (executeSql environment:"production") is READ-ONLY; prod data writes must go through the running app's Conductor API.
- [Tenants list strict parse](tenants-list-strict-parse.md) — one enum-invalid row 500s the whole `GET /api/tenants`; `tenants.region` is plain text with no DB CHECK.
- [Cold-start + scaffolding retired](regeneration-protocol.md) — `replit.md` is the single status source; the Scaffolding gate ledger was retired 2026-06-08 (friction, no payoff). Don't recreate it. Includes the operating agreement + Twilio global-secret/webhook facts.
- [Twilio API from shell](twilio-api-from-shell.md) — verify message SIDs/line-type/TF-status by hitting Twilio REST from bash (creds in shell env, NOT code_execution sandbox); diagnose delivery disputes.
- [Outbound From resolution](telephony-from-resolution.md) — From resolved live per-send per-tenant; tenant may only send on a number it OWNS (never the global default = a real tenant's number) or convos split; number doubles as inbound key (1 two-way tenant/number); unowned → Twilio 21660; 10DLC badge cosmetic.
- [Two user systems](two-user-systems.md) — `users` (superusers @ /admin/) vs `tenant_users` (per-tenant agents/owner @ agent inbox); don't confuse them; never return passwordHash.
- [Orval operationId mangling](orval-operationid-mangling.md) — some operationIds codegen into garbage symbol names (filenames stay correct); reorder words verb-first and re-run codegen.
