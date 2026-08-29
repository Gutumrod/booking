# BRIEF — BK-0 Product Documentation & Market Lock

**Product:** BK01 — `booking`
**Repository:** `Gutumrod/booking`
**Baseline branch:** `main`
**Baseline commit:** `e99615d`
**Date:** 2026-08-28
**Status:** SPECIAL DOCUMENTATION REMEDIATION BRIEF — NO PRODUCT IMPLEMENTATION AUTHORIZED

## Mission
Rebuild BK01's documentation into a production-grade SaaS source-of-truth set before BK-A or any production deployment.

This phase exists because the current repository contains strong booking-domain rules and mature implementation evidence, but the documentation is phase-grown, internally inconsistent, partially stale, and incomplete as a product/production/commercial contract.

The output must be strong enough that a new engineer, reviewer, operator, marketer, or support person can answer what BK01 is, who it is for, what V1 does, what it explicitly does not do, how every role behaves, how billing and entitlements work, how production is operated, and how it is positioned and launched — without guessing from code or old handoff notes.
## Hard Boundaries
- Documentation and evidence only.
- Do **not** change application code, SQL migrations, RLS, API routes, Stripe configuration, LINE configuration, Cloudflare configuration, DNS, production data, or production secrets.
- Do **not** deploy.
- Do **not** merge, delete, or rewrite branches.
- Do **not** silently "fix" a contradiction by choosing whichever document sounds newer.
- When code, database, current docs, and historical evidence disagree, record the conflict and resolve it through explicit Product Decision / ADR evidence.
- Never expose secret values. Environment-variable names may be inventoried; values may not be copied into documentation.
- Do not commit or push until an independent documentation review returns PASS and the owner explicitly authorizes it.

## Core Principle
**Evidence before prose.** Existing docs are inputs, not truth by declaration. Code, migrations, live-safe evidence, provider behavior, market evidence, and explicit owner decisions must be reconciled before new documents are marked LOCKED.

## Authority Goal
At BK-0 completion, `DOCUMENTATION_INDEX.md` must define a single unambiguous authority order. Old phase reports and handoffs become historical evidence, not competing product specifications.
## Mandatory Input Audit
Read every current product-governing document in full before drafting replacements, including at minimum:
- `PRODUCT_RULES_V1.md`
- `README.md`
- `PROJECT_HANDOVER_BRIEF.md`
- `docs/business/OFFICIAL_BUSINESS_MODEL.md`
- `docs/business/PRICING_SPEC.md`
- `docs/technical/ARCHITECTURE_SECURITY_STANDARD.md`
- `docs/technical/STRIPE_SUBSCRIPTION_STATE_MACHINE.md`
- `docs/technical/BRIEF_PHASE_E4_STRIPE_BILLING.md`
- `docs/technical/PHASE_LAUNCH_1_COMPLETION_REPORT_2026-08-12.md`
- `docs/platform/PHASE_0_BASELINE_SNAPSHOT_2026-08-20.md`
- every migration under `supabase/migrations/`

Also inspect the current application surfaces in `apps/booking-consumer` and `apps/booking-admin` for actual routes, roles, states, error paths, billing behavior, LINE behavior, ticket/support behavior, and platform-admin capability.

Do not accept phrases such as "100% complete", "passed", or "official" without checking whether the underlying state still matches `main` at the named baseline.
## BK-0A — Truth Reconciliation
Create `docs/audit/CURRENT_TRUTH_AND_CONTRADICTIONS.md` before rewriting the product specification.

For every material disagreement record: topic, source A, source B, observed code/DB reality, user/business impact, proposed resolution, required owner decision, and final disposition.

Mandatory contradictions to verify include:
1. Basic-plan LINE entitlement differs between `PRODUCT_RULES_V1.md`, pricing, and business-model docs.
2. Auto-slip is sold in pricing while `PRODUCT_RULES_V1.md` says it is outside V1.
3. Automatic card billing is described as V4 in old rules while Stripe Checkout/Billing/Portal/Webhooks exist now.
4. Custom shop LINE token input appears in old product rules but was removed for security in later implementation/evidence.
5. Slip-storage contract says private/signed URLs while the Phase-0 live baseline records a public `deposit-slips` bucket; allowed MIME types also differ.
6. Old deployment strategy says Cloudflare Pages while current repo uses OpenNext Cloudflare Workers.
7. Old domain/non-goal statements conflict with the portfolio decision that BK01 canonical technical host is `bk01.wstera.com`.
8. Old "known issues" sections describe frontend/Stripe/LINE/Supabase as mocks or missing although later implementation exists.
9. Staff role rules promise "own schedule/own bookings" while authenticated-user-to-staff identity mapping must be verified as actually enforceable.
10. Any duplicate Stripe billing truth, trial state, grace period, cancellation behavior, quota rule, or top-up rule across migrations/docs.

