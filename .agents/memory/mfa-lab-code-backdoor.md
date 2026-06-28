---
name: MFA lab-code back-door (preview the gated inbox)
description: How to get into the auth-gated tenant agent inbox in dev for screenshots/verification, and the beta MFA delivery shim that makes it possible.
---

# Previewing the auth-gated agent inbox (user-app)

The agent **Inbox** (and other tenant routes) are behind tenant login: email+password **then** an MFA/OTP step. There is **no seeded demo password**, so you cannot just log in. This is why "I can't screenshot the authenticated inbox" keeps coming up.

**How to actually preview it (dev):**
- Sign up a **throwaway tenant** via `/signup/trial` (single-step form: full name, 10-digit US phone, unique email, password ≥8). This routes to `/verify`.
- On `/verify`, the page **auto-fetches and displays the MFA code** in a small "lab card" (it calls the dev lab-code endpoint). The code is **also printed to the api-server console** as `[LAB CODE] Code for <email>: <code>`. Enter those 6 digits → you're in.
- A brand-new tenant has **no phone number / 10DLC registration**, so the Inbox **setup banner is visible** by default — ideal for verifying banner/branding work.
- The `runTest` (Playwright) skill can drive this whole flow end-to-end (signup → read lab card → verify → /inbox → screenshot). It worked first try.

**Why this matters / the beta shim:** the lab-code endpoint and the plaintext-code console log are an **intentional beta delivery shim** (real email/SMS OTP delivery isn't wired yet — in-code comment: "Remove this endpoint when SES email is wired").

**Security caveat for go-live:** the shim is **NOT gated by `NODE_ENV`** — it runs in production too. So in the published app, anyone who has a user's password can fetch that user's OTP via the lab-code endpoint, degrading MFA to effectively password-only. Fine for beta; **must be gated to non-prod (or replaced with real OTP delivery) before a real production go-live with external customers.**
