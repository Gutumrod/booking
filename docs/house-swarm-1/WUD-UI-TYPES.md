# WUD-UI-TYPES — the signup business-type list comes from the database

Work unit: H1-WUD-UI-TYPES (this record covers the R3 close-out, H1-WUD-UI-TYPES-R3)
Correlation id: house-swarm-1-wud-ui-r3-20260926 (this run) · house-swarm-1-wud-ui-20260926 (original)
Role class: implementation
Worktree: `D:/AI-Workspace/runtime/worktrees/house-swarm-1-wua3`
Branch: `feature/house-swarm-1-wua3-signup`
Revision at the start of this run: `3f3a10321499b9621d32bbeed856aa4063a14604`
Governing decisions: review finding N-4 (R3 review, 2026-09-26) + Addendum D entry N-4
(DB is the single source of type codes; the WU-A3 UI must read the list instead of
embedding codes).

Every command result written below is copied from the real run of this work unit.

---

## 1. The read surface: view and schema

The signup reads **`local_service.app_business_types`** — a VIEW, not the table.
The authoritative definition is `supabase/bk01-migrations/20260926120000_bk01_entitlement_packs.sql`,
view definition at line 327 (verified in the migration lane worktree
`D:/AI-Workspace/runtime/worktrees/house-swarm-1-wuc-db`):

    CREATE OR REPLACE VIEW local_service.app_business_types AS
    SELECT type_code, emoji, label_th, label_en, display_order
    FROM local_service.business_types
    WHERE is_active = true
    ORDER BY display_order ASC, type_code ASC;

    REVOKE ALL ON TABLE local_service.app_business_types FROM PUBLIC, anon, authenticated;
    GRANT SELECT ON TABLE local_service.app_business_types TO authenticated;

Its **five columns**, in this order and no other:

    type_code · emoji · label_th · label_en · display_order
    TEXT      · TEXT  · TEXT     · TEXT     · INTEGER

Two facts about the view shape what the UI does and are relied on here:

- The view already returns **only active rows, already ordered** (`display_order ASC,
  type_code ASC`), so the app neither filters nor re-sorts. It cannot disagree with the
  order the database gives.
- The view is granted to **`authenticated` only** — `anon` is deliberately not granted.
  An anonymous visitor therefore reads an error, not a list, and sees the explanatory
  state in §3 rather than a list.

The client's default schema is already `local_service`
(`apps/booking-admin/src/lib/supabase/client.ts`, `db: { schema: 'local_service' }`), so
the view name is used unqualified in the read: `.from('app_business_types')`.

## 2. The database is the single source of the codes

No list of business-type codes remains as an authority anywhere in the app.

