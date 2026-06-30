# Billing & Credit Engine — Test Roadmap

> **Purpose:** a tick-off QA checklist for the last build — the **credit-deduction
> engine** (backend, merged) and the **Credit Pricing** Admin page.
> Work top-to-bottom; each row is an independent, verifiable case with the exact
> expected outcome. Companion to [`Billing_Credit.md`](Billing_Credit.md).

**Legend:** ☐ = not run · ☑ = pass · ☒ = fail (log a note)

---

## 1. Subscription tiers & carrier overhead

| ID | Status | Scenario | Input / Setup | Expected result | Verify in |
|----|:------:|----------|---------------|-----------------|-----------|
| T1.1 | ☐ | Tier values correct | Open Admin → Credit Pricing | Starter $149/600, Growth $349/2,000, Enterprise Custom/Bespoke | Admin page §1 |
| T1.2 | ☐ | Overhead never touches credits | Tenant with number + no 10DLC | $15 number fee + $10 surcharge appear as **Stripe line items**; buckets unchanged | Stripe invoice; `tenants.*_credits` |

## 2. Waterfall deduction (Included → Add-On → Backup)

| ID | Status | Scenario | Input / Setup | Expected result | Verify in |
|----|:------:|----------|---------------|-----------------|-----------|
| T2.1 | ☐ | Drains Included first | Included=10, send 1-credit SMS | Included 10→9; Add-On/Backup untouched | `credit_ledger` `included_delta=-1` |
| T2.2 | ☐ | Spills to Add-On | Included=0, Add-On=10, send 3-seg | Add-On 10→7 | `addon_delta=-3` |
| T2.3 | ☐ | Spills to Backup | Included=0, Add-On=0, Backup=250, send 2 | Backup 250→248 | `backup_delta=-2` |
| T2.4 | ☐ | Mixed split | Included=2, Add-On=10, send 3-seg | draws 2 Included + 1 Add-On | ledger deltas |

## 3. Backup auto-replenish + toggle hard-stop

| ID | Status | Scenario | Input / Setup | Expected result | Verify in |
|----|:------:|----------|---------------|-----------------|-----------|
| T3.1 | ☐ | Block purchase trigger | All buckets 0, **Backup ON**, under cap, send 1 SMS | Buys **one 250 block ($10)**, spends 1, leaves 249 | two ledger rows: `backup_topup` (+250) + charge (−1) |
| T3.2 | ☐ | Block math | Need 300 credits at 0 | Buys **2 blocks** (ceil 300/250), $20 | `topup_blocks=2` |
| T3.3 | ☐ | Per-cycle cap freeze | `backup_topups_count` = cap | No more blocks; outbound **frozen** | preflight `allowed=false` |
| T3.4 | ☐ | **Backup OFF hard-stop** | All buckets 0, **Backup OFF**, send | **No carrier call, no message row**, HTTP **402** `credit_frozen` | inbox frozen; `routes/conversations.ts` 402 |
| T3.5 | ☐ | Preflight counts replenishable | Buckets 0, Backup ON under cap | Send **allowed** (coverage includes future blocks) | `assessOutboundCredit.coverage` |

## 4. Inbound never blocked (forced negative)

| ID | Status | Scenario | Input / Setup | Expected result | Verify in |
|----|:------:|----------|---------------|-----------------|-----------|
| T4.1 | ☐ | Inbound at zero | Buckets 0, Backup OFF, customer texts in | Message **accepted**; balance goes **−1** into `credit_debt` | `tenants.credit_debt` |
| T4.2 | ☐ | Inbound MMS | Inbound with `NumMedia>0` | Flat **3 credits** to debt | `inbound_charge` row, channel=mms |

## 5. Segmentation & encoding (SMS cost = segments)

