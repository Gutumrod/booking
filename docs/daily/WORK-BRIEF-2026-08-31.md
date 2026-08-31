# Daily Work Brief — 2026-08-31

**Project:** BK01 — Booking by WSTERA
**Priority:** Highest; close two P1 security/reliability defects first
**Verified on disk:** `feature/bk-a-v1-contract-remediation @ 021e06a`; pre-existing untracked `.claude/settings.local.json` and `docs/daily/2026-08-31.md`.

## Current state

- BK-A is not release-complete. CONT-03 requires remediation and a fresh independent verdict.
- CONT-04 is `BLOCKED_ENVIRONMENT` for G2 and DB-backed portions of G3–G9 because this machine has no usable local PostgreSQL/Supabase runtime.
- Stage 4 Option A migration-history reconciliation is recorded complete at commit `836943a`; 26 migration pairs reconciled, named Phase A migration hash matched, `seed_demo_shop = SELECT 1`, and two pending migrations were untouched.
- Last inherited app checks are 19/19 tests, lint with warnings only, and consumer/admin builds passing; these results predate the open P1 findings and are not CONT-03 acceptance.

## Work today, in order

1. Remediate RPC authorization, beginning with `reject_deposit_slip`: remove reliance on generic shop membership, enforce the locked staff/owner role contract inside SECURITY DEFINER functions, and audit broad function grants such as `GRANT ALL ON ALL FUNCTIONS TO authenticated`.
2. Make LINE paid-channel dispatch fail closed when subscription lookup errors, is ambiguous, or is unavailable; it must not fall back to trial/central OA in those cases.
3. Add negative tests for unauthorized RPC callers and subscription-lookup failure/ambiguity; prove no privileged mutation or central-OA delivery occurs.
4. Fix expired overlapping holds before authoritative reschedule collision enforcement, with regression coverage.
5. Clean branch-wide whitespace defects, then rerun `npm test`, `npm run lint`, `npm run build`, `git diff --check`, and `git diff --check main...HEAD`.
6. Obtain a fresh independent CONT-03 review. Update evidence/checklist/roadmap only with verified results and preserve CONT-04 as blocked where DB evidence is absent.

## Blocked / dependencies

- G2 and DB-backed G3–G9 require an approved clean PostgreSQL/Supabase environment for migration replay, pgTAP, tenancy, and concurrency gates.
- Do not install Docker on this machine under the current brief.
- CONT-03 cannot pass until both P1s and resulting regression findings are closed and independently reviewed.

## Do not repeat

- Do not redo Stage 4 migration reconciliation.
- Do not treat the old 19/19/build evidence as current acceptance.
- Do not commit `.claude/settings.local.json`.
- Do not commit/push, deploy, or apply migrations; Claude owns commits/pushes for this repo.

## Evidence to produce

- Code-level authorization matrix and negative test output for every affected RPC.
- LINE dispatch decision table and tests for success, missing subscription, lookup error, ambiguity, and trial behavior.
- Fresh full static/app gate outputs and both diff-check outputs.
- Independent CONT-03 review artifact.
- Updated `docs/audit/BK-A-IMPLEMENTATION-EVIDENCE-2026-08-29.md`, `docs/MASTER_CHECKLIST.md`, and `docs/10_DEVELOPMENT_ROADMAP.md` without claiming blocked DB gates.
