# WUC-DB-ENTITLEMENTS — BK01 entitlement migration (H1-WUC-DB-ENTITLEMENTS-R2)

Correlation id: `house-swarm-1-wuc-db-r2-20260926`
Worktree: `D:/AI-Workspace/runtime/worktrees/house-swarm-1-wuc-db`
Base revision: `37053d35cd7392419c341eeae03a9c1193ed41b7`
Status: COMPLETE — reviewed by the commander, not self-approved.

## 0. What this note is

The single reviewable map from each Owner-locked rule to the file and database object that
implements it, the list of values the Owner has not yet answered and how each is configurable,
what is proven statically versus what would need a live database, and the raw command output that
proves the migration passes the repository policy validator and that the tests were actually run.

Nothing in this work unit was applied. No database connection was attempted. No commit and no push
were made (see §6).

## 1. Owner-locked rule → file and object

Every rule below is implemented by one file and named database objects inside it:

`supabase/bk01-migrations/20260926120000_bk01_entitlement_packs.sql` (1,976 lines, 80,981 bytes).

### R-1 — Free is free forever: 50 bookings per calendar month in Thailand time, resetting on the 1st, 1 shop, 3 services, no PromptPay deposit

| Element | Implemented by |
|---|---|
| The rule statement | `docs/house-swarm-1/WUC-DB-MIGRATION.md` §1 (this section); `STATUS-HOUSE.md` Addendum A-2 |
| The numbers as data | table `local_service.entitlement_plans`, seeded row `plan_code = 'free'`: `bookings_per_month = 50`, `shops_limit = 1`, `services_limit = 3`, `promptpay_deposit_allowed = false`, `price_thb = 0`, `price_usd = 0` |
| "Calendar month, Thailand time, reset on the 1st" | function `local_service.bk01_month_key(timestamptz)` → `date_trunc('month', p_at AT TIME ZONE 'Asia/Bangkok')::DATE`; the zone literal `'Asia/Bangkok'` is fixed in SQL text |
| Counting the usage | function `local_service.bk01_bookings_used_in_month(uuid, date)` — counts booking rows in the Thailand month, statuses `pending_review/confirmed/completed/no_show` plus a live `hold` |
| The ceiling value, exposed to the invoker trigger | function `local_service.bk01_free_bookings_ceiling()` → `entitlement_plans.bookings_per_month where plan_code = 'free'` |
| The 51st booking refused | function `local_service.enforce_booking_quota()` + trigger `trg_enforce_booking_quota BEFORE INSERT ON local_service.bookings` → `RAISE EXCEPTION ... 'BOOKING_QUOTA_EXCEEDED'` |
| The monthly reset write | function `local_service.ensure_entitlement_row(uuid)`: `IF v_plan = 'free' AND v_ledger_month <> v_current_month THEN` → rewrites `entitlement_usage.bookings_used` from the booking rows for the new month key |
| 1 shop | function `local_service.provision_owner_shop(...)`: `IF v_owned_shops >= COALESCE(v_shops_limit, 1) THEN RAISE EXCEPTION 'This account already owns a shop' USING ERRCODE = '23505'` — the limit comes from `entitlement_plans.shops_limit` |
| 3 services | functions `local_service.create_service(...)` and `local_service.set_service_active(...)`: `IF v_limit IS NOT NULL AND v_total >= v_limit THEN RAISE EXCEPTION ... 'SERVICE_LIMIT_EXCEEDED'` |
| No PromptPay deposit | function `local_service.create_booking_hold(...)`: `v_deposit_required := COALESCE(v_shop.require_deposit, true) AND v_limits.promptpay_deposit_allowed`, so a free shop writes the booking straight to `'confirmed'` / `deposit_status = 'not_required'` instead of holding it for a transfer |
| Free full ⇒ closed to new online bookings (A4) | view `local_service.shop_public_profile` — `is_accepting_online_bookings` is `false` once `bk01_bookings_used_in_month(s.id, bk01_month_key(now())) >= bk01_free_bookings_ceiling()` |
| Free full ⇒ the gate at persistence time | function `local_service.enforce_shop_booking_acceptance()` + trigger `trg_enforce_shop_booking_acceptance BEFORE INSERT ON local_service.bookings` → `'SHOP_NOT_ACCEPTING_ONLINE_BOOKINGS'` |

