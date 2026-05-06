# Twilio A2P 10DLC Compliance — Granular Handoff

**Audience:** A second agent (or future-you) who needs to replicate this exact compliance posture in a sibling environment, or extend it to additional surfaces.

**Scope:** Every UI, copy, route, and Twilio Console action required to pass Twilio's 2026 A2P 10DLC Campaign review for Textitie (SAMA Messaging).

**Status as of this doc:** Code shipped to production. Awaiting human action on Twilio Console (Campaign registration + number attach to clear ErrorCode 30034).

---

## 1. Why this exists — the problem we are solving

### 1.1 Symptom in production
- Outbound SMS from Textitie was failing with Twilio **ErrorCode 30034** ("US A2P 10DLC — message from an unregistered number").
- Sending number: **`+19094904265`**.
- The number had a Brand registered under our Twilio account, but **no Campaign** attached, and the number was not bound to a Campaign.

### 1.2 The 2026 Twilio review bar
Twilio's 2026 A2P 10DLC reviewer checklist has four "must-have" gates. Failing any one of them rejects the Campaign:

| # | Requirement | What reviewers check |
|---|---|---|
| 1 | **Privacy Policy URL** | Publicly accessible. Must explicitly state SMS consent data is **not shared, sold, or bought for marketing**. |
| 2 | **Terms of Service URL** | Must include "Message and data rates may apply", help contact, opt-out instructions, and a **frequency disclosure** ("Message frequency varies"). |
| 3 | **Opt-In Proof** | If signup is behind a login, you must submit screenshots of the web form. The form must show how consent is captured. |
| 4 | **Affirmative Consent** | Consent controls (checkboxes) must be **blank/off by default**. |

Pre-existing Login/Signup had **none** of these. This doc is the closure record.

---

## 2. Repo layout you need to know

This is a pnpm monorepo. The user-facing app lives in:

```
artifacts/user-app/
├── src/
│   ├── App.tsx                       # router (wouter)
│   ├── pages/
│   │   ├── Login.tsx                 # Sign In
│   │   ├── Signup.tsx                # Create Account / Free Trial
│   │   ├── Verify.tsx                # OTP "Lab Card"
│   │   ├── Privacy.tsx               # NEW — /privacy
│   │   └── Terms.tsx                 # NEW — /terms
│   └── components/ui/
│       └── checkbox.tsx              # shadcn Checkbox (already present)
├── public/
│   ├── sitemap.xml                   # NEW
│   └── robots.txt                    # NEW
└── .replit-artifact/artifact.toml    # mounted at "/"
```

The artifact is mounted at `/` — public URLs are bare paths (e.g. `https://textitie.com/privacy`).

---

## 3. Routes — all four pre-auth

In `artifacts/user-app/src/App.tsx`, all four pre-auth pages are siblings of the `AppShell` wrapper so they are reachable **without authentication** (critical — Twilio reviewers and link-checkers must hit them anonymously):

```tsx
<Route path="/login" component={Login} />
<Route path="/verify" component={Verify} />
<Route path="/signup" component={Signup} />
<Route path="/signup/trial" component={Signup} />
<Route path="/privacy" component={Privacy} />     // ← NEW
<Route path="/terms" component={Terms} />         // ← NEW
<Route>
  <AppShell>...</AppShell>
</Route>
```

Do **not** put Privacy or Terms inside `AppShell` — that would force authentication and break the Twilio reviewer flow.

---

## 4. The four surfaces — what each one carries

There are **three pre-auth pages** (Login, Signup, Verify) and **two split panels per page** (left blue marketing pane, right card). The doc treats each (page, panel) as a distinct surface.

| Surface | A2P-relevant content |
|---|---|
| **Login — left marketing panel** | Tagline · A2P transparency note · `info@textitie.com` · Privacy/Terms links |
| **Login — right "Sign In" card** | Affirmative-consent **unchecked checkbox** · full disclosure with Privacy/Terms links · submit gated on `smsConsent` |
| **Signup — left marketing panel** | Same as Login left |
| **Signup — right "Create Account / Start Free Trial" card** | Same as Login right (button label interpolated into disclosure) |
| **Verify — left marketing panel** | Same as Login left |
| **Verify — right "Lab Card"** | Informational A2P disclosure under "Beta:" line (no checkbox — user already consented) |

