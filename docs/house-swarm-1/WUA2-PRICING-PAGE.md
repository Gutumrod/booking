# WU-A2 — Customer pricing / plans page (BK01)

Work unit: `H1-WUA2-PRICING` (build) · close-out: `H1-WUA2-R2-EVIDENCE`
Correlation: `house-swarm-1-wua2-20260926` · close-out correlation: `house-swarm-1-wua2-r2-20260926`
Branch: `feature/house-swarm-1-wua2-pricing` @ `37053d35cd7392419c341eeae03a9c1193ed41b7`
Status at this heading: page built by the earlier attempt; this note closed out in R2 with a re-run
verification log. The section headings below dated "BEFORE building" are the original note text and
are left in place; the R2 close-out sections are at the bottom.

## Approved commercial facts used (only these)

| Plan | Price | Limits | Purchasable |
|---|---|---|---|
| Free (forever) | free | 50 bookings / month · 1 shop · 3 services | yes |
| Basic | ฿390 or $11 per month | (see page copy) | yes |
| Pro | NOT for sale | — | **no — must not be shown as buyable** |

Source: Addendum A §Owner decisions 1 (2026-09-26). No other number, discount, trial length or
conversion was invented, computed or converted in this work unit.

## Currency per language (L-07) — FLAGGED FOR REVIEW

L-07 (locked 2026-09-25) says the selected language decides the currency: Thai → THB, English → USD.
So the same card shows a different currency depending on the language toggle:

- Thai (`th`) shows: Free → ไม่มีค่าใช้จ่าย (no currency needed, price is free) · Basic → **฿390 / เดือน**
- English (`en`) shows: Free → Free · Basic → **$11 / month**

**Flag for reviewer/Owner:** this means a Thai visitor sees ฿390 and an English visitor sees $11 for the
same plan. That is what L-07 as written requires, and both numbers are the Owner-approved fixed
figures (no conversion was performed). It is recorded here rather than silently chosen. If the Owner
wants a single currency per page (or an explicit currency switch separate from language), that is a
pricing decision and belongs to the Owner — not to this worker.

---

# R2 close-out (fill-in sections)

## Remaining gaps (recorded, not decided here)

1. **Basic quota numbers are deliberately not shown — awaiting the Owner.** Addendum A approves the
   Basic price (฿390 / $11 per month) but does NOT approve Basic booking / shop / service limits, so
   the comparison table renders the Basic column for those three rows as a "pending" mark
   (amber `CircleDashed` + `table.pending`) and the Basic card prints `basic.limitsPending`
   ("limits not announced yet"). No quota figure was invented. These cells must stay "pending" until
   the Owner approves the numbers in writing.
2. **Currency-by-language behaviour follows the locked plan (L-07) and should be reviewed, not treated
   as settled.** Thai shows ฿390 and English shows $11 for the same plan. The page does exactly what
   L-07 as written requires and performs no conversion, but the customer-visible effect (same plan,
   two currencies, chosen by the language toggle) is a product/pricing outcome the Owner may want to
   change. Flagged in the section above; it is NOT settled by this work unit.
3. **Rendered-page verification is a prior-attempt claim, not re-run in R2.** The earlier attempt
   reported browser/mobile verification of the rendered `/plans` page before it ran out of tool
   budget. R2 re-ran the parity checks, typecheck and lint only, so there is currently no test in the
   repo that asserts the `/plans` route renders — a route-level render test is still missing.
4. **LINE OA / notification charges are not priced here.** The page only states that the shop pays
   LINE directly (`plans.lineCost.body`); no LINE message fee, quota or markup figure is stated or
   implied. Pricing LINE messaging is an Owner decision and is outside this work unit.
5. **Pro is intentionally present but inert.** `pro.price` is copy ("Not for sale" / "ยังไม่วางขาย"),
   with no CTA, no checkout link and no number; the parity test asserts no `฿`/`$` digit and no
   490/990 appears in Pro copy. If Pro ever becomes sellable, the copy, both catalogues and the test
   must change together.
6. **Auto-slip is shown as not-included in both plans.** This mirrors the current product state; if
   that changes, both catalogues and the parity test's expectations must be updated in the same change.
7. **Parity coverage is consumer-app only.** The test reads `apps/booking-consumer/messages/*.json`.
   `apps/booking-admin` message catalogues are outside this work unit's scope and are not compared.

## Command log (real commands, real exit codes, observed output tail)

Environment: Node `v24.19.0` (reported by `node --version`). Repo revision
`37053d35cd7392419c341eeae03a9c1193ed41b7` (`git rev-parse HEAD`).

1. `git status --porcelain` → **exit 0**
   ```
    M apps/booking-consumer/messages/en.json
    M apps/booking-consumer/messages/th.json
    M apps/booking-consumer/src/app/page.tsx
   ?? apps/booking-consumer/src/app/plans/
   ?? docs/house-swarm-1/
   ?? tests/i18n-message-parity.test.ts
   ```

