# BK01 Shared-Runtime Coexistence Assessment

**Date:** 2026-09-08
**Product:** Booking / BK01
**Environment inspected:** WSTERA LAB (`ykxlqnshaaxmzzocpjlj`)
**Repository checkpoint:** `c0b9019`
**Mode:** read-only shared-runtime assessment; no database mutation
**Verdict:** **FAIL / NOT READY FOR N-PRODUCT SHARED-RUNTIME PASS**

## Executive Verdict

BK01 and PS01 currently coexist at the database object/data-plane level without a confirmed cross-product FK, function, policy, role, storage-policy, or cron dependency. Existing BK01 application behavior and the prior `local_service` compatibility evidence are not invalidated by this assessment.

The gate still fails because the **migration and shared-project configuration plane is already colliding in live WSTERA LAB**. The global Supabase migration ledger now contains a PS01-named migration that is absent from the BK01 repository, and a BK01 `supabase db push --linked --dry-run --skip-vault` fails closed before it can compute BK01 pending work.

This is not a hypothetical future collision. It is a reproduced current failure mode. Repairing the global history from BK01, pulling PS01 history into BK01, or teaching BK01 to own PS01 migration files would violate the product boundary.

Therefore BK01 cannot receive a shared-runtime PASS until product-local migration authority/history and platform-owned shared configuration are separated and proven.

## 1. Shared Project Context

WSTERA LAB is intentionally a shared Supabase project used to validate more than one WSTERA product in the same runtime. Current product namespaces observed:

- BK01 product schema: `local_service`
- PS01 product schema: `ps01`
- PS01 internal schema: `ps01_internal`
- Shared/managed surfaces include `auth`, `storage`, `public`, `graphql_public`, `cron`, `net`, installed extensions, global roles, PostgREST exposed-schema configuration, and `supabase_migrations.schema_migrations`.

## 2. Read-Only Evidence Snapshot

All live SQL evidence was collected as `supabase_read_only_user`. No PS01 business rows were inspected. Metadata/object catalogs, ACLs, migration metadata, Storage bucket metadata, role configuration, and sanitized cron metadata were used.

| Schema | Tables | Views | Functions | Triggers | Policies | Indexes | FKs | Overall metadata signature |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| `local_service` | 21 | 1 | 61 | 10 | 26 | 61 | 35 | `89464efc51cffa129a61cbdca5276647` |
| `ps01` | 21 | 0 | 92 | 21 | 16 | 58 | 32 | `144a08ae1c20fa202565ea5874326f67` |
| `ps01_internal` | 1 | 0 | 0 | 0 | 0 | 1 | 0 | `3901093bb0ec7d88bcdf8ce0c6dd93c4` |
| `public` | 0 | 0 | 189 | 0 | 0 | 0 | 0 | `5f2d6367b4db4c43cc176b9c4514f2c7` |

Shared-surface baseline:

- Live exposed schemas: `public, graphql_public, local_service, ps01`
- Exposed-schema signature: `cc395e3fb3c332ac29129c134287f407`
- Storage-bucket signature: `781374c37efdde45ec20ffaebbdbc387`
- Cron-job signature: `82ff7b1f72647ef6a32a4a3db9b66b0f`
- Installed-extension signature: `7d365c2d04a055f2cdf22f3948b62d49`
- Selected role-boundary signature: `4fd279f2aed5b067d2add1c1a97a295f`
- Global migration-ledger rows: `31`
- Global migration-ledger latest version: `20260908073552`
- Global migration-ledger signature: `c09cd23ca5ad1830668799ca7729002f`

The same BK01, PS01, PS01-internal and shared-surface signatures were recomputed after the assessment and matched exactly. This proves the read-only assessment did not mutate the measured shared-runtime surfaces.

## 3. Ownership Matrix

