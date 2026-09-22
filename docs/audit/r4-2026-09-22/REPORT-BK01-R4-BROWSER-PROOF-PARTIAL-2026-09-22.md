# REPORT — BK01 R4 Browser/Mobile Proof Partial

Date: 2026-09-22 (Asia/Bangkok)
Canonical branch: `feature/bk01-real-shop-hardening-r4`
Exact source: `3b3a3338de029a058aa5763c806be42f8a5205ca`
Source authority: `SOURCE_REVIEW_PASS / BROWSER_PROOF_RESUME`

## Scope

Resumed real Browser/Mobile proof after Codex R9 PASS.
Canonical source ran locally; KMO Supabase was used only as downstream real-shop runtime.
No House shared-runtime/Junction A/runtime-R7/Order/Claim work occurred.
## NEW-F18 runtime confirmation

After NEW-F18:
- public shop profile: HTTP 200, target found;
- public services using approved columns only: HTTP 200, 2 rows;
- public staff using approved columns only: HTTP 200, 0 rows.

Therefore the former Services/Staff 42501 caused by client `is_active` filtering is runtime-closed.

No inactive-row/client-side bypass was introduced; active-row authority remains RLS.
## KMO downstream availability drift

Public availability reads still failed:
- `staff_schedules`: 401 / PostgreSQL 42501
- `shop_holidays`: 401 / PostgreSQL 42501

Live policy inspection proved:
- RLS enabled on both tables;
- anon SELECT policies exist on both and use `true`;
- live KMO had lost the intended anon column privileges.

A narrow KMO-only migration was applied successfully to restore baseline public payload columns:
- schedules: staff_id, day_of_week, is_working_day, work_start, work_end, break_start, break_end
- holidays: staff_id, holiday_date, reason

No business data changed.
## Remaining predicate privilege defect

Browser still rendered truthful LOAD_ERROR after the first grant repair.

Source/runtime comparison identified the exact reason:
Consumer scopes both availability reads with `eq('shop_id', shopId)`.
Postgres requires SELECT privilege on a column used as a query predicate.

Live checks:
- anon SELECT privilege on `staff_schedules.shop_id`: false
- anon SELECT privilege on `shop_holidays.shop_id`: false

This is a KMO downstream baseline/grant defect, not a new canonical source regression.
Canonical historical runtime had broader anon table privileges, so its source contract was not dependent on the KMO narrowed baseline.

Required minimal KMO repair is to add SELECT on only `shop_id` for those two tables.
## Tooling stop

An attempt to apply the final two-column predicate grant through the managed migration tool was blocked by the platform safety layer and was NOT executed.

No bypass through raw SQL/CLI was attempted.

Browser UI after this point therefore cannot be accepted as PASS.
## KMO fixture blocker

Public runtime currently returns zero staff rows.

Therefore even after availability privileges are repaired, the real KMO tenant cannot prove:
`service -> staff/resource -> date -> valid slot -> hold/create`

without creating/activating staff and schedules.

That would change real shop business data and was not performed.

A truthful NO_STAFF state can be checked once the grant blocker is removed, but a full positive customer E2E requires an authorized real or isolated fixture.
## Security advisor note

A post-DDL Supabase security advisor scan reported pre-existing KMO project findings, including a SECURITY DEFINER public-profile view and unrelated public-schema/RLS debt.

These were not introduced by the narrow availability grant repair and were not remediated inside this BK01 R4 browser-proof lane.

They should be handled as a separate KMO security review rather than silently mixed into this acceptance result.
## Current disposition

- Canonical source at `3b3a333`: source review PASS.
- NEW-F18 Services/Staff runtime path: PASS.
- Desktop/mobile page rendering at current KMO runtime: FAIL-CLOSED / LOAD_ERROR.
- KMO availability privilege drift: proven, partially repaired, final predicate grant still blocked by tooling.
- Positive customer E2E: blocked by zero-staff KMO fixture.
- Admin browser/mobile acceptance: still owed.
- R4 CLOSE: NOT AUTHORIZED.

Status:
`BROWSER_PROOF_PARTIAL / KMO_RUNTIME_AND_FIXTURE_BLOCKED`