2. `git rev-parse HEAD` → **exit 0** → `37053d35cd7392419c341eeae03a9c1193ed41b7`

3. `node --version` → **exit 0** → `v24.19.0`

4. `node --no-warnings --test --experimental-test-isolation=none tests/i18n-message-parity.test.ts`
   → **exit 0**. Tail:
   ```
   ✔ consumer Thai and English message key sets match exactly (43.3717ms)
   ✔ consumer plans page ships the same keys in both languages (37.0878ms)
   ✔ plans copy carries only the approved commercial facts (63.5412ms)
   ✔ plans copy contains no social proof or invented testimonials (38.414ms)
   ℹ tests 4
   ℹ pass 4
   ℹ fail 0
   ℹ duration_ms 219.7014
   ```
   Pass **4**, fail **0**.

5. `node --no-warnings --test --experimental-test-isolation=none tests/i18n-message-key-counts.test.ts`
   → **exit 0** (key-set parity check with real counts; this file was added in R2):
   ```
   WUA2-PARITY th total keys : 173
   WUA2-PARITY en total keys : 173
   WUA2-PARITY th plans keys : 49
   WUA2-PARITY en plans keys : 49
   WUA2-PARITY only in th    : []
   WUA2-PARITY only in en    : []
   ✔ consumer message key-set parity check reports real counts (2.6406ms)
   ℹ tests 1
   ℹ pass 1
   ℹ fail 0
   ```
   Thai **173** keys, English **173** keys — equal. Plans section **49 / 49**. No key exists in only
   one language. Pass **1**, fail **0**.

6. `npx tsc --noEmit -p apps/booking-consumer/tsconfig.json` → **exit 0**, no diagnostics printed.
   Notes: no Next type-generation step was needed — the generated route types were already on disk
   (verified with `ls apps/booking-consumer/.next/types` → **exit 0**:
   `cache-life.d.ts`, `root-params.d.ts`, `routes.d.ts`, `validator.ts`), which is the missing-layout-
   type failure mode the work unit warned about. The typecheck is therefore a genuine clean pass and
   is NOT reported as a false failure.

7. `npm --workspace apps/booking-consumer run lint` → **exit 0**. Tail:
   ```
   ✖ 6 problems (0 errors, 6 warnings)
   ```
   All 6 warnings are pre-existing and live in
   `src/app/book/[slug]/page.tsx` (5 × `@typescript-eslint/no-unused-vars`, 1 ×
   `@next/next/no-img-element`). **Zero errors, zero warnings in `src/app/plans/page.tsx` or
   `src/app/page.tsx`.**

8. `node -e '<inline key-count script>'` → **not run: BLOCKED by tool policy**
   ("Command flagged as dangerous (script execution via -e/-c flag)"), with no approval channel
   available in this execution mode. Recorded here for honesty rather than silently dropped; the
   key-count check was produced instead as
   `tests/i18n-message-key-counts.test.ts` (command 5 above), which runs the same flattening rule
   under `node --test` and prints the real counts.

9. `git diff --stat` → **exit 0** →
   `messages/en.json +72`, `messages/th.json +72`, `src/app/page.tsx +7` (3 files changed,
   149 insertions(+), 2 deletions(-)); the new `/plans` page, the note and the test file are
   untracked, which matches `git status --porcelain` above.

10. `npx tsc --noEmit tests/i18n-message-key-counts.test.ts` → **exit 2**, three diagnostics
    (TS1259 ×2 on the `node:assert/strict` / `node:test` default imports, TS1343 on `import.meta`).
    This is the repo's existing `tests/` convention, not a new defect: the repo has **no root
    `tsconfig.json`** (checked with `ls tsconfig*.json` → exit 2, "No such file or directory"), so
    `tests/` is outside every TypeScript project and is only ever executed as
    `node --test`, which compiles TS natively. The pre-existing `tests/i18n-message-parity.test.ts`
    reports the **same three diagnostics in the same positions**. The consumer app typecheck does not
    include `tests/` and exits 0 (command 6), and the test itself passes under `node --test`
    (command 5).

11. Digest stability check. The digest covers everything above the hash heading, so it moves whenever
    the note changes; it was recomputed after every edit. Observed in order
    `sed '/^## sha256 of this note file$/,$d' docs/house-swarm-1/WUA2-PRICING-PAGE.md | sha256sum` →
    **exit 0** → `7e8e82e0137826ae96f188a2ec361454d5c4d7e52d1629d2d8502cf826cd63a0` (after the first
    full draft of the close-out section), then
    `99e7b9661ac68ef540d420ec5e845ed896a20f132ade96cbf5da9e9852db03b3` (after this command log was
    extended with entries 10–12). The value recorded in the final section below is the digest of the
    delivered note; because that section is excluded from the digest, writing it in does not move it.
    A verifier reproduces the recorded value with the command above.
    `sha256sum` of the whole delivered file → **exit 0** →
    `abf2588f32498d6caee1ca3c861a25a3f7b5ae11e9ec939feeb684093529336d` (whole-file value at that
    revision; it necessarily differs from the stored content digest, which excludes the hash section).