- `apps/booking-admin/src/lib/business-type-view.ts` holds **no code list**. It reads the
  view and nothing else. Verified statically (this run): grepping the module for any of
  the nine seeded codes as a quoted string returns nothing —

      $ grep -nE "['\"](barber|car_care|nail_lash|beauty_clinic|spa_massage|studio|sport_court|pet_grooming|other)['\"]" apps/booking-admin/src/lib/business-type-view.ts
      (no output)

  and the same module contains no `BUSINESS_TYPES` / `listBusinessTypes` identifier.
  `tests/business-type-view.test.ts` asserts this directly ("the app carries no business
  type code list", and the column/table assertions in the first test).
- The nine codes the migration lane seeds (`barber`, `car_care`, `nail_lash`,
  `beauty_clinic`, `spa_massage`, `studio`, `sport_court`, `pet_grooming`, `other`, at
  `display_order` 1..9) exist in the test files **only as fixtures describing what the
  database returns**, never as a list the app renders. The tests feed them as view rows.
- A code the app-invented WU-A3 set used (`hair_barber`, `beauty_salon`, `nail_salon`) is
  asserted to be gone: `tests/signup-business-type.test.ts` requires
  `findBusinessPattern()` to return null for them and requires the signup page to contain
  none of them.

### The mappings that DO remain in code (both are mappings, not code lists)

1. **Locale → stored label column**, in `business-type-view.ts`:

       BUSINESS_TYPE_LABEL_COLUMN = { th: 'label_th', en: 'label_en' }

   The view stores both languages on the row; the app maps the active locale to the
   stored column it shows. Anything that is not `en` resolves to `th`
   (`resolveBusinessTypeLabelLocale`). This is the only mapping the view module keeps, and
   it maps a locale to a column name — not to a type code.

2. **Bundled starter patterns keyed by four stored codes**, in
   `apps/booking-admin/src/lib/business-type-catalogue.ts`:
   `BUSINESS_PATTERNS` is keyed by `barber`, `beauty_clinic`, `nail_lash`, `other` — a
   SUBSET of the nine seeded codes. This is a keyed lookup, not a list: a code the
   database returns with no bundled pattern resolves to `null`
   (`findBusinessPattern`), and the signup accepts that type and records
   `pattern_source: 'none'` / `pattern_id: null` rather than inventing a pattern. The
   other five seeded codes (`car_care`, `spa_massage`, `studio`, `sport_court`,
   `pet_grooming`) currently have no bundled pattern and take exactly that path. This is
   deliberate and covered by tests ("a database code with no bundled pattern is accepted
   and says so on the payload"). Adding a pattern for the remaining codes is separate
   work, not an authority question: **the database remains the only source of which codes
   exist.**

The signup page (`apps/booking-admin/src/app/register/page.tsx`) contains **no code
literal**. It selects from the rows the view returned, prefills the free-text category
from the chosen row's database label, and builds the intent with
`source: BUSINESS_TYPE_VIEW_QUALIFIED` (`'local_service.app_business_types'`).

## 3. Honest degradation: the states that exist

When the type list cannot be read, the UI shows an explanatory state. It never invents a
list and never falls back to embedded codes. The states are:

| state | when | what the signup shows |
|---|---|---|
| `loading` (page-only) | before the read resolves | `auth.businessTypeLoading` |
| `loaded` | the view returned at least one complete row | the type cards, drawn only from returned rows |
| `empty` | the view returned a well-formed EMPTY array (no error) | `auth.businessTypeEmpty` — no cards |
| `unavailable` | a client error, a rejected read, a non-array response, or ANY malformed row | `auth.businessTypeUnavailable` — no cards, no list |

`BusinessTypeListStatus = 'loaded' | 'empty' | 'unavailable'`; the page widens it with
`'loading'`. `empty` and `unavailable` are kept apart on purpose so the step can say which
happened. A separate message (`auth.businessTypePatternUnavailable`) covers a returned
type that has no bundled starter pattern.

Parsing is all-or-nothing (`parseBusinessTypeRows`): one malformed row makes the whole
list `unavailable`, because a half-parsed list would be a broken list. A row is complete
only when `type_code` is non-empty and matches `^[a-z][a-z0-9_]*$`, `emoji`/`label_th`/
`label_en` are non-empty text, and `display_order` is an integer. Every failure path
returns `types: []`.

All four states have real copy in both catalogues
(`apps/booking-admin/messages/th.json`, `en.json`), and
`tests/signup-business-type.test.ts` asserts each key exists in both and is rendered by
the page. Because the view is granted to `authenticated` only, the anonymous case lands in
`unavailable` by design.

## 4. Change one — the module-loading defect, fixed by injection

**Defect.** `business-type-view.ts` imported the browser client at module scope:

    import { createClient } from './supabase/client';   // was line 33

Next resolves the extensionless specifier, so the app built. The node test runner loads
these files as **real ESM** and refuses an extensionless specifier, so
`tests/business-type-view.test.ts` could not even load:

    Error [ERR_MODULE_NOT_FOUND]: Cannot find module
      '...\apps\booking-admin\src\lib\supabase\client'
      imported from '...\apps\booking-admin\src\lib\business-type-view.ts'

Adding an explicit `.ts` extension is worse: the app's `tsconfig.json` uses
`moduleResolution: "bundler"` and does NOT enable `allowImportingTsExtensions`, so `tsc`
rejects it (`TS5097`). Other tests import app modules with an explicit `.ts` extension —
that is fine at the test's own boundary; the failure is an extensionless specifier
INSIDE an imported module. So the coupling is removed instead of the specifier patched.

**Fix.**

- `apps/booking-admin/src/lib/business-type-view.ts`: the import is deleted; the module
  has **no import statement at all**. `loadBusinessTypes` now takes the client as a
  parameter and its behaviour is otherwise unchanged:

      export async function loadBusinessTypes(client: BusinessTypeReader): Promise<BusinessTypeListResult> {
        return readBusinessTypes(client);
      }

  The exported `readBusinessTypes(client)` is unchanged.

- **Injected-client shape.** The parameter type is the module's own structural interface,
  so no client type is imported:

      export interface BusinessTypeReader {
        from(relation: string): {
          select(columns: string): PromiseLike<{ data: unknown; error: unknown }>;
        };
      }

  The real client satisfies it structurally; the client module specifier is
  `lib/supabase/client.ts` (imported as `'@/lib/supabase/client'` by the page), and it
  pins `db: { schema: 'local_service' }`. No specifier for it remains inside
  `business-type-view.ts`.

- `apps/booking-admin/src/app/register/page.tsx`: the page already imports
  `createClient` from `'@/lib/supabase/client'` (line 7) and already calls it elsewhere
  (lines 156, 194, 309), so it now passes its own client into the read (call at line 131,
  was line 129):

      const result = await loadBusinessTypes(createClient());

  Nothing else about the page changed.

- `tests/business-type-view.test.ts`: the wiring assertion no longer requires the view
  module to import the client module. It now asserts the opposite, with the reason:

      assert.doesNotMatch(viewModule, /^\s*import\b[^\n]*supabase\/client/m);

  while still asserting exactly what it asserted before about the surface — view name
  `app_business_types`, qualified name `local_service.app_business_types`, column list
  `type_code,emoji,label_th,label_en,display_order`, and `schema: 'local_service'` on the
  client module. The client module is still READ by the test (its schema line is still
  pinned); it is simply no longer IMPORTED by the view module.

- `tests/signup-business-type.test.ts`: the page assertion that pinned the load call is
  updated to the page's real call — `loadBusinessTypes(createClient())` instead of
  `loadBusinessTypes()` — so the test stays truthful rather than being loosened.

## 5. Change two — the corrected test expectation

**File/line:** `tests/signup-business-type.test.ts`, in the test
`'signup refuses a missing or unusable type instead of defaulting'` (the `assert.equal`
block around lines 181–193 before this run).

**The false claim.** The test ended by asserting that `buildSignupIntent(...)` returns
`null` for `typeCode: 'other'`:

    assert.equal(
      buildSignupIntent({ type: { typeCode: 'other', emoji: '🏪', displayOrder: 9 }, ... }),
      null,                                                     // <-- the error
    );

**Why it was false.** `'other'` is one of the **nine codes the migration genuinely seeds**
(`business_type_code` seed, `display_order` 9, `emoji` 🏪, label_th `อื่น ๆ`, label_en
`Other`), and it is therefore a row the view returns. `buildSignupIntent` refuses a code
on its SHAPE only — `!/^[a-z][a-z0-9_]*$/.test(type.typeCode)` — never on which code it
is. So the assertion was the test's error, not an implementation rule; nothing in the
implementation was changed to satisfy it.

**How it was changed, and why that way.** The single wrong assertion was **corrected, not
deleted**: the null-expectation was replaced with acceptance assertions, and a comment
records the rule. The rest of the test's intent is intact — the first four assertions
(missing, undefined, empty string, `'Hair Barber'`) still assert refusal, which is the
real rule: *a missing, empty or malformed code is refused, while a real seeded code
including `'other'` is accepted.* Correcting rather than deleting keeps the seeded
catch-all covered, which is strictly stronger than the other seeded code already covered
in the test above ("a database code with no bundled pattern is accepted and says so on
the payload", which uses `spa_massage`).

    const other = buildSignupIntent({
      type: { typeCode: 'other', emoji: '🏪', displayOrder: 9 },
      label: 'อื่น ๆ',
      source: 'local_service.app_business_types',
      selectedPlan: 'free_trial',
    });
    assert.ok(other, "the seeded catch-all 'other' must be selectable, not refused");
    assert.equal(other.businessType.typeCode, 'other');
    assert.equal(other.pattern.business_type, 'other');
    assert.equal(other.pattern.business_type_source, 'local_service.app_business_types');

### Other false or unsupported claims found and corrected

- `tests/signup-business-type.test.ts` (same test, the whole point of the block): the
  test's own name says it refuses "a missing or unusable type", and it then classified a
  perfectly usable seeded code as unusable. Corrected wording as above.
- `apps/booking-admin/src/lib/business-type-view.ts` (module doc comment, before this
  run): described the read as going "through the app's Supabase client" with the specifier
  `./supabase/client.ts` — accurate as a description of the app's wiring, but it described
  a module-scope import that had to go. The comment now states the client is a parameter
  and why. No behaviour claim was false; the comment is reworded to match.
- `docs/house-swarm-1/WUD-UI-TYPES.md` (before this run, 14 lines): claimed "This file is
  being appended to while the work runs" and did not name the view, the schema, the
  columns, the states, or any gate result. That record was unsupported by content — this
  document replaces it.

## 6. Commands, exit codes and observed output

All commands were run from the worktree root unless stated otherwise, on 2026-09-26
(Asia/Bangkok). Exit codes and counts below are the real reported values from this run.

**6.1 The two target suites, before and after the fix (the same command).**

    $ node --no-warnings --test --experimental-test-isolation=none tests/business-type-view.test.ts

    BEFORE the fix:
      Error [ERR_MODULE_NOT_FOUND]: Cannot find module '...src\lib\supabase\client'
        imported from '...src\lib\business-type-view.ts'
      ℹ tests 1  ℹ pass 0  ℹ fail 1
      EXIT: 1

    $ node --no-warnings --test --experimental-test-isolation=none \
        tests/business-type-view.test.ts tests/signup-business-type.test.ts

    AFTER the fix:
      ✔ the app reads exactly the view the migration lane named, on the local_service schema
      ✔ the read path asks the view for its five columns and carries no other column
      ✔ a failing read is unavailable through the same path, and never a partial list
      ✔ the app carries no business type code list
      ✔ the one remaining code mapping is the locale to stored label column
      ✔ the seeded database codes render through the read surface
      ✔ an unreadable or malformed response is unavailable, never an invented list
      ✔ a well-formed but empty view is empty, not unavailable
      ✔ the view row parser accepts only complete rows
      ✔ every bundled starter pattern is complete
      ✔ the bundled patterns are keyed by stored type codes, never by app-invented ids
      ✔ a database code with no bundled pattern resolves to null, never to a guessed pattern
      ✔ signup records the type the database returned, with its pattern and plan
      ✔ a database code with no bundled pattern is accepted and says so on the payload
      ✔ signup refuses a missing or unusable type instead of defaulting
      ✔ the signup page renders the type list from the database view, not from an embedded list
      ✔ the signup page degrades honestly when the type list cannot be read
      ✔ Thai and English pattern copy exist with the same key set
      ✔ signup step copy states the four-step flow in both languages
      ✔ opening hours summarise in the active locale with a closed-day label
      ℹ tests 20  ℹ pass 20  ℹ fail 0  ℹ cancelled 0  ℹ skipped 0  ℹ todo 0
      EXIT: 0

Both suites now LOAD and pass. Note `'signup refuses a missing or unusable type instead
of defaulting'` is in that passing 20 — the corrected expectation passes against the
unmodified implementation, which is the proof that it was the test that was wrong.

**6.2 Type generation, then the admin typecheck.**

    $ cd apps/booking-admin && npx next typegen
    Generating route types...
    ✓ Types generated successfully
    EXIT: 0

    $ cd apps/booking-admin && npx tsc --noEmit
    (no output)
    EXIT: 0

**6.3 Lint (root script, both workspaces).**

    $ npm run lint
    > booking-consumer@0.1.0 lint  →  ✖ 6 problems (0 errors, 6 warnings)
    > booking-admin@0.1.0 lint     →  ✖ 6 problems (0 errors, 6 warnings)
    EXIT: 0

0 errors. The 12 warnings are pre-existing and in files this change did not touch
(booking-consumer `book/[slug]/page.tsx` unused icons + `<img>`; booking-admin
`dashboard/page.tsx` `<img>`, `tickets/[id]/page.tsx` unused `router`/`selectedPriority`,
`tickets/new/page.tsx` unused `Phone`, `platform-admin/page.tsx` unused `planLabel`,
`lib/ticket-service.ts` unused `canTransition`). **No warning is attributed to
`business-type-view.ts`, `register/page.tsx`, `tests/business-type-view.test.ts` or
`tests/signup-business-type.test.ts`.**

**6.4 Full test suite.**

    $ npm test
    ℹ tests 138
    ℹ pass 138
    ℹ fail 0
    ℹ cancelled 0
    ℹ skipped 0
    ℹ todo 0
    EXIT: 0

138/138. `tests/business-type-view.test.ts` contributes 9 of them and
`tests/signup-business-type.test.ts` contributes 11; all 20 are in the passing 138.

## 7. Files changed in this work unit, with a one-line reason each

- `apps/booking-admin/src/lib/business-type-view.ts` — deleted the module-scope
  `./supabase/client` import (the ESM load defect) and made `loadBusinessTypes` take the
  client as a parameter; behaviour and `readBusinessTypes` otherwise unchanged.
- `apps/booking-admin/src/app/register/page.tsx` — passes the page's own
  `createClient()` into `loadBusinessTypes(...)` instead of letting the view module create
  one; no other page change.
- `tests/business-type-view.test.ts` — the wiring assertion now forbids the view module
  from importing the client module, while still pinning the view name, the qualified name,
  the five-column list and the `local_service` schema.
- `tests/signup-business-type.test.ts` — page match updated to the real call
  `loadBusinessTypes(createClient())`; the wrong `'other' → null` expectation corrected to
  acceptance of the seeded catch-all.
- `apps/booking-admin/src/lib/__pnode.ts` — DELETED (temporary probe file).
- `apps/booking-admin/src/lib/__zt.ts` — DELETED (temporary probe file).
- `apps/booking-admin/src/lib/__dynprobe.ts` — DELETED (temporary probe file).
- `docs/house-swarm-1/WUD-UI-TYPES.md` — this record, rewritten from 14 lines to a
  complete account of the surface, the rules, the changed expectation and the gate
  results.

Pre-existing, NOT written by this work unit but present in the same uncommitted change
(created by the earlier run of this lane): the untracked
`apps/booking-admin/src/lib/business-type-view.ts` itself, and the modified
`apps/booking-admin/messages/th.json`, `apps/booking-admin/messages/en.json`,
`apps/booking-admin/src/lib/business-type-catalogue.ts`.

## 8. Honesty statement for this work unit

- **No database connection was attempted.** No Postgres or Supabase connection was opened,
  no migration was run, no `supabase` CLI was invoked, nothing was deployed. The commands
  run were `git status`/`git rev-parse`, `node --test`, `npx next typegen`,
  `npx tsc --noEmit`, `npm run lint`, `npm test`, `sha256sum`, `find`, `grep`, `ls`, `cat`,
  and `rm` of the three probe files. The view definition in §1 was READ from the migration
  SQL file on disk, not executed.
- **No `.env` file was read, created or edited** — not `.env`, `.env.local` or
  `.env.staging.local`. The admin typecheck needs no environment values; `npm test` runs
  offline unit tests and passed without any secrets.
- **No commit and no push occurred.** No `git add`, `git commit` or `git push` was run.
  `HEAD` is still `3f3a10321499b9621d32bbeed856aa4063a14604`.
- **No probe or temporary file remains.** After the `rm`, a worktree-wide search for any
  path whose name begins with `__` or `tmp-` (excluding `node_modules` and `.git`) returns
  nothing.
- This record states only results observed in this run. No claim of "100%", "perfect", or
  any benchmark speed is made. Both the target suites and the full suite were run, and the
  admin typecheck was run after type generation, as reported in §6.
- The database codes and the UI agree **through the read surface**: the UI renders whatever
  rows `local_service.app_business_types` returns and holds no code list of its own. This
  is proven statically (the grep in §2 and the "carries no business type code list" test)
  and by the suites passing. It is **not** proven against a live database in this work
  unit — no SQL was executed here, and the boundary tests remain static/pure unit tests,
  as review finding N-4's context already records.