| Surface | Current/target owner | Status in WSTERA LAB | Required governance |
|---|---|---|---|
| `local_service.*` | BK01 | Live; schema + 83 relations/indexes/views owned by `postgres` | Product-owned data surface, but migration ownership must be bounded away from platform `postgres` |
| `local_service_internal.*` | BK01 | Not created | Proposed BK01 internal namespace after migration-plane remediation |
| `deposit-slips` bucket + BK storage policy | BK01 legacy shared asset | Live; private bucket | Register as BK01-owned legacy global asset; new BK assets must use `bk01-` prefix |
| `ps01.*` | PS01 | Live; owned by `ps01_migrator` | BK01 must have zero authority |
| `ps01_internal.*` | PS01 | Live; owned by `ps01_migrator` | BK01 must have zero authority |
| `ps01-daily-report-photos` | PS01 | Live | BK01 must not mutate or reuse the name |
| `auth.*` | WSTERA/Supabase shared platform | Live | Reference-only from product migrations unless a platform-approved managed change exists |
| `storage.*` schema | WSTERA/Supabase shared platform | Live | Product bucket/policy intents must use a managed shared-asset lane |
| `public`, `graphql_public` | WSTERA/Supabase shared platform | Live | No product business tables/functions by default |
| `cron.*`, `net.*` | WSTERA/Supabase shared platform | Live | Product migrations must not own project-global scheduler/network configuration |
| Installed extensions | WSTERA platform dependency set | Live | Products declare dependency; only platform lane may create/alter/drop extensions |
| PostgREST exposed schemas | WSTERA shared platform | Live | Central manifest only; product repos must not push project-global config |
| `supabase_migrations.schema_migrations` | WSTERA shared platform / Supabase CLI history | Live, mixed history | Must not be a product-local source of truth in a multi-product project |
| Cloudflare Worker Cron Trigger for BK01 | BK01/external provider | Previously proven | Remains outside DB cron ownership |

PS01 currently demonstrates the stronger target shape: dedicated `ps01_migrator`, `ps01_runtime`, `ps01_runtime_login`, product-owned schemas, no project-wide DB `CREATE`, and a product-scoped `ps01_internal.schema_migrations` baseline ledger.

## 4. Cross-Product Risk Findings

### RISK-01 — Global migration history collision is already active — **BLOCKER**

The global ledger contains 31 rows. Its newest row is version `20260908073552` with a PS01-specific migration name. BK01 has no matching local migration file.

`supabase migration list --linked` from the BK01 repository therefore shows a remote-only migration. More importantly, the following read-only command fails:

```text
supabase db push --linked --dry-run --skip-vault
```

Observed result: `Remote migration versions not found in local migrations directory.` The CLI suggests migration-history repair or `db pull`. Neither action is acceptable from BK01 because either would make BK01 alter or ingest cross-product global history.

Previous BK01 reconciliation evidence showed that this dry-run path could calculate only intended BK01 pending migrations before the PS01 remote-only row existed. The current failure is therefore a reproduced shared-project collision.

### RISK-02 — BK01 migration authority is not product-bounded — **BLOCKER**

`local_service` and its current relations are owned by `postgres`. Historical BK01 migrations also create project-global extensions and mutate managed Storage resources. This authority model is appropriate for a single-product/bootstrap context but does not prove that a future BK01 migration is technically unable to alter PS01 or another product.

### RISK-03 — Project-global config is not owned centrally — **BLOCKER**

Live PostgREST exposure is `public, graphql_public, local_service, ps01`, while BK01 `supabase/config.toml` lists only `public, graphql_public`. `supabase config push` pushes local configuration to the linked project and provides no dry-run flag. Therefore the BK01-local file cannot be treated as authoritative shared-project configuration.

### RISK-04 — Shared/global resources are mixed into product migration history — **REQUIRED REMEDIATION**

BK01 historical migrations reference `auth.users`, create `uuid-ossp` / `btree_gist`, create/update the `deposit-slips` bucket, and create/drop policies on `storage.objects`. Those are not ordinary BK01-schema objects. Future product migrations must not have an unrestricted route to these shared surfaces.

### RISK-05 — BK01 normal privileged runtime still uses project `service_role` — **REQUIRED REMEDIATION**

BK01 server-side admin clients are schema-pinned to `local_service`, and the live PS01 schemas explicitly deny `service_role` schema usage. That prevents a confirmed BK01-to-PS01 data-plane crossing today.

However, `service_role` is project-wide and has `BYPASSRLS`. Strict N-product isolation should not depend on every future product remembering to revoke that global role. BK01 should move normal privileged data-plane operations to a bounded BK01 runtime identity; project-wide service/admin authority should remain only behind narrowly reviewed managed operations that genuinely require it.

### RISK-06 — Legacy Storage name is not product-prefixed — **GOVERNANCE REQUIRED**

