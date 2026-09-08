# BK01 Pre-Integration Hygiene Independent Audit

**Date:** 2026-09-08 (Asia/Bangkok)  
**Mode:** Independent evidence review; no integration, source remediation, cleanup, LAB query, or runtime/platform mutation  
**Verdict:** **PASS WITH CLEANUP REQUIRED**

The two accepted safe lanes remain source-compatible and truthfully fail closed. They are safe to preserve while Junction A is remediated, but ignored environment copies and generated build/dependency state should be removed under a separate, explicit cleanup action before an integration worktree is created. Junction A remains the hard integration/runtime blocker.

## 1. Verified Git and worktree state

State below was captured before this report file was created.

| Lane | Branch | Verified HEAD | Upstream/remote | Tracked/untracked state |
|---|---|---|---|---|
| Coordinator | `feature/bk-a-v1-contract-remediation` | `8c8659eefd01b873b2cdf029ffbc2d1ff9a55bd2` | remote head identical | clean |
| Claude | `feature/bk01-public-portal-claim-ui` | `45fa3abf5a316dea622b005bfced1acf948cb8bc` | remote head identical | clean |
| Codex | `feature/bk01-order-safe-scaffold` | `982188170f6a80ce492723786ca1e21cc2435733` | remote head identical | clean |

The audit brief expected coordinator checkpoint `dabafec5e08c647a6711d49a60988a7c661a3828`. The actual coordinator head is one documentation commit later: `8c8659e`, whose only change from `dabafec` is the audit brief itself. This is benign checkpoint drift, but all merge analysis in this report uses current head `8c8659e`, not the stale expected SHA.

All three heads have merge base `8a5fb8852edb8af7aef7d2ce8338c0a2928d646a`. Worktree mapping, local upstream refs, and live `git ls-remote` results agree.

## 2. Findings

### P0

None found.

### P1 — cleanup/integration blockers

1. **Unnecessary live environment duplication exists outside the coordinator worktree.** Claude root `.env.local` and both Claude app `.env.local` copies have the same SHA-256 as coordinator root `.env.local`. Coordinator app copies also match coordinator root. Ignoring these files protects Git status, not local secret exposure. Remove the redundant copies before integration and keep only the explicitly owned coordinator sources.

2. **Junction A remains `FAIL / ROLLED BACK`; shared-runtime admission remains quarantined.** `docs/CURRENT_STATUS.md:74-97` and the master brief at lines 483-498 and 514 explicitly deny runtime unlock, bootstrap rerun, integration branch creation, and Order/Claim live runtime work. No hygiene result in this report overrides that gate.

### P2 — must survive into runtime design

1. **Order public tracking has an ambiguous identifier contract.** `order/core/security.ts:9-10` projects a field named `orderId`. The scaffold is disabled, so there is no current exposure, but live runtime must replace this with a distinct opaque `publicRef` or prove that the value is never the raw database identifier. This is a pre-enable requirement.

2. **The shared Git object database contains historical residue.** `git fsck --no-reflogs --unreachable` found 6 commits, 483 trees, and 1,952 blobs. Path mapping shows the dominant residue is the previously rewritten `order/catalog/node_modules` tree, including three large esbuild/TypeScript toolchain blobs. These objects are unreachable from the three audited branch heads and do not affect merges or checkouts. Do not prune them while active worktrees/House remediation are in progress; schedule preservation-aware Git maintenance separately after all required refs are backed up and the coordinator approves destructive cleanup.

### P3 — non-blocking debt/clarity

1. **Catalog test tooling has known dev-only advisories.** The copied catalog lock reports 6 findings: 3 moderate, 1 high, and 2 critical under Vitest/Vite tooling. `npm audit --omit=dev --prefix order/catalog` reports 0 production findings, and Codex root reports 0. Do not run a force upgrade inside integration; handle the copied test toolchain under a separate reviewed dependency task.

