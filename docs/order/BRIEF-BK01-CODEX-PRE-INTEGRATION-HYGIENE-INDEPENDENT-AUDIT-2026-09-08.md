# BRIEF — BK01 Codex Pre-Integration Hygiene Independent Audit

**Date:** 2026-09-08
**Mode:** READ-ONLY / INDEPENDENT AUDIT / NO IMPLEMENTATION
**Owner:** BK01 Coordinator

## Purpose

Independently verify that BK01 is genuinely clean and safe to hold while House remediates Junction A.
Do not trust prior PASS statements, Git cleanliness alone, or agent evidence without checking source/worktrees directly.

This audit is specifically requested because the coordinator found ignored/generated state that normal `git status` does not show.

## Absolute stop boundaries

- Do not merge any branch.
- Do not create an integration branch.
- Do not edit source code or migrations.
- Do not apply any Supabase change or query WSTERA LAB.
- Do not modify House/platform repositories.
- Do not remove, print, copy, rotate, or expose any secret value.
- Do not change `.gitignore` or secret-management policy.
- Do not run destructive Git cleanup, GC, reset, clean, prune, or reflog expiry.
- Return findings and recommendations only.
## Canonical repositories/worktrees to inspect

Coordinator:
`D:\AI-Workspace\projects\saas-product-hub\products\booking`
Expected branch: `feature/bk-a-v1-contract-remediation`
Expected checkpoint: `dabafec5e08c647a6711d49a60988a7c661a3828`

Claude safe lane:
`D:\AI-Workspace\worktrees\bk01-claude-public-portal-claim`
Expected branch: `feature/bk01-public-portal-claim-ui`
Expected SHA: `45fa3abf5a316dea622b005bfced1acf948cb8bc`

Codex safe lane:
`D:\AI-Workspace\worktrees\bk01-codex-order-safe-scaffold`
Expected branch: `feature/bk01-order-safe-scaffold`
Expected SHA: `982188170f6a80ce492723786ca1e21cc2435733`

All three expected branches were observed tracking origin at identical SHAs before this audit brief was written.

## Current gate truth

- Junction A: `FAIL / ROLLED BACK`.
- BK01 shared-runtime admission: `QUARANTINED`.
- Runtime Order/Claim migrations: not authorized.
- Claude safe-lane input: coordinator independently accepted.
- Codex safe-lane input: coordinator independently accepted.
- Formal Junction B merge remains blocked until House returns a new Junction A PASS.
## Coordinator observations to independently confirm or reject

1. `git status` is clean in all three worktrees, but ignored/generated artifacts exist.
2. Coordinator root `.env.local` exists and contains non-placeholder local values; app workspace copies also exist.
3. Claude worktree root `.env.local` has the same SHA-256 as coordinator root `.env.local`; its two app workspace copies match it as well.
4. Codex worktree has no root `.env.local`; its two app `.env.local` files matched its `.env.example` byte-for-byte at the coordinator check.
5. `.next/`, root `node_modules/`, workspace `node_modules/`, and Codex `order/catalog/node_modules/` are ignored generated state.
6. `.env.local` and app `.env.local` files are ignored by existing rules, but ignored does not mean hygienically safe.
7. No staged, unstaged or untracked file was observed in any of the three worktrees.
8. `git fsck --no-reflogs --unreachable` reports unreachable Git objects in the shared object database; determine whether this is ordinary historical residue or indicates a material hygiene/security problem. Do not dump secret-like blob contents.
9. Gitleaks is not installed; coordinator performed only a redacted/manual secret-pattern scan and found no secret-like token in safe-lane non-document source diffs.

For secret hygiene, report only paths, hashes/fingerprints if useful, counts, classification and remediation. Never output values.

## Merge-readiness observations to verify

- Both safe lanes branch from merge base `8a5fb8852edb8af7aef7d2ce8338c0a2928d646a`.
- Claude and Codex changed-file sets were observed to have no overlap.
- Coordinator and Claude changed-file sets were observed to have no overlap.
- Coordinator and Codex overlap only on the Codex safe-scaffold brief file.
- That overlapping brief was observed byte-identical at coordinator `dabafec` and Codex `9821881`.
- `git merge-tree --write-tree dabafec 9821881` returned exit 0.
- `git merge-tree --write-tree dabafec 45fa3ab` returned exit 0.
## Required audit work

### A. Worktree and Git integrity

Verify branch, HEAD, upstream, staged/unstaged/untracked state, worktree mapping, merge-base assumptions and remote refs.
Distinguish harmless ignored/generated state from state that could contaminate later integration.
Assess unreachable Git objects without destructive cleanup and without exposing sensitive content.

### B. Secret and environment hygiene

Inspect `.env` file presence and provenance without printing values.
Determine which ignored env copies are required canonical local state, which are generated copies, and which are unnecessary duplicated secrets.
Review `scripts/sync-env.js` behavior and whether current copies can be safely removed after builds without changing source contracts.
Check whether any secret-like value is committed in the safe-lane diffs or reachable branch history using available redacted scanning methods.
If a scanner is unavailable, state that limitation rather than claiming a full secret scan.

### C. Generated artifact hygiene

Classify `.next`, `node_modules`, nested catalog dependencies, coverage/temp/cache outputs and Supabase `.temp` state.
Recommend an exact cleanup set that is safe and reproducible, but do not delete anything.
Explicitly identify anything that must be preserved.

### D. Safe-lane authority boundaries

Reconfirm neither safe lane changes `supabase/migrations` nor `supabase/bk01-migrations`.
Check for platform/global mutation paths, credential shortcuts, runtime enablement, fake-success behavior or hidden cross-product coupling.
Reconfirm Claude Claim remains fail-closed and Codex Order runtime remains fail-closed.
Reconfirm Product Catalog is copy-and-own and Module Hub source was not modified.
### E. Contract and source-of-truth consistency

Review `docs/CURRENT_STATUS.md`, the integration master brief and safe-lane evidence for contradictory current-state instructions.
Older historical text may remain, but a later override must be explicit enough that another agent cannot accidentally authorize runtime work.
Flag any stale wording that could cause the wrong next action.

### F. Merge simulation

Repeat non-mutating merge analysis from the latest coordinator checkpoint into Codex then Claude in the intended order.
Confirm whether the two accepted safe lanes can be integrated without source conflict once Junction A is reopened.
Do not create a branch or merge commit.

### G. Security observations that must not be lost

Order public tracking currently includes a helper projection field named `orderId`. Determine whether this can safely mean an opaque public reference or whether the contract should require a distinct public reference before live runtime. Do not implement the fix.

Nested copied Product Catalog test tooling previously reported 6 audit findings (3 moderate, 1 high, 2 critical) while the root lockfile reported 0. Verify scope and whether any finding is reachable from production/runtime dependencies. Do not run force upgrades.

## Required return format

Produce one audit report file under `docs/order/` containing:

1. **Verdict:** `PASS`, `PASS WITH CLEANUP REQUIRED`, or `FAIL`.
2. Verified SHAs and Git/worktree state.
3. Findings grouped P0/P1/P2/P3.
4. Secret/env hygiene classification without values.
5. Exact safe cleanup recommendation.
6. Merge-simulation result.
7. Runtime/security blockers that must survive into the next phase.
8. Tooling/scan limitations.
9. Explicit statement that no LAB/runtime/platform mutation occurred.
10. Exact next action for BK01 coordinator.

Do not claim full cleanliness unless every material uncertainty above is resolved by evidence.