`deposit-slips` and `ps01-daily-report-photos` are currently distinct, and the only inspected Storage policy is BK01-scoped to `deposit-slips` plus `local_service` authorization. No current collision was found.

Immediate rename of `deposit-slips` is not required for this gate because renaming a live bucket would create avoidable compatibility risk. Instead it must be registered as a grandfathered BK01-owned global asset, while all new BK01 Storage resources use a `bk01-` prefix.

## 5. Confirmed Healthy Coexistence Evidence

- No FK was found between `local_service` and `ps01` in either direction.
- No inspected function definition or RLS policy in either product schema referenced the other product schema.
- `ps01_runtime`, `ps01_runtime_login`, and `ps01_migrator` have no `local_service` schema authority in the inspected role boundary.
- Project `service_role` has `local_service` schema usage but no `ps01` or `ps01_internal` schema usage.
- `ps01_internal` is accessible only to `ps01_migrator` in the inspected schema ACL.
- The two live Storage bucket names are distinct; BK01's inspected Storage policy is bucket-scoped.
- Eight live `cron.job` entries were inspected through sanitized metadata; none referenced `local_service` or `ps01` in command text.
- `public` contains no business tables in the inspected live state.

## 6. Migration Coexistence Plan

### 6.1 Platform-owned migration/config lane

A shared project needs one explicit platform lane for project-global state. That lane owns:

- global `supabase_migrations.schema_migrations` history;
- PostgREST exposed-schema configuration;
- managed `auth`, `storage`, `cron`, `net` changes;
- installation/change/removal of extensions;
- creation of global/custom roles and initial product-role bootstrap;
- the registry of product-owned global resource names such as Storage buckets.

Product repositories must not run standard `supabase db push` or `supabase config push` directly against WSTERA LAB/Production after cutover to the shared-runtime model.

### 6.2 BK01 product-local migration lane

Create a bounded `bk01_migrator` that:

- owns only `local_service` and future `local_service_internal`;
- has no superuser, `CREATEDB`, `CREATEROLE`, `BYPASSRLS`, or database-wide `CREATE` authority after bootstrap;
- has no `USAGE`, DML, DDL, or execute authority on `ps01` / `ps01_internal`;
- may reference approved shared interfaces such as `auth.users`, but may not structurally mutate managed/shared schemas;
- fails closed if a migration attempts an unauthorized schema, global extension DDL, global role DDL, or unregistered managed-resource mutation.

Create `local_service_internal.schema_migrations` as the BK01 product ledger. Store at minimum migration identity/version, source checksum, applied timestamp, release identity, and runner version. Acquire a BK01-scoped advisory lock before apply.

### 6.3 Legacy-history cutover

The existing BK01 global migration history remains historical evidence and must not be replayed or rewritten merely to fit the new shared-runtime model.

Cutover rule:

1. freeze the accepted BK01 legacy baseline;
2. derive and record a canonical source/content checksum for that baseline in the BK01 product ledger;
3. do not copy PS01 migrations into BK01;
4. do not run `supabase migration repair` from BK01 to hide another product's ledger row;
5. all new BK01 product-schema migrations use the BK01 runner + BK01 ledger only;
6. any genuinely shared/global change is submitted separately to the platform-owned lane.

Recommended new BK01 migration identity format:

```text
YYYYMMDDHHMMSS_bk01_<purpose>
```

Platform-global changes use a separate platform naming/ownership convention, for example:

```text
YYYYMMDDHHMMSS_platform_<purpose>
```

### 6.4 Rollback and failure behavior

- Product migration execution is transactional where PostgreSQL permits it.
- A failed write-scope/precondition check aborts before mutation.
- Rollback is a BK01-owned forward/compensating migration or a rehearsed product-scoped rollback artifact.
- Global migration-history repair is never a BK01 rollback mechanism.
- Pre/post signatures of all non-BK product/shared surfaces are part of the deployment evidence; an unauthorized delta is a hard failure.

## 7. Shared Config Governance

The live shared-project config, not BK01 `supabase/config.toml`, is the current runtime truth. A central platform manifest/process must become canonical for shared project configuration.

Required rules:

