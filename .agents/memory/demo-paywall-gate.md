---
name: Demo paywall gate (unpaid → signup phone only)
description: Where/why the demo paywall is enforced and the exact "paid" definition; covers human + AI sends.
---

# Demo paywall: unpaid tenants may text only their signup phone

**Rule:** an UNPAID tenant may send SMS only to the phone it signed up with (the
owner `tenant_user`'s phone). Every other destination is blocked server-side and
the inbox shows a full-width banner directly above the composer reading EXACTLY:
`You will need a Paid Subscription to text New Contacts`.

- **"Paid"/unlocked = `tenants.subscriptionStatus === "active"` OR the per-tenant
  operator override `tenants.billingBypass === true`** ("Auto Approve / Auto
  Subscribed"). Otherwise (`trialing`, `none`, `past_due`, `canceled`, null) GATED.
  (`isTextingUnlocked(status, billingBypass?)`.) `billingBypass` is a NOT NULL
  DEFAULT false column the operator flips from the Conductor tenant-detail
  Departments section so they can test the paid experience without paying; it is
  threaded through `isDemoTextingBlocked`/`isDemoTextingBlockedForTenant` and
  mirrored read-only onto `TenantSettings` for the Inbox (server still re-checks).
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

## "Choice C" trial → expired FULL hard-stop (distinct from the per-contact gate)

Signup is **always a 14-day free trial** (no card; no more `plan` branch / no
`/signup/trial`). At trial end a lifecycle job flips `trialing`→`expired`, which
triggers a *second, stronger* mode of the same gate:

- **Two gate modes, same `isTextingUnlocked` foundation:** (a) the per-contact
  demo restriction above (`paywall_new_contact`, applies to `trialing`/`none`),
  and (b) the **`expired` FULL hard-stop** (`trial_expired`) that blocks ALL
  tenant outbound **including self-texting**. The full stop is **scoped strictly
  to `subscriptionStatus === "expired"`** — legacy `none` tenants (abc4/abc5)
  keep self-texting under the per-contact gate; only `expired` is fully cut off.
  `active` / `billingBypass` escape both (via `isTextingUnlocked`).

- **DURABLE RULE — gate at EVERY direct `getSender().send()` choke point, not
  just `sendConversationReply`.** Tenant outbound has *three* tenant-driven
  senders and a tenant-wide stop must be replicated at each or it leaks:
  `sendConversationReply` (human+AI, runs `evaluateDemoTextingGate`),
  `campaignEngine.executeCampaign` (immediate + scheduled), and
  `surveyDispatcher`. The latter two are batch paths that bypass the
  per-contact gate, so they call the tenant-level helper
  **`isTenantSendingExpired(tenantId)`** (no per-contact compare; true only when
  `expired` AND not unlocked) before sending and mark the row failed.

- **`/inject` (Conductor) is intentionally EXEMPT** — it's outside
  `conductorAuth`'s tenant allow-list and only a non-tenant Bearer or Basic-auth
  caller passes, so a tenant JWT can never reach it. Operator injection is a
  trusted override (mirrors `billingBypass`), not "the tenant sending". Exemption
  is documented at the `dispatchInjection` send site.

- **Owner-only release, server-enforced:** `requireTenantOwner` (role must be
  `owner`) gates the 4 *mutation* billing endpoints (checkout/subscribe/
  change-plan/cancel). **GET billing endpoints stay open** — the agent AppShell
  must fetch `/billing/subscription` to render the mask, so gating the GET would
  break the paywall for agents.

- **Mask must be flash-safe:** AppShell holds a skeleton until the subscription
  query resolves (except on `/billing`, the upgrade destination) so an expired
  tenant never flashes the workspace before the mask mounts; **fail-OPEN on query
  error** (render children) since the server still hard-stops every send. Mask
  predicate = `status==="expired" && !billingBypass`; owner sees an Upgrade
  button → `/billing`, agents see "ask your owner" copy with no button.

- **`SubscriptionDetail.billingBypass` is now a required contract field** (server
  returns it; codegen regenerated) so the UI predicate can read it.

## Minting an expired-trial test account
There is NO Conductor/admin "force-expire" endpoint, and prod DB is read-only to
the agent, so an **expired-state test tenant can only be created in DEV**: `POST
/api/tenant-auth/register` (always starts a 14-day trial) → then `UPDATE tenants
SET subscription_status='expired', trial_ends_at=NOW()-'1 day', billing_bypass=false,
stripe_customer_id=NULL, stripe_subscription_id=NULL`. Owner then sees the
"Upgrade to keep going" wall (only `/billing` reachable); an agent sees "ask your
owner". Login MFA "Log Code" shows on the `/verify` lab card (dev) + api-server
console. Testing this in PROD would require adding an operator force-expire control.
