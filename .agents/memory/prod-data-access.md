---
name: Prod data access
description: How to read vs. write production data for this project
---

**Reads:** prod SQL via the executeSql tool with `environment: "production"` is **read-only** (writes roll back). Good for verifying rows (conversations, messages, tenants).

**Writes to prod data:** must go through the **running app's Conductor API** (HTTP Basic Auth, user `conductor`, password in `CONDUCTOR_PASSWORD`) against the live domain, e.g. `PATCH /api/tenants/:id`. There is no direct prod write path from tooling.

**Secret visibility quirk:** the `code_execution` sandbox env is stripped of secrets, but **bash sees the global/workspace secrets** — so `curl -u "conductor:${CONDUCTOR_PASSWORD}" ...` works from bash, not from code_execution.

**Why:** Established during the Textitie go-live when assigning the Toll-Free number and normalizing tenant regions in prod — the only safe write channel was the Conductor API.
