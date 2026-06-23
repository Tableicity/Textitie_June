---
name: DB-backed api-server test pattern
description: How to write meaningful unit tests for api-server pipeline/store code without faking the database.
---

In `artifacts/api-server`, DB-backed unit tests run against the REAL managed test Postgres (the `db` singleton from `@workspace/db` connects on import). Write them like `inboundStageStore.test.ts` / `inboundAiPipeline.throw.test.ts`:

- Seed real rows (`beforeAll`/`beforeEach`: tenant → conversation → message); clean up in `afterEach`/`afterAll` by `tenantId`.
- Mock ONLY external seams: the SMS sender (`sendConversationReply`), the Grok/Student layer (`@workspace/ai-student` `studentWhisper`), retrieval/classification (`./knowledge` `retrieveClassroomFacts` / `classifyQueryCategory` / `hasUnresolvedConflicts`), and `./compliance` `checkOutboundCompliance`. Use `vi.importActual` + override only those names so the module's other exports/types stay real.
- Assert against the REAL persisted rows (e.g. `conversation_ai_states.status`/`reasonCode`, `ai_auto_replies` claim presence).

**Why:** mocking the whole `@workspace/db` layer makes the test hollow — assertions just read back the hard-coded mock returns and pass even when the real code is broken. A hand-written attempt did exactly this (and also called the pipeline with the wrong arg shape).

**How to apply:** never `vi.mock("@workspace/db")`. To drive the Auto-Pilot auto-send path, the mocked Student draft must be `status:"drafted"`, `confidence:"high"`, `kbMatched:true`, `groundedInClassroom:true`, with a non-risky `queryCategory`, ≥1 safe-category (general/features) grounding fact, no conflict, compliance ok. Run per-file (`pnpm --filter @workspace/api-server exec vitest run <file>`) — full-suite tsc/vitest gets killed by the env reaper (~240s).
