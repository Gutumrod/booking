# Phase A Completion Report

Date: 2026-08-07
Project: `local-service-booking-saas`
Live Supabase project: `gyleqrjdzwwlqierdwcy`

## Status

Phase A — data integrity and authorization hardening — is complete. The migration was applied and verified against the live project by the project owner/Claude, then committed locally. Codex verified the resulting Git state and migration contents; Codex did not independently reconnect to the live project during this checkpoint.

## Git evidence

- `2545e2d` — `feat(backend): wire real Supabase backend, fix RLS/trigger/exclusion bugs found via live testing (Phase 1 + Phase A)`
- `f49ac98` — `fix(supabase): close remaining Phase A authorization gaps found in static review`
- Phase A migration: `supabase/migrations/20260807064655_phase_a_data_integrity_and_authorization.sql`
- Worktree was clean before this report was created.

## Completed controls

- Rebuilt `prevent_overlapping_staff_bookings` without a volatile `NOW()` predicate.
- Added stale-hold expiry handling and a clean client-facing exclusion-conflict error.
- Added required customer name/phone and non-past booking-date validation.
- Restricted `reject_deposit_slip` and `extend_booking_hold` to authenticated shop members.
- Revoked `anon` and `service_role` execution of the privileged reject/extend RPCs.
- Revoked anonymous direct inserts into `local_service.customers` and `local_service.bookings`; public booking creation must use `create_booking_hold`.
- Restricted rejection to bookings in `pending_review` with deposit status `submitted`.
- Preserved a dedicated reason-bearing history row for each rejection.
- Validated deposit-slip URLs against the live project bucket, booking-scoped path, canonical image object name, and an existing `storage.objects` row.

## Verification status

Reported live verification completed by the project owner/Claude:

- Exclusion constraint exists and concurrent overlapping requests cannot both succeed.
- Anonymous calls to `reject_deposit_slip` and `extend_booking_hold` are denied.
- Invalid or cross-booking slip URLs are rejected.
- Blank customer data and past booking dates are rejected.
- Remaining authorization-gap changes were verified through REST after deployment.

Codex verification in this checkpoint:

- Confirmed both Phase A commits exist locally.
- Confirmed the final migration contains the approved grants, revokes, state guard, explicit rejection-history insert, validation, and exclusion handling.
- Confirmed no Phase A migration remains uncommitted.

## Operational notes

- Local `main` is ahead of `origin/main`; the Phase A commits were not pushed during this checkpoint.
- Reapplying the Phase A migration manually drops and rebuilds the GiST exclusion constraint and can take an `ACCESS EXCLUSIVE` table lock. Treat it as a one-time ordered migration.
- At this report's date Phase B had not started. The 2026-09-27 BK01 WU-C work supersedes this checkpoint and uses the House runtime JWT adapter for server routes.