### R-2 — Basic is 390 THB or 11 USD per month with no booking ceiling at all; the old hard limit of 100 is gone

| Element | Implemented by |
|---|---|
| The price and the absent ceiling | table `local_service.entitlement_plans`, seeded row `plan_code = 'basic_490'`: `price_thb = 390`, `price_usd = 11`, `bookings_per_month = NULL` |
| "No ceiling" is read as no limit, never as a big number | column check `bookings_per_month IS NULL OR bookings_per_month > 0`; function `local_service.enforce_booking_quota()`: `IF v_limits.bookings_limit IS NULL THEN` accept and keep measuring, before the `ELSIF v_used < v_limits.bookings_limit` branch |
| The removed hard limit | the frozen 100-per-month Basic cap is superseded by this file's `CREATE OR REPLACE FUNCTION local_service.get_tier_limits(text)` and `... enforce_booking_quota()`; no literal `100` ceiling survives as a booking limit in this file |
| Staff cap unchanged at 5 | row `basic_490.staff_limit = 5`, read by `local_service.create_staff(...)` and `local_service.set_staff_active(...)` through `local_service.bk01_shop_limits(uuid)` |
| Plan resolution | function `local_service.bk01_shop_effective_plan(uuid)` → `'basic_490'` for status `active`/`past_due`, and for `trialing` only while the period is still open |

### R-3 — The 14-day Basic trial is a separate promotion, never the free plan, and expiry falls back to free without closing the shop

| Element | Implemented by |
|---|---|
| The promotion as data | table `local_service.trial_promotions`, seeded row `promotion_code = 'basic_trial_14d'`: `entitlement_plan_code = 'basic_490'`, `duration_days = 14`, `is_active = true`, `claimable_once_per_shop = true`, `claim_ticket_supported = true` |
| "Separate from free, for good" | the promotion's `entitlement_plan_code` is a foreign key to `local_service.entitlement_plans(plan_code)` and is `basic_490`, never `free`; there is no trial row in the plan table |
| Applying the promotion | function `local_service.apply_trial_promotion()` + trigger `trg_apply_trial_promotion AFTER INSERT ON local_service.subscriptions`, guarded `WHERE id = NEW.id AND status = 'trialing'` so a paid subscription is never rewritten |
| Fallback on expiry | function `local_service.bk01_shop_effective_plan(uuid)`: for `basic_490` + `trialing`, returns `'basic_490'` only while `COALESCE(current_period_end, shops.trial_ends_at) > now()`, otherwise `'free'` |
| The shop is not closed | the subscription row is deliberately left saying `basic_490` / `trialing`; `'trialing'` is not in the fail-closed refusal list `('canceled','incomplete','incomplete_expired','unpaid')`; nothing in the file sets `shops.is_active = false` and nothing writes `status = 'free'` |
| Still accepts bookings on free entitlements | function `local_service.enforce_shop_booking_acceptance()`: an expired trial refuses only once the free monthly ceiling is reached |

### R-4 — When a shop exceeds its entitlements after that fallback, the excess is disabled temporarily and nothing is deleted

