# Memory Index

- [Deploy secret reload](deploy-secrets-reload.md) — saving a Replit deployment secret does NOT restart prod; must republish. Verify go-live by the actual `from` number, not that the secret exists.
- [Prod data access](prod-data-access.md) — prod SQL (executeSql environment:"production") is READ-ONLY; prod data writes must go through the running app's Conductor API.
- [Tenants list strict parse](tenants-list-strict-parse.md) — one enum-invalid row 500s the whole `GET /api/tenants`; `tenants.region` is plain text with no DB CHECK.
- [Outbound From resolution](telephony-from-resolution.md) — From resolved live per-send per-tenant; tenant may only send on a number it OWNS (never the global default = a real tenant's number) or convos split; number doubles as inbound key (1 two-way tenant/number); unowned → Twilio 21660; 10DLC badge cosmetic.
- [Two user systems](two-user-systems.md) — `users` (superusers @ /admin/) vs `tenant_users` (per-tenant agents/owner @ agent inbox); don't confuse them; never return passwordHash.
- [Orval operationId mangling](orval-operationid-mangling.md) — some operationIds codegen into garbage symbol names (filenames stay correct); reorder words verb-first and re-run codegen.
