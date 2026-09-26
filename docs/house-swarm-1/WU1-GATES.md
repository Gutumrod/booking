# WU1-GATES — BK01 quality-gate baseline (H1-WU1-GATES)

Work unit: `H1-WU1-GATES` · Correlation id: `house-swarm-1-wu1-20260926`
Workspace: `D:/AI-Workspace/runtime/worktrees/house-swarm-1-wu1`
Branch: `feature/house-swarm-1-wu1-hardening`
Revision at start and end: `37053d35cd7392419c341eeae03a9c1193ed41b7` (base = `origin/feature/bk01-real-shop-hardening-r4`, per Addendum B decision 1)
Gate run (UTC): 2026-09-26T05:46:03Z
Node: v24.19.0 · npm: 11.11.1 · Next.js 16.3.0
Tree state before this work unit: clean (`git status --porcelain` empty).

This file is a raw gate record. Every exit code below was observed by running the command in this
worktree during this work unit. Nothing here is copied from branch documentation or from a previous
round's self-report.

## Summary table

| # | Gate | Exact command | Exit code | Result |
|---|------|---------------|-----------|--------|
| G1 | Dependency install | `npm ci` (repo root) | **0** | PASS — 696 packages added, 699 audited in 3m |
| G2 | Lint (both apps) | `npm run lint` (repo root) | **0** | PASS — 0 errors, 12 warnings (6 consumer + 6 admin) |
| G3 | Typecheck consumer | `npx tsc --noEmit` (cwd `apps/booking-consumer`) | **2** → **0** | FAILED on first run (`TS2304 LayoutProps`); PASSES after Next typegen. See §G3. |
| G4 | Typecheck admin | `npx tsc --noEmit` (cwd `apps/booking-admin`) | **2** → **0** | FAILED on first run (same cause); PASSES after Next typegen. See §G4. |
| G5 | Production build (both apps) | `npm run build` (repo root) | **1** | **FAIL — UNRESOLVED.** `prebuild` → `sync-env` aborts: `.env.local not found`. See §G5. |
| G6 | Unit/static tests | `npm test` (repo root) | **0** | PASS — 118 tests, 118 pass, 0 fail |
| G5b | Consumer prod build (component of G5) | `npm --workspace apps/booking-consumer run build` | **0** | PASS — compiled 27.7s, 8/8 static pages |
| G5c | Admin prod build (component of G5) | `npm --workspace apps/booking-admin run build` | **0** | PASS — compiled 13.1s, 16/16 static pages |

Gate order run: G1 → G2 → G3 → G4 → G5 → G6, as instructed. G3/G4 were re-run after their fix;
G2/G6 were re-run at the end to prove no regression.

---

## G1 — `npm ci`

- Command: `npm ci` (cwd = repo root)
- Exit code: **0**
- Output tail:

```
npm warn deprecated node-domexception@1.0.0: Use your platform's native DOMException instead
npm warn deprecated glob@9.3.5: Old versions of glob are not supported, and contain widely
publicized security vulnerabilities, which have been fixed in the current version.

added 696 packages, and audited 699 packages in 3m

209 packages are looking for funding
  run `npm fund` for details

5 vulnerabilities (4 high, 1 critical)

To address issues that do not require attention, run:
  npm audit fix
```

Note: 5 known vulnerabilities (4 high, 1 critical) are reported by npm's audit of dependencies.
They were NOT remediated here — `npm audit fix` would mutate the lockfile and is outside this
work unit's authority (dependency change). Recorded as an open item, not a failure of `npm ci`.

## G2 — `npm run lint`

- Command: `npm run lint` (cwd = repo root; script = `npm --workspace apps/booking-consumer run lint && npm --workspace apps/booking-admin run lint`)
- Exit code: **0**
- Output tail:

```
> booking-consumer@0.1.0 lint
> eslint

apps/booking-consumer/src/app/book/[slug]/page.tsx
    7:3   warning  'Calendar' is defined but never used   @typescript-eslint/no-unused-vars
    8:17  warning  'Sparkles' is defined but never used   @typescript-eslint/no-unused-vars
    8:57  warning  'Coffee' is defined but never used     @typescript-eslint/no-unused-vars
    9:26  warning  'ShieldAlert' is defined but never used @typescript-eslint/no-unused-vars
    9:39  warning  'Send' is defined but never used       @typescript-eslint/no-unused-vars
  823:25  warning  Using `<img>` could result in slower LCP ... @next/next/no-img-element

✖ 6 problems (0 errors, 6 warnings)

> booking-admin@0.1.0 lint
> eslint

... dashboard/page.tsx, tickets/[id]/page.tsx, tickets/new/page.tsx,
    platform-admin/page.tsx, lib/ticket-service.ts ...

✖ 6 problems (0 errors, 6 warnings)
```

0 errors. The 12 warnings are pre-existing unused-import / `<img>` warnings and do not fail the gate.
No warning was fixed: the gate passes as-is and touching them is outside this unit's scope.

## G3 — consumer `npx tsc --noEmit`

- Command: `npx tsc --noEmit` (cwd = `apps/booking-consumer`)
- First run exit code: **2**
- First run output (complete):

```
src/app/layout.tsx(23,56): error TS2304: Cannot find name 'LayoutProps'.
```

- Fix applied: `npx next typegen` (cwd `apps/booking-consumer`) — exit **0**, output
  `Generating route types... ✓ Types generated successfully`
- Re-run exit code: **0**
- Re-run output: *(empty — no diagnostics)*

## G4 — admin `npx tsc --noEmit`

- Command: `npx tsc --noEmit` (cwd = `apps/booking-admin`)
- First run exit code: **2**
- First run output (complete):

```
src/app/layout.tsx(23,56): error TS2304: Cannot find name 'LayoutProps'.
```

- Fix applied: `npx next typegen` (cwd `apps/booking-admin`) — exit **0**, output
  `Generating route types... ✓ Types generated successfully`
- Re-run exit code: **0**
- Re-run output: *(empty — no diagnostics)*

### Root cause of G3/G4 (evidence, not opinion)

Both apps use the Next.js 16 `LayoutProps` helper, which is a **generated** type, not a package type:

- `apps/booking-consumer/src/app/layout.tsx:23` and `apps/booking-admin/src/app/layout.tsx:23`
  both declare `export default async function RootLayout({ children }: LayoutProps<"/">)`.
- Next.js' own bundled documentation states the rule explicitly —
  `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/layout.md:107-110`:
  > "Types are generated during `next dev`, `next build` or `next typegen`."
  > "After type generation, the `LayoutProps` helper is globally available."
- The generator is `node_modules/next/dist/build/webpack/plugins/next-types-plugin/index.js`
  (emits `export interface LayoutProps` at line 134).
- Both `apps/*/tsconfig.json` list `.next/types/**/*.ts` in `include`, and that directory is not
  committed (`.gitignore`: `/.next/`). On a clean checkout after `npm ci` the directory does not
  exist, so the global `LayoutProps` declaration does not exist and `tsc` fails.

So on a clean tree `npx tsc --noEmit` is **not runnable** until Next's type generation has run once.
This is a gate-precondition defect, not a source defect: no source line was wrong.

The fix is therefore the typegen step only. It is the same generation that `next dev` / the app's own
`next build` performs internally, so it does not and cannot change product behaviour.
**No tracked source file was changed for G3/G4.**

## G5 — `npm run build` — ❌ FAILS (unresolved)

- Command: `npm run build` (cwd = repo root)
- Exit code: **1**
- Output (complete):

```
> prebuild
> npm run sync-env

> sync-env
> node scripts/sync-env.js

sync-env: .env.local not found
```

### Root cause

`package.json` defines a `prebuild` hook:

```json
"prebuild": "npm run sync-env",
"sync-env": "node scripts/sync-env.js",
```

`scripts/sync-env.js` copies the repo-root `.env.local` onto `apps/booking-admin/.env.local` and
`apps/booking-consumer/.env.local`, and calls `process.exit(1)` when the root `.env.local` is
missing:

```js
if (!fs.existsSync(source)) {
  if (relativeSource === '.env.staging.local') {
    fail('.env.staging.local not found; copy .env.staging.example and fill non-production values');
  }
  fail(`${relativeSource} not found`);
}
```

This worktree has **no** `.env.local`, no `.env`, and no `apps/*/.env.local`
(verified: `ls -la .env.local` → `No such file or directory`; `ls -la apps/booking-consumer/.env* apps/booking-admin/.env*` → none).
So `npm run build` aborts in `prebuild`, before either app is compiled.

### Why I did not "fix" it

The two available changes are both forbidden by this work unit's packet:

1. **Create a `.env.local`** — explicitly prohibited ("Never read, edit or create a .env file").
2. **Remove or bypass the `prebuild` hook** — this is a release/pipeline-contract decision: the hook
   is what pushes production-shaped configuration into both apps before a real build, and the same
   script is wired into `build:staging`, `cf:dry-run:staging` and both `dev:*` scripts. Deleting it
   would silently change how production configuration reaches the build, i.e. alter production
   behaviour and a deployment contract. That is a production/pipeline decision reserved for the
   Owner, so per the packet I stopped rather than deciding it.

The packet's own note that "the sibling .env.local points at production" confirms that satisfying the
hook by copying an env file would be actively unsafe, not merely out of scope.

### G5 component evidence — both app builds themselves PASS

To establish exactly where the failure sits, the underlying builds were run directly (each app's own
`build` script, bypassing only the root `prebuild` wrapper):

| Command | Exit code | Output tail |
|---|---|---|
| `npm --workspace apps/booking-consumer run build` | **0** | `✅ Compiled successfully in 27.7s` · `Finished TypeScript in 12.9s` · `✓ Generating static pages using 11 workers (8/8) in 2.4s` · routes: `ƒ /`, `ƒ /_not-found`, `ƒ /api/deposit-slips/upload-intent`, `ƒ /api/line/webhook`, `ƒ /api/line/webhook/merchant/[shopId]`, `ƒ /api/notifications/dispatch`, `ƒ /book/[slug]`, `ƒ /manage-booking` |
| `npm --workspace apps/booking-admin run build` | **0** | `✅ Compiled successfully in 13.1s` · `Finished TypeScript in 15.1s` · `✓ Generating static pages using 18 workers (16/16) in 963ms` · routes: `ƒ /`, `ƒ /_not-found`, `ƒ /api/billing/checkout`, `ƒ /api/billing/portal`, `ƒ /api/line/webhook`, `ƒ /api/webhooks/stripe`, `ƒ /auth/callback`, `ƒ /dashboard`, `ƒ /dashboard/tickets`, `ƒ /dashboard/tickets/[id]`, `ƒ /dashboard/tickets/new`, `ƒ /forgot-password`, `ƒ /login`, `ƒ /platform-admin`, `ƒ /register` |

Both builds were run with `NEXT_PUBLIC_SUPABASE_URL` **unset** in the shell (recorded in the log as
`NEXT_PUBLIC_SUPABASE_URL=[<UNSET>]`), and no database connection occurred.

**Conclusion on G5:** the only reason `npm run build` fails is the missing root `.env.local`
required by the `prebuild` hook. The application compilation itself passes for both apps. This is
recorded as a **remaining failure**, not resolved.

## G6 — `npm test`

- Command: `npm test` (cwd = repo root; script = `node --no-warnings --test --experimental-test-isolation=none tests/*.test.ts`)
- Exit code: **0**
- Output tail:

```
ℹ tests 118
ℹ suites 0
ℹ pass 118
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 320.4106
```