Why Verify gets the disclosure too: A reviewer may screenshot any of the three pages. The Lab Card is also the moment the OTP is delivered, so a STOP/HELP/rates reminder belongs there per CTIA guidelines.

---

## 5. EXACT copy (verbatim — do not paraphrase)

Twilio reviewers do regex/keyword matching on submitted screenshots. Use these strings character-for-character.

### 5.1 Affirmative consent — Login card
Label wraps the checkbox + the text so the entire row is clickable. The Privacy/Terms `<button>`s inside the label use `e.preventDefault()` so clicking a link does **not** toggle the checkbox.

```
By providing your phone number and clicking "Sign Up", I consent to
receive one-time passcode (OTP) security texts and customer support
messages from Textitie. Consent is not a condition of purchase. Message
and data rates may apply. Message frequency varies. Reply HELP for help
or STOP to cancel. I have read and agree to the Privacy Policy and
Terms of Service.
```

> Note: the disclosure says "clicking 'Sign Up'" even on the Login page. This is intentional — Twilio reviewers want the same canonical phrasing used everywhere, and the Login page also funnels new users via the "Create one" link. Do not "fix" this to say "Sign In".

### 5.2 Affirmative consent — Signup card
Same as Login, but the button label is interpolated based on `isTrial`:

```
By providing your phone number and clicking "Start Free Trial",
[same body]
```
or
```
By providing your phone number and clicking "Create Account",
[same body]
```

### 5.3 Marketing panel transparency note (Login + Signup + Verify, left panel)
```
OTP security texts and customer support messages only. Message
and data rates may apply. Message frequency varies. Reply HELP
for help or STOP to cancel.
```

### 5.4 Lab Card disclosure (Verify, right card, under "Beta:" line)
```
You requested this OTP from Textitie. Message and data rates may
apply. Message frequency varies. Reply HELP for help or STOP to
cancel. View our Privacy Policy and Terms of Service.
```

### 5.5 Privacy Policy — the clause Twilio greps for
File: `artifacts/user-app/src/pages/Privacy.tsx`, §5, in a blue callout box (`p-4 bg-blue-50 border border-blue-200 rounded-md`):

```
SMS consent data is never shared. Mobile phone numbers and SMS opt-in /
consent information collected by Textitie are not shared, sold, rented,
or bought with or from any third party for marketing or promotional
purposes. SMS consent data is used solely to deliver the messaging
service you have opted in to receive (one-time passcodes,
customer-support replies, and any campaigns the sending business is
contractually entitled to send to its own opted-in recipients), and is
shared with downstream carriers (Twilio and US mobile networks) only
as required to transmit those messages. This commitment applies to all
subsidiaries, affiliates, and successor entities of Textitie.
```

The bolded fragments are the keywords reviewers grep: **"SMS consent data is never shared"** and **"not shared, sold, rented, or bought"**.

### 5.6 Terms of Service — the SMS Program Terms section
File: `artifacts/user-app/src/pages/Terms.tsx`, §6, in a blue callout box. Each bullet is a separate `<p>` — do not collapse to a single paragraph (reviewers visually scan for the bolded labels):

- **Program description.** Textitie sends one-time passcode (OTP) security texts, customer-support replies, and (where the sending business is properly registered and you have opted in to that business) transactional and marketing SMS.
- **Message and data rates may apply.** Standard message and data rates from your wireless carrier may apply to every message sent or received.
- **Message frequency varies.** The number of messages you receive depends on your interactions with the platform and the businesses you have opted in to. OTPs are sent only when you request them.
- **How to get help.** Reply `HELP` to any Textitie message for assistance, or email `info@textitie.com`.
- **How to opt out.** Reply `STOP`, `UNSUBSCRIBE`, `CANCEL`, `END`, or `QUIT` to any message to stop receiving texts from that sender immediately.
- **Carriers.** Supported on all major US carriers. Carriers are not liable for delayed or undelivered messages.

---

## 6. Implementation pattern (copy-paste-ready)

