# BK01 compensating rollback chain

These files are separate from the frozen forward migration stream. Run them in reverse timestamp order, each as one transaction, only against the exact chain from `c16036d154912ebeb8217bf08ea06044daee8dfd`:

1. `20260927130000_bk01_trial_line_bind.rollback.sql`
2. `20260927120000_bk01_runtime_route_rpcs.rollback.sql`
3. `20260926120000_bk01_entitlement_packs.rollback.sql`

For the 2026-10-01 queue-lock plus SQL-consolidation release, run the product-local compensations in this order before considering the earlier chain:

1. `20261001130000_bk01_sql_consolidate.rollback.sql` — refuses rollback while refund data exists; keeps the 24/12 backfill values.
2. `20261001023000_bk01_queue_release.rollback.sql` — refuses rollback while released-queue state exists.

After each compensation, remove only that migration's exact row from `local_service_internal.schema_migrations` as `bk01_migrator` before reapplying. These two files are not a permission to roll back a shared or hosted database; use only the isolated, reviewed local test chain unless a separate release instruction authorizes an environment.

The guards reject non-null LINE binding values, any rows in the two route tables or the service entitlement ledger, changed entitlement seed data, changed derived business-type backfills, `starter_set_applied=true`, and `entitlement_disabled=true`. Only the exact migration-owned seed set is removed. The final rollback restores the prior function definitions, trigger definitions, view shape, owners, effective grants, and policies recorded from the frozen-chain PGlite baseline.

The final file is generated offline from `pg_get_functiondef`, `pg_get_triggerdef`, and view definitions at the pre-chain catalog snapshot. It contains no database rows, credentials, or environment values. Rebuild and verify with the optional `BK01_BASELINE_CATALOG_OUTPUT` and `BK01_GENERATE_FIRST_ROLLBACK=1` controls in `scripts/proofs/lane-b/wu1_e2e.mjs`; proof outputs belong outside the worktree.

The proof verifies partial rollback of only the latest file, populated-table rejection without row loss, all-three-file rollback and catalog equality, then reapplies the exact chain for the existing Lane B assertions. It uses PGlite and does not connect to LAB or production.
