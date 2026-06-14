# Trap: Department-Assigned Numbers Route Inbound to the Wrong Tenant

One real bug worth knowing — it doesn't affect your flow if you follow the
primary-number path.

## What happens
Department-assigned numbers route inbound to the wrong tenant. The inbound resolver's
fallback path (used when a number is attached to a *department* instead of the
tenant's primary number) runs an unscoped query against the shared DB pool — a side
effect of the Stage 4 isolation rollback. It returns the *first* tenant it iterates
whenever any department holds that number, not the real owner.

## Mitigation
Assign your brought number as the tenant's **primary** number — which is exactly what
the admin Telephony dropdown does. That path is an exact, correct match. Just avoid
the self-service "purchase → department" path until that resolver is fixed.