No LOCKED document may be produced while a P0/P1 contradiction affecting security, billing, entitlement, tenant isolation, customer money, or public product claims remains unresolved.
## BK-0B — Market & Competitive Intelligence Gate
This is mandatory and must finish **before** final positioning, pricing, packaging, or V1 feature boundaries are locked.

### Research standard
- Use current public evidence as of execution date; record retrieval date for every material source.
- Prefer official competitor product/pricing/help pages over comparison blogs.
- Separate observed facts from inference.
- Never treat competitor marketing claims as verified outcomes without independent evidence.
- For changing prices/features, capture currency, billing cadence, VAT/fees, trial terms, quota definition, and source date.
- If a competitor hides price or a feature cannot be verified, mark `UNKNOWN`; do not infer it.
- Search both Thai and English sources.
- Archive a concise source ledger with page title/domain/date/fact used so the analysis can be refreshed later.

### Market layers
Research three layers independently:
1. **Direct Thailand LINE-first booking competitors.**
2. **Global appointment/booking SaaS available as alternatives to Thai merchants.**
3. **Substitutes:** manual LINE/DM + Google Calendar/Sheets, marketplace booking, custom software, and walk-in/queue tools.
### Minimum competitor set
Thai/direct candidates to verify, not blindly accept as exhaustive:
- Onque
- MeQueue
- JongQ
- QueueBooking
- Bookio
- Booking Whale
- EikQueue
- FoxConnect
- Bangkok Boost or another current LINE-first Thai service-business system if more relevant at execution time

Global candidates:
- Fresha
- SimplyBook.me
- Setmore
- Booksy
- at least one additional global scheduling alternative relevant to the selected beachhead segment

If stronger/newer competitors are found, add them. Do not keep a weak candidate just to preserve this list.

### Competitive matrix fields
For every competitor capture: target segment, positioning, monthly/annual price, free plan/trial, booking quota, staff/provider limit, locations/branches, LINE integration mode, customer app requirement, booking page/LIFF behavior, deposit/payment support, PromptPay/Thai QR support, automatic slip verification, reminders, customer CRM/history, reschedule/cancel rules, waitlist, calendar sync, reports/analytics, API/webhooks, export/data portability, support/onboarding, marketplace/discovery, commission/transaction fees, branding/custom domain, and notable trust/privacy claims.
### Research seed observed on 2026-08-28 — MUST be re-verified during execution
The brief was commissioned after a current-market sweep found that BK01 is not entering an empty Thai LINE-booking niche:
- Onque advertises entry pricing from ฿299/month, 30-day trial, LINE-first booking, deposit/slip flows, and unlimited-booking positioning on some plans.
- MeQueue advertises Free, Pro around ฿399/month, and Business around ฿599/month, with LINE OA booking and deposit-related capability.
- JongQ advertises a single-feature-rich plan around ฿499/month or discounted annual billing, with LINE booking and reminders.
- QueueBooking advertises Free 50 bookings/month, Professional around ฿990/month and Business around ฿2,490/month, with LINE and PromptPay deposit messaging.
- Bookio advertises Free and Growth around ฿990/month with LINE booking/reminders.
- Global products show materially different pricing models: per-provider (Fresha/Booksy), booking-volume/custom-feature tiers (SimplyBook.me), and free/unlimited-appointment models (Setmore).

These observations are **not** the final market analysis and must not be copied into pricing decisions without source re-check. Their purpose is to prove that BK01's existing 490/990 package logic, quota model, LINE differentiation, and no-show positioning require explicit competitive validation.

### Required output
Create `docs/market/COMPETITIVE_LANDSCAPE_2026.md` with:
- sourced competitor matrix;
- feature parity/gap map;
- price architecture comparison;
- "where BK01 wins / ties / loses" analysis;
- switching-cost and onboarding comparison;
- defensibility assessment;
- claims competitors make that BK01 must not copy without evidence;
- refresh date and evidence ledger.
## BK-0C — Thailand Market Definition & Evidence
Create `docs/market/MARKET_AND_SEGMENTATION_2026.md`.

### Source priority
Use primary/official sources where possible:
- OSMEP / SME Open Data for Thai MSME counts and business categories.
- Department of Business Development and/or NSO for establishment/business-category evidence.
- Bank of Thailand for PromptPay / Thai QR usage and payment infrastructure facts.
- LINE / LY Corporation / LINE for Business for current Thailand platform evidence where available.
- Provider documentation for LINE Messaging API constraints and pricing.
- Secondary research may supplement but must be labelled secondary.

