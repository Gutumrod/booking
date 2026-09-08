# BK01 Shared-Runtime Junction A Failure Evidence

**Date:** 2026-09-08 (Asia/Bangkok)
**Environment:** WSTERA LAB (`ykxlqnshaaxmzzocpjlj`)
**Coordinator branch:** `feature/bk-a-v1-contract-remediation`
**Coordinator checkpoint before execution:** `71d79b2`
**Mode:** A0 refresh -> A1 platform bootstrap -> A2 isolation proof -> rollback on failure
**Verdict:** **JUNCTION A FAIL / ROLLED BACK / RUNTIME LOCKED**

## Owner hard gate

BK01 is not allowed to receive shared-runtime PASS if its migration/runtime authority can damage, mutate or interfere with another WSTERA product or platform-owned shared surface. Green application tests alone are insufficient.

## A0 live refresh

A0 used `supabase_read_only_user` metadata access only. No DDL/DML was executed during the refresh.

Concurrent movement since the earlier assessment was confirmed as MT01 work, not BK01:

- `20260908083054` — `mt_mp_02_persistence_reference`
- `20260908083145` — `mt_mp_02_explicit_server_only_deny`
- `20260908083459` — `mt_mp_02_atomic_claims`
- `20260908084606` — `mt_mp_02_verification_probe_20260908`

Global migration count before BK01 bootstrap: **35**.A0 product/shared baseline remained structurally stable:

| Surface | A0 observation |
|---|---|
| `local_service` | 21 tables, 61 functions, 26 policies, 61 indexes, 35 FKs |
| `ps01` | 21 tables, 92 functions, 16 policies, 58 indexes, 32 FKs |
| `ps01_internal` | 1 table, 1 index |
| `mt01` | 6 tables, 2 functions, 6 policies, 12 indexes, 7 FKs |
| `mt01_private` | 2 functions |
| Storage | 2 buckets: `deposit-slips`, `ps01-daily-report-photos` |
| cron | 8 jobs |
| Data API schemas | `public, graphql_public, local_service, ps01` |

No cross-product FK from/to BK01 was found. Function/policy cross-references found in the product set were only MT01's intended `mt01` ↔ `mt01_private` relationship. BK01 had no PS01/MT01 function or policy reference.

Before A1:

- `local_service` owner: `postgres`;
- all 23 owned BK01 relation/view/type objects: `postgres`;
- all 61 BK01 functions: `postgres`;
- `local_service_internal`: absent;
- `bk01_migrator*`: absent;
- the only BK01 shared-surface function dependencies were the three registered bootstrap exceptions.

## A1 platform bootstrap

The exact reviewed `supabase/shared-runtime/bk01-platform-bootstrap.sql` was applied through the platform migration mechanism.

Recorded global migration:

- version `20260908103209`;
- name `bk01_platform_bootstrap`.Immediate collateral comparison after A1 showed no unauthorized delta in PS01, MT01 or ordinary shared surfaces:

- PS01 / PS01-internal metadata signatures unchanged;
- MT01 / MT01-private metadata signatures unchanged;
- Storage bucket signature unchanged;
- cron signature unchanged;
- installed extension set/version signature unchanged;
- Data API exposed schema configuration unchanged;
- database ACL unchanged;
- non-BK role and non-BK membership signatures unchanged.

The global ledger changed by exactly one expected platform migration row.

## A2 hard failure

A2 did **not** pass.

### Failure 1 — Booking SECURITY DEFINER ownership regression

The bootstrap transferred 58 ordinary `local_service` function owners to `bk01_migrator`. Sixteen transferred functions reference `auth.*`, including `is_shop_member`, `has_shop_role`, booking deposit/status actions and owner provisioning paths.

Live privilege proof showed:

- `bk01_migrator` had `auth.uid()` EXECUTE;
- `bk01_migrator` did **not** have schema `auth` USAGE;
- the intended bootstrap `GRANT USAGE ON SCHEMA auth` did not persist in the live managed schema ACL.

A safe read-only runtime probe then reproduced the regression:

`local_service.is_shop_member(00000000-0000-0000-0000-000000000000)`

failed with PostgreSQL `42501: permission denied for schema auth`.This proves the bootstrap broke existing Booking runtime behavior and therefore fails the regression requirement independently of any cross-product concern.

### Failure 2 — shared `PUBLIC` authority defeats strict role isolation

`bk01_migrator` had no database-wide CREATE, no public CREATE, no PS01/PS01-internal schema USAGE and no MT01/MT01-private schema USAGE. It also had no Storage schema USAGE.

However PostgreSQL `PUBLIC` grants on managed/shared schemas still gave the role:

