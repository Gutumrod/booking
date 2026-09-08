# BK01 Product Decisions

**Baseline:** `main @ e99615d`
**Opened:** 2026-08-28
**Status:** OWNER APPROVED — 2026-08-28

Decision records must capture final decision, rejected alternatives, rationale, affected docs and implementation consequence. Evidence lives in `audit/CURRENT_TRUTH_AND_CONTRADICTIONS.md` and `market/*`.

## Blocking queue

| ID | Decision required | Recommended decision | Why | Status |
|---|---|---|---|---|
| PD-001 | Primary ICP | Hair/barber/beauty/nail; 1 location; ~1–10 providers | Best fit to current staff/time/deposit domain and current Thai market evidence | APPROVED 2026-08-28 |
| PD-002 | Paid-plan booking quota | Do not use 100/500 as paid-plan value wall; keep trial/free quota, make paid booking capacity effectively unlimited or operationally generous | Onque/JongQ offer unlimited; QueueBooking gives 2,000 at ฿990 | APPROVED 2026-08-28 |
| PD-003 | Final ฿490/฿990 prices | Keep prices **provisional**, not LOCKED, until feature contract + pilot WTP; do not change price merely to undercut competitors | Current product lacks features needed to justify Pro confidently | APPROVED 2026-08-28 |
| PD-004 | Auto-slip | Make automatic verification a **V1 REQUIRED Pro capability before public Pro sale**; remove claim until implemented and verified | Direct competitors already treat automation as normal paid functionality | APPROVED 2026-08-28 |
| PD-005 | LINE architecture | WSTERA Central OA is the default V1 production notification path and is bundled with the monthly service; merchant-owned OA is an optional managed add-on | Owner commercial override after live BK-SR-03 LINE acceptance | OVERRIDDEN 2026-09-08 |
| PD-006 | Staff identity | Add explicit auth-user→staff mapping; staff sees own bookings/schedule, owner/admin sees shop scope | Required to make existing role promise enforceable | APPROVED 2026-08-28 |
| PD-007 | Slip storage | Private bucket + authorized/signed access; retire public object URLs | Current public bucket conflicts with privacy/security intent | APPROVED 2026-08-28 |
| PD-008 | Annual billing | POST-V1 until true annual Stripe prices/state are implemented; remove annual UI/copy in BK-A | Current checkout is monthly-only | APPROVED 2026-08-28 |
| PD-009 | Customer reschedule/cancel | V1 REQUIRED self-service with policy guardrails and audit; no silent slot mutation | Current market expects change flows; current implementation is incomplete | APPROVED 2026-08-28 |
| PD-010 | Automated reminders | V1 REQUIRED; define at least confirmation + pre-appointment reminder with delivery/failure evidence | Reminder automation is table stakes in direct competitors | APPROVED 2026-08-28 |
| PD-011 | PromptPay QR generation | Remove runtime dependency on public `promptpay.io`; generate/control QR within approved BK01 dependency boundary | Avoid uncontrolled availability/privacy dependency | APPROVED 2026-08-28 |
| PD-012 | Data portability | V1 owner CSV export for core business data; account closure/deletion request flow before launch | Switching trust and privacy readiness require a real path | APPROVED 2026-08-28 |
| PD-013 | No-show | V1 REQUIRED owner/admin action + measurable event/history | Core product problem cannot be measured if status is schema-only | APPROVED 2026-08-28 |
| PD-014 | Blacklist | V1 OPTIONAL after no-show/history; if kept, define block/unblock and booking behavior explicitly | Current column alone is not a feature | APPROVED 2026-08-28 |
| PD-015 | Multi-branch | POST-V1 | Current provisioning is single-owner/single-shop and first beachhead is single-location | APPROVED 2026-08-28 |
| PD-016 | Medical clinics | Exclude from primary V1 positioning | Workflow/privacy/compliance scope differs materially | APPROVED 2026-08-28 |
| PD-017 | Production host routing | Keep canonical product host `bk01.wstera.com`; recommended public booking and admin paths under this canonical host with explicit two-Worker routing | Keeps portfolio convention while preserving separate Worker deployments | APPROVED 2026-08-28 |
| PD-018 | Ticket module | Classify as V1 operational/support capability, not lead marketing feature | Real implementation exists but does not differentiate booking purchase | APPROVED 2026-08-28 |

## Pricing architecture recommendation

Do not price database rows. For paid tiers, monetize operational value and variable-cost automation:
- trial/free: capacity-limited for evaluation/abuse control;
- paid booking volume: unlimited or a high fair-use ceiling that normal ICP shops will not hit;
- LINE messaging: default WSTERA Central OA is bundled with the monthly service; final managed-message fair-use/allowance is locked at the commercial gate; merchant-owned OA remains an optional managed add-on with separate setup/management cost;
- auto-slip verification: explicit monthly allowance/top-up because it has provider variable cost;
- staff/provider or advanced operations may differentiate tiers only if the ICP values the distinction.

Exact prices remain pending until the V1 bundle and cost model are known.

## Approval record

Owner approved the full recommendation set as a group on 2026-08-28. Each recommendation is now authoritative product intent for BK-0 and must be reflected in the numbered SSOT documents.
After approval, each accepted item must be rewritten as a dated decision record with:
`Decision → alternatives rejected → evidence/rationale → impacted documents → BK-A implementation consequence`.

Approval consequences:
- `00_PRODUCT_VISION.md`, `01_PRD.md`, `04_PRICING_ENTITLEMENTS.md`, `05_BOOKING_DOMAIN_RULES.md` and dependent documents may now be drafted and marked LOCKED when internally consistent;
- approved decisions define target V1 product contract, but marketing must still distinguish TARGET V1 from CURRENT IMPLEMENTATION until BK-A closes the gap;
- no implementation work is authorized by this file.