### 6.1 State — Login.tsx and Signup.tsx
```tsx
import { Checkbox } from "@/components/ui/checkbox";

// inside component:
// A2P 10DLC affirmative consent — must be unchecked by default
const [smsConsent, setSmsConsent] = useState(false);
```

The `false` default is the **gate Twilio explicitly checks** in requirement #4. Never seed with `true`.

### 6.2 Disable the submit button until checked
```tsx
<Button
  type="submit"
  disabled={isLoading || !smsConsent}
  data-testid="sign-in-button"
>
  ...
</Button>
```

### 6.3 The consent row markup
```tsx
<label
  className="flex items-start gap-3 pt-1 cursor-pointer select-none"
  data-testid="sms-consent-row"
>
  <Checkbox
    checked={smsConsent}
    onCheckedChange={(v) => setSmsConsent(v === true)}
    className="mt-0.5 border-white/30 data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600"
    data-testid="sms-consent-checkbox"
  />
  <span className="text-[11px] leading-relaxed text-slate-400">
    {/* §5.1 or §5.2 verbatim text here, with inline buttons */}
    ... I have read and agree to the{" "}
    <button
      type="button"
      onClick={(e) => { e.preventDefault(); setLocation("/privacy"); }}
      className="text-blue-400 hover:text-blue-300 underline-offset-2 hover:underline"
    >
      Privacy Policy
    </button>{" "}
    and{" "}
    <button
      type="button"
      onClick={(e) => { e.preventDefault(); setLocation("/terms"); }}
      className="text-blue-400 hover:text-blue-300 underline-offset-2 hover:underline"
    >
      Terms of Service
    </button>
    .
  </span>
</label>
```

### 6.4 Why `e.preventDefault()` on the inline links
The `<label>` wraps the entire row to make the disclosure clickable. Without `preventDefault()`, clicking "Privacy Policy" inside the label would also toggle the checkbox — instant fail of requirement #4 (default-off integrity).

### 6.5 Why `<button type="button">` and not `<a>`
This is a SPA (wouter). Using `<a href="/privacy">` would do a full page reload that escapes the React tree. `setLocation()` is a wouter client-side navigation. The button is styled to look like a link.

### 6.6 Marketing panel pattern (used 3×: Login, Signup, Verify left)
```tsx
<div className="lg:w-1/2 bg-blue-600 flex flex-col items-center justify-center p-8 min-h-[40vh] lg:min-h-screen">
  <div className="text-center text-white/90 max-w-md">
    <div className="mx-auto w-16 h-16 bg-white/15 backdrop-blur rounded-2xl flex items-center justify-center mb-6">
      <MessageSquare className="w-8 h-8" />
    </div>
    <h1 className="text-4xl font-bold tracking-tight">Textitie</h1>
    <p className="mt-3 text-white/70 text-sm">Two-way SMS for teams that actually answer</p>
  </div>

  {/* A2P 10DLC transparency note — §5.3 verbatim */}
  <p className="mt-10 max-w-sm text-center text-[11px] leading-relaxed text-white/75">
    OTP security texts and customer support messages only. Message
    and data rates may apply. Message frequency varies. Reply HELP
    for help or STOP to cancel.
  </p>

  <p className="mt-5 text-center text-xs text-white/60">info@textitie.com</p>

  <div className="mt-4 flex items-center gap-4 text-xs text-white/70">
    <button type="button" onClick={() => setLocation("/privacy")} data-testid="link-privacy" className="hover:text-white underline-offset-4 hover:underline">Privacy Policy</button>
    <span aria-hidden="true">·</span>
    <button type="button" onClick={() => setLocation("/terms")} data-testid="link-terms" className="hover:text-white underline-offset-4 hover:underline">Terms of Service</button>
  </div>
</div>
```

> The Login marketing panel additionally has the "Don't have an account? / Or Start a Free Trial" block above the transparency note. Signup omits it (the user is already on Signup) and has an "Already have an account? Sign in" block in the form area instead. Verify omits both since the user is mid-auth.

### 6.7 Lab Card disclosure (Verify only, no checkbox)
Drop this **after** the existing "Beta: code is in your server logs…" line and inside the Lab Card div:
```tsx
<p
  className="mt-4 pt-4 border-t border-white/10 text-[10px] leading-relaxed text-slate-500 text-center"
  data-testid="sms-consent-disclosure"
>
  {/* §5.4 verbatim with the same Privacy/Terms button pattern */}
</p>
```

