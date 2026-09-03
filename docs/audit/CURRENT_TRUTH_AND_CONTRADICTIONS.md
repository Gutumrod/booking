# BK01 Current Truth & Contradictions

**Product:** BK01 — booking
**Baseline:** `main @ e99615d`
**Audit date:** 2026-08-28
**Status:** RESOLVED FOR DOCUMENTATION LOCK — baseline gaps moved to BK-A
**Scope:** Documentation/evidence only; no implementation changes authorized.

## 1. Audit method

This document reconciles current repository evidence before any new product specification is marked LOCKED.
Evidence priority used for observed reality: current code + latest migrations → current live-safe baseline evidence → current documents → historical handoffs.
A current implementation fact does not automatically become a desired product decision; material mismatches remain OPEN until explicitly decided.

Inputs reviewed in full include `PRODUCT_RULES_V1.md`, `README.md`, `PROJECT_HANDOVER_BRIEF.md`, business/pricing docs, architecture/security docs, Stripe state-machine docs, launch report, Phase-0 baseline, both current apps, and all 28 migrations under `supabase/migrations/`.

## 2. Baseline inventory

- Repository working branch: `main`; HEAD and local main both `e99615d` at audit start.
- Product apps: `apps/booking-admin` and `apps/booking-consumer`.
- Deployment configuration in both apps is OpenNext on Cloudflare Workers (`open-next.config.ts`, `wrangler.jsonc`).
- Current Worker names are `wstera-admin` and `wstera-consumer`.
- Database history contains 28 migrations through `20260819000000_quota_staff_topup_enforcement.sql`.
- The BK-0 brief and `.claude/settings.local.json` were untracked at audit start; neither changes runtime behavior.

## 3. Material contradiction register