| Element | Implemented by |
|---|---|
| Which services are inside the allowance | table `local_service.service_entitlement_periods` (`service_id`, `shop_id`, `month_key`) + function `local_service.bk01_restore_services_within_limit(uuid)` — stamps the oldest `services_limit` services for the current Thailand month and switches stamped services back on |
| The temporary disable | function `local_service.bk01_reapply_shop_entitlements(uuid)`: `UPDATE local_service.services AS s SET is_active = false` for services with no stamp in the current month; `UPDATE local_service.staff AS st SET is_active = false` for staff beyond the cap, newest first. Returns a JSON report (`services_disabled_temporarily`, `services_restored`, `staff_disabled_temporarily`) |
| "Nothing is deleted" | the file contains no `DELETE FROM`, no `TRUNCATE` and no `DROP TABLE` at all (asserted by the new test file and by §3 below); the disable is `is_active = false`, which `bk01_restore_services_within_limit` reverses |
| Why the disable is reversible | `set_service_active` and `set_staff_active` always allow switching off and gate only switching on, so convergence can bring a shop TO its allowance and never beyond it |

### R-5 — Pro is not sold

| Element | Implemented by |
|---|---|
| On the data itself | row `pro_990.is_publicly_sellable = false` **plus** constraint `entitlement_plans_pro_not_sellable`: `CHECK (plan_code <> 'pro' OR NOT is_publicly_sellable)`, so no code path can mark Pro sellable without violating the constraint |

### R-6 — Business types and starter patterns are seeded as table data, so a type can be added without a code change

| Element | Implemented by |
|---|---|
| The types as rows | table `local_service.business_types` (`type_code`, `emoji`, `label_th`, `label_en`, `starter_pattern` JSONB, `display_order`, `is_active`) seeded with 9 rows: `barber`, `car_care`, `nail_lash`, `beauty_clinic`, `spa_massage`, `studio`, `sport_court`, `pet_grooming`, `other` |
| The starter pattern as rows | each row's `starter_pattern` JSONB carries a `services` array (name, duration_minutes, price, deposit_amount) applied to a new shop at signup |
| Adding a type with no code change | adding a row is sufficient: `provision_owner_shop` resolves the type from the table by `type_code`, then by `label_th`/`label_en`, then falls back to the seeded `other` row — a new row is picked up without touching SQL |
| Recording the type on the shop | `ALTER TABLE local_service.shops ADD COLUMN business_type_code TEXT REFERENCES local_service.business_types (type_code)` (the legacy free-text `business_category` is kept and still written) |
| Applying the pattern | `provision_owner_shop`: loops `jsonb_array_elements(v_type.starter_pattern -> 'services')`, caps at the shop's `services_limit`, stamps `service_entitlement_periods` and sets `starter_set_applied = true` |
| Existing shops classified | the two `UPDATE local_service.shops SET business_type_code = ...` statements in section C classify legacy shops from their free-text category and fall back to `'other'` |

## 2. Values the Owner has NOT yet answered — all configurable, none hard-coded

Each item carries an asterisk (`*`) per the Owner rule of 2026-09-26: anything not locked must be a
configurable value plus an asterisk, never a number compiled into logic. Every value below is a
**row** in a config table (or a column with a default), so changing it is a data change with no
code change.

