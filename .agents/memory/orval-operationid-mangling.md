---
name: orval operationId mangling
description: Some OpenAPI operationIds get silently mangled into garbage symbol names by orval codegen
---

Orval (the codegen behind `pnpm --filter @workspace/api-spec run codegen`) can mangle certain operationIds into nonsense exported symbol names while keeping the generated *filenames* correct.

**Observed:** operationId `tenantChangePassword` produced `useTenantln`, `TenantlnInput`, `TenantlnResult` (the "ChangePassword" collapsed to "ln") even though files were named `tenantChangePasswordInput.ts`. Renaming the operationId to `changeTenantPassword` produced clean `useChangeTenantPassword` / `ChangeTenantPasswordInput`.

**Why:** orval's symbol-name transform differs from its filename transform and chokes on some camelCase word combinations. Not all multi-word ids are affected (`setAgentStatus`, `tenantMe` are fine).

**How to apply:** After adding a path to `lib/api-spec/openapi.yaml` and running codegen, grep the generated `lib/api-client-react/src/generated/api.ts` for your expected `use<OperationId>` hook. If the symbol name is mangled, rename the `operationId` (reorder the words, e.g. verb-first) and re-run codegen until the symbol is clean. The URL/route is always correct regardless — only the TS symbol names are affected.
