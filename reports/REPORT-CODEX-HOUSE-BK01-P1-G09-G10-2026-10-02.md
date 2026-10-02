# BK01 P1 G09/G10 SQL implementation — 2026-10-02

Status: implementation and fresh W-1 proof complete; independent OpenCode + AGY review pending. No LAB, production, merge, or GO action.

## Source of truth and boundary

- Owner decision: Vault `06-Agent-Logs/WSTERA-House/STATUS-HOUSE.md`, Addendum A-26 and the entry “ผู้คุมตัดสินสัญญา G09/G10” (A-9): G10 disallows rebind; admin recovery is manual with audit. G09 allows valid tokens through, rejects wrong tokens after more than five per booking per 15 minutes, limits successful upload intents to 20 per booking per 24 hours, and performs bounded cleanup of rows older than two days.
- Contract: Vault `06-Agent-Logs/WSTERA-House/briefs/CONTRACT-BK01-G09-G10-2026-10-02.md`.
- Base: `e9745a8d49db54bf25f24cfb51adbb9d87ec098c`, branch `codex/bk01-p0-sql-20261002`.
- Implementation branch: `codex/bk01-p1-g09-g10-20261002`.
- Only the new `20261002150000_bk01_p1_g09_g10.sql` was added to the active migration chain. Migrations 120000, 130000, and 140000 and `scripts/lib/bk01-runtime-allowlist.mjs` are byte-identical to the base.

## Changes

- `authorize_booking_recovery_attempt` now serializes attempts by locking the booking, always accepts a valid, unexpired booking token without clearing prior failures, and caps wrong-token evidence at six attempts in a 15-minute window. Further wrong tokens in that window return false without increasing the counter. Cleanup removes at most 100 rows older than two days per call and excludes the current booking.
- `authorize_deposit_slip_upload` uses a separate internal RLS-enabled success ledger. The booking row lock serializes its 24-hour counter; the twenty-first intent raises `UPLOAD_INTENT_LIMIT`. A failed storage-grant registration rolls back its counter update with the transaction. The ledger has no direct grants to anon, authenticated, service_role, or bk01_runtime.
- `bk01_line_bind_booking` now validates through the existing recovery function before accepting a claim, locks the customer, rejects a different existing LINE binding, and does not rewrite a conflicting `line_users` mapping. The existing trial RPC already enforced its one-time binding contract and was not replaced.
- No RPC identity or runtime grant was added. Exact effective runtime EXECUTE remains 21. PUBLIC revokes in the migration preserve the measured existing ACLs; the proof reports no owner/ACL delta.
- Rollback restores the three original function bodies and removes only the new index/table.

## Evidence

Full isolated PG17.11 replay: `D:\AI-Workspace\runtime\relay\house-20261002\codex\HOUSE-BK01-P1-SQL-G09-G10\red-green-replay-r11`.

- Fail-before: 9/16 G09/G10 regression assertions were red on the pre-150000 chain; unaffected legitimate claim, recipient, cross-shop, replay, trial, and signature-order assertions passed.
- Apply: migration ran under the real `bk01_migrator` role through the non-superuser operator on fresh loopback W-1. Existing extensions privileges stayed closed.
- Pass-after: 23/23 assertions, including 12 concurrent wrong-token attempts, 24 simultaneous upload intents (20 accepted), a valid token during the failure window, expired and cross-booking tokens, shared-phone and cross-customer rebind attempts, one-winner concurrent binding, cross-shop/replay rejection, recipient resolution, and trial behavior.
- Rollback: raw catalog snapshot diff to the pre-P1 `e9745a8` catalog was empty (`[]`). Reapply then passed all 23 assertions again.
- Existing full P0 suites in the replay passed, including exact anon/authenticated/runtime surfaces (14/54/21) and the frozen-migration mutation guard.
- `npm test`: 340/340; `npm run db:bk01:policy`: PASS (47/47 forbidden migration cases, 5/5 runtime-authority cases, 3/3 exact EXECUTE cases); `npm run db:bk01:verify`: PASS; `git diff --check`: PASS; frozen migration/allowlist diff against base: empty.

## Handoff and remaining work

- Hermes/app owner should map SQL error `UPLOAD_INTENT_LIMIT` to the contract copy directing the customer to contact the shop. This SQL task did not edit the app.
- LINE binding recovery remains manual platform-admin action with audit; no self-service rebind was introduced.
- Independent OpenCode + AGY exact-SHA review remains required. This is not release PASS; LAB/prod/GO/merge remain untouched.

Next action: Claude ผู้คุม dispatches independent review against the committed branch SHA and attaches the verdict to the House room.