### Required questions
- What exact market is BK01 in: appointment scheduling, LINE-first booking, queue management, service-business operations, or a narrower combination?
- Which Thai business categories have the strongest fit and why?
- Which categories should be excluded from V1 because their workflow is structurally different?
- Is the strongest beachhead barber/salon/beauty, spa/massage, clinic, car care/repair, tattoo/studio, fitness/coaching, or another segment?
- What job is being replaced: chat scheduling, spreadsheet/calendar, existing booking SaaS, or marketplace?
- What triggers a business to pay rather than continue manually?
- What objections block adoption: setup, customer behavior, LINE OA setup, deposit trust, price, data ownership, staff training, or switching cost?
### Market sizing discipline
- Produce TAM/SAM/SOM only when defensible source inputs exist.
- Never multiply a guessed "number of shops" by a guessed conversion rate and call it market size.
- Show formulas and assumptions separately from sourced facts.
- Use ranges when source classifications do not map cleanly to BK01's actual ICP.
- Distinguish registered legal entities from informal/self-employed service businesses.
- Distinguish addressable businesses from businesses likely to pay for booking SaaS.
- Record confidence level for every important market estimate.

### Market evidence already worth validating
Bank of Thailand evidence confirms PromptPay is mature national payment infrastructure and, in 2026, reported very high transaction volumes. This supports researching PromptPay as a Thailand-native workflow advantage, but it does **not** by itself prove that deposit booking increases conversion or reduces no-shows for BK01's ICP.

Create `docs/market/ICP_JTBD.md` containing:
- primary ICP and secondary ICP;
- business size/staff/booking-volume bands;
- current workaround;
- trigger event;
- primary job-to-be-done;
- functional, emotional, and operational pains;
- willingness-to-pay hypothesis with evidence status;
- disqualifying conditions;
- interview/pilot questions for assumptions that public data cannot prove.
## BK-0D — Product Contract Pack
After BK-0A/B/C evidence exists, create or replace the numbered source-of-truth set:
1. `docs/00_PRODUCT_VISION.md` — problem, audience, value, category, principles, non-goals.
2. `docs/01_PRD.md` — complete functional + non-functional requirements with stable IDs.
3. `docs/02_SYSTEM_ARCHITECTURE.md` — runtime boundaries, data flow, failure behavior, deployment topology.
4. `docs/03_DATA_SECURITY_TENANCY.md` — identity, roles, tenant isolation, RLS, privileged boundaries, storage, audit, data lifecycle.
5. `docs/04_PRICING_ENTITLEMENTS.md` — authoritative plans, prices, quotas, top-ups, trial, upgrade/downgrade/cancel/grace rules.
6. `docs/05_BOOKING_DOMAIN_RULES.md` — hold, availability, collision, deposit, reschedule, cancellation, no-show, blacklist, quota semantics.
7. `docs/06_UX_USER_FLOWS.md` — end-to-end flows and error/recovery states for customer, owner, admin, staff, platform operator.
8. `docs/07_ANALYTICS_KPI_SPEC.md` — event taxonomy, metrics, activation, first value, retention, conversion, no-show measurement.
9. `docs/08_EXTERNAL_DEPENDENCIES.md` — Supabase, Stripe, LINE, Cloudflare, email/auth delivery and any slip provider.
10. `docs/09_TEST_RELEASE_GATES.md` — acceptance evidence for every requirement and release gate.
11. `docs/10_DEVELOPMENT_ROADMAP.md` — BK-A onward, derived from locked product truth rather than historical phases.

Do not preserve old wording for compatibility when it is wrong. Preserve historical evidence by archiving/reclassifying it, not by allowing two current truths.
## Mandatory Feature/Function Completeness Matrix
Create `docs/audit/FEATURE_REQUIREMENT_TRACEABILITY.md`.

Every user-visible or operational capability found in code, migrations, pricing, marketing, or old specs must have exactly one disposition: `V1 REQUIRED`, `V1 OPTIONAL`, `POST-V1`, or `RETIRED`.

Each row must map:
`Feature → user/role → requirement ID → entitlement → authoritative data/RPC/API → UX flow → negative/error states → analytics event → test evidence required → marketing claim allowed`.

