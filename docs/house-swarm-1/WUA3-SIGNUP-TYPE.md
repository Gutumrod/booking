# WUA3-SIGNUP-TYPE — Signup by business type with starter patterns

Work unit: H1-WUA3-SIGNUP-TYPE (record completed under H1-WUA3-R2-NOTE)
Correlation id: house-swarm-1-wua3-r2-20260926
Role class: implementation
Status: IMPLEMENTED AND VERIFIED IN THIS WORKTREE (client-side only; server work is NOT APPLIED)
Worktree: `D:/AI-Workspace/runtime/worktrees/house-swarm-1-wua3`
Branch: `feature/house-swarm-1-wua3-signup`
Revision under test: `37053d35cd7392419c341eeae03a9c1193ed41b7`
Governing rule: Addendum A decision 3 + L-12 (design for growth without a rebuild)

This record was written by a worker that did NOT implement the feature. It only ran
the verification commands and recorded what they printed. Nothing was
re-implemented, nothing outside `apps/booking-admin/src/`, `apps/booking-admin/messages/`,
`tests/` and `docs/` was touched.

## 1. What was implemented

Signup now asks what kind of business the shop is, as the FIRST of four steps, and
applies the starter pattern that belongs to that type.

1. **Business types are declared as data.** `apps/booking-admin/src/lib/business-type-catalogue.ts`
   exports `BUSINESS_TYPES: readonly BusinessTypeDefinition[]` — one entry per business
   type, each carrying its example services (key + whole-minute duration) and its
   opening hours for all seven weekdays. The signup page contains no per-type branch;
   it renders `listBusinessTypes()` and looks up the chosen entry with
   `getBusinessType(...)`. The new test asserts the page contains no
   `businessType === 'hair_barber' | 'beauty_salon' | 'nail_salon'` conditional.
2. **The type is asked for and required before the flow continues.** Step 1 shows one
   selectable card per type (label + description + number of example services), sourced
   from the catalogue and the `businessType` message namespace. On the last step the
   submit handler blocks if the type is missing or unknown (`businessTypeRequired`).
   An unknown id is rejected, never silently defaulted: `getBusinessType()` returns
   `null` and `buildSignupIntent()` returns `null`.
3. **The pattern is previewed before signup.** Once a type is chosen, the page lists the
   example services with their durations and the seven weekday opening-hours lines,
   rendered in the active locale by `summarizeOpeningHours(pattern, { dayNames, closedLabel })`.
   The copy states the pattern is editable after the shop is created.
4. **Selecting the type prefills the free-text business category** with
   `businessType.<messageKey>.label` (still editable, still overridable by the existing
   suggestion chips).
5. **The payload records the type, the pattern and the plan.** `buildSignupIntent({ businessType, selectedPlan })`
   produces the intent; the signup writes these fields onto its `PendingRegistration`
   payload: `businessType`, `businessTypeKey`, `patternId`, `patternVersion`,
   `patternServiceCount`, `patternTotalDurationMinutes`, `patternServiceKeys`,
   `patternWorkingDays`, plus `selectedPlan: intent.selectedPlan`. The intent's keys are
   stable snake_case (`business_type`, `pattern_id`, `pattern_version`, …) so a future
   server or analytics write can consume them unchanged.
6. **Pattern identity is versioned.** `BUSINESS_TYPE_PATTERN_VERSION = 1` and
   `getPatternId(type)` returns `<id>.v1`, so a later edit to a pattern stays analysable.
7. **Thai and English copy exist** under the `businessType` namespace plus the Step-1
   `auth` copy, with the same key set in both catalogues (proved by a run, §5).
8. **Tests.** `tests/signup-business-type.test.ts` adds 9 tests: catalogue completeness
   per defined type, the type-id list, unknown/missing type rejection, every defined type
   accepted with type + pattern + plan recorded, the page driven by catalogue data rather
   than conditionals, TH/EN key-set parity, four-step copy, the locale summariser, and
   the validator returning no issues.

## 2. The business types and what each starter pattern contains

Read from `BUSINESS_TYPES` (four types, in the order the signup offers them). `dayOfWeek`
is 0 = Sunday, matching `DashboardScheduleDay`/`dashboard.dayNames`. Durations are whole
minutes. Totals below are the sum over the type's services.