## Locked decision records

### PD-001 — Primary ICP
**Decision:** Hair/barber/beauty/nail, one location, ~1–10 providers.
**Rejected:** generic “all service businesses”; clinic-first; multi-branch-first.
**Rationale:** strongest current domain fit and market evidence.
**Impact:** Vision, PRD, positioning, GTM; BK-A avoids vertical-specific scope creep.

### PD-002 — Paid booking capacity
**Decision:** retire 100/500 paid booking value walls; paid usage is effectively unlimited for normal ICP with fair-use protection.
**Rejected:** legacy hard quota as pricing differentiator.
**Rationale:** direct competitors provide unlimited or materially higher capacity; rows are not the value.
**Impact:** pricing, entitlement migration/UI, marketing wording and quota tests.

### PD-003 — Final price
**Decision:** ฿490/฿990 remain pilot reference prices, not final public price.
**Rejected:** immediate undercut; declaring legacy prices final without WTP/cost evidence.
**Rationale:** Pro value/cost contract is incomplete until BK-A/pilot.
**Impact:** paid public launch remains blocked until commercial lock.

### PD-004 — Auto-slip
**Decision:** Pro automatic verification is V1 Required before Pro public sale.
**Rejected:** sell now and deliver later; remove automation from Pro permanently.
**Rationale:** competitor parity and manual-work value proposition.
**Impact:** provider selection, cost allowance, failure-state implementation and tests in BK-A.
### PD-005 — LINE architecture
**Owner override — 2026-09-08:** WSTERA Central OA is the default notification path for Trial/Basic/Pro and is bundled with the monthly BK01 service. A merchant may optionally use its own LINE OA as a managed add-on; WSTERA may charge additional setup/management/support fees. Exact add-on price and Central OA fair-use/message allowance remain for commercial lock.
**Supersedes:** the 2026-08-28 rule that paid production defaults to merchant-owned OA.
**Rejected:** requiring every paid merchant to bring its own OA; exposing raw channel credentials in ordinary shop/client data.
**Impact:** default onboarding uses WSTERA Central OA; merchant-owned credentials remain server-side and optional; pricing/operations must distinguish bundled central messaging from the managed merchant-OA add-on.

### PD-006 — Staff identity
**Decision:** explicit auth-user→staff mapping; staff sees own bookings/schedule only.
**Rejected:** generic shop membership as sufficient staff scope.
**Impact:** schema/RLS/RPC/UI remediation and cross-role negative tests.

### PD-007 — Slip storage
**Decision:** private bucket with authorized/signed reads.
**Rejected:** permanent public object URLs.
**Impact:** storage policy, persisted reference format, admin preview and privacy tests.

### PD-008 — Annual billing
**Decision:** POST-V1.
**Rejected:** UI-only yearly discount backed by monthly-only checkout.
**Impact:** remove annual V1 UI/copy; future ADR when true annual Stripe prices exist.

### PD-009 — Customer reschedule/cancel
**Decision:** V1 Required, policy-guarded and audited.
**Rejected:** shop-only change workflow; silent slot mutation.
**Impact:** transactional domain API, recovery UX, notifications, analytics and tests.

### PD-010 — Automated reminders
**Decision:** V1 confirmation + at least one pre-appointment reminder with sent/failed evidence.
**Rejected:** confirmation-only or undocumented best-effort messaging.
**Impact:** scheduler/delivery mechanism, retry evidence and notification metrics.

### PD-011 — PromptPay QR
**Decision:** controlled BK01 generation; no public `promptpay.io` runtime dependency.
**Rejected:** third-party public image URL as production dependency.
**Impact:** QR library/service selection and deterministic tests.

### PD-012 — Data portability
**Decision:** V1 core CSV export + closure/deletion request process.
**Rejected:** support-only ad hoc export; lock-in by omission.
**Impact:** export surface, support/privacy procedure and release evidence.
### PD-013 — No-show
**Decision:** V1 explicit owner/admin action + audit/analytics event.
**Rejected:** schema-only status or automatic inference from elapsed time.
**Impact:** dashboard action, authorization and KPI truth.

### PD-014 — Blacklist
**Decision:** V1 Optional only after explicit block/unblock and booking behavior exist.
**Rejected:** treating an unused boolean column as a shipped feature.
**Impact:** no marketing claim until full flow/test evidence exists.

### PD-015 — Multi-branch
**Decision:** POST-V1.
**Rejected:** expanding provisioning/tenancy before single-location product fit.
**Impact:** single-shop V1 contract remains deliberate.

### PD-016 — Medical clinics
**Decision:** excluded from primary V1 positioning.
**Rejected:** generic clinic claim based on appointment similarity.
**Impact:** marketing/ICP and privacy scope remain non-medical.

### PD-017 — Production host
**Decision:** canonical technical host `bk01.wstera.com`, preserving explicit two-Worker routing.
**Rejected:** stale Pages-era host conventions or merging security boundaries for URL simplicity.
**Impact:** deployment/routing plan and auth/provider callback configuration.

### PD-018 — Ticket module
**Decision:** V1 operational/support capability, not lead marketing feature.
**Rejected:** using internal support complexity as purchase differentiation.
**Impact:** retain/test support module while keeping positioning booking-focused.

## Owner approval evidence
The owner explicitly approved the full recommendation set in conversation on 2026-08-28. No individual override was supplied. Any later change to these locked decisions requires a dated decision update or ADR and downstream traceability review.
