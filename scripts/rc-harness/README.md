# HOUSE-BK01-RC-HARNESS — isolated local verification

Authorized scope: Owner instruction 2026-10-02. No LAB connection, production,
merge, application source edits, or pinned migration edits. Reuse Gate: N/A —
verification tooling for existing capabilities; no new product/backend capability.

## Source-of-Truth References

- `D:/AI-Workspace/vault/06-Agent-Logs/WSTERA-House/PLAN-LAB-GO-BK01-2026-10-02.md`
- `D:/AI-Workspace/vault/06-Agent-Logs/WSTERA-House/briefs/CONTRACT-BK01-G09-G10-2026-10-02.md`
- `D:/AI-Workspace/vault/06-Agent-Logs/WSTERA-House/STATUS-HOUSE.md`, A-26/A-27 only.
- SQL: `codex/bk01-p1-g09-g10-20261002` at `2a772e46a5dca42df2bf23429552972d9396f49e`.
- Initial app evidence: `codex/bk01-p0-app-20261002` at `3b4448256a0a4c13f9d4e7159c711daee555d581`.
- Continuation app: `codex/bk01-rc-app-20261002` at `6efec0ca7275b583076deb4eec1aa953f0bd9354`.
- F1: `codex/bk01-g10-line-audit-20261002` at `9d5ca2bfd34dc50414c69536b9a6a6cd4bbf11fc`;
  that source's `reports/REPORT-CODEX-HOUSE-BK01-G10-LINE-AUDIT-2026-10-02.md`
  and `docs/operations/BK01-LINE-binding-reset.md`.
- Existing W-1 replay: `scripts/proofs/bk01-p1-g09-g10-replay.mjs`; existing managed
  Auth/Storage scaffolds: `scripts/proofs/lane-b/wu1_e2e.mjs`.
- House Storage fixture: `scripts/proofs/lane-b/fixtures/house_storage_upload_grants.sql`.
- Evidence format: platform repository `tools/shared-runtime/platform-sql/apply-platform-sql.mjs`,
  functions `writeEvidence`, `writeLatestPlan`, `readMutationHistory`.

## One-command run

Copy `config.example.json` to an external operator configuration and fill absolute
tool paths. The configuration contains no database URL or provider credentials.
Use Node 24, Git, bundled npm, PostgreSQL **17.11**, PostgREST **13.0.8** for Windows,
and a compatible installed headless Chromium. Supply `npmCli` when npm is not next
to Node. The official PostgREST release needs PG's DLL directory on its PATH; the
runner adds it to that child process only.

```powershell
node scripts/rc-harness/run.mjs D:/AI-Workspace/runtime/bk01-rc-harness.local.json
```

The runner installs harness dependencies and exact app lockfile dependencies,
creates a fresh detached RC worktree for every run, copies SQL/runner/proof git
objects from `sqlSha`, leaves `apps/` byte-identical to `appSha`, creates fresh
loopback PG17 UTF-8/UTC, executes the reviewed W-1 replay, starts both apps with
separate working directories, and runs browser/HTTP/app-service/DB checks plus
dump/restore/deletion replay. Update either full SHA in the configuration to rerun.
There is no merge or cherry-pick. Source tests, both builds, and typechecks are
captured separately. Candidate failures are reported without fixes; exit 1 means
HOLD. ESLint runs without auto-fix for both pinned apps. SKIP is never PASS. Existing evidence/worktrees are retained; no cluster is
reset and no existing evidence is overwritten.

Optional `auditSqlSha` is a separate immutable F1 pin, not a replacement for
`sqlSha`. The runner requires its entire `supabase/` diff against the base to be
exactly the added forward/rollback 160000 pair; older SQL changes stop the run.
It copies those exact git objects and the audit proof scripts, preserves the full
P1/150000 rollback/reapply baseline, then applies 160000 through the existing
non-superuser migration runner before launching either app. Restore ledger count
is derived from the exact selected migration files, with all restored ledger rows
also fingerprinted. Forward and rollback SQL file hashes are captured.
The audit author's unchanged real-role proof must be red on the pre-audit schema,
then pass after apply. A failure is not swallowed. Its audit/ACL/role results are
reported as a separate e2e row; the older P1 static exceptions remain visible.

## Dashboard triage

`triage-admin.mjs CONFIG_JSON` compares fresh worktrees at base `62e93ec`, `9f452d4`
and RC `6efec0c`, using identical Node, exact lock bytes, clean env and explicit
loopback URL/public placeholder. Configure `triageDependencies` to a completed
exact-lock dependency installation; dependencies are shared read-only by junction
for webpack dev/build/start. It probes the dashboard with empty cookies because
`getLocale()` runs before the layout's Auth check; this measures request config,
not Auth/RLS. Each pin's actual dev and production build/start gets browser/server
evidence and application integrity hashes. It never inserts an i18n module/plugin.

