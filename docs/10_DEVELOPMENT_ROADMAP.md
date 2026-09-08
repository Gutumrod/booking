# BK01 Development Roadmap

**Status:** LOCKED — derived from BK-0 product truth
**Rule:** Historical phases are evidence only; this roadmap governs future build order.
**2026-09-06 CONT-04 closure:** CONT-04 DB-backed runtime gates are CLOSED: verdict `CONT04_PASS` at git HEAD `6e1c0c6` (2026-09-06). Evidence: 29/29 migration replay PASS, pgTAP 26/26 PASS (extension removed after run), fixture residue 0; runtime gates G3 8/8, G4 10/10, G5 22/22, G6A 10/10, G6B 8/8, G7 8/8, G8 9/9, G9 9/9 — all PASS. Runtime: WSTERA Lab (ykxlqnshaaxmzzocpjlj) only; production not accessed; changes not pushed. Frozen evidence: `.secretary-relay/t_ef1cef98/CONT04-FINAL-EVIDENCE-2026-09-06.json` and `.secretary-relay/t_ef1cef98/G8-EVIDENCE-2026-09-06.json`. The `BLOCKED_ENVIRONMENT` records in the 2026-09-03 entries below are historical point-in-time evidence and are superseded prospectively by this CONT04_PASS closure.

**2026-09-06 BK-SR-03 current state:** staging isolation is committed at `e65366f`; fresh local verification passes tests 20/20, lint with 0 errors, consumer/admin builds, production audit 0 vulnerabilities, and staging-boundary checks. External Cloudflare deploy/smoke/rollback plus LINE/Stripe V1 rehearsal are not yet proven. Cloudflare OAuth is authenticated and Owner approved shared `wstera-lab` (`ykxlqnshaaxmzzocpjlj`) as BK01's non-production runtime; its remote BK01 migration history matches local `29/29`. Current verdict: `BLOCKED_PENDING_STAGING_SECRETS`. Continue only after `.env.staging.local` is populated with `wstera-lab` API values plus non-production LINE OA and Stripe test credentials; `.env.local`, production/KMO credentials and project-global shared resources are forbidden shortcuts.

**2026-09-06 BK-SR-02 closure:** the transitive production audit finding was remediated by resolving `qs` from `6.15.3` to `6.16.0` in `package-lock.json` only. Exact release checkpoint `d2ee14f` passes `npm ci`, production audit (0 vulnerabilities), unit/static 19/19, lint (0 errors; 13 existing warnings), consumer/admin production builds, and exact clean-clone reproducibility. BK-SR-02 / BK-B is CLOSED. Evidence: `docs/audit/BK-SR-02-RELEASE-READINESS-EVIDENCE-2026-09-06.md`. Next gate: BK-SR-03 staging + external-system rehearsal.

**2026-09-06 Build-to-Sell reconciliation:** CONT-04 is CLOSED/PASS (`CONT04_PASS`) on approved WSTERA Lab. Final evidence records migration history 29/29, pgTAP 26/26 PASS, G3-G9 accepted, fixture residue 0, unit 19/19, lint PASS, and both production builds PASS; production was not accessed. BK-A is therefore CLOSED at release baseline `6e1c0c6`. The next bounded gate is BK-SR-02 / BK-B release and repository readiness; staging/external-system rehearsal follows only after that evidence review. See `docs/audit/CONT04-CLOSURE-EVIDENCE-2026-09-06.md`.

**2026-09-05 Owner Order-capability overlay:** BK01 is the active portfolio heavy track under the parent Codex production master plan. Existing Booking V1 hardening/release remains the heavy-track spine and resumes now. Order Phase 0A/0B documentation is now COMPLETE/LOCKED with `Reuse Gate: PASS` and MT01 Bootstrap Check PASS; the bounded slot is returned. Order implementation is not authorized and must not delay the current Booking V1 release path. Default trigger is after the Booking V1 release/pilot Owner decision. Earliest exception still requires BK-A + BK-B closure, the locked Order contracts, isolated migration baseline, and explicit Owner overlap/risk authorization. Canonical parent references: `docs/council-bk01-order-capability-2026-09-05/OWNER-OVERRIDE-AND-CORRECTION-2026-09-05.md` and `docs/strategy/BK01-EXECUTION-PRIORITY-2026-09-05.md`; canonical Order contract pack is under `docs/order/`.

**2026-09-03 reconciliation:** Booking Stage 4 Option A migration-history reconciliation is complete at `836943a` and must not be repeated. Portfolio P0a-C1 is PASS, so BK01 is eligible to resume as the next heavy implementation track. CONT-03 non-DB remediation/independent review is CLOSED/PASS; BK-A remains open only for DB-backed CONT-04 gates until an approved PostgreSQL/Supabase runtime is available.

**2026-09-03 CONT-03 verification:** All non-DB gates re-verified at HEAD `908108c` (working tree clean): `npm test` 19/19 PASS, `npm run lint` PASS (0 errors/13 warnings), `npm run build` PASS (consumer+admin), `git diff --check` PASS, static absence checks PASS (no `promptpay.io`, no annual offer, no legacy 100/500 paid claim, no unsupported absolute claim), secret scan PASS (no real secrets in changed app files). DB-backed gates G2 and DB portions of G3–G9 remain BLOCKED_ENVIRONMENT (no local PostgreSQL, no Docker per brief).

## BK-A — V1 Contract Remediation

**2026-08-29 status:** implementation candidate completed for all non-provider-decision items; unit/static, lint, and production builds pass. BK-A is not release-complete because local database replay/pgTAP and DB-backed G2–G9 acceptance are blocked by unavailable local PostgreSQL. BK-B remains closed. Evidence: `docs/audit/BK-A-IMPLEMENTATION-EVIDENCE-2026-08-29.md`.

**2026-09-08 LINE update:** live WSTERA Central OA staging acceptance is PASS: UID binding/reuse, confirmation, 24h reminder, reschedule, cancel, idempotent dispatch and capped provider retry are proven. Merchant-owned OA is no longer a V1 prerequisite; it is an optional managed add-on under Owner override PD-005. Remaining external commercial blockers are Pro auto-slip, Stripe rehearsal/closure, and final pricing terms. BK-B repository-readiness gate is CLOSED at exact release checkpoint `d2ee14f`; BK-SR-03 staging/external-system rehearsal is the current active gate.

Close all baseline→target gaps before public sale:
1. private deposit-slip storage + authorized read path;
2. explicit auth-user→staff identity and staff self-scope;
3. remove annual billing UI/copy and reconcile monthly-only checkout;
4. retire legacy paid 100/500 booking value walls from entitlement logic/UI;
5. WSTERA Central OA default production notification path + server-side secret boundary; merchant-owned OA remains optional managed add-on;
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