12. Placeholder sweep: `grep -nE 'to be filled|PLACEHOLDER|SHA_BODY|SHA_FINAL'
    docs/house-swarm-1/WUA2-PRICING-PAGE.md` → **exit 1** (no matches) when run immediately before
    this line was written; every `(to be filled ...)` placeholder section is now gone. Re-running the
    same grep on the delivered file returns **one** hit: this command line itself, because it quotes
    the search pattern verbatim. That hit is this log entry's own text, not a placeholder section, and
    a verifier can confirm the same by grepping for `^## .*to be filled` (no matches expected).

13. Final digest: because every prose edit above the hash heading moves the digest, this entry does
    not restate a number. The digest of the delivered note is the value recorded in the
    "sha256 of this note file" section below; it is computed over all lines above that heading, so
    writing it in does not move it, and the `sed | sha256sum` command reproduces it exactly. The
    whole-file digest of the delivered file is necessarily different by construction (it includes
    the hash section).

## Changed files (whole change, with a one-line reason)

| File | Change | Reason |
|---|---|---|
| `apps/booking-consumer/src/app/plans/page.tsx` | new | Customer-facing pricing page: Free + Basic cards, Pro shown as not-for-sale, plan comparison table, LINE-cost and limit-enforcement notes; Basic quotas rendered as "pending". |
| `apps/booking-consumer/messages/th.json` | modified | Adds the Thai `plans` message block and `home.plansCta` so the page has no untranslated key. |
| `apps/booking-consumer/messages/en.json` | modified | Adds the matching English `plans` message block and `home.plansCta`; keys kept 1:1 with Thai. |
| `apps/booking-consumer/src/app/page.tsx` | modified | Adds a landing-page link/CTA to `/plans` so the pricing page is reachable. |
| `tests/i18n-message-parity.test.ts` | new | Asserts Thai/English key sets are identical, the plans section matches, the copy carries only the approved commercial facts, and no social proof exists. |
| `tests/i18n-message-key-counts.test.ts` | new (R2) | Prints and asserts the real Thai/English key counts (total + plans) as recorded evidence for this close-out. |
| `docs/house-swarm-1/WUA2-PRICING-PAGE.md` | modified (R2) | This note: fills the remaining-gaps, command-log and changed-files placeholders. |

## Integrity, scope and prohibitions

- **No database connection was attempted.** No Postgres/Supabase connection was opened, no migration
  was run, no `supabase` CLI was invoked and no deploy was performed. Every command in the log is a
  read-only git query, a Node test run, `tsc`, `eslint` or `ls`.
- **No `.env` file was read, created or modified.** No environment file of any kind was touched.
- **No commit and no push occurred.** `HEAD` is still `37053d35cd7392419c341eeae03a9c1193ed41b7`
  and all work remains uncommitted in the worktree.
- All edits stayed inside the allowed scope (`docs/house-swarm-1/`, `apps/booking-consumer/src/`,
  `apps/booking-consumer/messages/`, `tests/`). Nothing under `apps/booking-admin`, `supabase/`,
  `relay/`, `.git` or `node_modules` was touched.

## sha256 of this note file

Hash convention: a file cannot contain its own full-file digest (writing the value changes the file,
so the stored value would always be stale). The note's sha256 is therefore recorded as a **content
digest over every line above the `## sha256 of this note file` heading** — i.e. over the whole note
except this hash section, which makes the value stable and exactly reproducible.

Recorded command (real, run in this worktree):

```
sed '/^## sha256 of this note file$/,$d' docs/house-swarm-1/WUA2-PRICING-PAGE.md | sha256sum
```

Recorded result → exit 0:

```
680ed88427f449595dc57fb2f925fafe08fe8ea48f1d486ba3ff42bd2c819480 *-
```

**sha256 of this note (content digest, whole note above this heading):
`680ed88427f449595dc57fb2f925fafe08fe8ea48f1d486ba3ff42bd2c819480`**

A verifier reproduces that value by running the `sed | sha256sum` command above in this worktree;
it recomputes to the same string because this hash section is excluded from the digest, so the value
stored here does not move the value it describes. For a plain whole-file check,
`sha256sum docs/house-swarm-1/WUA2-PRICING-PAGE.md` also runs on this frozen revision, but the value
it prints necessarily differs from the string stored in this section by construction.