1. Product `config.toml` files are local-development configuration unless explicitly generated from the central shared manifest.
2. `supabase config push` is prohibited from product repositories against shared LAB/Production.
3. The central exposed-schema set explicitly records each product-facing API schema. Current live set is `public, graphql_public, local_service, ps01`.
4. `local_service_internal` and `ps01_internal` remain unexposed by default.
5. Extensions are platform-owned dependencies. Product migrations may verify required extension/version but may not create/alter/drop them.
6. `cron` and `net` remain platform-owned. BK01 continues to use its previously proven external Cloudflare Cron Trigger unless a separately governed platform change is approved.
7. Shared/global custom roles are created through platform bootstrap; day-to-day product migrations run only as their bounded product migrator.

## 8. Collision Inventory

| Resource | Current observation | Collision status | Required action |
|---|---|---|---|
| Global migration ledger | Mixed BK01 + PS01-named history | **Active collision** | Stop product `db push`; central platform history + product ledgers |
| PostgREST exposed schemas | Live set differs from BK01 local config | **Governance collision risk** | Central manifest; prohibit product config push |
| `local_service` vs `ps01` schemas | Distinct | No current name collision | Preserve explicit ownership |
| `local_service_internal` | Not present | Available | Create only through bounded BK01 migration bootstrap |
| Storage bucket names | `deposit-slips` vs `ps01-daily-report-photos` | No current name collision | Register legacy BK bucket; prefix all new product buckets |
| Storage policies | BK inspected policy is bucket/BK-schema scoped | No confirmed cross-product policy collision | Preserve product-prefixed policy naming and managed apply lane |
| Extensions | Shared project-level dependencies | Shared by design | Platform ownership only |
| Cron/network | Shared project-level services | No BK/PS01 DB command reference found | Platform ownership only |

## 9. Compatibility Model Re-evaluation

The prior schema-alignment verdict remains valid but cannot be executed safely yet:

- product-facing BK01 schema remains `local_service`;
- proposed internal schema remains `local_service_internal`;
- compatibility wrappers remain preferable to moving externally used RPC names without evidence;
- current app clients already pin `local_service`, so no application-wide namespace rename is required;
- the internal split must wait until the bounded BK01 migration lane and shared-config governance exist.

The new coexistence evidence does **not** justify moving BK01 wholesale into a new product-facing schema. The problem is migration/global ownership, not the proven `local_service` application contract.

## 10. Add-Product Simulation — TEST03 Design Only

TEST03 was **not executed** in WSTERA LAB because the hard gate already failed at the migration-history/configuration plane. The brief requires stopping and reporting before adding another mutation once collateral risk is proven.

After remediation, TEST03 should run last in an isolated/ephemeral shared-runtime fixture with:

- `test03` + `test03_internal` schemas;
- dedicated `test03_migrator` and bounded runtime role;
- product-scoped migration ledger and lock;
- product-prefixed test Storage asset;
- deliberate negative attempts to access/alter `local_service`, `ps01`, `ps01_internal`, shared config, extensions, and unregistered Storage assets.

Acceptance requires BK01 and PS01 pre/post signatures to remain unchanged, product ledgers to remain independent, the global Supabase ledger to remain untouched by product-local migration execution, and every cross-boundary negative test to fail closed.

## 11. Remediation Required Before PASS

The following are hard gates, not optional cleanup:

1. **Centralize shared-project migration/config ownership.** Define the platform lane that owns global history, exposed schemas, global roles, managed schemas/resources, cron/network, and extensions.
2. **Create bounded BK01 migration authority.** `bk01_migrator` may mutate only BK01-owned namespaces after bootstrap.
3. **Create BK01 product migration history.** Add `local_service_internal.schema_migrations` plus BK01 advisory lock/checksum/release evidence.
4. **Cut over from standard product `supabase db push`.** Preserve legacy history as evidence; never repair or absorb PS01 history from BK01.
5. **Guard shared config.** Product repos must fail closed or clearly prohibit `supabase config push` against shared LAB/Production.
6. **Bound BK01 privileged runtime.** Move normal privileged DB data-plane work away from project-wide `service_role` to a BK01-scoped runtime identity. Any remaining project-wide managed-admin usage must be isolated and justified.
7. **Register global asset ownership.** Record `deposit-slips` as grandfathered BK01 ownership; require `bk01-` prefix for new BK01 global resource names.
8. **Re-run schema-alignment remediation only after Gates 1-7.** Then create/use `local_service_internal` without changing the proven product-facing contract unnecessarily.
9. **Run TEST03 last.** Prove add-product behavior and cross-boundary negative tests with unchanged BK01/PS01/shared signatures.

