# BK01 Analytics & KPI Specification

**Status:** LOCKED TARGET V1 — 2026-08-28

## Canonical event taxonomy
`signup_started`, `signup_completed`, `shop_provisioned`, `service_setup_completed`, `staff_setup_completed`, `schedule_setup_completed`, `booking_link_published`, `booking_page_opened`, `availability_viewed`, `hold_created`, `hold_expired`, `deposit_required`, `deposit_submitted`, `deposit_rejected`, `deposit_verified`, `booking_confirmed`, `booking_cancelled`, `booking_rescheduled`, `booking_completed`, `booking_no_show`, `line_linked`, `notification_sent`, `notification_failed`, `checkout_started`, `checkout_completed_authoritative`, `subscription_activated`, `subscription_past_due`, `subscription_cancelled`, `quota_warning`, `quota_exhausted`, `automation_topup_consumed`, `support_ticket_created`.

Events must include stable tenant/shop identifier internally, actor/role where applicable, event timestamp, relevant entity ID and source surface. Analytics must not leak secrets or unnecessary PII.

## Funnel definitions
- **Acquisition:** qualified merchant reaches signup start from a measured source.
- **Signup conversion:** `signup_completed / signup_started`.
- **Onboarding completion:** shop provisioned + ≥1 service + ≥1 provider + valid schedule + booking link published.
- **Activation hypothesis:** onboarding completion plus first real customer booking confirmed within the trial. This is a hypothesis to validate, not signup.
- **First value:** merchant receives and successfully handles a real booking without manual repair/intervention by WSTERA.
- **Trial-to-paid:** authoritative `subscription_activated` for a previously trialing shop / eligible ended trials.


## Engagement and retention definitions
- **Engagement:** an activated shop continues using BK01 for real operational appointments, measured by confirmed/completed bookings in an observation period; test/demo bookings are excluded where identifiable.
- **Retention:** an activated shop remains operationally active in subsequent cohort periods, not merely logged in or subscribed.
- **Paid retention:** paid shops whose authoritative subscription remains active/past_due under V1 billing policy and which remain in the retained-product cohort.
- **Logo churn:** previously paid shops that reach authoritative subscription cancellation/end during the measured cohort period; report voluntary/involuntary reason where known.
- **Product reliability:** availability, booking-integrity, provider-delivery, billing-state and security metrics in the Reliability section, evaluated independently from growth metrics.

## Checkout authority
`checkout_started` records an attempt. `checkout_completed_authoritative` is emitted only after a verified Stripe event has been reconciled to the shop/subscription state; browser success-page arrival is not completion evidence.
## Product outcome metrics
- booking completion rate = completed / confirmed appointments reaching scheduled time window;
- cancellation rate = cancelled / confirmed-or-later eligible appointments;
- no-show rate = explicit `no_show` / completed + no_show for elapsed appointments;
- deposit adoption = deposit-required confirmed bookings / all confirmed bookings;
- deposit verification success = verified / submitted, split manual vs automatic;
- notification success = sent / attempted by event type;
- reschedule success = completed reschedules / initiated reschedules;
- booking collision integrity = accepted double-bookings detected, target **0**;
- support burden = tickets and manual operator interventions per active shop.
## Business metrics
- paid active shops;
- MRR from authoritative active subscriptions;
- paid retention and logo churn by cohort;
- average revenue per paid shop;
- Basic↔Pro mix;
- pilot willingness-to-pay response versus pilot reference price;
- gross variable automation cost per paid shop;
- support hours/interventions per shop.

## Reliability metrics
- public booking availability/error rate;
- booking RPC failure rate by reason;
- LINE delivery failure rate;
- Stripe webhook processing failure/drift count;
- auto-slip provider unknown/error rate;
- private-slip unauthorized access attempts;
- release rollback/forward-fix incidents.

## Evidence discipline
No marketing claim may infer causality from these metrics without appropriate evidence. Specifically, no-show reduction requires pre/post or cohort comparison with explicit baseline definition. Signup is not activation. A merchant creating test data is not first value.

## Pilot targets
Exact commercial KPI thresholds are not invented in BK-0. Pilot must establish baseline distributions for time-to-onboard, time-to-first-value, confirmed bookings/shop, deposit usage, no-show/cancel rates, notification success, support burden and willingness-to-pay before final public price lock.
