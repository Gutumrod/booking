# REPORT — HOUSE-BK01-P0-SQL / R1

Date: 2026-10-02 task label; executed 2026-10-01 UTC.
Status: R1 SQL READY FOR INDEPENDENT REVIEW; release remains HOLD.
Branch: codex/bk01-p0-sql-20261002.
Base: 37a0535ddd0f75a2658b90740edf2bd7abb43af6.
Contract first published: dcd9f4b (before implementation, sent to Hermes).

## Source-of-Truth References

- Vault `00-System/3musketeers/room.md` lines 923–931, dispatch 2026-10-01T13:30Z.
- Vault `06-Agent-Logs/WSTERA-House/briefs/codex-parallel-20260927/28-BK01-COUNCIL-P0-FIX.md` §0–§3, §5; STATUS-HOUSE A-24.
- Council master §2–§4; `council-holes-2026-10-01/REMEDIATION-PLANS/COUNCIL-VERIFICATION-AND-FIX-PLAN-2026-10-01.md` §2–§4; `COUNCIL-REMEDIATION-RECOMMENDATIONS-2026-10-01.md` §4–§5 under Vault `06-Agent-Logs/WSTERA-House/council-holes-2026-10-01`.
- Booking base migrations `20261001130000_bk01_sql_consolidate.sql`, `20261001140000_bk01_pack_notify_group67.sql`; `reports/CONTRACT-BK01-P0-SQL-2026-10-02.md`.
- Hub `AGENTS.md`, `docs/platform/MODULE-REUSE-POLICY.md`, `PORTFOLIO_PRODUCTION_MASTER_PLAN.md`.
- Platform role prerequisite: worktree `bk01-runtime-role-20260930/docs/platform/shared-runtime/migrations/h3_bk01_runtime_role.sql`; product frozen `supabase/shared-runtime/bk01-platform-bootstrap.sql`.

Reuse Gate: N/A, bounded remediation of existing capability. MT01 bootstrap architecture unchanged. Product reuses existing tenant/request identity, migration runner and booking primitives; platform retains role/schema/extension ownership. No module copy or central billing/storage expansion.

## Changes and coverage

New migration: `supabase/bk01-migrations/20261002120000_bk01_council_p0.sql`.
SHA256: `631dc2ca79f3ab508cc2378272af242268ee0e52510bebfc2a601fc690b1de9a`.
Snapshot rollback: `supabase/rollback/20261002120000_bk01_council_p0.rollback.sql`.
SHA256: `1775be6f1bb54adb4e301aff63051e00366fd5b4cca7522d681478bfaf6747df`.

| Unit | Implemented result / proof |
|---|---|
| S1 | Two no-arg migrator-owned SECURITY DEFINER public wrappers, pinned search_path. Real anon/auth full app projections pass; six internal helpers remain private. Entitlement view shape preserved. |
| S2 | Public customer insert policy removed; authenticated writes revoked. Cross-shop insert tested both with and without RETURNING. |
| S3 | Inspected direct insert/update/delete/upsert in both apps: only authenticated DELETE tickets needed; explicitly granted under existing RLS. All other app SQL writes are RPC. Excess table/column DML, TRUNCATE, REFERENCES, TRIGGER revoked. History SELECT-only; exact gate passes. |
| S4 | Unrelated authenticated users cannot read private shops. Public view excludes line_oa_id. Public projection and member admin paths pass. |
| S5 | LINE claim filters customer recipients; context returns NULL LINE identity for noncustomer. Existing claim JOIN retained. |
| S6 | Email claim ambiguity fixed; unique shop/Thai-date/09-or-17 slot catch-up. Controlled 09:00:30, 09:07, 17:00, 22:00, 07:59 tests; missed cron catches up. Outputs exclude customer/booking data. |
| S7 | Contact requires top-level email and is_anonymous=false, owner/admin. No email_verified/user_metadata/auth.users access. Confirm email ON remains Window 2 prerequisite. |
| S8 | One nine-input catalog identity, trailing defaults NULL preserve current settings under row lock. Seven and nine named arguments tested. |
| S9 | New token 32 uppercase hex chars; SHA-256 of two UUIDv4 values supplies 128 output bits with 244 input random bits. Existing varchar(64) column unchanged. Legacy 10 and new 32 bind pass; approve/future reject expiry end+7 days. |
| S10 | Thai-date/past/NULL hold checks; destination-month quota uses advisory+existing entitlement locks. At 49/50 concurrent reschedules admit exactly one. Future/NULL completed fail. Legacy NULL rows ignored in availability; new NULL rejected by NOT VALID check. |
| S11 | Topup platform admin only, owner denied, existing balances retained. |
| S12 | Immutable received/refund_recorded money events, FORCE RLS, no direct app grants. Submitted/verified/rejected refunds require textual transfer evidence and existing time/role guards; event and booking state atomic. Rejected refund/history pass; owner UPDATE/DELETE/TRUNCATE ledger denied. File evidence HOLD: current customer-slip scope cannot safely authorize merchant evidence. |
| S13 | Cancel owner/admin only; staff denied and owner succeeds. |
| S14 | Existing nine-input hold RPC runtime only, exact runtime allowlist 20→21. Shop+trimmed-phone cap 3 live holds/pending; concurrent fourth admission denied. Pending review remains until appointment. |
| S15 | Legacy hash/count checked before DB client/socket; temporary copy mutation rejected using unreachable local DB. Full raw rollback equality, app named RPC arity and role surface gates pass. |