Until all applicable gates above are proven, BK01 may continue current LAB observation/testing that does not require unsafe shared migration/config mutation, but it must not be declared shared-runtime coexistence PASS.

## 12. Suggested Execution Phases

### Phase C1 — Platform boundary lock
- define central shared-project manifest/owner;
- freeze product `db push` / `config push` against shared environments;
- register existing product/global resources and current exposed schemas.

### Phase C2 — BK01 migration/runtime identity
- bootstrap `bk01_migrator`, `bk01_runtime`, and `local_service_internal` through the platform lane;
- prove negative permissions against PS01/shared schemas;
- create BK01 ledger + lock + migration runner with write-scope validation.

### Phase C3 — Legacy baseline cutover
- compute/lock accepted BK01 legacy migration baseline checksum;
- seed BK01 product ledger without replaying legacy SQL;
- prove a no-op BK01 migration check does not read/repair another product's ledger.

### Phase C4 — Internal-schema remediation
- execute the previously assessed `local_service_internal` split using the bounded BK01 runner;
- keep compatibility bridges only where actual call-path evidence requires them;
- verify app/runtime and BK01 regression gates.

### Phase C5 — TEST03 coexistence proof
- add the isolated fake product last;
- run positive + negative migration/runtime checks;
- compare immutable pre/post signatures for BK01, PS01, Storage/shared config, cron/network, extensions, and migration histories;
- only then reconsider the coexistence verdict.

## 13. Risks

- **Highest:** using standard Supabase global migration history from multiple independent product repos creates unavoidable history coupling even when SQL schemas do not overlap.
- **High:** allowing product-local `config.toml` to push shared project config can remove another product from the Data API or mutate unrelated project settings.
- **High:** platform-wide `postgres`/`service_role` authority makes product isolation depend on convention rather than enforceable database boundaries.
- **Medium:** shared managed-resource names such as buckets and policies can collide without a central ownership registry/prefix policy.
- **Medium:** moving BK01 internals before fixing migration ownership would increase blast radius while the deployment plane is still unsafe.
- **Low/currently controlled:** direct BK01↔PS01 schema coupling was not found in inspected FKs/functions/policies, and current PS01 role ACLs reject BK01's project service role.

## 14. Owner Decisions Required

1. Approve the rule that shared LAB/Production uses a **central platform-owned global migration/config lane**, while each product uses a bounded product migration runner/ledger.
2. Approve `bk01_migrator` + `bk01_runtime` as the BK01 target authority model, matching the isolation principle already proven by PS01.
3. Approve grandfathering `deposit-slips` as a registered BK01-owned legacy bucket instead of renaming it during this gate; require `bk01-` for new BK01 global assets.
4. Confirm that the prior `local_service_internal` remediation waits behind migration/config-plane closure and TEST03 remains the last proof gate.

## 15. Final Verdict

**FAIL / NOT READY**

BK01 is **not** currently a proven clean participant in an N-product shared Supabase runtime because its migration/config workflow still depends on project-global state that is already shared with PS01. The reproduced remote-only migration failure is sufficient to fail this gate.

This verdict does **not** mean the BK01 business schema or current application runtime is broken. Current object-level coexistence is substantially healthy. The failure is specifically that future BK01 evolution cannot yet be proven incapable of blocking or affecting another product.

PASS requires enforceable product-local migration/runtime authority plus centrally governed project-global state, followed by TEST03 as the final coexistence proof.

## 16. Hard Boundaries Honored

During this assessment:

- no WSTERA LAB DDL or DML was executed;
- no migration repair, migration apply, database reset, config push, or schema move was executed;
- no PS01 repository file was modified;
- no PS01 business data was read;
- no Production environment was accessed;
- no Council/Billing/LINE redesign was opened;
- TEST03 was not executed because a prior hard blocker was already proven;
- failed local dump artifacts created by an unavailable Docker-dependent CLI path were removed before closure;
- BK01 repository code/config was not modified; this assessment file is the only intended repository change.

### Key reproduced CLI evidence

```text
supabase migration list --linked
=> BK01 history plus remote-only version 20260908073552

supabase db push --linked --dry-run --skip-vault
=> Remote migration versions not found in local migrations directory.
```

No suggested `migration repair` or `db pull` action was executed.
