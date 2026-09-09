# BRIEF — BK01 Real-Shop Pilot Hardening & Merchant Flexibility Audit

**Date:** 2026-09-09 (Asia/Bangkok)
**Product:** BK01 Booking by WSTERA
**Mode:** REQUIREMENT LOCK / AUDIT / PREPARE-ONLY FOR CANONICAL RUNTIME
**Primary evidence:** KMO RACKBARCUSTOM downstream pilot + canonical BK01 source inspection
**Owner intent:** deploy early in a controlled pilot so real usage exposes defects before wider release.

## 1. Mission

Harden BK01 for real shops with different operating styles before broad release.
The system must support Booking now and remain structurally compatible with Order and Claim later.
Real-shop pilot evidence is authoritative for usability defects, but no single pilot shop may become a hardcoded product assumption.

## 2. Non-negotiable product rule

**Do not hardcode merchant business policy. Hard-lock system invariants.**

Merchant policy must be configurable where shops can reasonably differ.
System invariants must remain enforced server-side and must not be merchant-overridable.

## 3. Current execution gate

Canonical BK01 remains under the existing Junction A gate.
Until House/platform remediation returns and BK01 independently re-proves `Junction A PASS`:
- do not add forward schema/migrations to WSTERA LAB for this hardening work;
- do not start Order/Claim live integration;
- do not weaken current fail-closed protections;
- safe audit, UI/domain preparation, tests, documents and isolated downstream pilot evidence are allowed.
## 4. Controlled-deploy principle

Deploying early is intentional, but deployment is a learning environment, not proof of release readiness.
A pilot may use real merchant configuration, owner/staff accounts and realistic workflows.
Until customer-flow P0 gates pass, use synthetic customer identities and non-sensitive test transactions.
No fake payment recipient, no guessed merchant identity and no unapproved customer cutover.

Each pilot finding must answer:
1. Is this KMO-only configuration, generic BK01 defect, UX defect, architecture gap or operations issue?
2. Would a different shop reasonably hit the same issue?
3. Is the fix a merchant configuration, product default, or system invariant?
4. Can it be fixed without changing shared-runtime boundaries?

## 5. KMO real-user findings — initial evidence backlog

1. Shop weekly configuration can be changed and saved: working capability, keep as evidence.
2. Native time fields are difficult to operate on the tested device: generic UX defect.
3. Customer preview/onboarding path does not clearly prove readiness and an empty service set is not explained: generic UX/readiness defect.
4. Special shop holidays can be added and deleted: working capability.
5. Shop weekly hours and staff schedules are separate; unsaved edits for other staff are reset after saving one staff member: P0 workflow defect + scheduling contract gap.
6. Shop profile cannot be saved without PromptPay: P0 generic contract coupling.
7. Service duration is minute-only with 15-minute assumptions: merchant-flexibility architecture gap.
8. Numeric fields coerce empty input to zero, making natural editing difficult: generic form-state UX defect.
9. Customer page can return HTTP 200 while still failing to present a usable booking flow: P0 customer E2E/readiness defect.
## 6. Scheduling Policy V2 — required contract

Recurring weekly closure must support exactly one merchant-selected mode at a time:

### Mode A — SHOP_WEEKLY
- recurring weekly open/closed days are controlled at shop level;
- recurring weekly off-day controls at individual staff level are disabled;
- staff exact-date leave/time-off remains available;
- staff working-time details may refine availability only within a shop-open day.

### Mode B — STAFF_WEEKLY
- recurring weekly availability/off-days are controlled per staff member;
- recurring shop weekly closure controls are disabled;
- staff exact-date leave/time-off remains available.

### Always independent
- Shop Special Closure: exact calendar date, whole shop closed for Booking regardless of weekly mode.
- Staff Date Time-Off: exact calendar date, only that staff member unavailable.

Required precedence for Booking availability:
`shop inactive/billing blocked -> exact-date shop closure -> selected recurring-weekly policy -> staff exact-date time-off -> staff working time/break -> existing booking collision -> slot available`.

