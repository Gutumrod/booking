# HOUSE BK01 G10 Truncation Audit + R3 Harness — 2026-10-02

**Status: SQL proof PASS; R3 harness HOLD. Local evidence only.** No LAB, production, GO, deploy, commit, or merge was performed. Claude ผู้คุม retains commit/merge ownership.

## Source-of-Truth References

- SQL base: `codex/bk01-g10-line-audit-20261002` at `9d5ca2bfd34dc50414c69536b9a6a6cd4bbf11fc`.
- New SQL work branch: `codex/bk01-g10-trunc-20261002`, based exactly on the SHA above; changes are uncommitted. App/harness integration pins the new tip files by SHA-256 in `D:/AI-Workspace/runtime/relay/house-20261002/codex/HOUSE-BK01-RC-HARNESS/20261002T141620367Z/pins.json`.
- App pin: `codex/bk01-rc-app2-20261002` at `c3fdf2fa6a47962e8324c56606e832145361e65a`.
- Harness SQL base: `2a772e46a5dca42df2bf23429552972d9396f49e`; F1 SQL pin: `9d5ca2bfd34dc50414c69536b9a6a6cd4bbf11fc`.
- PG17.11 W-1 evidence: `D:/AI-Workspace/runtime/reviews/codex-bk01-g10-trunc-20261002-r4/`.
- R3 evidence: `D:/AI-Workspace/runtime/relay/house-20261002/codex/HOUSE-BK01-RC-HARNESS/20261002T141620367Z/`.
- OpenCode F1 audit finding: `D:/AI-Workspace/vault/06-Agent-Logs/WSTERA-House/reports/REVIEW-opencode-HOUSE-BK01-G10-LINE-AUDIT-9d5ca2b-2026-10-02.md`.
- Production GO plan and AGY review: `D:/AI-Workspace/vault/06-Agent-Logs/WSTERA-House/PLAN-PRODUCTION-GO-BK01-2026-10-02.md` and `D:/AI-Workspace/vault/06-Agent-Logs/WSTERA-House/reports/REVIEW-agy-PLAN-PRODUCTION-GO-BK01-2026-10-02.md`.

## 1. Migration 170000 — implemented and proven

New files:

- `supabase/bk01-migrations/20261002170000_bk01_g10_line_binding_audit_truncate.sql`
- `supabase/rollback/20261002170000_bk01_g10_line_binding_audit_truncate.rollback.sql`
- `scripts/proofs/bk01-g10-truncate-pg17.mjs`
- `tests/bk01-g10-truncate-migration.test.ts`

The migration adds a `BEFORE TRUNCATE FOR EACH STATEMENT` audit trigger for `local_service.line_users`, recording one pre-image ledger row per LINE binding with actor, effective role, row, shop, customer, and old LINE ID. It preserves the pre-existing `service_role` TRUNCATE privilege. Customer INSERT and DELETE with a non-null `line_user_id` are audited. UPDATE audit triggers use `WHEN OLD.line_user_id IS DISTINCT FROM NEW.line_user_id`; a no-op update creates no ledger row. The existing update audit also avoids logging unchanged values.

### PG17.11 W-1 RED → GREEN

- Fresh W-1 replay of the reviewed predecessor reached the 160000 state. The new assertions were red before 170000: no-op UPDATE had produced an audit row (`rows=1`), TRUNCATE had no ledger entries, and customer INSERT/DELETE had no ledger entries. The existing 21-entry allowlist and TRUNCATE privilege were present at baseline.
- Applied 170000 with the non-superuser migration runner. All six checks passed: service_role TRUNCATE remains allowed; no-op UPDATE writes zero rows; TRUNCATE writes one audit row per each of two bindings and identifies `service_role`; customer INSERT and DELETE are recorded; effective `bk01_runtime` allowlist remains exactly 21 identities; existing local_service function owner/ACL delta is `[]`.
- Applied rollback: raw schema dump diff is `[]`, and the existing 160000 trigger set is restored. Reapplied 170000 and all six checks passed again.
- Full replay exited 0 and the temporary PG17.11 cluster was shut down.

Evidence files include `g10-truncate-baseline-results.json`, `g10-truncate-after-results.json`, `g10-truncate-rollback-raw-diff.txt`, `g10-truncate-green.log`, `g10-truncate-reapply-green.log`, and the before/after schema snapshots in the PG17 evidence directory above.

### Preserved invariants

- `service_role` still has TRUNCATE on `local_service.line_users`; no privilege revoke was added.
- Effective runtime RPC allowlist: exactly 21 identities.
- Existing function owner/ACL delta: `[]`.
- Rollback raw schema diff: `[]`.
- Forward migration hashes `20261002120000` through `20261002160000` match the requested base `9d5ca2bfd34dc50414c69536b9a6a6cd4bbf11fc` exactly. The new 170000 forward migration SHA-256 is `04c2be732353a7ac5c6abed2051770220057fba0f15f7ff8259c317e5b5c1b7b`; rollback SHA-256 is `db4bfa6864c75e20f00657a36ccdbaf9ca1554a625d850b2a79ae16fe7d6625b`.
- `npm test` on the isolated SQL branch: **345/345 pass**. `npm run db:bk01:policy`: PASS (14 migrations accepted; policy mutation probes 47/47; runtime authority 5/5; allowlist violating sets 3/3).

