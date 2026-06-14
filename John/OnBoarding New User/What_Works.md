# What Works (Code-Verified)

The database/app side of the go-live flow works as expected. Verified by tracing the
actual code, not docs.

## 1. Create the user/tenant ✅
Public signup (`/signup` → `POST /tenant-auth/register`) creates the tenant **and**
the owner login in one transaction (region US, "starter" tier, no number yet). The
admin can also create one via `POST /tenants`, which also auto-provisions a Chatwoot
inbox. Either way you get a tenant with no phone number — exactly what you want before
assigning.
- Note: signup requires the owner's own 10-digit US phone (that's A2P opt-in
  evidence). That is **not** the tenant's sending number — don't confuse the two.

## 2. Assign the number in admin ✅ (with one condition)
Admin → Tenant → **Telephony** card shows a dropdown populated from
`GET /tenants/owned-numbers`, which lists numbers Twilio reports your account owns.
You pick it → `PATCH /tenants/:id` saves it (E.164 enforced server-side).
- **Condition:** the whole platform uses a *single* Twilio account (the
  `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` secrets). Your brought number must be
  **inside that same account** to appear in the dropdown and to send. If you bought it
  under a separate Twilio account, it won't show up, and outbound would be rejected by
  Twilio (error 21660). In that case you'd have to port it into the platform account
  first.

## 3. Outbound (replies, campaigns) ✅
Every send funnels through one ownership check: a tenant may only send from a number
it owns in the DB; otherwise it's refused with a clear message (it never borrows the
platform default). So the moment you assign the number, sending from it works. There
is **no in-app A2P gate** — sending is only limited by opt-outs / quiet hours /
blocks. Your A2P approval is enforced on Twilio's side, which is exactly where it
belongs.
