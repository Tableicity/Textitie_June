# Billing & Credit Engine — Staff Training Manual

> **Audience:** Textitie / SAMA engineers and technical support staff.
> **Scope:** the internal **credit-deduction engine** — how a tenant's balance is
> counted, drained, charged, and refunded for every live inbound and outbound
> message — plus the two **free-trial spend controls** layered on top of it: the
> daily trial outbound budget ([§9](#9-the-free-trial-daily-budget)) and the trial
> soft-expiry lifecycle ([§10](#10-the-free-trial-lifecycle-soft-expiry--reminders)).
> This is the money-correctness core of the platform.
> **Status:** the backend engine is built and tested (DB-backed money-correctness
> suite is green); the free-trial budget + lifecycle are built and unit-tested, and
> the trial paywall is live in the app — at expiry it **hard-stops all outbound
> (including self-texting)** across every send path, with **owner-only** release
> ([§10](#10-the-free-trial-lifecycle-soft-expiry--reminders)). The full
> customer-facing billing UI, real email delivery of trial notices, and the real
> Backup card-charge are later phases — see [§12 Known Boundaries](#12-known-boundaries--deferred-work).

---

## 0. The 60-second mental model

Every billable message costs a whole number of **credits**. When a message is
sent (outbound) or received (inbound), the engine:

1. **Counts** the cost — segments for SMS, a flat 3 for MMS ([§2](#2-segmentation--encoding-rules)).
2. **Drains** the cost through a strict 3-bucket **waterfall** —
   Included → Add-On → Backup ([§1](#1-the-waterfall-logic)).
3. **Records** an immutable row in `credit_ledger` (the audit trail) and
   **materializes** the new balances onto the tenant + the usage record.
4. Later, a Twilio delivery webhook may **refund** the charge if the carrier
   *rejected* the message ([§3](#3-webhook-status--refund-logic)).

Two hard rules sit on top of everything:

- **Outbound can be stopped. Inbound can never be stopped.** Outbound runs a
  preflight gate and refuses to send if the tenant is out of coverage. Inbound is
  always accepted and, if the tenant is at zero, pushes the balance **negative**
  into `creditDebt`.
- **Every charge is idempotent.** A carrier retry, a double webhook, or a
  reconcile pass can replay safely — the unique ledger key guarantees one charge
  per message.

### Where the code lives

| Concern | File |
| --- | --- |
| Pure cost calculator (counting) | `artifacts/api-server/src/lib/messageCost.ts` |
| Segment/encoding math | `artifacts/api-server/src/lib/smsUtils.ts` |
| Charge / refund / preflight engine | `artifacts/api-server/src/lib/creditService.ts` |
| Backup auto-replenish seam | `artifacts/api-server/src/lib/backupTopupProvider.ts` |
| Refund mapping (webhook) | `artifacts/api-server/src/lib/deliveryStatus.ts` |
| Outbound send + gate + charge | `artifacts/api-server/src/lib/outboundReply.ts` |
| Inbound charge | `artifacts/api-server/src/routes/webhooks.ts` |
| Campaign per-message charge | `artifacts/api-server/src/lib/campaignEngine.ts` |
| Ledger / tenant / usage schema | `lib/db/src/schema/{creditLedger,tenants,usageRecords}.ts` |

### The canonical rate card

| Item | Price | Behavior |
| --- | --- | --- |
| **Included Pool** | bundled in the plan | Resets every cycle, **no rollover** |
| **Add-On Packs** | **$0.03 / credit** | Purchased credits, **roll over** indefinitely |
| **Backup Credits** | **$0.04 / credit** | Auto-bought in **250-credit blocks ($10.00/block)** when the balance hits zero |
| Local number fee | **$15 / mo** | **Stripe line item — never a credit deduction** |
| Unregistered (no 10DLC) surcharge | **$10 / mo** | **Stripe line item — never a credit deduction** |

Plan tiers (seeded): **Essentials $149 / 600 credits**, **Pro $349 / 2,000 credits**,
**Enterprise — unlimited**. A **trial** tenant is granted **100 credits**.

> **Engineer note on prices:** the deduction engine only *enforces* the **Backup**
> price, because Backup is the only bucket the engine itself *purchases* at charge
> time. It is a single source of truth in `backupTopupProvider.ts`:
>
> ```ts
> /** Credits granted per Backup auto-replenish block. */
> export const BACKUP_BLOCK_SIZE = 250;
> /** $0.04/credit × 250 = $10.00 per block. */
> export const BACKUP_BLOCK_PRICE_CENTS = BACKUP_BLOCK_SIZE * 4;
> ```
>
> The **$0.03 / credit Add-On** price is a *purchase* price (the tenant buys a
> pack via checkout, which tops up `addonCredits`); the deduction engine never
> mints Add-On credits, it only spends them, so $0.03 lives in the purchase/
> checkout flow, not here.

---

## 1. The Waterfall Logic

A tenant carries three spendable buckets plus a debt counter (all on the
`tenants` row, with the per-cycle Included bucket on the active `usage_records`
row):

| Bucket | Column | Refill behavior | Order |
| --- | --- | --- | --- |
| **Included Pool** | `usage_records.credits_included` − `included_credits_used` | Resets each cycle, **no rollover** | **1st** |
| **Add-On Packs** | `tenants.addon_credits` | Bought at $0.03/cr, **rolls over** | **2nd** |
| **Backup Credits** | `tenants.backup_credits` | Auto-bought in 250-cr blocks at $0.04/cr | **3rd** |
| Debt | `tenants.credit_debt` | Negative balance (inbound overrun / post-send shortfall) | overflow |

The engine **always drains in this exact sequence**, taking as much as each
bucket has before moving to the next. From `creditService.ts`:

```ts
// 7. Strict waterfall drain: Included → Add-On → Backup.
let remaining = credits;
const drawIncluded = Math.min(remaining, includedRemaining0);
remaining -= drawIncluded;
const drawAddon = Math.min(remaining, addon0);
remaining -= drawAddon;
const drawBackup = Math.min(remaining, backup0);
remaining -= drawBackup;
```

### 1.1 Backup auto-replenish (the 250-credit block trigger)

If, after draining Included + Add-On + existing Backup, there is **still a
remainder** on an **outbound** charge, and the tenant has Backup **enabled** and
is **under their per-cycle cap**, the engine buys whole **250-credit blocks** —
just enough to cover the remainder — and spends from them:

```ts
// 8. OUTBOUND backup auto-replenish (only when a usage record exists so the
//    per-cycle cap is enforceable). Buys 250-credit blocks up to the cap.
let topupBlocks = 0;
let topupCredits = 0;
let extraBackupDraw = 0;
if (remaining > 0 && direction === "outbound" && t.backup_enabled && usage) {
  const cap = t.backup_topup_cap_per_cycle ?? 0;
  const blocksAvailable = Math.max(0, cap - usage.backup_topups_count);
  const blocksNeeded = Math.ceil(remaining / BACKUP_BLOCK_SIZE);
  const blocksToBuy = Math.min(blocksNeeded, blocksAvailable);
  if (blocksToBuy > 0) {
    const auth = await authorizeBackupTopup({ tenantId, blocks: blocksToBuy, idempotencyKey });
    if (auth.authorized) {
      topupBlocks = blocksToBuy;
      topupCredits = auth.credits;            // blocks × 250
      extraBackupDraw = Math.min(remaining, topupCredits);
      remaining -= extraBackupDraw;
    }
  }
}
```

Key points for support staff:

- A Backup purchase is **bursty, not per-credit**. A tenant who runs out and
  sends one 1-credit SMS buys a **whole 250-credit block** ($10.00). The leftover
  247 credits stay in `backup_credits` for future messages.
- The **per-cycle cap** (`backupTopupCapPerCycle`) limits how many blocks a tenant
  can auto-buy per billing cycle. Once `backup_topups_count` reaches the cap, no
  more blocks are bought — the tenant is **frozen** for the rest of the cycle.
- Each block purchase writes its **own** `backup_topup` ledger row (the money-in
  audit) separate from the message charge row.

### 1.2 The Backup toggle → outbound HARD-STOP

Backup is a tenant toggle (`tenants.backup_enabled`). When it is **OFF**, the
tenant gets **no** auto-replenish, so once Included + Add-On + existing Backup are
exhausted, **outbound sends are refused at 0 balance**. This is enforced
**before the carrier is ever called**, by the read-only preflight in
`outboundReply.ts`:

```ts
// Outbound HARD-STOP gate: refuse to send (and never create a row or reach the
// carrier) when the tenant has no coverage across Included + Add-On + Backup
// (+ replenishable Backup). Unlimited/unmetered tenants always pass.
const assessment = await assessOutboundCredit({ tenantId, body: outboundBody });
if (!assessment.allowed) {
  return { ok: false, reason: "credit_frozen", errorMessage: CREDIT_FROZEN_MESSAGE };
}
```

The preflight computes **coverage** as everything the tenant could possibly spend
this instant — including Backup it *could still auto-replenish* — and blocks only
if the message cost exceeds it (`creditService.ts`):

```ts
let replenishableBackup = 0;
if (t.backup_enabled && usage) {
  const cap = t.backup_topup_cap_per_cycle ?? 0;
  const blocksAvailable = Math.max(0, cap - usage.backup_topups_count);
  replenishableBackup = blocksAvailable * BACKUP_BLOCK_SIZE;
}

const coverage = includedRemaining + addon + backup + replenishableBackup;
const shortfall = Math.max(0, cost.credits - coverage);
const allowed = !metered || shortfall === 0;
```

When `allowed` is false, the conversation route returns **HTTP 402 Payment
Required** (`routes/conversations.ts`), which the inbox surfaces as a "credit
frozen" state. **Unlimited** (Enterprise) and **unmetered** (no billing context
at all) tenants always pass.

### 1.3 Inbound forces a negative balance (debt)

Inbound messages are **never** gated — we always accept what a customer texts us.
If the tenant is at zero with Backup off, the inbound cost has nowhere to drain,
so the remainder becomes **debt**:

```ts
// 9. Any remainder accrues as debt (inbound always; outbound only as a
//    last-resort post-send race — the preflight gate should prevent it).
const debtDelta = remaining;
if (debtDelta > 0 && direction === "outbound") {
  logger.warn({ tenantId, messageId, shortfall: debtDelta },
    "Outbound charge exceeded coverage post-send; applied to debt");
}
const newDebt = debt0 + debtDelta;
```

So `creditDebt` climbs on inbound overruns (and, only as a rare post-send race,
on outbound). A tenant who tops up later pays this down first.

---

## 2. Segmentation & Encoding Rules

The cost of an **SMS** is **1 credit per segment**; an **MMS** is a **flat 3
credits**. The single source of truth is the pure, side-effect-free calculator
`calculateMessageCredits` in `messageCost.ts`:

```ts
export const MMS_CREDITS = 3;

export function calculateMessageCredits(input: MessageCostInput): MessageCost {
  const body = input.body ?? "";
  const seg = calculateSegments(body);
  const isMms = (input.mediaCount ?? 0) > 0 || (input.forceMms ?? false);

  if (isMms) {
    return { credits: MMS_CREDITS, channel: "mms", segments: seg.segmentCount, encoding: seg.encoding };
  }
  return { credits: seg.segmentCount, channel: "sms", segments: seg.segmentCount, encoding: seg.encoding };
}
```

`calculateSegments` (in `smsUtils.ts`) does the encoding math. The rules:

### 2.1 Standard SMS — GSM-7

Plain ASCII / GSM-7 text fits **160 characters in a single segment**.

- `"Hi there"` (8 chars) → **1 segment → 1 credit**.
- A 160-char message → **1 segment → 1 credit**.

### 2.2 Multi-segment SMS — GSM-7 (the 153 rule)

Once a GSM-7 message spills past 160 characters, the carrier splits it and adds a
**7-character concatenation header (UDH)** to each part, so each segment now only
holds **153 characters**.

- 161 chars → **2 segments → 2 credits**.
- 350 chars → `ceil(350 / 153)` = **3 segments → 3 credits**.

> **There is NO 3-credit cap on long text.** A 4-segment text is **4 credits**, a
> 10-segment text is **10 credits**. The "3" only ever appears as the **flat MMS**
> price (§2.4) — do not confuse the two.

### 2.3 The Emoji Drop — UCS-2 (the 70 rule)

The **instant** a single emoji or non-GSM-7 character (many accented letters,
curly quotes, etc.) appears, the **entire message** re-encodes as **UCS-2**, and
the segment size collapses:

- **Single segment: 70 characters** (not 160).
- **Multi-segment: 67 characters** each (the 3-char UDH overhead in UCS-2 units).

Worked examples:

- 70 UCS-2 chars → **1 segment → 1 credit**.
- **71 chars (one over) → 2 segments → 2 credits.**
- 150 UCS-2 chars → `ceil(150 / 67)` = **3 segments → 3 credits**.

The practical lesson: **one 😀 added to a 70-char message doubles its cost.** This
is carrier physics, not a Textitie surcharge.

| Encoding | 1 segment | Each additional segment |
| --- | --- | --- |
| GSM-7 (plain) | 160 chars | 153 chars |
| UCS-2 (any emoji/special char) | 70 chars | 67 chars |

### 2.4 MMS Rules — flat 3 credits

Any **media-bearing** message is a flat **3 credits**, regardless of body length
or direction. MMS is triggered two ways:

- **Real media** — any attachment: PDF, PNG, JPG, vCard, etc. On inbound, Twilio
  reports this as `NumMedia > 0`; on outbound, an attachment count > 0.
- **Deliberate text→MMS wrap** (`forceMms: true`) — when we intentionally send a
  long body as MMS instead of many SMS segments.

Inbound MMS is also charged the flat 3. The calculator short-circuits to
`MMS_CREDITS` the moment `mediaCount > 0 || forceMms` (see the snippet in §2).

---

## 3. Webhook Status & Refund Logic

After we send, Twilio calls our status webhook. `deliveryStatus.ts` maps the
gateway result to one of two outcomes. The decisive table is a single allow-list:

```ts
// REJECTED (never billable) → reverse the credit charge. Everything else (e.g.
// 30007 spam-filtered, 30003 unreachable handset) is a genuine FAILED delivery.
const REFUNDABLE_REJECTION_CODES = new Set(["21610", "21211"]);
```

### 3.1 REJECTED → refund / no charge

| Code | Meaning |
| --- | --- |
| **21610** | Recipient has **opted out / STOP** — carrier refuses to attempt |
| **21211** | **Invalid number format** — message is not deliverable |

These never reach a handset and were never a billable carrier event, so we
**reverse the charge** (idempotently, and race-safe). Both the conversation-
message and campaign-message paths do this:

```ts
// Carrier REJECTION (21610 / 21211) → reverse the credit charge. Idempotent and
// race-safe (handles the rejection arriving before the charge).
if (code != null && REFUNDABLE_REJECTION_CODES.has(code)) {
  await refundMessageCredits({
    tenantId: msg.tenant_id,
    messageId: msg.id,
    externalId: externalId || null,
  }).catch((err) => logger.error({ err, messageId: msg.id },
    "Delivery webhook: credit refund failed (non-blocking)"));
}
```

### 3.2 FAILED / UNDELIVERED → no refund, the charge stands

| Code | Meaning |
| --- | --- |
| **30007** | **Carrier spam / filtering block** (e.g. content flagged) |
| **30003** | **Unreachable handset** (phone off, out of coverage, etc.) |

These are **genuine delivery attempts that the carrier billed us for**. Twilio
charged us for the send regardless of the handset outcome, so refunding the
tenant would mean **eating the carrier cost out of our margin**. The codes are
simply **absent from `REFUNDABLE_REJECTION_CODES`**, so the refund branch never
fires and the original charge remains in place. This is intentional margin
protection — *we pay the carrier whether or not the message lands, so the credit
is consumed.*

### 3.3 The refund is consumption-only and race-safe

`refundMessageCredits` (in `creditService.ts`) reverses **only what the message
consumed** — it does **not** claw back a Backup block we already purchased with
real money:

```ts
// Reverse ONLY the consumption. The consumed-from-Backup amount nets out any
// Backup top-up that was purchased — that purchase is NOT reversed.
const refundBackup = origCredits + includedDelta + addonDelta - debtDelta;
```

Two safety properties matter operationally:

- **Idempotent:** a duplicate rejection callback finds the existing
  `refund_rejected` ledger row and no-ops — a tenant is never double-refunded.
- **Fast-callback-before-charge:** if the rejection webhook somehow arrives
  *before* the inline charge (it can, under load — for conversation **and**
  campaign messages), the refund writes a `pending_refund` marker. The later
  charge sees the marker and **skips**, so a rejected message is never left
  charged.

---

## 4. Separate Overhead Line Items (NOT credits)

Two recurring fees are **infrastructure overhead**, billed as **Stripe
subscription line items**, and are **never** deducted from any credit bucket:

| Fee | Amount | Billed via |
| --- | --- | --- |
| **Local number rental** | **$15 / month** | Stripe line item |
| **Unregistered (no 10DLC) surcharge** | **$10 / month** | Stripe line item |

Why this separation matters: credits measure **message volume**; these fees
measure **carrier infrastructure** (renting a number, the penalty for sending on
an unregistered number). Mixing them would make per-message cost reporting
meaningless and would let a number rental silently freeze messaging. They live in
the Stripe billing layer (subscription items / metering), entirely outside
`creditService.ts`. **If a tenant asks "where did my credits go," number rental
and the unregistered surcharge are never the answer.**

---

## 5. The Agentic AI Moat

Our Agentic LLM **Co-Pilot** drafts replies for agents. On the credit rate-card,
**AI generation is mathematically free** — the calculator only ever prices the
*message that is actually sent over the carrier*. There is no LLM-token line on
the rate card, and no charge path runs at draft time. The only thing that costs
credits is the **outbound SMS/MMS** when a human (or Auto-Pilot) sends it.

But "free generation" is a **revenue moat**, not a giveaway:

- The Co-Pilot produces **richer, more contextual** responses than a human typing
  on a phone. Longer, well-formed answers naturally run **past 160 GSM-7
  characters → multi-segment → multiple credits** (§2.2).
- The moment the model uses an **emoji or a special character** for tone, the
  whole message re-encodes to **UCS-2 at 70 chars/segment** (§2.3), so even a
  medium reply becomes 2–3 segments.
- When the agent attaches a doc/image the AI suggested, that is a **flat 3-credit
  MMS** (§2.4).

So the AI's value to the customer (faster, better replies) is the same mechanism
that **drives natural, defensible credit consumption** — the better the
assistant, the longer and more frequent the messages, the more credits flow,
while our *cost to generate* stays at zero. The product quality **is** the
monetization engine.

```ts
// AI drafting writes NO credit_ledger row. The ONLY charge is the carrier send:
if (sendResult.status === "sent") {
  await chargeMessageCredits({ /* …the sent body… */ reason: "outbound_charge" });
}
```

---

## 6. Where charges actually happen (live paths)

Every billable event funnels through `chargeMessageCredits` with a **stable
idempotency key**, so each path charges **exactly once**:

| Path | File | Key | Reason |
| --- | --- | --- | --- |
| Agent / AI outbound reply | `outboundReply.ts` | `outbound:<messageId>` | `outbound_charge` |
| Inbound message received | `routes/webhooks.ts` | `inbound:<sid>` | `inbound_charge` |
| Campaign blast (per message) | `campaignEngine.ts` | `campaign_message:<id>` | `campaign_charge` |
| Backup block purchase | `creditService.ts` | `topup:<chargeKey>` | `backup_topup` |
| Carrier rejection refund | `deliveryStatus.ts` | (reverses the original) | `refund_rejected` |

**Outbound** (gate → carrier → charge only on confirmed send):

```ts
// Charge credits ONLY for a confirmed send. Idempotent on the message id, so a
// retry never double-charges; a Rejected delivery callback later refunds it.
if (sendResult.status === "sent") {
  try {
    await chargeMessageCredits({
      tenantId, direction: "outbound", body: outboundBody,
      idempotencyKey: `outbound:${pendingRow.id}`,
      reason: "outbound_charge", messageId: pendingRow.id,
      externalId: sendResult.externalId ?? null,
    });
  } catch (err) {
    logger.error({ err, tenantId, messageId: pendingRow.id },
      "Outbound credit charge failed after a confirmed send");
  }
}
```

**Inbound** (never blocked, fire-and-forget so the carrier 200 is never delayed):

```ts
// Inbound is NEVER blocked — at zero with Backup off the balance simply goes
// negative (creditDebt). Fire-and-forget so metering never delays the 200.
chargeMessageCredits({
  tenantId: tenant.id, direction: "inbound", body: messageBody,
  mediaCount: numMedia,                          // Twilio NumMedia → MMS detection
  idempotencyKey: `inbound:${inboundSid ?? inboundMessageId}`,
  reason: "inbound_charge", messageId: inboundMessageId,
  externalId: inboundSid ?? null,
}).catch((err) => logger.warn({ err, tenantId: tenant.id },
  "Inbound credit charge failed (non-blocking)"));
```

---

## 7. The money-safety contract (idempotency)

The whole engine is built on one invariant: **one confirmed message = exactly one
net charge**, no matter how many times a webhook, retry, or reconcile fires.

- **Unique ledger key** — `credit_ledger` has a unique index on
  `(tenant_id, idempotency_key, reason)`. Every insert is
  `ON CONFLICT … DO NOTHING`, so a replay is a silent no-op:

  ```ts
  await client.query(
    `INSERT INTO credit_ledger ( … ) VALUES ( … )
       ON CONFLICT (tenant_id, idempotency_key, reason) DO NOTHING
       RETURNING id`, [ … ]);
  // Lost a concurrent race on the same key — the other txn applied it.
  if (inserted.rows.length === 0) { await client.query("ROLLBACK"); return chargeMessageCredits(input); }
  ```

- **Row-level serialization** — the tenant row (and the active usage record) are
  locked `FOR UPDATE` inside the transaction, so two concurrent charges for the
  same tenant can never both read the same balance and overdraw.
- **Charge after confirmed send only** — outbound and campaign charge *after* the
  carrier accepts; a charge failure is logged but never fails the send (the
  message already left). The idempotent key keeps a future reconcile safe.
- **Refund nets the ledger to zero** — a rejection refund writes a negative
  `credits` row keyed to the same message, so charge (+) and refund (−) net out.

---

## 8. Enterprise (unlimited) & unmetered tenants

- **Unlimited (Enterprise):** `isUnlimitedTier` short-circuits the charge to a
  **zero-cost audit row** (we still write a ledger entry for visibility) and the
  preflight always returns `allowed: true`. Enterprise never drains buckets and
  never freezes.
- **Unmetered:** a tenant with **no** active usage record, **no** buckets, and
  never migrated is treated as unmetered and always passes the gate — this keeps
  internal/test/non-billing flows from ever being frozen by accident. The
  `metered` flag in `assessOutboundCredit` encodes this.

---

## 9. The Free-Trial Daily Budget

Counting and the waterfall (§1–§2) decide what a message *costs*. The free-trial
daily budget is a separate **send-time guard** that decides whether a **trialing**
tenant is allowed to send at all right now. It exists so a free trial cannot be
used as an unlimited SMS faucet — even when the tenant is only texting its own
signup number in the sandbox.

> **The trial rule.** A tenant on `subscriptionStatus = "trialing"` may send at
> most **15 outbound segments per rolling 24 hours**. The segment that would push
> the trailing-24h total over 15 is refused with **HTTP 402**:
>
> > *"Daily trial message limit reached. Upgrade to a paid plan or wait 24 hours
> > to resume testing."*

### Where the code lives

| Concern | File |
| --- | --- |
| Cap constant + 402 message | `demoTextingGate.ts` (`TRIAL_DAILY_SEGMENT_CAP`, `DAILY_TRIAL_LIMIT_MESSAGE`) |
| Pure budget policy | `demoTextingGate.ts` (`isTrialDailyBudgetExceeded`) |
| Rolling-24h usage SUM | `demoTextingGate.ts` (`sumOutboundSegmentsLast24h`) |
| Authoritative send-time gate | `demoTextingGate.ts` (`evaluateDemoTextingGate`) |
| Gate call + 402 mapping | `outboundReply.ts` → `routes/conversations.ts` |

### Same unit as the ledger

The budget is counted in **segments** — exactly the unit the credit ledger
already records (1 credit/segment for SMS, a flat 3 for MMS — §2). So the two
numbers the gate compares are directly addable:

- **Prior usage** = `SUM(credit_ledger.credits)` for `direction = 'outbound'`
  over the last 24h. Reading the append-only ledger (the durable record of every
  *confirmed* outbound charge) means a carrier retry can never inflate the count.
- **Pending cost** = `calculateMessageCredits(...)` for the message about to send.

```ts
export const TRIAL_DAILY_SEGMENT_CAP = 15;

export function isTrialDailyBudgetExceeded(args: {
  subscriptionStatus: string | null | undefined;
  billingBypass?: boolean | null;
  priorSegments24h: number;
  pendingSegments: number;
}): boolean {
  if (isTextingUnlocked(args.subscriptionStatus, args.billingBypass)) return false;
  if (args.subscriptionStatus !== "trialing") return false;
  return args.priorSegments24h + args.pendingSegments > TRIAL_DAILY_SEGMENT_CAP;
}
```

### Who is and isn't capped

| Tenant state | Capped by the daily budget? |
| --- | --- |
| `active`, or `billingBypass` on | **No** — fully unlocked, no demo restrictions at all |
| `trialing` | **Yes** — 15 segments / rolling 24h |
| `expired` | **No** *budget* — because expiry is a **full outbound hard-stop**: it sends **nothing at all**, not even to its own signup phone (§10) |
| `none`, `past_due`, `canceled` | **No** *budget* — but the **contact gate** below already restricts them to self-texting |

### Three gates, in order

`evaluateDemoTextingGate` is the single send-time demo gate and runs the demo
policies in a fixed order, returning a discriminated decision so the caller can
surface the right 402. Active / `billingBypass` tenants short-circuit out first
with no restriction at all; everyone else falls through these in order:

0. **Trial expired — full hard-stop** — a tenant whose 14-day trial has lapsed
   (`subscriptionStatus === "expired"`) may send **nothing**, not even to its own
   signup phone (`reason: "trial_expired"`). Checked **first**, and scoped to
   `expired` ONLY so legacy `none`/demo tenants fall through to the contact gate
   below (§10).
1. **Contact restriction** — an unpaid/demo tenant may only text the phone it
   signed up with (`reason: "paywall_new_contact"`, fail-closed).
2. **Daily trial budget** — only for `trialing`, the 15-segment/24h cap
   (`reason: "daily_trial_limit"`).

It is enforced in the one authoritative **conversational** outbound path
(`sendConversationReply`), so the human composer **and** AI auto-send are covered
uniformly, and `routes/conversations.ts` maps a blocked decision to **402** with
the decision's message. The two **batch** send paths — campaign blasts
(`campaignEngine.ts`) and survey dispatch (`surveyDispatcher.ts`) — call
`getSender().send()` directly and do **not** run this per-contact gate, so each
enforces the expiry hard-stop on its own via `isTenantSendingExpired(tenantId)`
before sending (§10).

> **Engineer note — this is a deliberate *soft* cap.** The budget reads the ledger
> *before* the carrier send, and the ledger row for the current message is only
> written *after* the send confirms (§6). So two truly concurrent trial sends can
> both read the same prior total and both pass, briefly overshooting 15. That is
> acceptable and intentional for a trial sandbox limit — it mirrors how the charge
> engine reads balances and avoids a distributed lock for a non-billing guardrail.
> **Do not "harden" this into a reservation unless the trial cap ever becomes
> billing-critical.**

---

## 10. The Free-Trial Lifecycle (Soft Expiry & Reminders)

The daily budget (§9) governs a trial *while it is live*. The lifecycle governs
how a trial *ends*. It is a **subscription-state** process, distinct from the
per-message charge engine, but it lives in this manual because it is the other
half of trial monetization.

It runs on the existing **60-second timer engine** — `processTrialLifecycle()` in
`trialLifecycle.ts`, wired into `timerEngine.runTimerCycle` — so there is no
separate scheduler. Each cycle it scans every tenant still `trialing` with a
`trialEndsAt` and takes **at most one** action per tenant:

| Time left to `trialEndsAt` | Action | Notification type |
| --- | --- | --- |
| within (2, 7] days | day-7 upgrade nudge | `trial_reminder_day_7` |
| within (0, 2] days | day-2 upgrade nudge | `trial_reminder_day_2` |
| at or past expiry (≤ 0) | flip `trialing → expired` + "trial ended" nudge | `trial_expired` |

```ts
export function selectTrialAction(msLeft: number): TrialLifecycleAction {
  if (msLeft <= 0) return "expire";
  const daysLeft = Math.ceil(msLeft / DAY_MS);
  if (daysLeft <= 2) return "remind_day_2";
  if (daysLeft <= 7) return "remind_day_7";
  return "none";
}
```

Only **one** action returns per call. Earlier windows have already fired on prior
cycles, so a tenant that comes online late simply gets the most relevant remaining
nudge — the lifecycle never backfills old reminders.

### What "expired" means

Expiry is **"soft" only in that nothing is deleted** — operationally it is a
**hard** takeover of both the UI and every outbound path:

- `subscriptionStatus` flips **`trialing` → `expired`**.
- The **demo number stays assigned** — the tenant keeps its sandbox, contacts, and
  setup. Nothing is deleted.
- **All outbound is hard-stopped — including self-texting.** Unlike the per-contact
  demo gate (which still lets an unpaid tenant text its *own* signup phone), an
  `expired` tenant may send **nothing**. The stop is enforced **server-side at every
  outbound choke point**, so the UI wall is a courtesy, not the control:
  - **Conversational sends** (human composer + AI auto-send) — `evaluateDemoTextingGate`
    returns `reason: "trial_expired"` *before* the contact/budget checks, and
    `routes/conversations.ts` maps it to **HTTP 402**.
  - **Batch sends** (campaign blasts, survey dispatch) — these bypass the
    per-contact gate, so each calls `isTenantSendingExpired(tenantId)` before its
    `getSender().send()` and refuses (the campaign run is halted; the survey row is
    marked `failed` with error `trial_expired`).
- The user-app swaps the main view for an **"Upgrade to keep going"** wall off the
  `expired` status — **except `/billing`**, which stays reachable so they can pay.
  To avoid a flash of the workspace before the wall mounts, AppShell holds a
  skeleton until the subscription query resolves (it **fails open** on a query
  error, since the server still hard-stops every send regardless).
- **Release is owner-only.** Only an `owner` tenant_user can lift the wall by
  subscribing — the four billing **mutations** (checkout / subscribe / change-plan /
  cancel) are guarded by `requireTenantOwner`. A non-owner agent sees an
  "ask your owner to upgrade" message with no upgrade button. Billing **GET**s stay
  open so the agent's app can still fetch the subscription to render the wall.
- **`billingBypass` escapes everything.** The operator's per-tenant "Auto Approve /
  Auto Subscribed" override (`isTextingUnlocked`) clears both the send hard-stop and
  the UI wall, so support can preview the paid experience on an expired tenant.

> **Contract note.** `expired` is a **new** `subscriptionStatus` value. Because
> `GET /billing/subscription` returns the status **raw**, any new status MUST be
> added to the OpenAPI `SubscriptionDetail.status` enum and the client
> regenerated — otherwise the generated TypeScript union won't contain it and the
> UI literally cannot branch on it. (Same "raw passthrough" gotcha as the Facts
> list elsewhere in the platform.) The same applied to **`billingBypass`** — it was
> added to `SubscriptionDetail` (required) and the client regenerated so the wall
> predicate can read it (`expired && !billingBypass`).

### Where the code lives

| Concern | File |
| --- | --- |
| Pure window decision | `trialLifecycle.ts` (`selectTrialAction`) |
| Processor (scan + flip + fire) | `trialLifecycle.ts` (`processTrialLifecycle`) |
| Timer wiring (60s) | `timerEngine.ts` (`runTimerCycle`) |
| Idempotency + email seam table | `lib/db/src/schema/tenantNotifications.ts` |
| Conversational send hard-stop | `demoTextingGate.ts` (`evaluateDemoTextingGate` `trial_expired` branch, `TRIAL_EXPIRED_MESSAGE`) |
| Batch send hard-stop (campaign / survey) | `demoTextingGate.ts` (`isTenantSendingExpired`) → `campaignEngine.ts`, `surveyDispatcher.ts` |
| Owner-only release guard | `middleware/tenantAuth.ts` (`requireTenantOwner`) → `routes/billing.ts` |
| Paywall wall + Billing badge | user-app `components/AppShell.tsx`, `pages/Billing.tsx` |

### The two safety guarantees

**1. Each nudge fires exactly once.** `tenant_notifications` has a UNIQUE
`(tenant_id, type)` and every insert is `ON CONFLICT DO NOTHING`, so the 60s
re-run can never double-send a reminder.

**2. The flip is race-safe and atomic with its notification.** The status UPDATE
is **doubly guarded** — still `trialing` **and** `trialEndsAt <= now` — so neither
a concurrent upgrade to `active` nor a concurrent trial *extension* (status stays
`trialing`, `trialEndsAt` pushed out) can be clobbered by a stale processor. The
flip and the `trial_expired` insert run in **one transaction**: if the insert
throws, the flip rolls back and the next cycle retries both, so an expiry can
never be recorded without its notification.

```ts
const flipped = await db.transaction(async (tx) => {
  const updated = await tx.update(tenantsTable)
    .set({ subscriptionStatus: "expired" })
    .where(and(
      eq(tenantsTable.id, tenant.id),
      eq(tenantsTable.subscriptionStatus, "trialing"),
      lte(tenantsTable.trialEndsAt, now),     // only a TRULY elapsed trial
    ))
    .returning({ id: tenantsTable.id });
  if (updated.length === 0) return false;     // someone paid / extended — leave it
  firstFire = await insertTrialNotification(tx, tenant, REMINDER_SPECS.expire);
  return true;
});
```

### Side effects (best-effort)

On a **first** fire only, the lifecycle also writes an auditable `billing_events`
row and logs the **email-delivery seam**. No email provider is wired yet — the
in-app notification *is* the delivery today, and the log line is where a real send
will attach. These side effects are best-effort: a failure here is logged and
**never** rolls back the flip or the notification.

---

## 11. Worked end-to-end examples

1. **Plain 1-segment reply, healthy balance.** "Thanks, see you at 3pm" (23
   chars, GSM-7) → 1 credit. Drains 1 from Included. Ledger: one
   `outbound_charge`, `included_delta = -1`.

2. **Long emoji reply.** 150-char body containing one 🎉 → UCS-2 → `ceil(150/67)`
   = 3 segments → **3 credits**. If Included has 2 left and Add-On has 10: draws 2
   Included + 1 Add-On.

3. **Out of credits, Backup ON, sends 1 SMS.** Included 0, Add-On 0, Backup 0,
   cap not reached → engine buys **one 250-block ($10.00)**, spends 1, leaves
   **249** in `backup_credits`. Two ledger rows: `backup_topup` (+250) and
   `outbound_charge` (−1 from backup).

4. **Out of credits, Backup OFF, tries to send.** Preflight `allowed = false` →
   **no carrier call, no message row** → route returns **402** → inbox shows
   "credit frozen."

5. **Customer texts in at zero balance, Backup OFF.** Inbound is accepted; 1
   credit has nowhere to drain → `creditDebt` += 1. Balance is now **−1**.

6. **Outbound to an opted-out number.** We send, charge 1. Twilio returns
   **21610** → `refundMessageCredits` reverses it → net 0.

7. **Outbound spam-blocked by carrier.** We send, charge 1. Twilio returns
   **30007** → **not** in the refundable set → **charge stands** (we paid the
   carrier).

---

## 12. Known Boundaries & Deferred Work

These are deliberate scope lines, not bugs — flag them before go-live:

- **Backup card-charge is a stub.** `authorizeBackupTopup` currently authorizes
  any positive block request. The real **Stripe off-session charge** against the
  tenant's saved card is a later phase. Today a hypothetical decline at charge
  time (impossible with the stub) would fall through to `creditDebt`.
- **Hard-stop on a Backup *decline*** (as opposed to Backup *off*) requires a
  **reserve-then-send** flow (authorize the card *before* the carrier call). The
  **off** case is already a true preflight hard-stop; the **decline** case lands
  with the real provider.
- **No durable charge outbox yet.** If a charge throws *after* a confirmed send,
  it is logged, not retried. The idempotent ledger keys make a future
  reconciler/outbox safe to add.
- **Customer billing UI is partial.** The **trial paywall** (the "Upgrade to keep
  going" wall on `expired`, with **owner-only** release and a full server-side
  outbound hard-stop) and **in-app trial notifications** are live (§10). Still later
  phases: the full balance display, the Backup toggle UI, and the top-up purchase
  screens.
- **Trial notifications are in-app only.** `processTrialLifecycle` records each
  nudge in `tenant_notifications` and logs an email-delivery seam, but **no email
  provider is wired** — real email/SMS delivery of the nudges is a later phase.
- **The trial daily budget is a soft cap, not a reservation** — see the engineer
  note in §9; truly concurrent trial sends can briefly overshoot 15 segments.

---

## 13. Maintaining this code

- **Never change pricing in two places.** Backup price/size live only in
  `backupTopupProvider.ts` (`BACKUP_BLOCK_SIZE`, `BACKUP_BLOCK_PRICE_CENTS`).
- **Never hand-roll segment math.** Always go through `calculateMessageCredits`
  → `calculateSegments`. Adding a new charge path means *calling the calculator*,
  not re-deriving 160/153/70/67.
- **Any new charge path needs a stable idempotency key** and, if it carries its
  own identifier, must extend both the refund-before-charge guard **and** the
  `pending_refund` marker to that identifier (this is why campaign sends key on
  `campaign_message_id` symmetrically with conversation `message_id`).
- **Raw-SQL ledger INSERTs are only validated by the DB-backed tests, not by
  `tsc`.** A column/placeholder count mismatch throws only at runtime. Always run
  the money-correctness suite after touching `creditService.ts`:

  ```bash
  pnpm --filter @workspace/api-server exec vitest run src/lib/creditService.test.ts
  pnpm --filter @workspace/api-server exec vitest run src/lib/creditService.decline.test.ts
  pnpm --filter @workspace/api-server exec vitest run src/lib/messageCost.test.ts
  # Free-trial spend controls (§9–§10):
  pnpm --filter @workspace/api-server exec vitest run src/lib/demoTextingGate.test.ts
  pnpm --filter @workspace/api-server exec vitest run src/lib/trialLifecycle.test.ts
  ```

  (Run per-file — the shared test-DB env reaper can tear down a multi-file run.)
- **A new `subscriptionStatus` value means an OpenAPI change.** The status is
  returned **raw** to the client, so add any new value (e.g. `expired`) to the
  `SubscriptionDetail.status` enum and regenerate the client, or the UI can't see
  it (§10). Any new field the wall predicate needs (e.g. `billingBypass`) must
  likewise be added to `SubscriptionDetail` and the client regenerated.
- **A tenant-wide outbound stop must be replicated at *every* send choke point.**
  There are three tenant-driven senders — `sendConversationReply` (human + AI),
  `campaignEngine.executeCampaign`, and `surveyDispatcher` — each calling
  `getSender().send()`. A stop added only to the conversational gate silently leaks
  through campaigns and surveys. The conversational path uses
  `evaluateDemoTextingGate`; the two batch paths use `isTenantSendingExpired`. The
  Conductor `/inject` path is an operator capability deliberately **exempt** (it
  sits outside `conductorAuth`'s tenant allow-list, so a tenant JWT can never reach
  it — an operator override, like `billingBypass`).
- **Refund codes are an allow-list.** To make a new Twilio code refundable, add it
  to `REFUNDABLE_REJECTION_CODES` in `deliveryStatus.ts` — and ask first whether
  the carrier billed us for that attempt (if yes, it should *not* be refundable).
```
