# BRIEF — BK01 Shop Weekly Closure Addendum

**Date:** 2026-09-09 (Asia/Bangkok)
**Product:** BK01 Booking by WSTERA
**Mode:** REQUIREMENT LOCK / PREPARE ONLY UNTIL JUNCTION A PASS
**Parent handoff:** `docs/order/BRIEF-BK01-CONTINUATION-HANDOFF-2026-09-08.md`

## Verified current gap

Current BK01 does **not** have a shop-level recurring weekly closure source of truth.

Existing mechanisms are different:
- `local_service.staff_schedules` stores weekly working/off state per individual staff member using `staff_id`, `day_of_week`, and `is_working_day`.
- `local_service.shop_holidays` stores date-specific closures; `staff_id IS NULL` means the entire shop is closed on that exact date.
- `local_service.shops` has no recurring weekly closed-day field.
- current admin UI edits weekly availability per staff and special shop holiday dates only.
- current Booking availability first checks exact-date shop holidays, then staff-level weekly schedules.

Current E3.2 evidence explicitly states that unsupported shop-wide recurring hours/off-day state was removed because no backend source of truth existed.

## Required capability

Owner/admin must be able to configure recurring weekly shop closures independently, for example:

`ร้านหยุดทุกวันอังคาร`

This setting must apply to the whole shop without requiring every staff schedule to be edited separately.
## Behavioral contract

1. Shop weekly closure is a **shop-level override** above staff schedules.
2. If the requested weekday is closed for the shop, public availability must return no bookable slot even when a staff member is individually marked working.
3. Special `shop_holidays` continue to override by exact date.
4. Staff-specific weekly schedules/time-off remain independent and continue to refine availability on otherwise open shop days.
5. Existing `/book/[slug]` behavior must remain compatible for shops with no recurring closure configured.
6. Missing recurring-closure configuration means no additional shop-level weekly closure; do not infer one from staff rows.
7. Owner/admin may mutate the setting; ordinary staff must not control shop-wide closure policy.
8. Customer/public reads receive only the minimal closure truth required for availability; do not expose private shop settings.

Recommended precedence:

```text
shop inactive
  -> exact-date shop holiday
  -> recurring shop weekly closure
  -> staff exact-date holiday
  -> staff weekly schedule / working hours / breaks
  -> booking collision
```

## Data-model direction

Use a dedicated product-local source of truth rather than encoding the rule by updating every staff member.

Preferred bounded model:
- shop-scoped recurring weekday rows, e.g. `shop_weekly_closures(shop_id, day_of_week)`;
- `day_of_week` constrained to `0..6` using the same convention as `staff_schedules`;
- unique `(shop_id, day_of_week)`;
- tenant-safe owner/admin mutation RPC;
- public/runtime read only through a bounded availability contract.

Do not overload `shop_holidays`, because that table represents exact calendar dates and currently participates in date-specific availability semantics.
## Current execution gate

This addendum does **not** reopen Junction A or authorize a LAB migration.

Until House/platform remediation returns and BK01 independently re-proves `Junction A PASS`:
- do not apply a new schema to WSTERA LAB;
- do not create/apply a BK01 forward migration for this capability;
- do not start Order/Claim live integration as part of this work;
- safe UI/domain preparation may be reviewed separately only if it does not require runtime truth or weaken current fail-closed behavior.

After `Junction A PASS`, implement this as a bounded BK01 product-local change and prove it in LAB before claiming completion.

## Required acceptance after runtime unlock

- configure Tuesday as recurring shop closure;
- Tuesday returns no public booking availability for every staff member;
- another weekday remains governed by each staff member's schedule;
- an exact-date `shop_holidays` row still closes an otherwise open weekday;
- removing Tuesday closure restores staff-derived availability without rewriting staff schedules;
- cross-shop mutation/read substitution fails closed;
- ordinary staff cannot mutate shop-wide weekly closure;
- existing shops with no configured weekly closure preserve current behavior;
- Booking create/reschedule RPCs and consumer availability agree on the same closure rule;
- no unauthorized PS01/MT01/shared-runtime delta occurs.

## Evidence basis

Verified against current repository source on 2026-09-09:
- `supabase/migrations/20260807051629_staff_schedules.sql`
- `supabase/migrations/20260807135141_phase_c_fail_closed_staff_schedules.sql`
- `apps/booking-admin/src/app/dashboard/page.tsx`
- `apps/booking-consumer/src/lib/booking-service.ts`
- `docs/technical/PHASE_E3_2_LOCAL_CHECKPOINT_REPORT_2026-08-08.md`

**VERDICT:** CONFIRMED GAP — shop-level recurring weekly closure is not currently modeled as an independent source of truth.
