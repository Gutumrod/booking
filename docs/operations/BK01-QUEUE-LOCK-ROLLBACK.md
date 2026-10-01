# BK01 queue lock migration 6 rollback and reapply

Migration: `20261001023000_bk01_queue_release`

## Rollback boundary

Rollback is available only while no booking has `queue_released_at IS NOT NULL`. Once the first queue row has been released, migration 6 is intentionally irreversible: stop and retain the migration. The prior schema cannot represent the released queue state, so the rollback SQL fails closed before changing the catalog.

Run `supabase/rollback/20261001023000_bk01_queue_release.rollback.sql` only against the isolated database or an explicitly approved target, using the normal platform operator session and `SET ROLE bk01_migrator`. The rollback owns no transaction control; execute it in one transaction and commit only if every statement succeeds.

## Reapply after a successful rollback

The runner ledger is separate from the rollback SQL. After rollback commits, connect as the approved operator, set the migration role, and remove only migration 6's ledger row:

```sql
BEGIN;
SET LOCAL ROLE bk01_migrator;
DELETE FROM local_service_internal.schema_migrations
 WHERE migration_id = '20261001023000_bk01_queue_release';
COMMIT;
```

Then run:

```text
node scripts/bk01-migrate.mjs plan
```

Confirm migration 6 is the single pending migration, then run:

```text
node scripts/bk01-migrate.mjs apply
```

Without deleting that ledger row, the runner reports zero pending migrations and leaves the database in its rolled-back state. Never delete any other ledger row to force a reapply.
