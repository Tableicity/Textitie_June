---
name: Co-Pilot triage router
description: Inbound SMS pre-retrieval triage router — gating, fail-open policy, and the not-grounded invariant guarding the deferred Auto-Pilot enablement.
---

- The pre-retrieval triage router (out_of_scope / general_in_scope / tenant_specific) runs ONLY when the effective engagement mode is Co-Pilot AND the tenant has a non-empty brandScope AND the router LLM is configured. Manual returns before it; Auto-Pilot falls past it into the unchanged grounded path.
- **Fail-open is centralized in `resolveRouteBranch`**: anything that is not a confident, well-formed non-default classification (non-routed status, low/medium confidence, unparseable/error/stub/skip, or out_of_scope without a decline) collapses to `tenant_specific` (the existing pipeline). Never add a fail path that leaves the pipeline anywhere else.
- **Invariant guarding the DEFERRED Auto-Pilot enablement:** flash (general_in_scope) and decline (out_of_scope) drafts MUST keep `kbMatched=false` and `groundedInClassroom=false`, and `isRouterBranchAutoSendable` returns true ONLY for `tenant_specific`.
  **Why:** when router branches are later wired under Auto-Pilot, the auto-send gate keys on grounded/kbMatched; a parametric Grok "flash" answer or an LLM decline is NOT tenant truth and must never be auto-sendable or learnable.
  **How to apply:** if you enable the router under Auto-Pilot, gate auto-send on `isRouterBranchAutoSendable(branch)` AND the existing grounded gate — do not relax the flash draft flags to make them grounded.
- Customer SMS is QUERY-ONLY in every branch; router/flash output is never persisted as knowledge — no `persistEscalatedFacts` path is reachable from the flash or decline branches.