The same rule must be enforced by consumer availability, create hold, reschedule and any trusted mutation path.
UI-only enforcement is insufficient.
## 7. Merchant configuration vs system invariant

### Merchant-configurable policy
- Booking enabled/disabled.
- Weekly scheduling mode and applicable recurring schedule.
- Shop special closures and staff exact-date time-off.
- Staff working times and breaks where applicable.
- Slot interval; do not assume fixed 30 minutes.
- Service duration and scheduling mode.
- Booking lead time and booking horizon.
- Cancellation/reschedule windows.
- Deposit required/not required, amount/rule and supported payment method.
- Reminder/notification policy.
- Order production calendar and fulfillment policy when Order is later enabled.
- Shop-facing Claim categories/labels where safe.

### Hard system invariants
- tenant isolation and cross-shop denial;
- owner/admin/staff authorization boundaries;
- server-side collision prevention;
- idempotency and atomic state changes;
- payment-state integrity and no invented recipient;
- auditability for sensitive mutations;
- bounded public data exposure;
- fail-closed behavior for missing security/payment authority;
- lifecycle transition integrity;
- no unauthorized PS01/MT01/shared-runtime delta.
## 8. Service duration and scheduling model

Do not solve minute/hour/day by display conversion alone.
Introduce a clear scheduling model:
- `TIME_SLOT`: minute/hour services that occupy a same-day time interval;
- `DATE_RANGE`: day-based work that can span dates and must respect multi-day calendar semantics.

Minute/hour values may be normalized internally, but the merchant-facing unit must be preserved.
Day-based duration must not be implemented as `days * 1440 minutes` without cross-date rules.
No hidden 15-minute or 30-minute merchant policy may remain hardcoded unless explicitly defined as a configurable product default.

## 9. Profile and Payment separation

Shop profile/contact configuration must save independently from payment setup.
PromptPay is optional unless the active booking/payment policy actually requires it.
When a deposit-required flow lacks a verified supported payment method, that payment flow must fail closed with a clear readiness error.
Never invent or fall back to a demo PromptPay recipient or guessed deposit amount.
Changing a service price must not silently overwrite the merchant's deposit decision (for example, automatic 30%).

## 10. Admin UX requirements

- Replace hard-to-use time-only interaction with keyboard-friendly HH:MM entry plus accessible picker behavior.
- Numeric form state must allow an empty string during editing; parse and validate at blur/save boundaries.
- Schedule edits must not disappear because another staff member was saved.
- Prefer page-level/batch `Save All Changes` or explicit dirty-state protection for multi-staff schedule edits.
- Give the merchant a direct `Preview customer page` action at all times.
## 11. Merchant readiness and customer truthfulness

Admin must show readiness as independent capabilities, not one giant completion requirement.
At minimum show status for profile, booking schedule, services, staff/provider setup, payment when required, and public booking availability.
A merchant must be able to preview the customer page before every setup item is complete.

Customer page must never be blank or ambiguous.
It must distinguish at least:
- shop unavailable/inactive;
- online booking disabled or billing-blocked;
- no active services;
- no active provider/staff when the service requires one;
- schedule not configured;
- no available slot for selected date;
- payment configuration missing when payment is required;
- actual data/runtime load failure.

HTTP 200 is not a customer-flow PASS.
Customer E2E PASS requires visible shop -> service -> provider/resource policy -> date -> valid slot -> hold/create flow, plus truthful negative states.

## 12. Diversity matrix — mandatory audit targets

The hardening review must test contracts against at least these shop styles:
- barber/salon: short slots, multiple staff, individual weekly schedules;
- clinic/wellness: appointments, breaks, strict provider selection, cancellation windows;
- garage/repair shop: variable-duration jobs and staff/technician availability;
- custom fabrication shop such as KMO: long work, production days, optional deposit, Booking + future Order/Claim;
- no-deposit merchant: booking must work without payment onboarding;
- one-person shop: minimal setup and simple weekly closure;
- multi-staff shop: unsaved/batch schedule changes must remain safe;
- day-based/date-range service: must not be forced into same-day minute slots;
- Claim-only or support-heavy merchant: profile/support setup must not depend on Booking payment configuration.
## 13. Security and safety gates