## 2. R3 browser harness — exercised, overall HOLD

The harness used app pin `c3fdf2fa6a47962e8324c56606e832145361e65a` and hash-verified migration/proof files from the new 170000 tip. It opened the authenticated Admin dashboard in a real Playwright browser: HTTP 200, DB-backed shop heading, and no page errors. DOM actions and resulting database state passed for:

- approve → `confirmed`
- reject → `rejected`
- refund → `refunded` with reference `RC-REFUND-REFERENCE`
- outcome `completed` → `completed`
- outcome `no_show` → `no_show`

R3 evidence records **17 PASS / 0 FAIL / 2 SKIP** across the e2e/proof rows. The two skips are hosted Auth/provider/Storage/Turnstile-hostname proof and LAB/production actions; those require external state and were not performed. App build, typecheck, and lint passed for both consumer and Admin. W-1 restore rehearsal exited 0; canonical constraint diff was empty. These are local harness results, not hosted or production evidence.

The overall harness result is **HOLD** because the assembled pinned-source test suite was **523/527** and two static checks failed:

1. `forward migrations exist in timestamp order and the repository policy accepts each` — existing test expects the prior exact migration filename list.
2. `BK01 runtime allowlist is the exact 11 identities plus 8 legacy PUBLIC exceptions` — snapshot expects 11 explicit / 19 effective identities; active SQL helper is 13 / 21.
3. `generated bootstrap accepts only exact pre and post route-migration privilege states` — snapshot expects route/effective-set sizes `0,5,6` / `13,18,19`, while the restored newer SQL snapshot differs.
4. `runtime exact allowlist includes trial binding and rejects the twelfth explicit RPC` — snapshot expects 11 / 19 while the active helper is 13 / 21.

Static checks: `rpc-arity` cannot resolve `bookingHoldRpcArgs(request)`; the G10 source grep expects route-local binding code while this RC keeps it in `lib/line-webhook.ts`. The signed-handler/runtime path passed. Both static failures remain open and must be reconciled by their owners; no waiver is implied.

R3 summary is `summary.json`; action evidence is `admin-dom-actions.json`; source gate results are `source-checks.json`; dashboard capture is `admin-dashboard-authenticated.png`. R3 pins all copied tip-file hashes in `pins.json` and recorded no source drift. Overall status is **HOLD**, despite passing browser behavior and SQL proof.

## 3. Production GO plan updates — F-01 through F-05

Updated `D:/AI-Workspace/vault/06-Agent-Logs/WSTERA-House/PLAN-PRODUCTION-GO-BK01-2026-10-02.md` to record:

- F-01: any RC/build-input change invalidates prior acceptance; re-pin, run the full suite (minimum 517 tests), build/typecheck/lint/security checks, rerun complete harness, and obtain new independent two-lane reviews bound to the exact SHA.
- F-02: create/read back private `deposit-slips` production bucket, 5,242,880-byte maximum, JPEG/PNG/WebP MIME allowlist, narrow owner/shop access policies, and explicit PS01 isolation. The pinned fixture is documented only as the local contract, not production evidence.
- F-03: compile production `NEXT_PUBLIC_*` values into separately built Worker artifacts, freeze each deployable artifact and manifest SHA-256, and manage runtime secrets separately.
- F-04: require all four A-27 items before a real sale: ToS retention wording; working `privacy@wstera.com`; cancelled-shop manual purge/anonymization runbook; deletion-tombstone replay after restore.
- F-05: lock the pilot shop hostname and verify it in Turnstile allowed domains and Supabase Auth redirect/callback URLs before onboarding.

The plan now reflects the authenticated dashboard and DOM result while keeping the current release at HOLD because of the actual source/static failures and unmeasured hosted gates.

## Closeout

**Done:** migration/rollback/proofs, PG17 RED→GREEN and invariant checks, R3 authenticated dashboard and DOM action harness, AGY F-01..F-05 plan updates.

**Verified:** allowlist 21; ACL delta `[]`; 120000–160000 hashes unchanged; raw rollback diff `[]`; 345/345 isolated SQL branch tests; R3 17/0/2 e2e/proof status and browser DOM actions; both consumer/Admin build, typecheck, lint PASS.

**Open / next action:** resolve four assembled-source test failures and two static scanner/check failures, then independent review of the exact uncommitted branch tips. Hosted Auth/provider/Storage/Turnstile hostname and LAB remain unverified. Claude ผู้คุม owns commit/merge and must decide any next gate. No LAB, production, GO, deployment, commit, or merge occurred.

แปะให้: Claude ผู้คุม