| ID | Status | Input body | Expected credits | Why |
|----|:------:|------------|:----------------:|-----|
| T5.1 | ☐ | 23 chars plain | 1 | GSM-7, ≤160 |
| T5.2 | ☐ | exactly 160 plain | 1 | single segment boundary |
| T5.3 | ☐ | 161 plain | 2 | spills → 153/seg |
| T5.4 | ☐ | 350 plain | 3 | ceil(350/153) |
| T5.5 | ☐ | 70 chars w/ one 😀 | 1 | UCS-2, ≤70 |
| T5.6 | ☐ | **71 chars w/ emoji** | **2** | emoji drop → 70/seg |
| T5.7 | ☐ | 150 chars w/ emoji | 3 | ceil(150/67) |
| T5.8 | ☐ | very long plain (~800) | 6 | **no 3-credit cap** on text |

## 6. MMS (flat 3)

| ID | Status | Scenario | Expected |
|----|:------:|----------|----------|
| T6.1 | ☐ | Outbound w/ PDF/PNG/vCard | 3 credits flat regardless of body length |
| T6.2 | ☐ | `forceMms` text wrap | 3 credits |
| T6.3 | ☐ | Inbound media | 3 credits |

## 7. Webhook status & refund mapping

| ID | Status | Twilio code | Expected | Verify |
|----|:------:|-------------|----------|--------|
| T7.1 | ☐ | **21610** (opt-out/STOP) | Charge **reversed** (refund) | `refund_rejected` row, net 0 |
| T7.2 | ☐ | **21211** (invalid number) | Charge **reversed** | net 0 |
| T7.3 | ☐ | **30007** (spam block) | **Charge stands** (no refund) | original charge remains |
| T7.4 | ☐ | **30003** (unreachable) | **Charge stands** | original charge remains |
| T7.5 | ☐ | Rejection before charge | refund writes `pending_refund`; later charge **skips** | no net charge |
| T7.6 | ☐ | Duplicate rejection callback | Refund **idempotent**, no double-refund | single refund row |

## 8. Idempotency / money safety

| ID | Status | Scenario | Expected |
|----|:------:|----------|----------|
| T8.1 | ☐ | Carrier retries inbound (same SID) | Charged **once** (`inbound:<sid>` unique) |
| T8.2 | ☐ | Outbound retry (same msg id) | Charged **once** (`outbound:<id>`) |
| T8.3 | ☐ | Campaign re-run | Each message charged once (`campaign_message:<id>`) |
| T8.4 | ☐ | Concurrent sends, one tenant | Row `FOR UPDATE` serializes; no overdraw |
| T8.5 | ☐ | Charge throws after send | Send still succeeds; logged, not retried (known boundary) |

## 9. Enterprise / unmetered bypass

| ID | Status | Scenario | Expected |
|----|:------:|----------|----------|
| T9.1 | ☐ | Enterprise (unlimited) sends | Always allowed; zero-cost audit row; never freezes |
| T9.2 | ☐ | Unmetered tenant (no usage/buckets) | Always passes gate |

## 10. Admin "Credit Pricing" page (UI)

| ID | Status | Scenario | Expected |
|----|:------:|----------|----------|
| T10.1 | ☐ | Nav button present | Sidebar shows **Credit Pricing** (Coins icon) below Tiers |
| T10.2 | ☐ | Route works | `/admin/credit-pricing` renders the 4 sections |
| T10.3 | ☐ | Read-only | "Read-Only Reference" badge; no editable inputs |
| T10.4 | ☐ | Values match engine | Tiers, waterfall, segmentation, refund codes match §1–§9 |
| T10.5 | ☐ | Auth-gated | Unauthenticated → redirected to login |

---

## Known boundaries (expected, not bugs — verify when the relevant phase lands)

- **Backup card *decline* is not a hard-stop yet.** The Backup provider is a stub
  that always authorizes; only Backup *off* hard-stops today (T3.4). Re-test the
  decline path once the real Stripe off-session charge is wired.
- **No charge-outbox retry.** A charge that throws *after* a confirmed send (T8.5)
  is logged, not auto-retried. Safe to add later because the ledger keys are
  idempotent.

## Automated coverage (run before manual QA)

```bash
pnpm --filter @workspace/api-server exec vitest run src/lib/messageCost.test.ts
pnpm --filter @workspace/api-server exec vitest run src/lib/creditService.test.ts
pnpm --filter @workspace/api-server exec vitest run src/lib/creditService.decline.test.ts
```

(Run per-file — the shared test-DB env reaper can tear down a multi-file run.)
