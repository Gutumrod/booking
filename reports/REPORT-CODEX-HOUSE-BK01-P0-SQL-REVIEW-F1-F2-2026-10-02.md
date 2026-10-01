# HOUSE-BK01-P0-SQL — Opencode F1/F2 follow-up

Date: 2026-10-02. Scope: controller-directed F1/F2 fixes only, on SQL branch `codex/bk01-p0-sql-20261002`, base reviewed R1 `f5fedb882b9db8f94c8baa079438cef50250a804`.

## Source of truth

- Vault `00-System/3musketeers/room.md`, `[R1 review — opencode]` plus Owner/controller confirmation that F1 is source-confirmed and requested key tightening.
- Vault `06-Agent-Logs/WSTERA-House/reports/REVIEW-opencode-HOUSE-BK01-P0-SQL-f5fedb8-2026-10-02.md`, F1/F2 findings and independent PG17 evidence.
- Vault brief `06-Agent-Logs/WSTERA-House/briefs/codex-parallel-20260927/28-BK01-COUNCIL-P0-FIX.md` §0–§3, §5; STATUS-HOUSE A-24.
- Existing BK01 migrations `20261002120000_bk01_council_p0.sql`, `20261002130000_bk01_p0_alert_context.sql`, and upload authorization migration `20260928120000_bk01_house_upload_grants.sql`.
- `reports/CONTRACT-BK01-P0-SQL-2026-10-02.md` final Opencode F1/F2 key contract.

## Implementation

New forward migration `supabase/bk01-migrations/20261002140000_bk01_review_f1_f2.sql`.
SHA-256: `c1f382c5a069c1195ba0778ab49c7561f488648c193c69d6cc3dabddd4eca3cc`.

New snapshot rollback `supabase/rollback/20261002140000_bk01_review_f1_f2.rollback.sql`.
SHA-256: `f6dee48993dd00d3abdc97552a28580427c202c207f5625249f9a4289044a51b`.

F1 replaces only the existing `create_booking_hold` body: every new hold now sets `link_token_expires_at = v_end_tz + interval '7 days'` at creation, matching confirmed bookings. Its separate `expires_at` remains 15 minutes for deposit holds. I inspected the existing upload authorization: it still independently requires status `hold`, an unexpired `expires_at`, and an unexpired `link_token_expires_at`. That migration is untouched. The W-1 fixture lacks the platform-owned `wstera_platform_internal.register_storage_upload_grant` dependency, so I source-checked that gate and did not pretend a real storage upload ran.

F2 replaces only the existing four-argument email claim body. No new RPC or signature/allowlist identity is added. Final keys, using the current Bangkok date:

- Shop cap alert: `push_cap_unverified:<lowercase UUID of an existing local_service.shops row>:<YYYY-MM-DD>`.
- System quota alert: `quota_unreadable:global:<YYYY-MM-DD>`.
- System breaker alert: `breaker_open:global:<YYYY-MM-DD>`.

SQL rejects blank, missing, dash, malformed, non-existent shop IDs; wrong/missing `global`; mismatched kind; and dates other than the current Bangkok date. The contract calls out that Hermes must update `pushAlertDedupeKey()` before R2 integration.

The migration preserves both functions' owners and EXECUTE ACLs. Prior P0/controller migration and rollback files, frozen legacy migrations and platform bootstrap are byte-for-byte unchanged from f5fedb8. No extension grant or extra runtime function; effective runtime remains 21.

## Verification

Fresh W-1 replay directory: `D:\AI-Workspace\runtime\relay\house-20261001\codex-par\HOUSE-BK01-P0-SQL\fresh-replay-review-final` (PG17.11, UTC, loopback, actual non-superuser product operator and actual anon/authenticated/runtime roles; cluster shut down in `finally`). Reproduction: `node scripts/proofs/bk01-opencode-f1-f2-replay.mjs`, with the isolated environment variables/prerequisites documented in the preceding R1 report.

- Before migration: 4/4 assertions confirm 24-hour hold-token expiry at a 40-day appointment and acceptance of the old dash/global-ambiguous keys.
- After migration: 15/15 assertions. Hold expiry equals appointment end +7 days; separate 15-minute hold TTL remains; both old invalid key forms, blank, nonexistent shop, and missing-global forms are rejected; valid existing-shop and explicit system-global forms are accepted.
- Three guard mutations (F1 expiry, F2 shop existence, F2 global segment) each make their negative contract assertion fail; function definitions are restored after each mutation.
- Existing suites in the complete replay: base fail-before 8/8; P0 after 38/38; advanced 28/28; controller follow-up 33/33; exact anon/authenticated/runtime surfaces 14/54/21; write matrix, history SELECT-only, and RPC named-argument/catalog 49/49 pass.
- Follow-up rollback to exact f5fedb8 catalog: raw diff `[]`; full chain rollback to 37a0535: raw diff `[]`; reapply and all after checks pass.
- `npm test` 340/340; BK01 migration policy accepts all 11, 47/47 violating SQL cases rejected, 5/5 runtime authority cases rejected, 3/3 effective-set cases rejected; repository/frozen-source verification PASS (30 migrations, SHA-256 `812b4656b5fcc65d881afd1712581d7c4ba0fd37f39a35c9d7d7d6173b695f5a`).
- `git diff --check` passes. The only existing unit fixture edit adds the new timestamped migration to its expected migration list.

## Handoff

- Claude/opencode/AGY: review the final branch SHA stated in the room; repeat the W-1 replay independently on the new SHA. The published f5fedb8 review result does not automatically cover this new migration.
- Hermes: change alert key generation to the three exact strings above before using the existing claim RPC; no new function is available. OPS delivery, integrated app candidate, and external email remain unmeasured here.
- LAB, production, GO and merge remain HOLD. File refund evidence remains on its existing separate storage-contract HOLD.