| ID | Sev | Topic | Conflict | Observed current reality | Disposition |
|---|---|---|---|---|---|
| ENT-001 | P1 | Basic LINE entitlement | `PRODUCT_RULES_V1.md` gives Basic LINE booking/shop notifications; pricing/business docs exclude automatic LINE OA | Central LINE webhook exists, but package enforcement for LINE is not a coherent product contract | RESOLVED PD-005: merchant-owned OA for paid production; central OA trial/onboarding; exact managed allowance must be explicit |
| ENT-002 | P1 | Auto-slip | Product rules place auto-slip outside V1; pricing sells Pro auto-slip quota | Aug-19 migration defines auto-slip limits/top-ups, but no verification provider/flow was found | RESOLVED PD-004: V1 Required for Pro before sale; baseline gap assigned BK-A |
| LINE-001 | P1 | Custom shop token | Old rules/registration copy promise custom LINE token | Current implementation uses central `LINE_CHANNEL_SECRET`/`LINE_CHANNEL_ACCESS_TOKEN`; settings persist only `line_oa_id` | RESOLVED PD-005: merchant OA via server-side secret boundary; raw token UI/shop-row model rejected |
| SEC-001 | P1 | Deposit-slip privacy | Security/product docs require private storage/signed URLs | Migration creates public `deposit-slips`; consumer returns `getPublicUrl`; current accepted MIME is JPEG/PNG/WebP, 5 MB | RESOLVED PD-007: private storage target; baseline remediation required in BK-A |
| BILL-001 | P1 | Annual billing | Register UI advertises ฿4,900/฿9,900 yearly | Checkout route maps only monthly Stripe price env vars; E4 design scoped annual billing out | RESOLVED PD-008: annual POST-V1; remove V1 UI/copy in BK-A |
| BILL-002 | P1 | Billing generation | Old product rules defer automatic card billing to V4 | Stripe Checkout, Portal, webhook idempotency, subscription sync and booking gate exist now | RESOLVED: monthly Stripe billing is V1; old V4 statement historical |
| ROLE-001 | P1 | Staff self-scope | Rules promise staff sees own bookings/schedule | Auth identity maps user→shop membership only; no verified auth-user→staff row mapping; dashboard reads all shop bookings | RESOLVED PD-006: explicit mapping + own scope; BK-A blocker |
| ROLE-002 | P1 | Staff schedule control | Rules imply staff self-schedule | schedule RPC permits owner/admin only; staff is read-only | RESOLVED: V1 staff self-view only; owner/admin manage schedules unless later decision expands mutation |
| PROD-001 | P1 | Reschedule | Product/market expectations include rescheduling | No operational reschedule RPC/UI was found in current code/migrations | RESOLVED PD-009: V1 Required; BK-A implementation gap |
| PROD-002 | P1 | Reminders | Product/competitor positioning expects reminders | log event types exist, but no deployed scheduler/Edge Function was evidenced in Phase-0/current repo | RESOLVED PD-010: V1 Required; BK-A implementation gap |
| PROD-003 | P2 | No-show | `no_show` is a valid booking status | No current dashboard action/RPC dedicated to marking no-show was found | RESOLVED PD-013: V1 Required explicit action/analytics; BK-A gap |
| PROD-004 | P2 | Blacklist | `customers.is_blacklisted` exists | No current management UI/action and no booking rejection check based on blacklist was found | RESOLVED PD-014: V1 Optional; no claim until full flow exists |
| PAY-001 | P1 | PromptPay QR architecture | Architecture text describes controlled/server-side QR generation | Consumer currently loads QR from external `promptpay.io/<number>/<amount>.png` | RESOLVED PD-011: controlled BK01 generation; BK-A gap |
| DEP-001 | P1 | Deployment | Older docs describe Cloudflare Pages / old workspace | Current apps target two OpenNext Cloudflare Workers | RESOLVED PD-017: OpenNext Workers + canonical host; Pages strategy historical |
| HOST-001 | P1 | Canonical host | Old domain statements conflict with portfolio decision | Target technical host is `bk01.wstera.com`, but consumer/admin route split is not locked | RESOLVED PD-017: canonical host locked; two-Worker routing retained |
| OPS-001 | P2 | Platform admin | Old handoffs describe missing/mock platform admin | Real role gate + shop list, activation, trial extension and plan-label correction RPCs exist | RESOLVED: V1 operational capability with audited/minimum privilege contract |
| SUPPORT-001 | P2 | Tickets | Older product docs largely omit support-ticket capability | Ticket/timeline tables and guarded RPCs exist; current role/retention semantics need product disposition | RESOLVED PD-018: V1 operational/support, not lead marketing |
| QUOTA-001 | P1 | Booking quota | Pricing logic and later DB entitlement need one authority | Current DB limits: Free 50, Basic 100, Pro 500 confirmed bookings/month; top-up balance exists | RESOLVED PD-002: retire paid 100/500 value walls; trial 50 retained; BK-A entitlement gap |
| QUOTA-002 | P1 | Staff quota | Docs are not consistently aligned | Current DB limits: Free 5, Basic 5, Pro 10 staff | RESOLVED: Trial/Basic 5, Pro 10 retained |

## 4. Current booking-domain truth supported by code/migrations

- Booking persistence uses separate booking status and deposit status axes.
- Active booking statuses include `hold`, `pending_review`, and `confirmed`; terminal/status values also include completed, cancelled, no-show and expired.
- Deposit statuses include not-required, awaiting, submitted, verified, rejected and refunded.
- Deposit-required bookings start with a 15-minute hold; rejection resets a 15-minute hold.
- A database exclusion constraint prevents overlapping active bookings for the same staff member.
- Expired holds are cleared before conflicting new booking creation.
- Staff availability is fail-closed: a staff member without a matching working schedule row is unavailable.
- "Any staff" assignment chooses an eligible available staff member with lower same-day active-booking count first.
- Service duration CRUD accepts positive multiples of 15 minutes; consumer UI slot presentation must be reconciled separately from this invariant.
- Service-level deposit `0` is an explicit no-deposit override; it does not inherit shop default.
- Shop-wide and staff-specific holidays participate in booking availability.
- Booking creation is public only through guarded `create_booking_hold`; direct anonymous inserts were revoked by later hardening.
- Deposit approval/rejection/cancellation mutations require authenticated shop membership.
- Subscription state is stored in `subscriptions`, synchronized from Stripe events, and mirrored to legacy shop status for compatibility.
- Trial is initialized at 14 days. Current booking acceptance allows `trialing`, `active`, and `past_due`, and blocks canceled/incomplete/incomplete-expired/unpaid plus expired trial.
- Owner provisioning currently permits one owned shop per auth account and seeds `line_oa_id = 'central_booking_oa'`.
- Platform-admin plan update is an administrative label correction; comments explicitly state Stripe remains payment truth.