At minimum cover:
- signup, verification, login, recovery, logout, session expiry;
- shop provisioning/onboarding and slug/URL lifecycle;
- services, staff, service/staff assignment, schedules, breaks, closures/time-off;
- customer booking, any-staff selection, hold/expiry, overlap/collision, deposit/no-deposit, slip submit/reject/verify;
- confirmation, cancellation, reschedule, completion, no-show, blacklist/customer history;
- owner/admin/staff role boundaries and staff-self identity behavior;
- LINE linking, receipts, reminders, failure/retry behavior and central-vs-shop OA policy;
- subscription, trial, checkout, portal, billing failure, grace, cancellation, quota, top-up;
- tickets/support, platform-admin, suspension, manual override, impersonation/support access, audit trails;
- data export, deletion, retention, account closure and recovery behavior;
- Thai/English, timezone/date/calendar, mobile/browser/accessibility expectations.

A feature is not considered documented if only the happy path is described.
## BK-0E — Marketing & Commercial Pack
Create:
- `docs/marketing/POSITIONING_MESSAGING.md`
- `docs/marketing/GO_TO_MARKET.md`
- `docs/marketing/LAUNCH_PLAN.md`
- `docs/marketing/KPI_METRICS.md`

### Positioning must be evidence-constrained
Define category, primary ICP, beachhead segment, alternatives, pain hierarchy, differentiated value pillars, objections, switching narrative, landing-page order, CTA baseline, and explicit `WHAT_WE_DO_NOT_CLAIM`.

The existing statement "ขจัดปัญหา No-show 100%" is prohibited unless real controlled evidence supports it. Prefer measurable language such as "ลดงานตามคิว", "ช่วยคัดคิวด้วยมัดจำ", or a quantified reduction only after pilot evidence exists.

### GTM must not be a channel list
Define acquisition sequence, why each channel fits the ICP, offer, onboarding burden, funnel, conversion points, pilot cohorts, case-study evidence standard, referral timing, paid-acquisition readiness gate, stop conditions, and feedback-to-ADR process.

At minimum compare whether BK01 should lead with: PromptPay deposit, LINE-native workflow, central LINE zero-setup, scheduling integrity, Thai-first operations, price simplicity, or another advantage discovered by market research. Do not choose before the competitive matrix is complete.
### Analytics/KPI requirements
`docs/07_ANALYTICS_KPI_SPEC.md` and `docs/marketing/KPI_METRICS.md` must agree on definitions.

At minimum define canonical events for:
- signup started/completed;
- shop provisioned;
- service/staff/schedule setup completed;
- booking link published/opened;
- availability viewed;
- hold created/expired;
- deposit required/submitted/rejected/verified;
- booking confirmed/cancelled/rescheduled/completed/no-show;
- LINE link/notification sent/failed;
- checkout started/completed-authoritatively;
- subscription activated/past_due/cancelled;
- quota warning/exhausted/top-up consumed.

Define separately: acquisition, activation, first value, engagement, retention, trial-to-paid conversion, paid retention/churn, booking completion rate, cancellation rate, no-show rate, deposit adoption, notification success, support burden, and product reliability.

Do not call signup "activation". Proposed activation/first-value definitions must be justified by the actual customer job and pilot evidence plan.
## BK-0F — Production Operations Pack
Create:
- `docs/operations/DEPLOYMENT_RUNBOOK.md`
- `docs/operations/INCIDENT_RUNBOOK.md`
- `docs/operations/BACKUP_RESTORE_RUNBOOK.md`
- `docs/operations/SUPPORT_RUNBOOK.md`
- `docs/operations/LEGAL_PRIVACY_CHECKLIST.md`

### Deployment runbook
Must define local/staging/production boundaries, approved release artifact, database migration order, two-Worker deployment, `bk01.wstera.com` routing decision dependency, secret ownership, Supabase Auth redirect configuration, Stripe webhook registration, LINE callback configuration, smoke tests, rollback/forward-fix rules, and evidence record.

### Incident runbook
Define severity and playbooks for: cross-tenant exposure, booking collision/corruption, public booking outage, Stripe/webhook drift, LINE delivery failure, deposit/slip exposure, auth outage, DB/Supabase degradation, Cloudflare deployment error, quota mis-enforcement, and operator/admin misuse.

### Backup/recovery
Define backup owner/frequency/retention, restore rehearsal, RTO/RPO proposal requiring explicit approval, restoration verification, data-loss observation, migration failure handling, and evidence retention.
### Support and operator access
Support documentation must define who can view customer/shop data, when platform-admin access is allowed, how impersonation/support-view is audited, what actions are prohibited, escalation path, response expectations, and how a customer requests export/deletion/account closure.