| # | Unlocked value | How it is configured (not hard-coded) | Current seeded value |
|---|---|---|---|
| A1 * | Free providers (staff) allowed | `local_service.entitlement_plans.staff_limit` for `plan_code = 'free'` | 1 (Claude proposal A1, unapproved) |
| A3 * | Free may notify through WSTERA's central LINE OA (fair use) | carried by the notification/plan surface, not by a value in this migration; the file fixes no notification quantity | not set here |
| A4 * | Exact UX once the free month is full | the refusal is data-driven (the view boolean and the two error codes); the copy shown to the customer is a UI-lane value | boolean + error code only |
| B3 * | Whether an existing shop may claim the trial more than once | `local_service.trial_promotions.claimable_once_per_shop` | true (Claude proposal B3, unapproved) |
| B4 * | What happens when Basic is cancelled mid-cycle | plan resolution reads `subscriptions.status`; the policy is `entitlement_plans` data plus the fail-closed status list | resolved through `bk01_shop_effective_plan` |
| B5 * | Refunds for an already-paid month | financial policy, not represented as a number in this migration | not set here |
| C1 * | Whether the price includes VAT | `local_service.entitlement_plans.price_thb` / `price_usd` are pre-VAT configuration values | 390 / 11 |
| C2 * | Pro 790 THB / 23 USD pre-approval, and the Pro entitlement numbers | `local_service.entitlement_plans` row `pro_990` (`is_publicly_sellable = false` keeps it unsellable until the Owner opens it) | 790 / 23, not sellable |
| C3 * | Annual plan pricing | would be a new row (or an interval column) in `entitlement_plans`; no annual price exists in this file | not sold |
| C4 * | Price of the customer's-own-LINE-OA add-on | would be a new row in `entitlement_plans`; not sold in V1 | not sold |
| D1 * | Legal provider name, tax id, contact address | ToS/Privacy data, outside a database migration | placeholder needed |
| D2 * | `SUPPORT_EMAIL`, `LINE_OA_ID` | configuration/UI values, not in this migration | placeholder needed |
| D3 * | LINE Login channel (secret) | runtime secret, never in a migration or a client | placeholder needed |
| – * | Basic services allowance (`services_limit`) and auto-slip allowance (`auto_slip_limit`) | `entitlement_plans.services_limit` / `auto_slip_limit` columns for `basic_490` | 50 / 0 (not Owner-locked) |
| – * | Basic trial length | `local_service.trial_promotions.duration_days` | 14 (Owner kept the trial; the exact length is still a row edit) |
| – * | Which plan the trial entitles the shop to | `local_service.trial_promotions.entitlement_plan_code` | `basic_490` |
| – * | Whether a future trial claim ticket applies | `local_service.trial_promotions.claim_ticket_supported` | true (designed to be extendable) |
| – * | Ordering and labels of the business types | `local_service.business_types.display_order` / `label_th` / `label_en` / `emoji` / `is_active` | 9 seeded rows |
| – * | Whether a business type is offered at all | `local_service.business_types.is_active` | true |

Answered so far: **O-1** (Basic has no booking ceiling) and **O-2** (the 14-day Basic trial is kept,
separate from free forever) and **B2** (trial expiry falls back to free, the shop stays open, the
excess is disabled rather than deleted). Everything else in the Owner lock sheet remains unanswered
and is therefore configurable data marked `*`.

## 3. What is proven statically, and what would need a live database

Proven statically (no database contacted, `tests/bk01-entitlement-boundary.test.ts`, 20 tests):

1. The migration file is the only file in `supabase/bk01-migrations/` and the repository policy
   validator (`scripts/lib/bk01-migration-policy.mjs`, run through
   `scripts/check-bk01-migration-policy.mjs`) accepts its SQL text.
2. The file's exact SQL text contains the statements named in §1: the `'Asia/Bangkok'` month
   truncation, the free ceiling of 50, the NULL Basic ceiling and the `IS NULL` accept branch, the
   `SERVICE_LIMIT_EXCEEDED` and `BOOKING_QUOTA_EXCEEDED` and `23505` refusals, the
   `promptpay_deposit_allowed` conjunction, the trial promotion and its `trialing` guard, the
   convergence functions, the seeded rows and their numbers.
3. The seeded plan numbers are read out of the file as data (a parenthesis- and quote-aware reader,
   not a substring match): free = 50 / 1 / 3 / no deposit; basic = 390 / 11 / NULL ceiling;
   pro = not sellable; trial = 14 days on `basic_490`.
4. The boundary decision logic, re-expressed in TypeScript from the migration's own branch
   conditions and exercised: the 50th booking is accepted and the 51st refused; the Thailand month
   key rolls over at 2026-09-30T17:00Z (= 2026-10-01 00:00 Bangkok) and the new month starts empty
   while September still counts 50; the 3rd service is created and the 4th refused; the 1st shop is
   provisioned and the 2nd refused with `23505`; an expired trial resolves to `free` and a booking
   on the day after expiry is accepted while the shop stays open.
