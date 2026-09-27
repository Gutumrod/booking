# Lane B WU-1 embedded source proof

From this directory: `npm ci --ignore-scripts` then `npm run proof`.
From the repository root: `node scripts/proofs/lane-b/wu1_e2e.mjs` after the dependency install.
The optional first argument selects a different repository checkout. Default repo is resolved relative to this harness, independent of cwd.

PGlite 0.5.8 is pinned in this isolated package and lockfile; it is not a runtime dependency of either app. The harness runs the frozen 30-migration chain and generated bootstrap in embedded Postgres, with synthetic Auth, extension/storage stubs and substitutions for unsupported extension/GiST statements. This is source-level evidence, not hosted Supabase or Lane B criteria completion. NULL-argument exercise only establishes the first exercised path for each function. See the comments in the harness for all substitutions.

No LAB, external DB or credentials are used. Output: `supabase/shared-runtime/WU1-PGLITE-PROOF.json` in the selected checkout. This file is regenerated with a timestamp; a successful run is exit 0 with 12 checks passing. Re-run source verifier and tests after regenerating bootstrap.