`triage-cloudflare.mjs CONFIG_JSON RC_WORKTREE` controls the RC's real deployment
packaging offline. It creates another immutable worktree, installs fresh actual
dependencies (no outside-root junction), runs the app's unchanged OpenNext build
including its own Next build, then starts Wrangler strictly `--local` on loopback
using the actual pinned config. Build/HTTP failure and opaque error bodies stay
unclassified unless an actual error signal establishes their cause. This does not
prove deployed Cloudflare acceptance and performs no deployment or LAB request.

Evidence includes pins/file hashes, operator stdout/stderr/exit, per-case JSON and
Markdown, raw restore comparisons, source checks, and app/SQL integrity. Sensitive
local tokens are generated per run, passed in process environments, and never
written to curated reports. No global environment/configuration is changed. The
runner does not invoke `sync-env`, deploy, Supabase CLI, or production transports.

## Proof boundaries

- Data API is real PostgREST, PostgreSQL roles, RLS and RPCs. No mocked DB results.
- Local issuer and Auth are fixture transports. Hosted Auth/email confirmation is
  SKIP. Runtime role remains actual `bk01_runtime` and exact 21-function allowlist.
- Local Storage writes real bytes and real `storage.objects` rows under runtime;
  the existing House trigger validates/consumes exact MIME/size/path grants. Hosted
  Supabase signed Storage is SKIP. This scaffold is not a new Storage service.
- Turnstile uses Cloudflare's official passing test secret/key and real siteverify;
  production hostname/widget acceptance is SKIP.
- Alert app code talks to the real DB claim/ack RPC with a fake send transport.
  Real Resend delivery is SKIP.
- The pinned dashboard currently fails at `getLocale()` because next-intl server
  configuration is missing. The harness can separately execute the unchanged
  browser admin-service bundle against real PostgREST; that is service proof,
  not a DOM approval/refund/outcome PASS. DOM cases stay SKIP after this failure.
- Old SQL proof's G10 text-grep expects binding code in a route module; the app
  moved it into `lib/line-webhook.ts`. Its failure remains an artifact. The older
  arity scanner cannot resolve `bookingHoldRpcArgs(request)`; recorded FAIL, no fix.

## Offline GO preparation

```powershell
node --test scripts/rc-harness/evidence-history.test.mjs
node scripts/rc-harness/evidence-history.mjs EXTERNAL_TOOL_DIR REVIEWED_MANIFEST_JSON
node scripts/rc-harness/lab-preflight.mjs
```

The validator is read-only: checks tool filename/schema/provenance, manifest pins,
exact baseline mutation orders 5/10/15, strict UTC chronology, byte hashes, foreign
files, malformed JSON, duplicate timestamps, failed mutations and rollback history.
Only `tool/` is passed to it; operator stdout/stderr/captures belong beside it in
`operator/`. It does not repair evidence. CLI tests demonstrate legacy invalid
history exit 1 and separated synthetic tool/operator history exit 0 while keeping
operator bytes exact. Filename/schema checks do not cryptographically prove who
created a record; original byte hashes/provenance and controller review still matter.

`restore.mjs` uses `pg_dump --format=custom --no-owner --no-acl`, saves SHA256,
restores into an empty local database with non-superuser `operator`, compares all
rows/counts/hashes, columns, function bodies, triggers, ledger and constraints, and
smokes the exact public projection. PG deparse/reparse changes constant
varchar-array casts in CHECK/exclusion expressions; raw differences remain in
evidence and only this exact cast equivalence is canonicalized. Other drift fails.
The drill then proves a post-backup deletion would resurrect on restore, replays
the preserved local customer-anonymization log, repeats it to prove idempotence,
and compares source/restored state again. Financial events are preserved.

**Recovery limits:** no-owner/no-acl archives do not prove original owner/ACL
reconstruction. The actual LAB recovery recipe must be separately reviewed before
GO. Database dumps do not back up Storage object bytes; hosted object recovery is
outside this database drill. This is a local anonymization drill only: production G33 tombstone storage,
Legal Hold flags and account/booking retention remain absent/HOLD; do not apply
the drill log to LAB. `authority=local-drill-only` deliberately prevents presenting
it as a production deletion contract. A-27 requires restore→replay before reopening.

The default preflight command emits queries/checklist and makes **no connection**.
Its `--read-only` mode is prepared for a separate authorized window: offline
history must pass first; target host/projectRef/issuer owner role must be explicitly
pinned; TLS verify-full, read-only session and transaction, fixed SELECT/catalog
queries, timeouts, empty product ledger, role/membership and legacy NULL checks.
It never reads issuer-client secrets or executes app RPCs. Capture still requires
controller review, dump/restore recovery validation, and fresh GO. This task does
not run `--read-only` against LAB.