| type id | i18n key | example services (duration) | services | total | opening hours | weekly break | closed |
|---|---|---|---|---|---|---|---|
| `hair_barber` | `businessType.hairBarber` | `haircut` 30, `haircutWash` 45, `beardTrim` 15, `washSet` 30, `colorShort` 90 | 5 | 210 min | 10:00–20:00 | 13:00–14:00 | Mon |
| `beauty_salon` | `businessType.beautySalon` | `facialBasic` 60, `facialPremium` 90, `browShape` 30, `lashExtension` 120, `makeupEvent` 75 | 5 | 375 min | 10:00–19:00 | 12:00–13:00 | Sun |
| `nail_salon` | `businessType.nailSalon` | `manicure` 45, `pedicure` 60, `gelPolish` 75, `nailArt` 90, `extensionSet` 120 | 5 | 390 min | 10:00–20:00 | 12:00–13:00 | none (open every day) |
| `other` | `businessType.other` | `consultation` 30, `standardService` 60, `servicePackage` 90, `followUp` 30 | 4 | 210 min | 09:00–18:00 | 12:00–13:00 | Sun |

The three named groups come from the product README (primary ICP "single-location
hair/barber/beauty/nail", `README.md:32`); `other` is the catch-all required by
Addendum A (WU-A3 "เริ่มจากกลุ่มหลักใน README … + อื่นๆ").

Opening-hours days per type, as declared (`weeklyHours(...)` with `openDays`):

- `hair_barber`: `TUE_TO_SUN` = `[2,3,4,5,6,0]` → closed Monday only.
- `beauty_salon` and `other`: `MON_TO_SAT` = `[1,2,3,4,5,6]` → closed Sunday only.
- `nail_salon`: `EVERY_DAY` = `[0,1,2,3,4,5,6]` → open all seven days.

Each type therefore carries `pattern_working_days` (sorted working weekdays) on the
payload: `hair_barber` `[0,2,3,4,5,6]`, `beauty_salon` `[1,2,3,4,5,6]`,
`nail_salon` `[0,1,2,3,4,5,6]`, `other` `[1,2,3,4,5,6]`.

Deliberate omissions, by design: **no prices and no deposit amounts** — pricing is an
Owner decision (Addendum A), so a starter pattern never carries money. Also no
per-type colour, logo or copy beyond label/description/services/closed-day label.

## 3. How to add a new business type by data alone

Two edits, no page change, no component change, no new branch:

1. Add one entry to `BUSINESS_TYPES` in `apps/booking-admin/src/lib/business-type-catalogue.ts`:
   - `id`: snake_case, unique (`/^[a-z][a-z0-9_]*$/`), e.g. `'spa_massage'`.
   - `messageKey`: lowerCamelCase, unique (`/^[a-z][a-zA-Z0-9]*$/`), e.g. `'spaMassage'`.
   - `pattern.services`: at least 3 entries, each `{ key: <lowerCamelCase, unique within the type>, durationMinutes: <positive integer, multiple of 15> }`.
     The multiple-of-15 rule exists so a later server write satisfies the existing
     duration contract without a rewrite.
   - `pattern.openingHours`: exactly 7 entries covering `dayOfWeek` 0..6 exactly once.
     Build them with the provided helper
     `weeklyHours(openDays, open, close, breakStart, breakEnd)` — closed weekdays get
     `isOpen: false` and all four time fields `null`; open weekdays need `HH:MM`
     `open`/`close` with `close > open`, and the break must be both-or-neither and sit
     inside the opening hours.
2. Add matching copy under key `businessType.<messageKey>` in **both**
   `apps/booking-admin/messages/th.json` and `apps/booking-admin/messages/en.json`:
   `label`, `description`, and `services.<key>` for every service key declared in step 1.
   The two files must contain the identical key set (the test compares the flattened
   key trees with `assert.deepEqual`).

Nothing else is required. On the next run `validateBusinessTypeCatalogue()` and
`tests/signup-business-type.test.ts` enforce: unique ids and message keys, snake_case id,
lowerCamelCase messageKey and service keys, ≥3 services, integer durations that are
multiples of 15, seven weekday rows with no duplicate/closed-day hours, `HH:MM` format,
`close > open`, and breaks inside opening hours. A new type is therefore offered by the
signup, previewed, summarised in Thai and English and recorded on the payload purely by
adding data. This is the L-12 property the work unit asked for.

## 4. Applied at signup time on the client vs. still missing on the server (NOT APPLIED)

**Applied on the client at signup (implemented, in this worktree):**

- Step 1 asks for the business type and refuses to advance without a valid one.
- Options, labels, descriptions and service counts come from `BUSINESS_TYPES` data.
- The selected type prefills the free-text `businessCategory` field (editable).
- The starter pattern is previewed in the active locale (services + durations + weekday
  hours) and the copy states it is editable/deletable afterwards.
- `buildSignupIntent({ businessType, selectedPlan })` is the single decision point; an
  unknown or missing type yields `null` and an error message, not a default type.
- The client-side pending-registration payload (localStorage key
  `local-service.pending-owner-registration`) carries the type, the pattern identity and
  the plan alongside the existing shop/owner/PromptPay fields.

**NOT APPLIED — server / SQL work that still remains (nothing below was done here):**

- **No database and no SQL was touched for this feature.** There is no migration, no new
  column, no new table and no RPC change in this worktree for business types.
- The provisioning RPC `provision_owner_shop` is called with its existing parameters only
  (`p_shop_name`, `p_shop_slug`, `p_business_category`, `p_owner_name`, `p_owner_phone`,
  `p_promptpay_number`, `p_promptpay_name`, `p_requested_plan`, `p_idempotency_key`). It
  does **not** receive the business type, the pattern id or the pattern contents.
  Extending the RPC to accept them is NOT APPLIED.
- **The starter pattern is never persisted.** No code writes the pattern's example
  services (name + duration) or its opening hours into shop services or opening-hours
  rows on the server. A shop created today therefore gets the pattern only as a client-side
  preview and a client-side payload — it is not yet a real service list or real opening
  hours in the database.
- **No durable record of the type/pattern for analysis.** The pattern fields live only in
  the localStorage payload, and on successful provisioning the page removes that key, so
  the type and pattern are discarded rather than stored for later analysis. Addendum A's
  "record the type + pattern + plan of the shop for analysis" is therefore only half
  satisfied: recorded on the payload (done, and asserted by test), persisted server-side
  (NOT APPLIED). A resume-after-email path re-reads that same payload, so a resumed signup
  behaves identically — and also loses the fields afterwards.
- **No server-side validation of the business type.** Nothing rejects an unknown
  `business_type` at the database or API boundary; the only check is the client-side
  catalogue lookup. A server-side allow-list / constraint is NOT APPLIED.
- **No server-side catalogue or API for listing types.** The type list ships with the
  client bundle; there is no endpoint serving it. Not required by this work unit.
- **Pricing/quota/entitlement work (WU-A1) and the LINE-login work (WU-A4) are separate
  work units and are NOT part of this change.** The three plan ids on the payload are the
  pre-existing `free_trial | basic_490 | pro_990`; this change records the selected plan
  but does not add the `free` plan, does not change price, and does not enforce quota.
  `apps/booking-admin/src/lib/commercial-contract.ts` still exposes only
  `basic_490 | pro_990`, with reference prices still marked `pilot-reference-not-final`.
  Any price change is an Owner decision and was not made here.

## 5. Commands, exit codes and observed output

All commands were run from the worktree root unless stated otherwise, on 2026-09-26
(Asia/Bangkok). Exit codes are the real reported codes.

**5.1 Precondition of the admin typecheck (a clean tree has no generated route types).
`apps/booking-admin/.next` was moved aside to the local temp directory to observe this
exactly, then regenerated in 5.2.**

    $ cd apps/booking-admin && npx tsc --noEmit
    src/app/layout.tsx(23,56): error TS2304: Cannot find name 'LayoutProps'.
    EXIT: 2

This is the known precondition of this repository, **not a source defect**: `layout.tsx`
uses the Next-generated `LayoutProps` helper, which exists only after route types are
generated. `Next` 16.3.0 requires `next typegen` first. Recorded so the next reader does
not mistake the bare typecheck failure for a real error.

**5.2 Type generation, then the real typecheck.**

    $ cd apps/booking-admin && npx next typegen
    Generating route types...
    ✓ Types generated successfully
    EXIT: 0

    $ cd apps/booking-admin && npx tsc --noEmit
    (no output)
    EXIT: 0

**5.3 Lint (both workspaces, root script).**

    $ npm run lint
    > booking-consumer@0.1.0 lint
    > booking-admin@0.1.0 lint
    ...
    ✖ 6 problems (0 errors, 6 warnings)     [booking-consumer]
    ✖ 6 problems (0 errors, 6 warnings)     [booking-admin]
    EXIT: 0

0 errors. The 12 warnings are pre-existing and in files this change did not touch
(unused `Coffee`/`ShieldAlert`/`Send`/`router`/`selectedPriority`/`Phone`/`planLabel`/
`canTransition`, and `<img>` usage). Grepping the lint report for the WU-A3 files
(`business-type-catalogue.ts`, `register/page.tsx`, `signup-business-type.test.ts`)
returned NONE — no warning is attributed to this change.

**5.4 Full test suite.**

    $ npm test
    ✔ every defined business type carries a complete starter pattern
    ✔ the catalogue names the README main groups plus an other category
    ✔ an unknown or missing business type is rejected, never defaulted
    ✔ signup accepts every defined type and records the type, pattern and plan
    ✔ signup refuses a missing or unknown business type
    ✔ the signup page drives the type and pattern from catalogue data, not from conditionals
    ✔ Thai and English business-type copy exist with the same key set
    ✔ signup step copy states the four-step flow in both languages
    ✔ opening hours summarise in the active locale with a closed-day label
    ℹ tests 127
    ℹ pass 127
    ℹ fail 0
    EXIT: 0

`tests/signup-business-type.test.ts` contains 9 `test(` calls; all 9 are in the passing
127. The run above is the evidence for "a test covers that each defined type has a
complete pattern and that each type is accepted": test 1 asserts
`validateBusinessTypeCatalogue()` deep-equals `[]` and then re-checks every type's
services/durations/7 weekdays directly; test 4 calls `buildSignupIntent(...)` for every
defined type and for all three plan ids and asserts the recorded pattern fields.

**5.5 Integrity of this note.**

The hash tool was validated against a known vector first —
`printf 'abc' | sha256sum` → `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`,
the correct SHA-256 of `abc`. Two commands were then used:

1. `sha256sum docs/house-swarm-1/WUA3-SIGNUP-TYPE.md` — hashes the whole file.
2. `head -n -1 docs/house-swarm-1/WUA3-SIGNUP-TYPE.md | sha256sum` — hashes the same
   content with the final line removed.

The value produced by the second command is the one printed on the final line of this
file, so the self-reference is checkable by re-running exactly that pipeline. Only the
trailing hash line is excluded from its own hash; the rest of the file is covered in full.
The whole-file hash is intentionally not repeated here, because writing it into the body
would change it again — run command 1 to obtain it.

## 6. Honesty statement for this work unit

- **No database connection was attempted.** No Postgres or Supabase connection was
  opened, no migration was run, no `supabase` CLI was invoked, nothing was deployed. The
  only commands run were `git status`/`git diff`/`git check-ignore`/`git rev-parse`,
  `npx next typegen`, `npx tsc --noEmit`, `npm run lint`, `npm test`, `sha256sum`,
  `awk`/`grep`/`wc`/`ls`/`date`, and a `mv` of the ignored `apps/booking-admin/.next`
  directory.
- **No `.env` file was read, created or edited** — not `.env`, `.env.local` or
  `.env.staging.local`. (Only `apps/booking-admin/.env.example` and
  `apps/booking-admin/.env.staging.example` were even listed by a directory listing; they
  are templates and were not read.) The admin typecheck needs no environment values;
  `npm test` runs offline unit tests and the test suite passed without any secrets.
- **No commit and no push occurred.** No `git add`, `git commit` or `git push` was run.
  `git status --porcelain` after all runs still shows exactly the three modified and three
  untracked paths listed in §7, and `HEAD` is still
  `37053d35cd7392419c341eeae03a9c1193ed41b7`.
- Nothing was re-implemented: this unit only ran verifications and wrote this record.
- The `.next` directory moved aside in 5.1 was restored by the typegen run in 5.2; it is
  git-ignored (`apps/booking-admin/.gitignore:17:/.next/`), so the tree is unchanged by it.
- This record states only results that were observed in this run. No claim of "100%",
  "perfect", or any benchmark speed is made.

## 7. Changed files across the whole change (with one-line reasons)

Uncommitted, as shown by `git status --porcelain` and `git diff --numstat`:

1. `apps/booking-admin/src/lib/business-type-catalogue.ts` — **new** (393 lines). The
   data-only catalogue: the four business types with their starter patterns (services +
   durations + 7-weekday opening hours), the versioned pattern id, the signup-intent
   builder that records type + pattern + plan, the locale-agnostic opening-hours
   summariser, and the structural validator. Keeps the signup free of per-type branches.
2. `apps/booking-admin/src/app/register/page.tsx` — **modified** (+181/−17). Adds the
   business-type step as Step 1 (was a 3-step flow), renders the options from
   `listBusinessTypes()`, blocks progress without a valid type, previews the pattern, and
   writes the type/pattern/plan fields onto the pending-registration payload.
3. `apps/booking-admin/messages/th.json` — **modified** (+60/−3). Thai `businessType`
   namespace (4 labels, 4 descriptions, 19 service labels, `closedDay`) plus the Step-1
   `auth` copy, and the step titles renumbered to /4.
4. `apps/booking-admin/messages/en.json` — **modified** (+60/−3). The matching English
   copy with the identical key set (asserted equal by test).
5. `tests/signup-business-type.test.ts` — **new** (230 lines, 9 tests). Catalogue
   completeness per type, id list, unknown-type rejection, every type accepted with
   type/pattern/plan recorded, page-data-not-conditionals, TH/EN key-set parity,
   four-step copy, locale summariser.
6. `docs/house-swarm-1/WUA3-SIGNUP-TYPE.md` — **new**. This record (was a heading stub).

No other path was modified. `apps/booking-admin/AGENTS.md` (the Next.js agent-rules block
that `next dev` rewrites) was **not** touched by this work unit.

---

sha256 of this note's content excluding this final hash line: 750af7cbace46bb775b859ea9e7e1101c50760b4a3015df9d232301154a1c404
