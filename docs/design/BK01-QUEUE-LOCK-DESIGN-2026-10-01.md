# BK01 queue lock design — HOUSE-BK01-QUEUE-LOCK

Status: implementation prepared on `codex/bk01-queue-lock-20261001`; scheduled invocation remains a runtime-contract decision. Base `c5e6650d9c3e46c76d05e27fdcf76f49da62ffd1`. No LAB or production change.

> The proposal below records the design considered before the caretaker decision. The approved resolution at the end of this note supersedes the advisory-lock proposal and updates the proof criteria.

## Reproduction finding (2026-10-01, isolated PG 17 clone)

The existing `prevent_overlapping_staff_bookings` constraint **is present** after migrations 1–5. Its predicate is the immutable status-only expression installed by the later Phase A migration, not the earlier `NOW()` expression from `product_rules_v1.sql`. A real `anon` hold followed by a real `anon` slip submission kept `expires_at` at the original 15-minute value. After moving that deadline into the past in the isolated fixture, a second real `create_booking_hold` call failed with “Selected staff is unavailable during this time slot”. A two-connection barrier test observed two sessions waiting on a table lock; after release, one hold succeeded and one failed for overlap. Thus the brief's predicted double booking and missing constraint were **not reproduced** in this scaffold. This clone initially had a migration-5 ledger entry but the older link-token function body; migration 5 was reapplied on the clone before the function calls, so this is not yet a clean W-1 replay proof.

The actual confirmed defect is the unchanged hold deadline on slip submission and the absence of a release path for pending review after appointment end. Replacing the existing exclusion guard with a trigger is a material architecture change and needs caretaker review before SQL. Do not treat the earlier B2 hypothesis as verified.

## Decision and boundary

- A submitted slip keeps its booking in `pending_review` and reserves the staff interval through `end_timestamptz`. The end, rather than the start, protects the full appointment and avoids admitting an overlapping booking while service could still be underway. `expires_at` must no longer retain the original 15-minute hold deadline after submission.
- After `end_timestamptz`, a pending review remains pending for a human decision and keeps the slip evidence. A nullable `queue_released_at` records that its slot was released; the admin badge/view must count `status='pending_review' AND queue_released_at IS NOT NULL` as “ต้องคืนเงิน/รอตัดสิน”. Do not auto-approve or auto-reject. Owner of admin UI is block 2; handoff contract should name a view or function after schema proof.
- Only `hold` with future `expires_at`, `pending_review` with null `queue_released_at` and future appointment end, and `confirmed` consume a slot. A hold sweeper marks expired holds `expired`; a pending sweeper sets `queue_released_at` after appointment end. Lazy sweep in `create_booking_hold` plus an operator-scheduled sweep is needed so a stale status does not persist indefinitely.
- Use a database trigger on booking insert/update that takes a transaction advisory lock keyed by staff ID, checks overlapping active booking ranges, and raises on conflict. It covers direct writes as well as `create_booking_hold` and needs no `btree_gist` or schema `extensions` privilege. The booking function must make its availability query match this predicate. A staff move must lock old/new staff IDs in deterministic order. The trigger and function must be tested under the actual runtime role, including two connections synchronized by a barrier.
- Before replacing an existing overlap constraint, inspect the actual catalog after migration 1–5. If the constraint exists, its predicate and operator classes decide whether it can remain. No `now()` in a constraint/index predicate. Any existing active overlaps require explicit inventory and operator disposition before adding the trigger; do not silently delete or pick a winner. Migration should fail closed with conflicting booking IDs/count rather than half-apply.
- Rollback must restore catalog/function/grant state and must fail closed if new state cannot be represented by the old schema. Reapply on the same simulated identity is mandatory.

## Reuse gate

Pure remediation of existing product-local booking capability: `Reuse Gate: N/A`. Module Hub's generic scheduler/lock modules are application-side contracts and do not provide a PostgreSQL booking-row invariant. Central platform owns billing/entitlement, not BK01 appointment inventory. No upstream or cross-product copy is planned.

## Required proof before implementation can be accepted

PG 17 W-1 scaffold with non-superuser CREATEROLE actor, no PUBLIC usage of `extensions`, and no `bk01_migrator` usage there; exact base migrations 1–5; raw B1/B2 fail-before; 20 synchronized two-connection races pass-after; slip past 15 minutes and past appointment end; real-role function calls; rollback/catalog comparison/reapply; static and catalog forbidden-reference scans; mutation checks for removed lock and reintroduced time predicate.

## Approved resolution and implementation evidence (2026-10-01)

The caretaker correction at brief `23-BK01-PRESALE-FIXES-B1-B8.md`, section 2, block `แก้ไข 2026-10-01` (vault `54b20df`) supersedes the historical advisory-lock proposal above:

- Keep `prevent_overlapping_staff_bookings` as the GiST exclusion constraint. Do not add trigger/advisory locking or change UUID extension privileges.
- On slip submission, set `expires_at = end_timestamptz`. Keep the booking `pending_review` after appointment end; set `queue_released_at` so its interval no longer blocks a successor.
- Keep both lazy release in `create_booking_hold` and an operator-scheduled sweep. The sweep function is implemented, but calling it from the existing five-minute Cloudflare Cron is held: that Worker currently uses `bk01_runtime`, whose exact House RPC allowlist does not include this function, and the Worker has no service-role credential. Do not widen that contract or substitute another credential in this task.
- `bk01_pending_past_appointment_count(shop_id)` enforces shop membership. Approval rejects a released row clearly, including after a successor has booked the interval.
- Clean W-1 replay used PG 17.11: the 30 frozen legacy migrations, generated bootstrap, and active migrations 1–5. `generate_link_token()` matched migration 5. The unmodified baseline reproduced B1 and B2 (7/7 checks). Migration 6 then passed 13/13 final checks, including 20/20 synchronized two-connection races, successor booking, rejection of old-row approval, and shop-scope denial.
- Under the actual non-superuser `operator` runner, `SET ROLE bk01_migrator` successfully dropped/re-added the GiST constraint while `bk01_migrator` and PUBLIC both had no `extensions` USAGE. An attempted recreation omitting `queue_released_at` failed with SQLSTATE `23P01` against the successor row.
- The rollback restored columns, trigger catalog, GiST predicate, and both function definitions after line-ending normalization; the migration was reapplied through the runner. Plan reports 6 applied / 0 pending. No LAB or production target was used.

Implementation commit: `0885148368607c2d382444f0981362afdd701bc3`; formatting follow-up: `6d6643fd7c9bd65403b5aeea4184a9ab31567641` (branch pushed, not merged).

Acceptance remains `NEEDS_DECISION` for the existing scheduled-Worker authority path, and the two application builds remain blocked by worktree dependency symlinks/type errors in existing API route exports. Repository verify, policy, and all 313 tests pass; lint reports 0 errors and 6 warnings.