- schema USAGE on `net`;
- write-capable privileges on `net._http_response`, `net.http_request_queue` and its sequence;
- EXECUTE visibility on shared `net`/`public` functions.

This is not unique to BK01. Read-only comparison proved the same `net` write-capable exposure exists for `ps01_migrator`, `ps01_runtime` and `ps01_runtime_login` because it is inherited from shared `PUBLIC` ACLs.

Therefore the current shared-runtime model cannot truthfully claim that every product role is technically incapable of touching every platform-managed shared surface.

This does **not** prove PS01 currently damages another product. It proves the strict isolation claim is incomplete at the platform ACL layer.

## Required stop decision

No Order/Claim migration, capability persistence, Claim write adapter, Order table/RPC or other BK01 product-local runtime migration is authorized from this state.

The coordinator did not weaken PS01/MT01 ACLs, revoke platform `PUBLIC` grants or patch managed Supabase schemas merely to make BK01 pass. Such a change is platform-wide authority and is outside this BK01 gate.

## Rollback

Because no BK01 product-local forward migration had been applied, the reviewed bootstrap rollback was eligible and was executed immediately.

Recorded global migration:

- version `20260908103450`;
- name `bk01_platform_bootstrap_rollback`.Rollback verification restored the measured pre-bootstrap state exactly for BK01 and unrelated products:

| Surface | Restored metadata signature |
|---|---|
| `local_service` | `0820872289087ff754146d62b131f6c2` |
| `ps01` | `f0f1bed81b36b5e15dffac43543dea30` |
| `ps01_internal` | `af22dd0dc23c4921c74cc04d91a4ed60` |
| `mt01` | `030d5426fc2c75486c45ee4849be8da7` |
| `mt01_private` | `d9bd2571a837d0a69940c5113c6b6b08` |
| `public` | `8c8abf944ed46f6fabfd33cd0faeec78` |
| `storage` | `fca35b8f658bb1358181f0dc5b5673f1` |
| `auth` | `0aabbcbe307fb103dc85ec83a9d44143` |
| `cron` | `d52dbf7ab28759147fb75390580cc793` |
| `net` | `bad9b9674695d8229ce441c58e70eefb` |
| `extensions` | `6b547cccd374301384d17c182c22e242` |
| `realtime` | `0eacb9bcc22ea2d1265ba2ad3d12a65e` |
| `vault` | `d1b22912def0ac844f20af3b57db3d62` |

Shared signatures also returned to the A0 values: Storage `fc0338a5637b01241644b64b5693be96`, cron `094c226c69fc59b2a728f60310ec0449`, extensions `4282a00d4860acc3433a27bbd69d4d0d`, non-BK roles `ee05342f581f8f8e3bef4b9a69eb572a`, non-BK memberships `c65e12cb8e5827cfd6472ec4f1913251`.

`bk01_migrator*` roles are absent again, `local_service_internal` is absent, and the safe Booking probe returns normally instead of throwing an auth permission error.

The two platform migration-history rows remain as audit evidence and are not repaired or erased.## Final coordinator verdict

**JUNCTION A: FAIL**

**LAB state after rollback:** restored to the pre-bootstrap BK01 baseline with unrelated product/shared signatures unchanged.

**Order/Claim runtime unlock:** **DENIED**.

**Safe-lane Claude/Codex work:** may remain preserved as isolated, non-runtime evidence; it must not self-unlock DB/runtime work.

## Blockers before any retry

1. The BK01 migration/runtime ownership model must not break `auth.*`-dependent Booking functions when ownership changes away from `postgres`.
2. The platform must decide how strict product isolation treats managed `PUBLIC` capabilities such as `net`. BK01 is not authorized to change those ACLs unilaterally.
3. Any revised design must be proven without changing PS01/MT01 product ownership/history and must repeat pre/post signatures plus real Booking regression probes.
4. No production deployment or shared-runtime runtime expansion is authorized while this verdict is open.

The preferred next action is a **platform-level shared-runtime isolation remediation decision** followed by a new bounded BK01 bootstrap design. Do not patch the current bootstrap and rerun it without resolving both blockers above.

**CURRENT BK01 SHARED-RUNTIME STATUS:** QUARANTINED / NOT ADMITTED FOR FORWARD RUNTIME MIGRATIONS

## Local repository verification after rollback evidence

- `git diff --check`: PASS (line-ending warnings only; no whitespace error).
- `npm test`: **27/27 PASS**.
- `npm run db:bk01:verify`: repository/static verification PASS.

The static verifier passing does **not** override this live verdict. The reproduced `auth` permission failure proves that repository shape checks alone are insufficient for shared-runtime admission; live A2 regression/isolation evidence remains authoritative.