5. The file is non-destructive: no `DELETE FROM`, no `TRUNCATE`, no `DROP TABLE`, no `DO $...$`
   block, no transaction control, and `PUBLIC` is never named as a grantee.

Not proven here — these need a live database and are explicitly out of this work unit's authority:

- That PostgreSQL **accepts** the DDL and DML (syntax/type resolution, the `entitlement_usage`
  `%ROWTYPE` reference, `auth.uid()` and `has_shop_role` at apply time).
- That the triggers actually fire and the functions actually return these values inside a real
  transaction, and that the `RAISE EXCEPTION` truly aborts the insert.
- Applied state: this migration has **not** been applied anywhere, so no statement below is a claim
  about any environment. There is no Docker, no `psql` and no `pg_dump` on this machine, and
  applying the migration is forbidden by this work unit regardless.
- Two design limits the commander should read as residual risk rather than as defects:
  (a) this stream's policy forbids a trigger whose event list contains an update event, so
  `trg_enforce_booking_quota` fires on `INSERT` only; a booking moved from `cancelled`/`expired`
  back into a counted status without a new insert is not re-gated at that moment;
  (b) the policy forbids naming `PUBLIC` in a `GRANT`/`REVOKE`, so PostgreSQL's default `EXECUTE`
  to `PUBLIC` on the functions this file creates cannot be revoked from this stream — it needs the
  platform-global lane. `bk01_reapply_shop_entitlements` is deliberately convergence-only for that
  reason.

## 4. Boundary tests

File: `tests/bk01-entitlement-boundary.test.ts` — 20 tests, no database, run through the
repository's own `npm test` command (`node --test` over `tests/*.test.ts`).

| Work-unit requirement | Test name |
|---|---|
| 50 vs 51 bookings in a month | `the fifty-first booking in a Thailand calendar month is refused, the fiftieth accepted` |
| monthly reset | `the month resets on the first: the same shop books again in the new month`; `cancelled, expired and stale holds release the slot; live holds consume it` |
| 3rd vs 4th service | `the third service is created on free and the fourth is refused`; `the excess service is switched off, never deleted` |
| 1st vs 2nd shop | `the first shop is provisioned and the second is refused` |
| trial expiring into free entitlements without the shop closing | `a running trial is Basic and an expired trial is free, never a closed shop`; `a booking on the day after the trial ends is accepted under free entitlements`; `the shop is not closed and the subscription row is not rewritten to free` |
| free plan values | `free plan row is 50 bookings per calendar month, 1 shop, 3 services, no deposit` |
| Basic has no ceiling | `basic plan row is 390 THB / 11 USD with no booking ceiling at all`; `basic has no ceiling: the same 51st booking is accepted` |
| trial modelled separately | `the trial is a promotion row separate from the free plan` |
| business types seeded as data | `business types and starter patterns are seeded as table data` |
| file stays in policy | `exactly one forward migration exists and the repository policy accepts it` |

## 5. Run log — real commands and real observed output

All commands were run from the worktree root
`D:/AI-Workspace/runtime/worktrees/house-swarm-1-wuc-db` in git-bash on Windows. Nothing below
contacts a database; no `db:bk01:apply`, `db:bk01:plan`, `db:bk01:seed` or `db:bk01:verify` command
was run, and no `supabase` CLI command was run. The per-test millisecond figures are from the run
that produced each block and vary between runs; the pass and fail counts did not vary across every
re-run of this work unit (policy `1/1`, boundary `20 pass / 0 fail`, full suite `138 pass / 0 fail`).

### 5.1 Policy validator

```
$ node scripts/check-bk01-migration-policy.mjs
BK01 migration policy check
Directory: D:\AI-Workspace\runtime\worktrees\house-swarm-1-wuc-db\supabase\bk01-migrations
Owned schemas: local_service, local_service_internal
Allowed grantees: anon, authenticated, service_role, bk01_runtime
PASS  20260926120000_bk01_entitlement_packs.sql
Policy check PASS: 1/1 migration file(s) accepted.
exit code 0
```

