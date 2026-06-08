---
name: Querying Twilio API directly for diagnostics
description: How to hit Twilio's REST API from this repl to verify message SIDs, line types, and toll-free status when the dev DB/UI isn't enough.
---

# Querying Twilio directly (delivery disputes / "it never sent")

**Where the creds live:** `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` are real values in the **workspace shell environment** (`process.env` in a `node -e` or `python3` run via the bash tool). They are **NOT** readable from the code_execution sandbox — `viewEnvVars` there returns boolean `true` (existence only), and sandbox `process.env` is undefined. So run Twilio diagnostics from bash, never from code_execution.

**Never print the values.** Build basic-auth from env inside the script and only print non-sensitive response fields. Never echo the account SID (it appears in `account_sid`/the URL — exclude it from output).

**Useful read-only endpoints:**
- Message by SID: `GET api.twilio.com/2010-04-01/Accounts/{acc}/Messages/{SID}.json` → `status`, `error_code`, `from`, `to`, `date_sent`.
- List by party: `Messages.json?To=%2B1...` / `?From=%2B1...` (URL-encode the `+`).
- Line type / carrier: `lookups.twilio.com/v2/PhoneNumbers/{num}?Fields=line_type_intelligence` → `carrier_name`, `type` (mobile/landline/voip/tollFree).
- Toll-free verification: `messaging.twilio.com/v1/Tollfree/Verifications` → `status` (e.g. `TWILIO_APPROVED`).
- Error alerts: `monitor.twilio.com/v1/Alerts?PageSize=100` (filter by `resource_sid`/`error_code`; `alert_text` is often null for 30003).

**Key diagnostic logic (delivery disputes):** A real `SM...` SID in our DB proves the message left the app — our code only stores `external_id` on a successful `messages.create()`. `30003` ("unreachable handset") comes only from Twilio's status callback, never fabricated by us. If one destination carrier fails 30003 on every attempt while another carrier delivers fine from the same approved sender, the fault is carrier/handset-side on that specific number, not the app. Confirm by checking for any **inbound** from that number — zero inbound + all outbound 30003 = two-way carrier/device block, escalate via Twilio, not a code fix.
