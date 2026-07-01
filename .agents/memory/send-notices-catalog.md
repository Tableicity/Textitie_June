---
name: Send-notice copy catalog
description: Where outbound send-block / paywall copy lives and how server + user-app share it so it can't drift.
---

# Send-block / paywall copy is owned by `@workspace/send-notices`

All customer/agent-facing copy for a **blocked outbound send** (billing/paywall
gates) lives in ONE shared, pure-data lib: `lib/send-notices` (`SEND_NOTICES`
keyed by `SendNoticeReason`: `paywall_new_contact | daily_trial_limit |
trial_expired | credit_frozen`). Each entry carries `message`, `title`,
`severity`, `httpStatus`, optional `cta`.

- **Server** re-sources its message constants from the catalog
  (`PAYWALL_NEW_CONTACT_MESSAGE` etc. in `demoTextingGate.ts`,
  `CREDIT_FROZEN_MESSAGE` in `outboundReply.ts`) and the `conversations.ts` send
  route maps a blocked `OutboundReplyResult.reason` to a 402 via a single
  data-driven `getSendNotice(reason)` lookup (`res.status(notice.httpStatus)`).
- **Client** (Inbox composer) reads the 402 body `{ error, reason }` off the
  generated `ApiError` (`err.status` + `err.data`), looks up the same catalog by
  `reason`, and renders the banner + toast. Unknown/absent reason → fall back to
  the server `error` string (or a generic line) so a block is never silent.

**Why:** the Inbox banner used to hardcode the "New Contacts" message for EVERY
402 because it ignored the response `reason`; the copy also lived twice (server
const + client literal) and drifted. A single shared catalog is the "proper fix"
so the wording can't diverge and a new gate is added in exactly one place.

**How to apply:** to add/relabel a send-block message, edit `SEND_NOTICES` only.
A brand-new gate also needs: (1) the new key added to `SendNoticeReason`, (2) the
reason produced somewhere in `OutboundReplyResult`, and (3) nothing else — the
402 route and the Inbox banner pick it up automatically via `getSendNotice`.
Keep every `message` verbatim-equal to any historical server constant a test
asserts (the exact strings are locked in `demoTextingGate.test.ts`). Note the
402 body is NOT yet in the OpenAPI spec (the shared lib is the typed join key);
typing the `{ error, reason }` body is an open follow-up.