118/118 pass. These are static/unit tests only — they read repository files and pure functions. No
test in `tests/` opens a database connection (verified by inspection before running: the only
`supabase`/`postgres` mentions are string/path assertions against migration SQL files and
`supabase/config.toml`, plus source-text assertions — no client is constructed).

---

## Files changed

| File | Status | Reason |
|---|---|---|
| `docs/house-swarm-1/WU1-GATES.md` | **created** | The required deliverable for this work unit: the gate record itself. |

**No tracked source, config, contract, pricing, entitlement, schema or migration file was changed.**
The G3/G4 fix produced only build artifacts, all of which are git-ignored and therefore not
repository changes:

| Artifact (untracked, git-ignored) | Reason |
|---|---|
| `apps/booking-consumer/.next/types/*` , `apps/booking-consumer/next-env.d.ts` | Generated by `npx next typegen` (G3 fix). Ignored via `apps/booking-consumer/.gitignore` (`/.next/`, `next-env.d.ts`). |
| `apps/booking-admin/.next/types/*` , `apps/booking-admin/next-env.d.ts` | Generated by `npx next typegen` (G4 fix). Ignored via `apps/booking-admin/.gitignore` (`/.next/`, `next-env.d.ts`). |

Verified with `git check-ignore -v`, which resolved them to those `.gitignore` rules.
`git status --porcelain` after all gates shows exactly one entry: `?? docs/house-swarm-1/`.

## Remaining failures

| ID | Failure | Status |
|---|---|---|
| F-1 | `npm run build` exits **1**: `prebuild` → `sync-env` aborts with `sync-env: .env.local not found`. Blocks the root build gate on any tree without a root `.env.local`. | **UNRESOLVED — needs a decision.** Resolution requires either supplying a non-production env file or changing the `prebuild` pipeline hook. Both are outside this work unit's authority / prohibited by its packet. **This is the blocker to escalate.** |
| F-2 | `npx tsc --noEmit` is not runnable on a clean tree until Next type generation has run (missing `.next/types`). | **MITIGATED, root cause left in place.** The gate now passes after `npx next typegen`; the underlying ordering/precondition issue (nothing in the repo runs typegen before `tsc`) is unchanged because fixing it would mean editing `package.json` scripts or `tsconfig.json` — a pipeline-contract change outside this unit's authority. |
| F-3 | `npm ci` reports 5 dependency vulnerabilities (4 high, 1 critical). | **OPEN — informational.** Not remediated: `npm audit fix` mutates the lockfile (dependency change), outside this unit's authority. |

## Compliance statement

- **No database connection was attempted at any point.** No dev server, seed, migration, db script,
  `supabase` CLI command, or Postgres/Supabase client was started by this work unit. The only
  commands run were `npm ci`, `npm run lint`, `npx tsc --noEmit`, `npx next typegen`,
  `npm run build`, `npm test`, the two app `build` scripts, and read-only file inspection.
  No `.env` file was copied or sourced, so the Supabase client construction path
  (`getSupabasePublicConfig()`, which throws when its vars are absent) was never reached with
  credentials; `NEXT_PUBLIC_SUPABASE_URL` was verified **unset** in the shell for the build runs.
- **No `.env` / `.env.local` / `.env.staging.local` file was read, created or modified.**
- **No deploy. No migration. No secret was read or printed. No commit. No push.**
- No file under prohibited scope (`.git`, `node_modules`, `relay`, `supabase`, any `.env*`) was
  edited.
- Environment note: the shell exports `SUPABASE_ACCESS_TOKEN` (variable name only recorded, value
  not read). All `supabase` CLI usage was avoided for this reason.

**Ceiling claim:** the highest status supportable by this record is `BUILD_PASS` for the two apps
individually and for lint/typecheck/tests; `npm run build` at the root does **not** pass. No
`PRODUCTION_READY`, `LIVE_PROVEN` or `OPERATED_STABLE` claim is made or implied.
