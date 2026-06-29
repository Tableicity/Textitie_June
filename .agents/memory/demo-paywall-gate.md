---
name: Demo paywall gate (unpaid → signup phone only)
description: Where/why the demo paywall is enforced and the exact "paid" definition; covers human + AI sends.
---

# Demo paywall: unpaid tenants may text only their signup phone

**Rule:** an UNPAID tenant may send SMS only to the phone it signed up with (the
owner `tenant_user`'s phone). Every other destination is blocked server-side and
the inbox shows a full-width banner directly above the composer reading EXACTLY:
`You will need a Paid Subscription to text New Contacts`.

- **"Paid"/unlocked = `tenants.subscriptionStatus === "active"` ONLY.** `trialing`,
  `none`, `past_due`, `canceled`, null — all GATED. (`isTextingUnlocked`.)
- Enforcement lives in the **universal `sendConversationReply` (outboundReply.ts)**,
  gated FIRST (before scrub/compliance/From-resolution/persist) so a blocked send
  creates no message row, burns no usage, and never reaches the carrier. Returns
  `{ok:false, reason:"paywall_new_contact"}`; the conversations send route maps
  that reason → **HTTP 402**.
- Fail-CLOSED: unpaid + unresolvable signup phone ⇒ blocked.
- Phone compare is tolerant: E.164 (via `normalizePhoneE164`, which THROWS on
  garbage → try/catch) with a last-10-digits fallback so a malformed contact
  number can't crash the send path (it just won't match).
- Signup phone = oldest `owner`-role `tenant_user` with a phone, else oldest user
  with a phone (legacy tenants lacking an explicit owner still resolve one).
- UI mirror only (server is authoritative): Inbox uses `useGetTenantSettings`
  (`subscriptionStatus` + `signupPhone` now on the `TenantSettings` schema),
  compares last-10, shows the banner + disables textarea/Send, and also surfaces
  the banner on a 402 `onError`.

**Why the universal sender, not `guardOutboundFrom` or the route:** operators
assign tenants a REAL demo From number for testing, so the From-ownership guard
won't catch a demo send; gating in the one outbound source of truth covers the
human composer, AI auto-send (Auto-Pilot/Co-Pilot), and campaigns uniformly and
they can never drift.

**How to apply:** any new outbound path MUST go through `sendConversationReply`
(or call `isDemoTextingBlockedForTenant`) or it bypasses the paywall. This gate
also blocks AI auto-replies to NEW contacts for unpaid tenants — intentional, per
the literal requirement (inboundAiPipeline reads `reason` as a plain string and
treats a non-ok send as handback, so it degrades safely).

**Test seeding gotcha:** any api-server integration test that drives a human/AI
send must seed the tenant `subscriptionStatus:"active"`, or the new gate blocks
the send and the assertion fails for an unrelated reason.
