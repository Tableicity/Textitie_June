---
name: Carrier billing Stripe reconciliation
description: Non-obvious traps when syncing per-number carrier add-ons to a Stripe subscription's quantity-based items.
---

# Carrier billing → Stripe subscription-item reconciliation

The DB-derived snapshot (`computeCarrierBillingSnapshot`) is always the source of
truth for UI/invoice; pushing to Stripe (`syncCarrierBillingToStripe`) only
happens for real `sub_*` subs in billable states and is best-effort
(post-commit, swallows errors, logs CRITICAL). These rules below caused real
review failures and must hold:

## Multi-pass reconciliation must re-fetch live items each pass
When a single sync reconciles MORE THAN ONE managed price in sequence (carrier
fee, then unregistered surcharge), each pass must call
`stripe.subscriptions.retrieve()` itself and operate on the LIVE item list.
**Why:** a tempting "optimization" is to retrieve once and pass the same
`sub.items.data` snapshot into both passes. That snapshot goes stale: the first
pass can delete an item, and the second pass still sees it, so its
"is this the last remaining item?" guard is computed against phantom items and
it tries to delete the actual last item → Stripe "cannot delete the last
subscription item" error → whole sync fails.
**How to apply:** never hoist one `retrieve()` out and share it across passes;
the extra retrieve per pass is an accepted cost (deletes/changes are rare and
only run for real billable subs).

## Never delete the last subscription item
Before deleting a managed add-on item, confirm at least one OTHER-priced item
remains (the base plan item normally protects this). If the managed add-on would
be the only item left, skip the delete and log CRITICAL instead of throwing.
**Why:** Stripe rejects emptying a subscription; a single stale add-on is far
less harmful than aborting reconciliation.

## Recovery path is mandatory for best-effort sync
Because sync is best-effort, "underbilling until reconciled" only stays bounded
if a reconciliation path exists. There is a Conductor-scoped
`POST /tenants/:id/reconcile-carrier-billing` that re-runs the sync; sync is also
re-triggered on subscription activation/update (closes the buy-before-subscribe
gap) and on any primary-number change via Conductor `PATCH /tenants/:id`, not
only on the surcharge toggle.

## number_type is derived, not trusted
`phone_numbers.number_type` (`local`|`toll_free`) drives billing (toll-free =
$0). It is classified from the E.164 number and self-healed on every boot, so a
mislabeled/legacy row can't bypass or inflate carrier charges. Don't trust a
client-supplied type.