Frozen legacy/product migrations and platform bootstrap are unchanged. New function owners are bk01_migrator; three pre-existing postgres-owned exceptions remain unchanged. Existing function owner/ACL changes are only intended create_booking_hold executor transfer; new wrappers/ledger helpers have explicit ACLs. Token PUBLIC ACL is preserved as required by existing allowlist.

## Verification — fresh W-1

Evidence root (machine local, not copied into Vault):
`D:\AI-Workspace\runtime\relay\house-20261001\codex-par\HOUSE-BK01-P0-SQL\fresh-replay3`.

Fresh PG17.11, UTC, localhost:55463; operator non-superuser. Managed fixture/legacy installation occurs before postgres is demoted; reviewed platform scripts subsequently create runtime/migrator roles (neither pre-created). Product migration runner SET LOCAL ROLE bk01_migrator. Extensions PUBLIC and migrator USAGE remain denied. Anon/authenticated/runtime calls use real roles. Scaffolding and controlled clock/catalog mutation setup use fixture authority only in the guarded disposable cluster; production RPC calls use actual application roles.

- Fail-before baseline: 8/8 assertions reproduce base defects, including exact public projections, customer insertion without RETURNING, settings-seven failure, premature completion and anon TRUNCATE authority.
- Pass-after: 38/38 assertions, including intended ACL delta, full projections, real JWT shape, contact and money ledger isolation, actual unauthorized writes and TRUNCATE attempts, role/state checks.
- Advanced: 28/28 assertions including time, NULL, phone/slot/quota races and five guard mutations (completed, recipient channel, contact anonymous, destination quota, phone cap). Removing each guard makes the corresponding negative expectation fail; original function definitions restored.
- Exact effective execute sets: anon 14, authenticated 54, runtime 21; exact table AND column write matrix; SELECT-only history policy PASS.
- TypeScript AST named RPC/catalog gate: all 49 calls in SQL branch PASS. R2 current in-progress snapshot was separately checked (47 calls); this is not an integrated release proof.
- Apply → rollback → raw diff = base (0 differences) → reapply PASS. Compared function definitions/owners/ACLs, relation definitions/owners/ACLs/RLS, column definitions, policies, constraints, triggers and table ACLs. Not just a combined hash.
- Frozen source mutation rejection before connection PASS; originals untouched.
- npm test: 340/340 PASS.
- db:bk01:policy: 9 migrations, 47/47 policy mutations, 5/5 authority checks, 3/3 effective execute-set checks PASS.
- db:bk01:verify PASS (30 frozen legacy files, pinned hash unchanged).
- lint: exit 0, six existing warnings.
- next typegen then standalone TypeScript checks: initially PASS in both apps. Full webpack builds generate stronger route constraints and FAIL: consumer handleUploadIntent, handleLineWebhook, handleNotificationDispatch; admin handleStripeWebhook are unsupported named exports. These four route source files are unchanged against base. Do not treat initial standalone TypeScript PASS as full app build acceptance.
- Default Turbopack builds blocked by node_modules junction outside worktree filesystem root. Webpack compilation passes in both apps, then fails route-export type validation described above. All build env values were nonsecret placeholders; no production env loaded.
- git diff --check PASS. Disposable clusters stopped, including earlier debugging cluster.

## Reproduction

From booking branch checkout, dependencies present, set these environment variables to local isolated paths:

```powershell
$env:BK01_P0_PGBIN='D:\AI-Workspace\runtime\portable\platform-sql-a10-pg17\pgsql\bin'
$env:BK01_P0_EVIDENCE_DIR='<new empty local evidence path>'
$env:BK01_P0_RUNTIME_ROLE_SQL='<reviewed platform h3_bk01_runtime_role.sql path>'
$env:BK01_P0_LOCAL_PORT='55463'
node scripts/proofs/bk01-council-p0-replay.mjs
npm test
npm run db:bk01:policy
npm run db:bk01:verify
```

Driver rejects existing data directory and wrong PG version; creates a new loopback cluster, applies pinned prerequisites/chain, runs baseline/after/races/mutations/gates and shuts it down in finally. Machine paths are evidence provenance, not application config.

## Remaining / handoff

1. Claude lane and AGY must independently review the exact final SQL SHA, state × function × NULL × actual role matrix, ledger/contact RLS and before/after ACLs. Reviewers must run their own evidence.
2. Hermes R2: consume contract, remove public line_oa_id select, runtime server hold route with server Turnstile/rate limits, refund evidence UI, JWT contact and full event dispatch. Repair unsupported named route exports within app ownership and rerun full builds. Final SQL+app candidate e2e still pending.
3. File refund evidence is explicitly HOLD; textual transfer reference is implemented. A separate storage authorization contract is needed if file upload is required.
4. Window 2: Confirm email ON and NOT VALID interval CHECK validation on approved LAB window; legacy NULL remediation decision remains separate. Real mail send unmeasured in R1.
5. Frozen bootstrap is a pre-P0 prerequisite, not a post-P0 grant repair. Generator deliberately retains pinned pre-P0 output. Final 21-role surface is enforced by P0 gate. Reapplying old bootstrap after P0 could revoke new hold access; release order must remain prerequisite → full migration chain → final surface gate.
6. Rollback is a local reviewed recovery artifact: it restores base grants/schema exactly and drops the new money ledger. After activation, preserve/export any new financial events before rollback approval. Restoring the old exclusion can fail with legacy NULL data; fail closed, do not rewrite legacy data automatically.

No LAB/production operations, merge or GO. SQL readiness is not release readiness. No request to change pricing, public sellability, P1 scope or extension privileges.
