# MAC HANDOFF — BK01 R4 Source Re-Review Checkpoint

**Date:** 2026-09-09 (Asia/Bangkok)
**Purpose:** move the current BK01 R4 review checkpoint from Windows to Mac without relying on Windows-local runtime files.

## Canonical source checkpoint

- Repository: `Gutumrod/booking`
- Branch: `feature/bk01-real-shop-hardening-r4`
- HEAD before this handoff-doc commit: `815fb437cbe94221e68825b2f847043ba5e56cad`
- Origin parity at verification: `0/0`
- Frozen audit baseline: `520bb08`
- Amended contract tip: `4d352ad`
- Pre-remediation R4 target: `b0f7353`
- Claude remediation commits: `9ccd5d3`, `815fb43`

The source remediation is complete but R4 is **not yet source-review accepted**. The next gate is independent Codex source re-review.
## Fresh Windows verification before handoff

Fresh checks run on the source checkpoint:

- `npm test` → **70/70 pass, 0 fail**
- `npm run lint` → **0 errors, 12 warnings**
- Consumer `next build` → PASS with non-secret inline placeholder public env
- Admin `next build` → PASS with non-secret inline placeholder public env
- `git diff --check 4d352ad..HEAD` → clean
- protected scope diff (`supabase/`, `scripts/`, `*.env*`, `package.json`, `package-lock.json`) → empty
- cumulative R4 secret-pattern scan → 0 hits
- worktree before adding this handoff bundle → clean

No production `.env.local` was used or modified.
## Bundled evidence

This directory contains Git-tracked copies of the Windows-local R4 evidence needed on Mac:

- `REPORT-CODEX-BK01-R4-INDEPENDENT-REVIEW-2026-09-09.md`
- `BRIEF-CLAUDE-BK01-R4-REMEDIATION-FINAL-2026-09-09.md`
- `BRIEF-CODEX-BK01-R4-INDEPENDENT-REVIEW-AND-CLAUDE-REMEDIATION-2026-09-09.md`
- `BRIEF-CODEX-BK01-R4-SOURCE-RE-REVIEW-WINDOWS-2026-09-09.md`
- `BRIEF-CODEX-BK01-R4-SOURCE-RE-REVIEW-MAC-2026-09-09.md`

The Mac-specific re-review brief uses Mac paths and is the brief to give Codex after checkout.
The Windows copy is retained only as original evidence.
## Mac bootstrap

Expected workspace:
`/Users/wachirayachankhonkan/AI-Workspace/projects/saas-product-hub/products/booking`

On Mac:

```bash
git fetch origin
git checkout feature/bk01-real-shop-hardening-r4
git pull --ff-only origin feature/bk01-real-shop-hardening-r4
git status -sb
git rev-parse HEAD
git rev-parse origin/feature/bk01-real-shop-hardening-r4
npm ci
npm test
```

After this handoff commit is pushed, the Mac HEAD must match origin exactly. Do not start Codex review if the worktree is dirty or SHA differs.
## Next action on Mac

Give Codex this file:
`docs/handoffs/mac-r4-2026-09-09/BRIEF-CODEX-BK01-R4-SOURCE-RE-REVIEW-MAC-2026-09-09.md`

Expected review disposition if source closes cleanly:
`SOURCE_REVIEW_PASS / BROWSER_PROOF_OWED`

If Codex finds any remaining/new source defect, it must return `REMEDIATE_SOURCE` and create the bounded remediation brief specified in the Mac re-review brief.

## Locks that remain in force

- no merge to coordinator/main;
- no deploy or production cutover;
- no WSTERA LAB forward migration;
- no SQL/RPC/schema/shared-runtime change;
- no Order/Claim live integration;
- no PS01/MT01/platform delta;
- R7 remains blocked by Junction A;
- browser/mobile proof comes only after Codex source re-review passes.

This handoff bundle is documentation/evidence only and does not change application behavior.
