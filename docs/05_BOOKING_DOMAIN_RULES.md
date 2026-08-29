# BK01 Booking Domain Rules

**Status:** LOCKED — target V1 contract, 2026-08-28
**Timezone:** Asia/Bangkok
**Authority:** Overrides historical booking-rule prose where conflicts exist.

## Booking state model
Canonical booking states: `hold`, `pending_review`, `confirmed`, `completed`, `cancelled`, `no_show`, `expired`.
Canonical deposit states: `not_required`, `awaiting`, `submitted`, `verified`, `rejected`, `refunded`.

Every state mutation must be validated, tenant-authorized where non-public, and auditable. Terminal-state changes require an explicit recovery/reopen decision; they must never be mutated silently.

## Availability
A slot is bookable only if all are true:
1. shop is active and subscription/trial gate permits online booking;
2. service is active and belongs to the shop;
3. selected/eligible provider is active and belongs to the shop;
4. provider has an explicit working schedule for that weekday;
5. full service duration fits within working hours and outside breaks;
6. shop/provider is not closed/off on that date;
7. no active booking interval overlaps the provider interval.

Missing schedule is unavailable. Client-side availability is advisory; the authoritative create/mutate transaction must repeat all critical checks.

## Any Staff allocation
When customer chooses Any Staff, the server selects only eligible providers. The deterministic policy is lowest qualifying workload for that business date, then stable tie-breaker. Allocation must remain collision-safe under concurrency.

## Hold
Deposit-required booking starts as `hold/awaiting` with 15-minute expiry. Expired holds release capacity and become `expired`. Any extension policy must be explicit and one-time; customer upload/retry behavior must not create indefinite holds.

## No-deposit
When service deposit resolves to zero/not-required, a valid booking may enter `confirmed/not_required` atomically and consumes normal booking entitlement/fair-use accounting.
## Deposit and slip rules
- PromptPay recipient details belong to the merchant.
- QR generation must not depend on public `promptpay.io` at runtime.
- Slip object is private; database stores controlled object reference/path, not an unauthenticated permanent public URL.
- Allowed upload types and size are enforced before upload and at storage/provider boundary.
- Submission moves valid active hold to `pending_review/submitted`.
- Manual approval moves to `confirmed/verified`; rejection returns to a time-limited recoverable state with reason.
- Automatic verification can confirm only on a positive provider result tied to the expected amount/merchant/transaction identity. Unknown, timeout or ambiguous result remains reviewable, never auto-approved.
- Duplicate transaction reference across accepted deposits is rejected or escalated; it must not confirm two bookings.

## Reschedule
Customer self-reschedule is V1 REQUIRED. It creates a new candidate interval under the same availability/collision rules and commits old-slot release + new-slot reservation atomically. Policy window, deposit carry-forward/refund implications and notification must be explicit to the customer before confirmation. Every reschedule emits audit and analytics evidence.

## Cancellation
Customer cancellation is allowed only within merchant-configured policy. Owner/admin may cancel active bookings with reason. Cancellation releases future capacity. Deposit refund is a merchant policy/operation unless a future payment integration explicitly automates it; BK01 must not claim funds are automatically refunded.

## Completion and no-show
Owner/admin can mark confirmed appointment `completed` or `no_show`. These terminal outcomes are required for KPI truth. No-show is never inferred merely because time passed. Metrics use explicit status events.

## Blacklist
Blacklist is V1 OPTIONAL. If implemented, owner/admin can block/unblock a tenant-local customer with reason/audit. A blocked customer cannot create a new booking for that shop using the matched canonical identity. Blacklist is not global across WSTERA tenants.

## Quota and entitlement
Trial booking capacity is limited for evaluation/abuse control. Paid booking capacity is effectively unlimited for normal ICP usage; legacy 100/500 paid limits are retired. Staff limits and variable-cost automation allowances remain enforceable. Entitlement checks must be transaction-safe and cannot delete historical business records on downgrade.

## LINE notifications
Confirmation plus at least one pre-appointment reminder are required V1 events. Delivery failure must be logged and visible/recoverable without corrupting booking state. Merchant-owned OA is paid-production default; central OA is onboarding/trial mode.

## Identity and authorization
Public customer booking does not require customer account. Merchant users require authenticated membership. Staff operational scope requires explicit auth-user→staff mapping; being a generic shop member is insufficient to expose all shop bookings to a staff-role user.

## Audit invariants
Booking lifecycle, deposit review/verification, reschedule/cancel/no-show, entitlement-changing operator action and platform-admin intervention must have attributable, timestamped evidence. Audit records are not user-editable business notes.