2. **`docs/CURRENT_STATUS.md` retains older status prose above the current override.** The later sections at lines 74-97 are explicit and prevent accidental runtime authorization, so there is no present authority contradiction. Consolidate the historical top section when Junction A is reopened to reduce future agent ambiguity.

3. **Ignored state is materially larger than `git status` suggests.** All worktrees contain generated dependencies/build outputs. This is reproducible state, not source truth, but it should not be carried into a new integration worktree.

## 3. Secret and environment hygiene

No value was printed or copied during the audit. Classification is based on existence, byte length, hashes, ignore provenance, and script behavior only.

| Location | Classification | Action |
|---|---|---|
| Coordinator root `.env.local` | canonical local secret source currently used by default sync/build | preserve |
| Coordinator root `.env.staging.local` | canonical non-production local source | preserve |
| Coordinator app `.env.local` files | generated byte-identical copies of coordinator root | remove after current build session |
| Claude root `.env.local` | unnecessary duplicate of coordinator local secret source | remove before integration |
| Claude app `.env.local` files | generated duplicates of Claude/coordinator root | remove before integration |
| Codex root `.env.local` | absent | no action |
| Codex app `.env.local` files | byte-identical to `.env.example`; placeholder-only build residue | remove |

`scripts/sync-env.js` is semantically identical across the audited heads; its byte hash differs only where branch/working-copy line endings differ. It copies the chosen repository-root env file verbatim to both app workspaces and refuses sources outside the repository. Therefore app copies are reproducible and need not be preserved.

High-confidence redacted scans over all three reachable heads found no private-key marker, provider-token shape, AWS access key, or JWT shape. The same scan covered all 1,952 unreachable blobs and found no high-confidence credential shape. Twenty-four generic assignment hits mapped to dependency source and LINE webhook source that reference environment-variable names; no value was emitted. `gitleaks` is not installed, so this is not a comprehensive secret-scanner attestation.

## 4. Exact safe cleanup recommendation

Do not execute this cleanup until the coordinator explicitly authorizes it. Resolve and validate each literal path inside its named worktree before deletion.

### Preserve

- Coordinator: `.env.local`, `.env.staging.local`, `.claude/settings.local.json`, `.secretary-relay/`, and `supabase/.temp/` while House/Junction A work remains active.
- Every tracked source file, lockfile, evidence document, and safe-lane branch/ref.
- The shared Git object database as-is; no `gc`, `clean`, `prune`, reset, or reflog expiry in this phase.

### Remove from coordinator when authorized

- `apps/booking-admin/.env.local`
- `apps/booking-consumer/.env.local`
- root `node_modules/`
- both app `node_modules/`
- both app `.next/`, `.open-next/`, `.wrangler/`, `next-env.d.ts`, and `tsconfig.tsbuildinfo`

### Remove from Claude safe lane when authorized

- root `.env.local`
- both app `.env.local`
- root and both app `node_modules/`
- both app `.next/`, `.wrangler/`, `next-env.d.ts`, and `tsconfig.tsbuildinfo`

### Remove from Codex safe lane when authorized

- both app `.env.local`
- root and both app `node_modules/`
- `order/catalog/node_modules/`
- both app `.next/`, `.wrangler/`, `next-env.d.ts`, and `tsconfig.tsbuildinfo`

No tracked file or `.gitignore` change is required for this cleanup.

## 5. Generated artifact classification

- `.next/`, `.open-next/`, `.wrangler/`, `next-env.d.ts`, and `tsconfig.tsbuildinfo`: generated build/tool output; safe to regenerate.
- root/app/catalog `node_modules/`: generated dependency installs; safe to regenerate from committed lockfiles.
- app `.env.local`: generated by `scripts/sync-env.js`; remove after builds.
- coordinator `supabase/.temp/`: generated local CLI/link metadata, but preserve during the active platform remediation handoff.
- coordinator `.secretary-relay/` and `.claude/settings.local.json`: local coordination/tool state; outside safe cleanup without a separate ownership decision.
- No coverage, generic `tmp/`, `temp/`, or root `.cache/` directory was observed in the three audited worktrees.