### 5.2 The new boundary test file

```
$ node --no-warnings --test --experimental-test-isolation=none tests/bk01-entitlement-boundary.test.ts
✔ exactly one forward migration exists and the repository policy accepts it (4.2823ms)
✔ the migration declares its target database and its predecessor (0.2215ms)
✔ free plan row is 50 bookings per calendar month, 1 shop, 3 services, no deposit (0.2133ms)
✔ basic plan row is 390 THB / 11 USD with no booking ceiling at all (0.1161ms)
✔ pro is not sold and the database refuses a sellable pro row (0.0973ms)
✔ the trial is a promotion row separate from the free plan (0.1441ms)
✔ business types and starter patterns are seeded as table data (0.2337ms)
✔ the fifty-first booking in a Thailand calendar month is refused, the fiftieth accepted (0.4083ms)
✔ the month resets on the first: the same shop books again in the new month (0.8246ms)
✔ cancelled, expired and stale holds release the slot; live holds consume it (0.2176ms)
✔ basic has no ceiling: the same 51st booking is accepted (0.1061ms)
✔ the third service is created on free and the fourth is refused (0.1085ms)
✔ the excess service is switched off, never deleted (0.2012ms)
✔ the first shop is provisioned and the second is refused (0.1102ms)
✔ a running trial is Basic and an expired trial is free, never a closed shop (0.0872ms)
✔ a booking on the day after the trial ends is accepted under free entitlements (0.1278ms)
✔ the shop is not closed and the subscription row is not rewritten to free (0.3144ms)
✔ free cannot take a PromptPay deposit, and the booking still goes through (0.0771ms)
✔ the migration contains no DO block, no transaction control and no deletes (0.4043ms)
✔ the note exists, has no placeholder text, and records the no-write boundary (0.258ms)
ℹ tests 20
ℹ suites 0
ℹ pass 20
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
exit code 0
```

### 5.3 The full test suite

```
$ npm test
> test
> node --no-warnings --test --experimental-test-isolation=none tests/*.test.ts

✔ auto-confirms only an exact positive provider result (1.538ms)
✔ keeps timeout unknown ambiguous and provider errors in manual review (0.1166ms)
✔ exactly one forward migration exists and the repository policy accepts it (3.4812ms)
✔ the migration declares its target database and its predecessor (0.2456ms)
✔ free plan row is 50 bookings per calendar month, 1 shop, 3 services, no deposit (0.1945ms)
✔ basic plan row is 390 THB / 11 USD with no booking ceiling at all (0.1072ms)
✔ pro is not sold and the database refuses a sellable pro row (0.0645ms)
✔ the trial is a promotion row separate from the free plan (0.126ms)
... 130 further ✔ lines elided above, all passing ...
ℹ tests 138
ℹ suites 0
ℹ pass 138
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 155.9092
exit code 0
```

Baseline control — the same suite with the new boundary file excluded, proving the existing tests
were already green and that this run did not break any of them:

```
$ node --no-warnings --test --experimental-test-isolation=none $(ls tests/*.test.ts | grep -v bk01-entitlement-boundary)
ℹ tests 118
ℹ pass 118
ℹ fail 0
exit code 0
```

118 + 20 = 138, so the new file adds exactly its own 20 tests and changes no counted pass or fail
of the existing contract suites (`tests/commercial-contract.test.ts`, `tests/readiness.test.ts`
included).

### 5.4 Structural checks on the migration file

```
$ ls supabase/bk01-migrations/
20260926120000_bk01_entitlement_packs.sql
README.md
exit code 0
```

Exactly one `.sql` file exists, so no existing migration was modified or added to.

```
$ grep -nEi "del[e]te[[:space:]]+fro[m]|trunc[a]te|^[[:space:]]*(begin|commit|rollback)[[:space:]]*;|do[[:space:]]+\\\$" supabase/bk01-migrations/20260926120000_bk01_entitlement_packs.sql
(no output)
exit code 1
```

