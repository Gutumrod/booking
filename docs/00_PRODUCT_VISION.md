# BK01 Product Vision

**Product:** BK01 — Booking by WSTERA
**Status:** LOCKED — Owner approved 2026-08-28
**Authority:** Product-level intent; subordinate requirements live in `01_PRD.md`.

## Problem
Small Thai appointment businesses still coordinate availability through LINE/DM, manual calendars, spreadsheets, and staff memory. The recurring failure is not merely “taking bookings”; it is keeping staff availability, deposits, confirmations, changes, and customer communication consistent without double-booking or excessive manual follow-up.

## Primary ICP
Single-location hair salons, barbers, beauty salons, nail studios and similar appointment businesses with roughly 1–10 service providers. They operate in Thailand, commonly use LINE as a customer communication channel, and need simple Thai-first workflows rather than enterprise scheduling complexity.

## Category
BK01 is a **Thailand-first appointment operations SaaS with LINE-assisted customer communication and PromptPay-native deposit workflows**. It is not a generic queue ticketing product, medical clinic system, marketplace, POS, ERP, or multi-branch enterprise suite.

## Core value
BK01 should let a merchant publish a booking link, expose only genuinely available times, secure high-intent appointments with deposits when needed, keep staff schedules consistent, and reduce manual confirmation/follow-up work while preserving merchant ownership of the customer relationship.

## Product principles
1. **Scheduling integrity before convenience** — availability and collision rules must be enforced at the authoritative data layer.
2. **Merchant-owned relationship** — paid production supports shop-owned LINE OA; WSTERA central OA is onboarding/trial convenience, not forced brand ownership.
3. **Thai-native money flow** — PromptPay deposit flow is first-class; customer money goes directly to the merchant unless a future explicit product decision says otherwise.
4. **No hidden claims** — no unsupported “eliminates no-shows” or similar absolute marketing.
5. **Tenant safety is a product feature** — role boundaries, storage privacy and auditability are release blockers.
6. **Operational simplicity** — single location first; avoid adding clinic, branch, POS or marketplace complexity into V1.
## V1 outcome
A qualifying merchant can self-register, configure one shop, define services/providers/schedules, publish a customer booking URL, accept collision-safe bookings, optionally require PromptPay deposits, review/verify deposits, confirm/change/cancel appointments, mark completion/no-show, send required notifications, manage subscription state, and export core business data.

## Explicit V1 non-goals
- medical/clinical workflow or medical-record handling;
- multi-branch tenancy or franchise hierarchy;
- marketplace/discovery/commission business model;
- POS, inventory, payroll or accounting;
- full CRM/marketing automation suite;
- annual billing until annual Stripe prices/state are implemented;
- customer mobile app requirement;
- public deposit-slip URLs;
- runtime dependency on public `promptpay.io`;
- unlimited platform-operator access or unaudited impersonation.

## Differentiation hypothesis
BK01 should lead with the combination of **reliable staff scheduling + Thai-native deposit flow + merchant-owned LINE operations + low setup burden**. LINE or PromptPay alone are not defensible differentiators because Thai competitors already offer them.

## Evidence boundary
Current implementation and market evidence are documented separately. A V1 requirement in this vision is a release contract, not proof that the baseline code already satisfies it. BK-A must close all implementation gaps before public launch.

## Success evidence
Success requires pilot evidence showing merchants can reach first value without high-touch setup, booking integrity holds under real concurrency, deposit and notification flows are reliable, and retention/value metrics justify final paid pricing. Exact no-show reduction, conversion uplift and willingness-to-pay remain hypotheses until measured.