Every new merchant-configurable feature must prove:
- owner/admin mutation authorization at DB/RPC boundary, not only hidden UI controls;
- ordinary staff denial where the contract forbids mutation;
- outsider and cross-shop read/write substitution fail closed;
- public surface exposes only the minimum truth needed for booking;
- no service-role/browser secret leakage;
- mutation idempotency where retries can duplicate business actions;
- concurrency/collision tests for booking create and reschedule;
- audit evidence for sensitive merchant changes;
- rollback or deterministic restore path for every pilot schema patch;
- no real payment instruction until recipient/configuration is verified.

Phone/customer validation must not silently assume one merchant or customer population.
If BK01 remains Thailand-first, country/normalization behavior must be explicit product policy, not scattered regex assumptions across Booking and Ticket domains.

## 14. Booking / Order / Claim boundary rule

Do not collapse all calendars into one table merely for convenience.
Booking availability, Order production capacity and Claim/recheck scheduling may have different business meaning.
They may inherit shared merchant profile/configuration only where the contract explicitly says so.
The goal is composable capabilities, not one generic hardcoded workflow and not an oversized ERP abstraction.

## 15. Execution phases

**R0 — Evidence lock:** preserve KMO findings, reproduction and upstream/downstream classification.
**R1 — Hardcode audit:** scan Admin, Consumer, SQL/RPC, Booking, Ticket/Claim and Order preparation for merchant policy embedded in code.
**R2 — Scheduling Contract V2:** lock SHOP_WEEKLY vs STAFF_WEEKLY, exact-date overrides and server-side precedence.
**R3 — Merchant Configuration Architecture:** separate profile, scheduling, services, payment, notification and capability readiness.
**R4 — UX remediation design:** time entry, numeric editing, batch schedule save, customer preview and truthful empty/error states.
**R5 — Service scheduling contract:** TIME_SLOT vs DATE_RANGE and configurable slot behavior.
**R6 — Security review:** authorization, tenant isolation, public exposure, collision, idempotency, rollback and negative tests.
**R7 — Post-Junction implementation:** only after `Junction A PASS`, apply bounded canonical runtime/schema changes and prove LAB isolation.
**R8 — KMO resync + pilot round 2:** sync only verified upstream fixes, deploy controlled pilot and repeat real-user E2E.
## 16. Release acceptance — no code-green shortcut

A feature is not accepted because lint/tests/build pass alone.
Acceptance requires all applicable layers:
1. static/type/lint/build pass;
2. focused domain and DB/RPC tests pass;
3. negative authorization/tenant tests pass;
4. browser/mobile usability proof passes;
5. customer E2E positive and negative paths pass;
6. merchant configuration survives reload and concurrent editing expectations;
7. no hidden fallback creates false business/payment truth;
8. rollback/recovery evidence exists for pilot runtime changes.

## 17. Stop conditions

Stop and report instead of improvising when:
- a fix requires guessing merchant identity/payment information;
- a change would weaken tenant isolation or server-side enforcement;
- canonical work requires a LAB migration before Junction A is re-proved;
- a KMO-specific value would need to become generic product code;
- Order/Claim live integration would be required to close a Booking hardening task;
- a schema/runtime delta touches PS01, MT01 or shared platform objects unexpectedly;
- the only way to claim PASS is HTTP status, mocked data or source inspection without the required real-user proof.

## 18. Evidence basis

Canonical BK01 evidence includes current Admin/Consumer source, staff schedules, shop holidays, booking hold/reschedule guards, shop settings RPC and Ticket/Case domain.
KMO downstream evidence includes the 2026-09-09 real-user observations, M3/B1 closure report, PromptPay coupling defect report and shop weekly schedule mitigation.

**Verdict:** REAL-SHOP HARDENING REQUIRED BEFORE BROAD RELEASE.
Controlled deployment remains encouraged as a defect-discovery mechanism, provided the gates above remain enforced.