## 5. P0/P1 lock status

No verified current cross-tenant read/write bypass was established by this documentation audit. That is not a fresh penetration-test PASS.
The public deposit-slip contract is nevertheless a P1 privacy/security mismatch because current implementation intentionally exposes public object URLs while the intended security documentation says private/signed access.

**BK-0 contradiction status: RESOLVED AT PRODUCT-CONTRACT LEVEL.** Owner decisions now resolve every listed P1 product/security/entitlement choice. Several baseline implementation gaps remain BK-A release blockers; they are not unresolved documentation contradictions.

**BK-A implementation snapshot (2026-08-29):** the remediation migration, application paths, and static/unit coverage now exist. Build and lint pass, but database replay/RLS/pgTAP and real provider gates are blocked locally and are not accepted as PASS. See `BK-A-IMPLEMENTATION-EVIDENCE-2026-08-29.md`.

**CONT-03 verification (2026-09-03, HEAD `908108c`):** static absence re-verified on the real repo — no `promptpay.io` runtime, no annual offer, no legacy 100/500 paid claim, and no unsupported absolute claim (including `ปลอดภัย 100%`) on current V1 surfaces. This closes the static-copy portion of CLAIM-001 and COMM-001 at the code level; DB-backed authority evidence remains pending. See `BK-A-IMPLEMENTATION-EVIDENCE-2026-08-29.md`.

## 6. Downstream implementation gate

Market and competitor evidence was reviewed and the owner approved the full recommendation set on 2026-08-28. Numbered SSOT is now locked to that product contract. BK-A must remediate baseline implementation gaps before any public V1 release; commercial price lock, provider allowances, and legal/operations approvals occur at their explicitly documented downstream gates.


## 7. Additional baseline authorization gap found during independent review

| ID | Sev | Topic | Conflict | Observed current reality | Disposition |
|---|---|---|---|---|---|
| ROLE-003 | P1 | Staff ticket/support scope | Owner-approved PD-006 limits staff to own operational booking/schedule scope; current support contract assigns ticket operations to owner/admin | `20260818000000_local_service_tickets.sql` currently permits owner/admin/staff to read and mutate shop-wide tickets/timelines | RESOLVED BY PD-006: target V1 ticket operations are owner/admin only; current broad staff ticket access is a BK-A authorization remediation blocker |
| CLAIM-001 | P1 | Unsupported absolute security claim | Evidence-constrained positioning prohibits absolute security/outcome claims without owned proof | `apps/booking-consumer/messages/th.json` footer currently says `ปลอดภัย 100%` | RESOLVED AT CONTRACT LEVEL: remove or replace the unsupported absolute wording before public release; BK-0 does not invent replacement copy and BK-A must verify the public surface against `SHIPPED-VERIFIED` evidence |
| COMM-001 | P1 | Stale commercial UI/copy | PD-002 retires paid 100/500 booking walls, PD-003 keeps ฿490/฿990 provisional, and PD-008 makes annual billing POST-V1 | Registration still exposes yearly ฿4,900/฿9,900 and Pro 500-booking copy; locale files retain Basic 100-bookings/month copy; app surfaces show ฿490/฿990 without consistently stating pilot/reference status | RESOLVED AT CONTRACT LEVEL: approved pricing/entitlement target is unchanged; remove annual and legacy-quota copy and prevent provisional prices being presented as final during BK-A/commercial-launch remediation |

These findings do not reopen product decisions. They record baseline implementation/copy mismatches against approved role, pricing, billing and evidence-constrained marketing contracts.
