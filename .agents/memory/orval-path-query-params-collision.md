---
name: Orval path+query Params collision
description: Why an OpenAPI op with both a path param and a query param breaks api-zod codegen, and how to avoid it.
---

# Orval `<Op>Params` collision (path + query)

An operation that declares **both** a path parameter and a query parameter makes
codegen emit the SAME symbol name from two generated files:

- the zod target (`lib/api-zod/src/generated/api.ts`) names the **path** params object `<Op>Params` (and the query params `<Op>QueryParams`).
- the orval client types dir (`lib/api-zod/src/generated/types/<op>Params.ts`) names the **query** params type `<Op>Params`.

`lib/api-zod/src/index.ts` does `export * from "./generated/api"` **and** `export * from "./generated/types"`, so the two `<Op>Params` collide → `tsc` fails with **TS2308 "already exported a member named '<Op>Params'"** during `codegen` (which runs `typecheck:libs` after orval).

**Why:** the two generators use different naming conventions for the `*Params` suffix; an op with only-path or only-query never collides, so this is invisible until you add an op that has both.

**How to apply:** when adding a Conductor/tenant route that is `/{id}/...` (path param) and you want a filter, **do not** add a query param. Either drop the query param and use a dedicated query-less sub-path (e.g. `GET /tenants/{id}/conversations/unassigned` instead of `?departmentId=0`), or move the filter into the path. Reproduce/verify by running `pnpm --filter @workspace/api-spec run codegen` — it fails closed on the collision.
