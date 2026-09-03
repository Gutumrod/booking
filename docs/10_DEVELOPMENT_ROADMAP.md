# BK01 Development Roadmap

**Status:** LOCKED — derived from BK-0 product truth
**Rule:** Historical phases are evidence only; this roadmap governs future build order.

**2026-09-03 reconciliation:** Booking Stage 4 Option A migration-history reconciliation is complete at `836943a` and must not be repeated. Portfolio P0a-C1 is PASS, so BK01 is eligible to resume as the next heavy implementation track. BK-A remains open for CONT-03 remediation/independent review; DB-backed CONT-04 gates remain blocked until an approved PostgreSQL/Supabase runtime is available.

**2026-09-03 CONT-03 verification:** All non-DB gates re-verified at HEAD `908108c` (working tree clean): `npm test` 19/19 PASS, `npm run lint` PASS (0 errors/13 warnings), `npm run build` PASS (consumer+admin), `git diff --check` PASS, static absence checks PASS (no `promptpay.io`, no annual offer, no legacy 100/500 paid claim, no unsupported absolute claim), secret scan PASS (no real secrets in changed app files). DB-backed gates G2 and DB portions of G3–G9 remain BLOCKED_ENVIRONMENT (no local PostgreSQL, no Docker per brief).

## BK-A — V1 Contract Remediation

**2026-08-29 status:** implementation candidate completed for all non-provider-decision items; unit/static, lint, and production builds pass. BK-A is not release-complete because local database replay/pgTAP and DB-backed G2–G9 acceptance are blocked by unavailable local PostgreSQL. BK-B remains closed. Evidence: `docs/audit/BK-A-IMPLEMENTATION-EVIDENCE-2026-08-29.md`.
Close all baseline→target gaps before public sale:
1. private deposit-slip storage + authorized read path;
2. explicit auth-user→staff identity and staff self-scope;
3. remove annual billing UI/copy and reconcile monthly-only checkout;
4. retire legacy paid 100/500 booking value walls from entitlement logic/UI;
5. merchant-owned LINE OA production secret boundary + central OA trial mode;
6. confirmation + pre-appointment reminder delivery/retry evidence;
7. Pro automatic slip verification provider integration, allowance and fail-safe review;
8. controlled PromptPay QR generation without `promptpay.io`;
9. customer self-reschedule/cancel with policy + audit + atomic collision checks;
10. completion/no-show actions + canonical analytics events;
11. owner CSV export + deletion/account-closure request path;
12. restrict ticket/support operations to owner/admin per PD-006 and verify platform-admin/support audit behavior;
13. remove or replace unsupported absolute public copy such as `ปลอดภัย 100%`, using only claims backed by `SHIPPED-VERIFIED` evidence;
14. reconcile all commercial surfaces with PD-002/PD-003/PD-008: remove annual and legacy 100/500 booking copy and do not present ฿490/฿990 as final public prices.

## BK-B — Pilot Readiness
- staging/production-like release rehearsal;
- privacy/legal checklist closure required for pilot data;
- pilot onboarding instrumentation;
- support playbooks and incident rehearsal;
- 5–15 qualifying single-location pilot shops targeted for evidence collection;
- capture time-to-first-value, support burden, booking integrity, deposits, notifications and WTP.

## BK-C — Commercial Lock
- refresh competitors;
- approve final Basic/Pro monthly prices;
- approve auto-slip/managed-message allowances and top-up economics;
- validate landing-page claims against pilot evidence;
- finalize paid launch funnel and support expectations.

## BK-D — Public V1 Launch
Release only after all `09_TEST_RELEASE_GATES.md` gates pass, legal/privacy launch blockers close, pricing is owner-approved and independent reviewer returns PASS.

## Post-V1 candidates
Annual billing, multi-branch, advanced CRM/marketing automation, marketplace/discovery, broader APIs/webhooks, waitlist, deeper calendar sync, advanced analytics and non-primary vertical workflows. Medical clinics remain excluded until a separate compliance/workflow decision.