### Legal/privacy checklist
This is a readiness checklist, not legal advice. It must identify what requires legal review before public launch, including at minimum:
- Privacy Policy and Terms of Service;
- PDPA lawful-basis/notice/consent questions applicable to customer and shop-owner data;
- processor/subprocessor inventory and data locations;
- retention and deletion rules for bookings, customer records, logs, tickets, auth data, billing records, and deposit-slip images;
- data export/correction/deletion request process;
- cookie/analytics consent requirements if non-essential tracking is introduced;
- breach/incident notification obligations requiring legal confirmation;
- merchant responsibility for deposit/refund/cancellation policy wording;
- prohibited marketing claims and evidence ownership.

Security documentation should map release verification to a recognized application-security baseline such as current OWASP ASVS, while keeping BK01-specific tenant and business invariants explicit.
## BK-0G — Document Governance & Change Control
Create:
- `docs/DOCUMENTATION_INDEX.md`
- `docs/PRODUCT_DECISIONS.md`
- `docs/ADR_TEMPLATE.md`
- `docs/MASTER_CHECKLIST.md`
- `docs/audit/DOCUMENTATION_AUDIT.md`
- `docs/audit/MARKET_SOURCE_LEDGER.md`

`DOCUMENTATION_INDEX.md` must define authority order and conflict rules.

`PRODUCT_DECISIONS.md` must record every locked decision with date, decision, alternatives rejected, reason, impacted docs, and whether owner approval was required.

Use ADRs for architecture/security decisions that would otherwise be re-litigated later.

Historical phase reports, handoffs, and completion evidence must be labelled historical/current-evidence appropriately. They may remain in the repository but must not override the numbered source-of-truth set.

All internal file links must be updated to the current repository paths; stale references to the old `local-service-booking-saas` workspace must be removed or explicitly marked historical.
## Execution Order
1. Baseline repo/branch/commit and inventory all current docs/routes/migrations.
2. Build `CURRENT_TRUTH_AND_CONTRADICTIONS.md`.
3. Perform market/competitor research and market-source ledger.
4. Produce `MARKET_AND_SEGMENTATION_2026.md`, `COMPETITIVE_LANDSCAPE_2026.md`, and `ICP_JTBD.md`.
5. Surface owner decisions required by evidence; do not bury them inside prose.
6. Lock Product Vision + PRD + Pricing/Entitlements + Booking Domain Rules first.
7. Then lock Architecture/Security, UX flows, Analytics/KPI, External Dependencies and Release Gates.
8. Then build Marketing/GTM/Launch and Operations packs from the locked product truth.
9. Build traceability matrix, documentation index, decisions log, checklist and final audit.
10. Run independent cross-document review against current code/migrations and current market evidence.

Parallel drafting is allowed only where documents do not depend on unresolved product decisions. Pricing, positioning and marketing claims must wait for the competitive and product-truth gates.

## Required Owner-Decision Queue
Do not assume answers for material product choices. Collect them in one explicit queue, ranked by whether they block documentation lock. Likely candidates include final Basic/Pro LINE entitlements, auto-slip V1 status/provider, central-vs-shop LINE policy, staff-login scope, slip-storage target, final pricing/quota architecture after market review, and consumer/admin production hostname/path routing under `bk01.wstera.com`.
## BK-0 Final Gate — Documentation Lock PASS
BK-0 passes only when all conditions below are true:
- No unresolved P0/P1 contradiction remains across product, billing, security, tenancy, storage, deployment, or marketing claims.
- Every V1 feature/function has a requirement ID and traceability row.
- Every role has an explicit authorization and UX contract.
- Pricing, entitlements, quotas, billing state, downgrade/cancel behavior, and marketing copy agree exactly.
- Market and competitor analysis is current, sourced, dated, and distinguishes fact from inference.
- ICP/beachhead is explicit; excluded segments and reasons are explicit.
- Product claims have evidence status; unsupported absolute claims are removed.
- Production architecture, external dependencies, failure modes, deployment, incident, backup/restore, support and legal/privacy readiness are documented.
- Analytics/KPI definitions are canonical and measurable.
- Test/release gates map back to requirements and include negative tenant/security paths.
- Old/stale docs cannot masquerade as current SSOT.
- `DOCUMENTATION_AUDIT.md` reports no unresolved material cross-document mismatch.
- Independent reviewer checks evidence rather than trusting the drafting agent's self-report.

**Only after BK-0 PASS may BK-A begin.**

## Final Deliverable Summary
The expected output is a coherent production documentation system, not a cosmetic rewrite. Expect roughly 20–30 maintained documents across product truth, market, marketing, operations, evidence and governance. Fewer files are acceptable if the same authority and coverage are achieved without creating giant mixed-purpose documents.