## 6. Safe-lane authority boundaries

- Claude diff: 0 changes under `supabase/migrations`, `supabase/bk01-migrations`, platform/shared-runtime scripts/config, or env files.
- Codex diff: 0 changes under the same paths.
- Claude `productionClaimAdapter` returns only `ok: false` with `CLAIM_NOT_ENABLED_FOR_SHOP` or `CLAIM_RUNTIME_NOT_ENABLED`; rerun tests passed 43/43.
- Codex Order production status and unavailable adapter return `available: false / ORDER_RUNTIME_UNAVAILABLE`; rerun tests passed 51/51.
- Both safe lanes passed `npm run db:bk01:verify` in this audit.
- Codex catalog verification passed 92/92 plus typecheck. Product Catalog provenance points to Module Hub commit `cd88c570ab57f6976d15f85d09973d0cfbf0cd63` and no runtime cross-repository import was found.
- Module Hub itself is clean at that commit; it was not modified by this audit.

The Codex catalog verification script runs `npm ci --prefix order/catalog`; running the required verification regenerated only the already-ignored `order/catalog/node_modules/` dependency tree. It did not change tracked source, lockfiles, env files, runtime, or migrations. No cleanup was performed afterward because this brief forbids deletion.

## 7. Merge simulation

Changed-path overlap from common base:

- coordinator ↔ Codex: 1 path, the Codex safe-scaffold brief; both heads contain identical Git blob `874e6d08b1119caed244cf0c89870cd8bdce0627`;
- coordinator ↔ Claude: 0 paths;
- Codex ↔ Claude: 0 paths.

Non-checkout `git merge-tree --write-tree` simulations from current coordinator head returned exit 0 for:

- coordinator `8c8659e` + Codex `9821881`;
- coordinator `8c8659e` + Claude `45fa3ab`;
- Codex `9821881` + Claude `45fa3ab`.

Because the two safe lanes have zero changed-path overlap and both independently merge cleanly with current coordinator, the intended Codex-then-Claude source sequence is conflict-free at the current heads. This is source-conflict evidence only, not authorization to create an integration branch or proof of runtime compatibility.

## 8. Runtime/security blockers to carry forward

1. New House/platform remediation and a fresh Junction A PASS are required before formal Junction B.
2. Do not reapply the failed bootstrap or start Order/Claim migrations while quarantine remains.
3. Order confirmation/capacity/idempotency requires authoritative database transaction and concurrency probes.
4. Claim must remain a bounded adapter over Ticket/Case and must not weaken private Ticket RLS.
5. Capability enablement must come from a bounded public/server projection.
6. Resolve `orderId` versus opaque public Order reference before tracking goes live.
7. Phone/email-only history enumeration and cross-shop reference substitution remain forbidden.
8. Catalog dev-tool advisories remain visible maintenance debt but are not production-runtime findings.

## 9. Tooling and evidence limitations

- `gitleaks` is unavailable. Custom high-confidence and path-only redacted scans were used; full entropy/rule-pack coverage is not claimed.
- No LAB query or live Supabase operation was performed, so live state was not revalidated.
- No destructive Git maintenance was attempted; unreachable-object content was classified without dumping values.
- Merge simulation proves current textual/tree compatibility, not post-merge test/build behavior.

## 10. Mutation statement and next action

No WSTERA LAB, Supabase runtime, platform/House repository, source code, migration, branch, remote ref, or integration state was mutated. No secret value was printed, copied, rotated, or removed. This report is the only tracked-worktree deliverable created by the audit; it remains uncommitted for coordinator review.

**Exact next action:** Keep Junction B on HOLD. Coordinator should review this report, authorize the literal-path cleanup set separately, remove redundant safe-lane/app env copies and generated artifacts, then continue waiting for House remediation. Only after new House evidence exists should BK01 rerun Junction A. If Junction A passes, create the dedicated integration branch from the then-current verified coordinator checkpoint and integrate Codex first, verify, then Claude.
