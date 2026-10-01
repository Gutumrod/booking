# BK01 SQL Consolidation Release Checklist

Status: source handoff only. Migration `20261001130000_bk01_sql_consolidate` has not been applied to LAB or production.

## Required coordinated release

- Deploy the booking-admin application version that sends all nine arguments to `local_service.update_shop_settings` together with migration `20261001130000_bk01_sql_consolidate`.
- Do not apply the migration while the seven-argument application version is serving traffic. The migration drops the old seven-argument function identity; the existing application call will fail until the matching application version is live.
- Verify the deployed application commit and applied migration ledger entry before reopening shop settings writes.
- Run the owner/admin approval and refund role checks, the `bk01_runtime` notification-claim check, and the refund/counter checks in the release evidence pack before advancing the release gate.

## Explicitly outside this release

- Owner-email recipient lookup and daily email summary remain held until the migration path can create exact owner=`postgres` functions while preserving the `bk01_migrator` boundary and the email consumer has a separately verified route.
- No LAB or production migration is authorized by this checklist.
