# Onboarding a New User & Bringing a Number Live

This manual covers the full, code-verified flow to onboard a new tenant (customer
business) and put a Twilio phone number into two-way service on Textitie (SAMA).

---

## TL;DR — the four steps

1. **Create the tenant** (signup or admin).
2. **Confirm the number is in the platform's Twilio account**, then **assign it as the
   tenant's primary number** in Admin → Tenant → Telephony.
3. **In the Twilio Console, point the number's inbound webhook** at
   `https://textitie.com/api/webhooks/twilio` (HTTP POST). *The app does NOT do this for you.*
4. **Send a test text both directions** to verify.

---

## Step 1 — Create the tenant/user

Two equivalent ways to create a tenant:

- **Public signup** — `/signup`. Creates the tenant **and** the owner login in one
  step (region US, "starter" tier, no number yet). The owner must supply their own
  10-digit US phone — this is A2P opt-in evidence and is **separate** from the
  tenant's sending number.
- **Admin** — the Conductor creates a tenant (also auto-provisions a Chatwoot inbox).

Either way you end with a tenant that has **no phone number** — that's expected.

---

## Step 2 — Assign the number (Admin → Tenant → Telephony)

The Telephony card shows a dropdown of numbers Twilio reports the account owns. Pick
the number and save. The number is stored in E.164 (e.g. `+19094904265`).

> **CRITICAL CONDITION — same Twilio account.**
> The entire platform uses **one** Twilio account (the `TWILIO_ACCOUNT_SID` /
> `TWILIO_AUTH_TOKEN` secrets). The brought number must live **inside that account**:
> - If yes → it appears in the dropdown, and outbound works.
> - If it's in a separate Twilio account → it won't appear, and outbound is rejected
>   by Twilio (**error 21660**). You must **port the number into the platform account
>   first**.

> **Assign it as the tenant PRIMARY number — not to a department.**
> Inbound routing matches the tenant's primary number exactly. The department-number
> path has a known wrong-tenant routing bug (see "Known issues" below), so avoid the
> self-service "purchase → department" path for go-live.

---

## Step 3 — Set the inbound webhook in Twilio (manual — required)

**This is the #1 reason a new number "won't receive texts."** Nothing in the
codebase ever sets a number's inbound webhook. Assigning a number only writes it to
the database; it does **not** configure Twilio.

In the **Twilio Console**: Phone Numbers → (your number) → **Messaging** →
**"A message comes in"** → **Webhook**, set to:

```
https://textitie.com/api/webhooks/twilio      (HTTP POST)
```

(Or attach the number to a **Messaging Service** whose inbound webhook is that URL.)

Notes:
- Must be the **published** domain, not the `.replit.dev` preview (Twilio rejects
  preview URLs).
- The webhook route is intentionally public and verified by Twilio's request
  signature, so it "just works" when Twilio itself calls it.

---

## Step 4 — Verify both directions

- **Outbound:** have the tenant send a reply / test message from their inbox. Every
  send is ownership-checked — a tenant may only send from a number it owns; otherwise
  it's refused (the platform never borrows another tenant's number). There is **no
  in-app A2P gate** — sending is only limited by opt-outs, quiet hours, and blocks.
  A2P is enforced on Twilio's side (already approved).
- **Inbound:** text the number from a phone. It should appear in the tenant's inbox.
  If it doesn't, re-check Step 3 (webhook) and Step 2 (same account, E.164 primary).

---

## Known issues / gotchas

- **Manual webhook (Step 3)** — the app shows "inbound texts now route to X" on save,
  but routing is not actually wired until you set the Twilio webhook. Misleading; fix
  pending.
- **Department numbers route to the wrong tenant** — the inbound resolver's
  department fallback runs an unscoped query (a side effect of the Stage 4 isolation
  rollback) and returns the first tenant it finds. Use **primary-number** assignment
  only until fixed.
- **One account, one client** — all tenants share a single Twilio account; numbers
  must live there.

---

## Quick reference

| Item | Value |
| --- | --- |
| Inbound webhook URL | `https://textitie.com/api/webhooks/twilio` (POST) |
| Status callback (auto, prod only) | `https://<domain>/api/webhooks/twilio/status` |
| Number format | E.164, e.g. `+19094904265` |
| Twilio "wrong account" error | 21660 |
| Assign location | Admin → Tenant → Telephony (primary number) |
| Signup route | `/signup` (creates tenant + owner) |