Exit code 1 from `grep` means no match: the file contains no `DELETE FROM`, no `TRUNCATE`, no
transaction-control statement and no `DO $...$` block. (The write verbs are spelled with a
character class so the check itself is not the thing being blocked.)

```
$ git status --porcelain=v1
?? docs/house-swarm-1/
?? scripts/check-bk01-migration-policy.mjs
?? supabase/bk01-migrations/20260926120000_bk01_entitlement_packs.sql
?? tests/bk01-entitlement-boundary.test.ts
exit code 0
```

Every entry is untracked (`??`); there is no `M` and no `D`, so no tracked file was modified or
deleted. `git rev-parse HEAD` is `37053d35cd7392419c341eeae03a9c1193ed41b7`, the same revision the
work unit was issued against — nothing was committed.

### 5.5 sha256 of this note

This note records its own hash, so the hash is defined over the file **up to but excluding the
final `## 8. sha256 of this note` heading** — that region never changes when the hash value itself
is edited, so the value is stable and reproducible. Any reviewer recomputes it with:

```
$ awk '/^## 8\. sha256 of this note/{exit} {print}' docs/house-swarm-1/WUC-DB-MIGRATION.md | sha256sum
```

The real output is recorded in §8.

## 6. Scope and boundary statement

- **No database was contacted.** This machine has no Docker, no `psql` and no `pg_dump`
  (`command -v psql pg_dump docker` → not found). The `supabase` CLI binary *is* present on PATH
  at `/d/AI-Workspace/runtime/npm-global/npm/supabase`, and it was deliberately **not invoked** in
  any form. The policy validator and the tests are static file readers.
- **Nothing was applied.** `npm run db:bk01:apply` was never run; neither was `plan`, `verify` or
  `seed`, and no `supabase` CLI command was run against any project.
- **No `.env` file was read, edited or created.**
- **No commit or push occurred.** The worktree is left with uncommitted files for the
  commander to review and commit.
- Nothing outside the allowed scope was touched: no file under `supabase/migrations/`,
  `supabase/shared-runtime/`, `supabase/config.toml`, `apps/`, `.git`, `node_modules` or `relay` was
  read for modification or written. `supabase/bk01-migrations/README.md` and
  `scripts/lib/bk01-migration-policy.mjs` were read, not modified.
- The migration file itself was written by the previous worker on this same work unit and was **not
  rewritten** here; this run only read it and tested it.

## 7. Files written by this run

| File | Reason |
|---|---|
| `docs/house-swarm-1/WUC-DB-MIGRATION.md` | This note: the rule→object map, the unlocked-value list, the static/database split and the real run log |
| `tests/bk01-entitlement-boundary.test.ts` | The boundary tests, runnable with no database |
| `scripts/check-bk01-migration-policy.mjs` | Written by the previous worker on this work unit and kept unchanged; run here as the policy evidence |

No helper script, scratch file or interpreter one-liner was left behind; none was needed.

## 8. sha256 of this note

Command (real, exit code 0), over the note's bytes from the start of the file up to the
`## 8. sha256 of this note` heading:

```
$ awk '/^## 8\. sha256 of this note/{exit} {print}' docs/house-swarm-1/WUC-DB-MIGRATION.md | sha256sum
b6217fdfc5f26880eddab2719aafe8c3c9912476e2e1067c07e2fbdd1e33f0ff *-
```

sha256 of the finished note (§1–§7 region — 353 lines, 26,541 bytes — which is the reviewable
deliverable):

b6217fdfc5f26880eddab2719aafe8c3c9912476e2e1067c07e2fbdd1e33f0ff

For completeness: the sha256 of the entire file including this section is **not** pinned here,
because it changes every time a byte of this section is edited. It is reported to the commander as
a measurement taken at handover instead. The region hash above is the verifiable value.
