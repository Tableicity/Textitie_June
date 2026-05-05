# Multi-Tenant Scope (SAMA / Textitie)

> Goal: flip the app from "ACME hardcoded" to "any company can sign up,
> get isolated data, and text from their own number" — **without** 2FA,
> without RBAC polish, without admin tooling. Just the bare minimum to
> stop being a bottleneck and let real tests happen.

---

## TL;DR — what's already built vs what's missing

### Already built (the heavy lifting is done)

- **`tenants` table** with billing, HIPAA, quiet hours, plan tier, prepaid credits, BAA.
- **`tenant_users` table** (12 cols: email, password_hash, role, skills, languages, status, last_assigned_at) — separate from the legacy `users` table.
- **`tenant_id` on every domain table** — conversations, messages, contacts, campaigns, automations, surveys, reminders, opt-outs, opt-ins, audit_logs, billing_events, departments, dispositions, message_templates, integrations, injections, usage_records. **20 tables, all FK'd to `tenants.id` ON DELETE CASCADE.**
- **`requireTenantAuth` middleware** (`artifacts/api-server/src/middleware/tenantAuth.ts`) that pulls `tenantId` + `tenantUserId` off the session token. Every API route already uses it.
- **Twilio inbound routing by phone number** (`webhooks.ts`) — looks up `tenants.phone_number = To` to find which tenant the inbound SMS belongs to. **This already works for N tenants; we've just only seeded one.**
- **Outbound `from` is per-tenant** via `tenant.phoneNumber` → `fromOverride` (`lib/sama.ts`).
- **Phone number purchase route** (`POST /phone-numbers/purchase`) buys from Twilio and assigns to a department.

### Missing / broken (the actual work)

1. **Two parallel auth tables.** `users` (legacy, 5 cols) is what `/auth/login` reads. `tenant_users` (12 cols) is what `requireTenantAuth` middleware expects. **They're not connected.** Login currently issues a token with `userId` but middleware wants `tenantUserId` + `tenantId`. Today this works because the token is hand-rolled and ACME bypasses checks.
2. **No signup endpoint.** No `POST /auth/signup` that atomically creates `tenants` + first `tenant_users` row.
3. **No signup page.** No `/signup` route in the React app.
4. **No "first run" tenant onboarding** — new tenant has no phone number, no departments, no shortcuts. They land in an empty Messages screen and can't do anything until they buy a number.
5. **Tenant isolation is unverified.** Routes use `requireTenantAuth` but no end-to-end test proves tenant A can't read tenant B's conversations. (Risk: silent cross-tenant data leak in production.)
6. **ACME seed data pollutes the DB.** Real signup flow shouldn't auto-attach to ACME.
7. **Admin/observability gap.** No way to see "list of tenants who signed up today" without raw SQL.

---

## Phased plan — pick where to stop

### Phase 1 — "I can sign up a fake company and text from a 2nd Twilio number" (1 day)

**Goal:** prove tenant isolation works end-to-end. You sign up a 2nd company, it gets its own number, you text yourself from both numbers, and neither company sees the other's messages.

**Scope:**
- Unify auth on `tenant_users` table. Retire `users` table (or leave it dormant — your call).
- New endpoint: `POST /auth/signup` → creates `tenants` row (slug auto-generated from company name) + `tenant_users` row (role=owner) in one transaction. Returns session token with `tenantId` + `tenantUserId`.
- New page: `/signup` — three fields (Company name, your email, password). On success, log the user in and drop them on Messages.
- Wire `POST /phone-numbers/purchase` to the new tenant's id (already does this, just verify).
- **Tenant isolation smoke test** — playwright test that signs up tenant A and tenant B, sends a message from each, and asserts each only sees their own.
- Twilio webhook: confirm inbound routing to the right tenant by `To` number (already works, just verify with 2 numbers).

**Stop here?** Yes if you just want to dogfood. No billing, no email verification, no domain restrictions, no 2FA.