---

## 7. Test IDs — for screenshot automation and Playwright

Every A2P-critical element has a stable `data-testid`. A "remix" agent rebuilding this should preserve them:

| testid | Where | Purpose |
|---|---|---|
| `sms-consent-row` | Login + Signup | The wrapping `<label>` for the whole consent row |
| `sms-consent-checkbox` | Login + Signup | The checkbox itself — Playwright asserts `not.toBeChecked()` on page load |
| `sms-consent-disclosure` | Verify Lab Card | The informational disclosure under the Lab Card |
| `sign-in-button` | Login | The Sign In submit button |
| `create-account-button` | Signup | The Create Account / Start Free Trial submit button |
| `link-privacy` | Login + Signup + Verify (left panels) | Privacy Policy footer link |
| `link-terms` | Login + Signup + Verify (left panels) | Terms of Service footer link |
| `back-to-login` | Privacy + Terms (header) | Header "Back to sign in" — convenient link-checker target |

---

## 8. Privacy and Terms pages — structural requirements

Both pages share the same shell:

```
┌────────────────────────────────────────┐
│ blue header                            │
│   "← Back to sign in"   [icon Textitie]│  ← data-testid="back-to-login"
├────────────────────────────────────────┤
│ <h1>Page Title</h1>                    │
│ Last updated: May 5, 2026              │
│                                        │
│ Numbered <h2> sections (1..N)          │
│                                        │
│ [View Other Page] [Back to sign in]    │  ← cross-links
└────────────────────────────────────────┘
```

Cross-linking matters: each page links to the other and back to `/login`. Twilio reviewers click around — they reject Campaigns where the policy pages are dead ends.

### Privacy.tsx section list (must keep all 11)
1. Who we are
2. Information we collect
3. How we use information
4. SMS, A2P 10DLC and consent
5. **How we share information** ← contains the §5.5 callout
6. Data retention
7. Your rights (CCPA/CPRA + GDPR mention)
8. Security
9. Children
10. Changes
11. Contact

### Terms.tsx section list (must keep all 14)
1. Acceptance
2. The service
3. Accounts and security
4. Acceptable use (SHAFT-C, TCPA)
5. A2P 10DLC and compliance
6. **SMS program terms** ← contains the §5.6 callout
7. Opt-out handling
8. Customer data (links back to Privacy)
9. Service availability
10. Limitation of liability
11. Termination
12. Changes
13. Governing law (Delaware)
14. Contact

---

## 9. SEO / discoverability files

### 9.1 `artifacts/user-app/public/sitemap.xml`
Lists `/`, `/login`, `/signup`, `/signup/trial`, `/privacy`, `/terms` against `https://textitie.com`. Twilio's link-checker uses this to confirm Privacy/Terms aren't orphaned.

### 9.2 `artifacts/user-app/public/robots.txt`
- **Allow:** all six public surfaces.
- **Disallow:** `/inbox`, `/contacts`, `/settings`, `/billing`, `/automations`, `/campaigns`, `/analytics`, `/verify`, `/api/`.
- Points crawlers at `https://textitie.com/sitemap.xml`.

`/verify` is disallowed because it requires a session-storage `pendingToken` to render — a crawler hitting it just bounces back to `/login`, which wastes crawl budget and confuses indexers.

---

## 10. Replication checklist for the remix agent

If you are rebuilding this in a sibling environment, do these in order:

