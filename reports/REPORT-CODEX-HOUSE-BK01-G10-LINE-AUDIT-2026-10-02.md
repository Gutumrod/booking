# BK01 G10 LINE binding audit — implementation report

**Status:** implementation and local gates complete; ready for exact-SHA independent OpenCode + AGY review through the House controller. This is not a release verdict. No LAB, production, merge, or RPC allowlist change was made.

## Source and scope

- Base: `codex/bk01-p1-g09-g10-20261002` @ `2a772e46a5dca42df2bf23429552972d9396f49e`.
- Owner ruling: House `STATUS-HOUSE`, A-9 ruling for OpenCode G09/G10 F1: add table-level LINE audit triggers in migration `20261002160000`; no new reset RPC; add manual reset runbook.
- Added `supabase/bk01-migrations/20261002160000_bk01_g10_line_binding_audit.sql` and matching rollback.
- Added `docs/operations/BK01-LINE-binding-reset.md`.

## Behavior and access boundary

- `line_users` records each INSERT, UPDATE, and DELETE. `customers` records only changes to `line_user_id`.
- Internal ledger `local_service_internal.line_binding_audit` stores timestamp, authenticated user UUID when supplied, database session/effective role, shop/customer/row UUIDs, operation, and old/new LINE user IDs. It stores no name, phone, email, display name, picture URL, or IP address.
- The ledger is owned by `bk01_migrator`, RLS-enabled, has no direct grants, and remains outside schema USAGE for anon, authenticated, service_role, and `bk01_runtime`. Runtime direct INSERT fails with `42501`.
- The trigger helper is private and has no EXECUTE for anon, authenticated, service_role, or runtime. Existing function owner/EXECUTE ACLs have no delta. Effective `bk01_runtime` EXECUTE remains exactly 21.
- Runbook requires the platform-admin identity in the request claim to match `platform_admins`; the transaction removes the exact old mapping and nulls the customer link. It requires owner confirmation and a second admin review, then checks both rows and audit entries.

## Verification

Fresh PostgreSQL 17.11 W-1 replay evidence: `D:\AI-Workspace\runtime\relay\house-20261002\codex\HOUSE-BK01-G10-LINE-AUDIT\red-green-replay-r5`.

- Fail-before on the exact chain through 150000: audit ledger/trigger absent; the acceptance assertion exited 1 as expected.
- Pass-after: 12/12 assertions; direct platform-admin INSERT/UPDATE/DELETE on `line_users` and direct customer LINE change record actor UUID, operator login, effective role, old/new values, and IDs.
- Runtime write to the audit table is denied; anon/auth/service/runtime have no schema access or table privileges; helper EXECUTE is denied to all four roles.
- Existing function owner/ACL delta: `[]`; runtime EXECUTE: exact 21.
- Rollback: ledger, triggers, helper, and migration row absent; normalized `pg_dump --schema-only` raw schema diff: `[]`. Reapply: 12/12 assertions pass.
- Full P0/G09/G10 replay completes; P1 regression assertions: 23/23 after and after reapply; earlier rollback proof: raw catalog diff `[]`.
- `npm test`: 340/340; `npm run db:bk01:policy`: PASS (47/47 policy cases, 5/5 runtime-authority cases, 3/3 EXECUTE-set cases); `npm run db:bk01:verify`: PASS; `git diff --check`: PASS.
- Migrations 120000/130000/140000/150000 and `scripts/lib/bk01-runtime-allowlist.mjs` are byte-identical to base.

## Remaining review notes

- No live database was changed. Review is needed before any deploy or merge.
- The audit ledger adds no purge job. Confirm the A-27 12-month internal audit-retention process before enabling long-running use; legal/accounting retention inputs remain separate owner decisions.
- Next: House controller dispatches OpenCode and AGY to review the exact branch tip and attach their verdicts to `room.md`.