**Risk:** moderate. Auth refactor is the only sharp edge. If we break login for `abc17@gmail.com` (your test account), you can't get back in. Mitigation: keep `users` table around as a fallback for one day.

---

### Phase 2 — "Real signup hardening" (0.5 day)

**Scope (only if Phase 1 looks good):**
- Email format validation + unique-email check (already a DB constraint, just nicer UX).
- Password strength (min 8 chars).
- Rate-limit signup endpoint (5/min/IP).
- "Verify your email" stub — we send a click-link with a JWT, no actual SMTP yet (just log the link to console for now).
- Onboarding checklist on first login: "1. Buy a phone number  2. Send a test message  3. Invite teammates" — three checkboxes that mark themselves done as you do them.
- Replace ACME seed → make it a proper **demo tenant** that signups can opt out of, or remove it entirely.

---

### Phase 3 — "Billing-gated signup" (1 day, blocks on Stripe)

**Scope (only when you've picked tier names + prices):**
- Stripe Checkout on the signup page → `tenants.stripe_customer_id` + `subscription_status='trialing'` set on success.
- 14-day trial defaults; `trial_ends_at` enforced by middleware on protected routes.
- "Upgrade" button in Settings → Stripe Customer Portal.
- Webhook handler for `customer.subscription.updated`/`deleted` — already partially scaffolded in `routes/billing.ts`, needs verification.

**Blocks on:** the pricing decisions you parked yesterday (Cheap Seats $20, tier names, Fuel Surcharge model).

---

### Phase 4 — "Wrappers" (deferred, your words)

- 2FA (TOTP via authenticator app)
- Per-tenant subdomain (`acme.textitie.com`) instead of shared `textitie.com`
- SSO (Google / Microsoft)
- Admin/super-admin panel for support
- Audit log viewer per tenant
- Granular RBAC (today: just `owner` / `agent` on tenant_users)

---

## Open questions before Phase 1 starts

1. **Test login `abc17@gmail.com` — does it stay tied to ACME or migrate to a new tenant?** (Recommend: leave it on ACME so existing test data isn't orphaned.)
2. **Phone number purchase — is the user expected to pay Twilio out of pocket during signup, or do we eat that cost?** (Recommend: trial users get a free Twilio number provisioned on our account; on cancel we release it back.)
3. **Tenant slug from company name — what if "Acme Corp" signs up twice?** (Recommend: append `-2`, `-3`, etc. to keep it unique and pretty.)
4. **What domain emails are blocked?** (Recommend: nothing — block list comes later.)

---

## Files that will change in Phase 1

- `artifacts/api-server/src/routes/auth.ts` — add `POST /auth/signup`, refactor `POST /auth/login` to read `tenant_users`.
- `artifacts/api-server/src/middleware/tenantAuth.ts` — already correct, no change.
- `lib/api-spec/openapi.yaml` — add `/auth/signup` schema, regen with `pnpm --filter @workspace/api-spec run codegen`.
- `artifacts/user-app/src/pages/Signup.tsx` — new page.
- `artifacts/user-app/src/App.tsx` — register `/signup` route.
- `artifacts/user-app/src/pages/Login.tsx` — add "Need an account? Sign up" link.
- `lib/db/src/schema/users.ts` — deprecate (no migration needed; just stop writing to it).
- Optional: `scripts/src/migrate-users-to-tenant-users.ts` — one-shot migration if we want to retire `users` cleanly.

---

## Time estimate

| Phase | Effort | Blocks on |
|---|---|---|
| 1 — Sign up + dogfood | ~1 day | nothing |
| 2 — Hardening | ~0.5 day | Phase 1 |
| 3 — Stripe-gated | ~1 day | tier/pricing decisions |
| 4 — Wrappers | TBD | Phase 1+3 done |

**Recommendation: ship Phase 1 next session, stop, dogfood for a day, then decide if Phase 2 or 3 is the bigger blocker.**