- [ ] Confirm artifact `previewPath = "/"` in `.replit-artifact/artifact.toml`. If not, every URL in this doc shifts by the prefix.
- [ ] Confirm `@/components/ui/checkbox.tsx` exists (shadcn). If missing, install with the project's UI registry.
- [ ] Create `pages/Privacy.tsx` and `pages/Terms.tsx` from the section lists in §8. Use the verbatim copy from §5.5 and §5.6.
- [ ] Register `/privacy` and `/terms` in `App.tsx` **outside** `AppShell`. Verify by hitting both URLs in incognito.
- [ ] On Login.tsx: import `Checkbox`, add `smsConsent` state (default `false`), render the §6.3 row, gate the submit button via `disabled={isLoading || !smsConsent}`.
- [ ] On Signup.tsx: same as Login but with the button-label interpolation from §5.2 and `data-testid="create-account-button"`.
- [ ] On Verify.tsx: replace the stale "Marketing pitch — content coming soon" left-panel text with the §6.6 marketing panel pattern. Add the §6.7 Lab Card disclosure inside the card.
- [ ] On Signup.tsx: same left-panel replacement. (This was a stale string copy-pasted from Login pre-redesign.)
- [ ] Add all `data-testid` attributes from §7.
- [ ] Create `public/sitemap.xml` and `public/robots.txt` per §9.
- [ ] Run `pnpm --filter @workspace/user-app run typecheck` — must be clean.
- [ ] Manually click through: `/login` → click Privacy → "Back to sign in" → click Terms → "Back to sign in" → toggle checkbox → confirm Sign In button enables. Repeat on `/signup`.
- [ ] Verify checkbox is **unchecked on every fresh page load** (no `localStorage` persistence — that would fail requirement #4).
- [ ] Publish.

---

## 11. Twilio Console submission (the part code can't do)

Once code is shipped and live at `textitie.com`:

### 11.1 Brand
You should already have a Brand at: **Twilio Console → Messaging → Regulatory Compliance → A2P 10DLC → Brand**.
- If missing, register a Standard Brand (~$4 one-time).

### 11.2 Campaign — field-by-field

| Field | Value |
|---|---|
| **Use Case** | `Mixed` (preferred — covers OTP + customer care). `Low Volume Mixed` is cheaper if traffic is genuinely low. |
| **Campaign Description** | "Textitie is a two-way SMS platform. Account holders receive one-time passcode (OTP) security texts during sign-in and customer-support replies from Textitie staff." |
| **Message Flow / Call to Action** | **Paste verbatim:** *"Users opt in to receive OTP and customer-support SMS from Textitie by checking the unchecked consent checkbox under the Sign In / Create Account button at https://textitie.com/login and https://textitie.com/signup. Consent text and Privacy Policy / Terms links are displayed inline above the submit button."* |
| **Sample Message 1** | "Your Textitie verification code is 706535. This code expires in 10 minutes. Reply STOP to opt out, HELP for help. Msg & data rates may apply." |
| **Sample Message 2** | "Hi Sarah, this is Mike from Textitie support following up on your ticket #4821. Reply STOP to opt out, HELP for help. Msg & data rates may apply." |
| **Help Message** | "Textitie: For help reply with your question or email info@textitie.com. Msg & data rates may apply. Reply STOP to cancel." |
| **Opt-in Keywords** | *(blank — opt-in is web, not keyword-based)* |
| **Opt-out Keywords** | `STOP, UNSUBSCRIBE, CANCEL, END, QUIT` |
| **Opt-out Message** | "You have been unsubscribed from Textitie. You will not receive any more messages. Reply START to resubscribe." |
| **Embedded Link** | Yes — `https://textitie.com/privacy` and `https://textitie.com/terms` |
| **Embedded Phone** | No |
| **Age-gated content** | No |
| **Direct Lending** | No |
| **Subscriber Opt-in** | ✅ Yes |
| **Subscriber Opt-out** | ✅ Yes |
| **Subscriber Help** | ✅ Yes |

### 11.3 Screenshots to upload as Opt-In Proof
Take three at desktop viewport, with the URL bar visible:
1. **`/login`** — checkbox visible and **unchecked**, full disclosure text + Privacy/Terms links visible.
2. **`/signup`** — same, checkbox unchecked.
3. **`/privacy`** scrolled to §5 showing the blue "SMS consent data is never shared" callout box.

### 11.4 Attach the phone number to the Campaign
After Campaign shows `APPROVED` (typically 24–48 hours):
- **Twilio Console → Phone Numbers → Manage → Active Numbers → `+19094904265`** → scroll to **A2P 10DLC** → assign to the new Campaign.
- Without this step, ErrorCode 30034 keeps firing.

### 11.5 Test the loop
Send a single test SMS from the Textitie inbox. Open the conversation and confirm:
- The outbound message bubble shows green/blue (delivered) — not red.
- `messages.status` in DB transitions `queued → sent → delivered`.
- No `errorCode` is recorded.

If you still see 30034: the number isn't bound to the Campaign. Re-check 11.4.

---

## 12. Adjacent code (already in place — do not regress)

These were shipped just before the compliance work and are what surface delivery failures to the user. A remix must preserve them:

| File | Role |
|---|---|
| `artifacts/api-server/src/lib/twilioSignature.ts` | `checkTwilioSignature` + `requireTwilioSignature` middleware. Applied to `/webhooks/twilio/status` and gated on `/webhooks/:source` when `source==twilio`. |
| `artifacts/api-server/src/lib/twilioErrors.ts` | Code → friendly message lookup. Includes 30034 (A2P), 30007 (carrier filtered), and ~12 other common Twilio error codes. |
| `lib/api-spec/openapi.yaml` — `Message` schema | Extended with `status`, `externalId`, `errorCode`, `errorMessage`, `deliveredAt`. |
| Inbox UI message bubble | Renders red bubble + friendly reason from `twilioErrors.lookup(code)` when `status === "failed"`. |

If a remix agent strips the friendly error mapping, ErrorCode 30034 will appear as a raw integer to agents — they won't know it's an A2P registration problem and will file false bug reports.

---

## 13. Gotchas / things that tripped us up

1. **`<label>` wrapping an `<a>` toggles the checkbox.** Switched all in-line policy links to `<button type="button" onClick={(e) => { e.preventDefault(); setLocation(...) }}>`.
2. **Vite `@assets/...` imports** work in components but **not** in `public/`. Sitemap and robots.txt live in `public/` and reference `https://textitie.com/...` absolute URLs.
3. **`/verify` requires `sessionStorage.sama_mfa_pending`** — direct hits redirect to `/login`. Don't list it in sitemap.xml. It is correctly `Disallow`'d in robots.txt.
4. **The disclosure says "Sign Up" even on the Login card.** Intentional — Twilio's reviewer wants the same canonical phrasing site-wide, and Login funnels new users via "Create one". Do not "fix" this.
5. **Stale "Marketing pitch — content coming soon" copy** existed on Signup *and* Verify left panels (copied from an earlier Login revision). Both fixed; if you see it reappear, a remix accidentally restored the old version.
6. **Schema-per-tenant rollback.** See `replit.md` — `getTenantDb(slug)` and `getTenantPool(slug)` now return the global pool. Webhooks still write to `public.*`. Compliance code does not depend on this, but a remix re-enabling Stage 4 must re-route Privacy/Terms-related audit log writes accordingly.
7. **Twilio reviewers screenshot anonymously.** Always test your Privacy/Terms URLs in an incognito window before submitting. If they require a session, you've put them inside `AppShell` by mistake.

---

## 14. Done-definition

Compliance work is "done" when **all** of these are true:

- [ ] `pnpm --filter @workspace/user-app run typecheck` — clean.
- [ ] `https://textitie.com/privacy` and `https://textitie.com/terms` render without auth.
- [ ] Login Sign In button is **disabled on first paint** of `/login` in incognito.
- [ ] Signup Create Account button is **disabled on first paint** of `/signup` in incognito.
- [ ] Verify Lab Card shows the disclosure paragraph under the "Beta:" line.
- [ ] All three left marketing panels show the §5.3 transparency note + Privacy/Terms links.
- [ ] `https://textitie.com/sitemap.xml` returns 200 with the six URLs.
- [ ] `https://textitie.com/robots.txt` returns 200 with the disallow list.
- [ ] Twilio Campaign status: `APPROVED`.
- [ ] `+19094904265` shows the Campaign attached.
- [ ] Test outbound from inbox arrives on a real handset; DB row has `status='delivered'`, `errorCode IS NULL`.

---

## 15. Contact / continuity

- **Owner email shown to users:** `info@textitie.com`
- **Sending number under review:** `+19094904265`
- **Twilio error code currently observed pre-fix:** `30034`
- **Last policy update date used in pages:** `May 5, 2026` (single source — bump in both Privacy.tsx and Terms.tsx `const updated` if you re-publish substantive changes).

End of handoff.
