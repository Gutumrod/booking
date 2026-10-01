# CONTRACT BK01 P0 SQL — 2026-10-02

Status: implemented R1 contract; fresh W-1 SQL proof PASS, independent review pending. Base 37a0535ddd0f75a2658b90740edf2bd7abb43af6. Branch codex/bk01-p0-sql-20261002.

## Source-of-Truth References
- Vault briefs/codex-parallel-20260927/28-BK01-COUNCIL-P0-FIX.md §0–§3, §5 and STATUS-HOUSE A-24.
- Base supabase/bk01-migrations/20261001130000_bk01_sql_consolidate.sql and 20261001140000_bk01_pack_notify_group67.sql.
- apps/booking-consumer/src/lib/booking-service.ts; apps/booking-admin/src/lib/admin-service.ts and ticket-service.ts.
- Hub docs/platform/MODULE-REUSE-POLICY.md; PORTFOLIO_PRODUCTION_MASTER_PLAN.md.

## App contract
- create_booking_hold keeps the existing nine named inputs and JSON return. Only bk01_runtime may execute; anon/authenticated are revoked. Runtime effective exact allowlist remains 21. Server route owns Turnstile and IP/shop rate limiting. SQL adds atomic shop+phone concurrent hold/pending cap of 3; pending_review retains its appointment deadline. New holds set link_token_expires_at to appointment end +7 days while expires_at remains the separate 15-minute deposit-hold TTL. Past/NULL times fail closed.
- shop_public_profile keeps all customer-facing columns except line_oa_id is removed. Consumer must remove that column from its select. Public eligibility is computed by a safe SECURITY DEFINER wrapper, not grants to internal entitlement helpers.
- bk01_shop_entitlement_status keeps shop_id,item_kind,item_id,item_name,is_active,plan_entitled,state,system_disabled,created_at. A wrapper exposes members' rows and only active public-shop rows to outsiders.
- update_shop_settings(uuid,text,text,text,text,text,text,integer,integer) keeps named inputs; p_customer_cancel_before_hours and p_customer_reschedule_before_hours DEFAULT NULL preserve stored settings under row lock. Both seven and nine named args work; only one catalog identity exists.
- set_shop_notification_contact(p_shop_id uuid) keeps return email,verified_at. Requires owner/admin, top-level email and is_anonymous=false. No email_verified/user_metadata/auth.users dependency. Confirm email ON is a Window 2 release prerequisite.
- record_deposit_refund(p_booking_id uuid,p_refund_reference text,p_note text DEFAULT NULL) keeps JSON return and inputs. Reference is mandatory attached textual transfer evidence; supports submitted/verified/rejected after existing appointment/release time guard. No new storage scope or upload route is authorized. File attachments are held pending a separate storage contract; never reuse customer slip upload to upload merchant evidence.
- get_deposit_refund_history(p_booking_id uuid) keeps existing return fields and reads immutable refund_recorded events. The new deposit_money_events ledger is append-only, FORCE RLS, RPC access only. received and refund_recorded facts are recorded without rewriting history.
- cancel_booking keeps existing signature; owner/admin only. set_booking_outcome completed rejects missing or future start. New tokens are 32 hex characters (128 random bits); legacy 10-character tokens remain accepted until expiry. Confirmation, approval and future slip rejection extend expiry to appointment end +7 days.
- LINE claim only claims customer rows; context returns line_user_id only for customer recipients. Event CHECK set is unchanged; controller follow-up appends deposit_status. App must handle every permitted event explicitly.
- claim_due_shop_email_notifications(p_limit integer DEFAULT 25) keeps output notification_id,shop_id,event_type,email,attempt_count,idempotency_key,pending_slip_count. Digests catch up due 09/17 Bangkok slots once per shop/date/slot, silent during 22–08. No LINE JOIN changes.
- Reschedule checks destination-month quota atomically; reminder reschedule semantics stay 3h. Basic/trial has no booking ceiling. apply_topup is platform-admin only; existing balances preserved.

## Write matrix and preflight
All application database writes inspected with insert/update/delete/upsert search: only booking-admin ticket-service.ts directly DELETEs tickets; all other SQL writes use RPC. authenticated is granted DELETE tickets through its existing RLS, no other direct DML. anon retains no DML. Both roles lose TRUNCATE/REFERENCES/TRIGGER on every product table. Reads are governed by existing RLS plus restricted shops policy.

Reuse Gate: N/A — bounded remediation of existing product SQL, grants, booking state and refund evidence; no new runtime, central billing, storage scope, or copied module. Existing tenant boundary/runner/ledger primitives are reused locally. MT01 Bootstrap Check: N/A for this existing-runtime remediation; no bootstrap architecture introduced. Platform owns roles/global schemas/extensions; R1 cannot mutate them.

## Evidence gates
PG17.11 fresh W-1 UTC, operator non-superuser, platform bootstrap creates product roles; extensions PUBLIC USAGE revoked. Real-role exact projections, NULL/time/race/guard mutations, before/after ACL, app RPC named-argument/catalog and write matrix checks. Full catalog snapshot rollback diff must be zero. Frozen legacy hashes checked by runner before creating a DB client. LAB/production/GO/merge remain HOLD.

Implementation note: existing link_token column is varchar(64), unchanged; 32 hex token derives from SHA-256 of two independent UUIDv4 values. Frozen platform bootstrap remains a pre-P0 prerequisite; P0 exact 21/14/54 role surfaces are checked by scripts/proofs/bk01-p0-surface-gate.mjs.

## Controller follow-up — room 2026-10-01T15:35Z

Implemented/proven on fresh W-1 replay6 on top of e0800ee; this replaces the former email signature/output contract. Runtime cardinality remains 21; old one-input catalog identity is removed, not retained as an overload.

- `claim_due_shop_email_notifications(p_limit integer DEFAULT 25, p_alert_kind local_service.bk01_ops_alert_kind DEFAULT NULL, p_alert_key text DEFAULT NULL, p_delivered boolean DEFAULT NULL)`.
- SQL enum exactly `cap_unverified`, `quota_unreadable`, `breaker_open`. All alert inputs NULL => normal existing shop-email claims. All three alert inputs must be non-NULL for alert mode. Partial args or arbitrary/stale day keys fail.
- The initial key formats in this controller note were superseded by the Opencode F1/F2 review follow-up below. See the final key contract below.
- Returns existing seven fields plus `alert_claimed boolean, alert_delivered boolean`. Normal shop rows append NULL flags. Alert row has NULL notification_id/shop_id/email/attempt_count/pending_slip_count, event_type=`ops_alert`, idempotency_key=input key, and only claim/delivery flags.
- **Two phase transport contract:** call `p_delivered=false` before sending; only alert_claimed=true authorizes send. Concurrent callers lose; undelivered claim holds a five-minute lease. After successful provider acceptance call same kind/key with `p_delivered=true` to acknowledge; acknowledgement returns alert_claimed=false and alert_delivered=true and never authorizes mail. Persisted delivered keys cannot be reclaimed that Thai day. An acknowledgement without a prior claim fails. On transport failure do not acknowledge; a later run may retry after lease. Stable provider idempotency key is required for retry/crash recovery; SQL cannot prove exactly-once external delivery. `delivered` is an acknowledgement, not the old app's pre-send measured/unmeasured flag: Hermes must adapt the sink flow.
- FORCE RLS `ops_alert_delivery_ledger`, no direct anon/authenticated/runtime table grants. Alert SQL does not select shop/customer/contact data and does not claim shop emails. OPS alerts may be claimed during shop quiet hours; quiet-window logic for shop email remains unchanged.
- `get_line_notification_delivery_context(uuid,integer)` appends `deposit_status text` from the currently pending notification's booking. Existing fields, ACL/owner and signature are preserved. Use this for approved/rejected deposit_slip_decision, never infer approval by default.
- New migration/rollback follow e0800ee; frozen P0/legacy/bootstrap files stay unchanged. Full-chain rollback runs alert/context rollback first, then P0 rollback.


## Opencode R1 review follow-up — F1/F2 (2026-10-02)

Status: migration `20261002140000_bk01_review_f1_f2.sql` is implemented on top of f5fedb8; fresh W-1 proof passed. Independent review is pending. Earlier migrations are frozen.

- F1: create_booking_hold sets `link_token_expires_at = v_end_tz + interval '7 days'` for newly created holds as well as confirmed bookings. `expires_at` remains its separate 15-minute deposit-hold deadline. Slip upload authorization continues to require status=hold, unexpired `expires_at`, and unexpired link token. The platform upload registry RPC is not present in the W-1 fixture, so its body is source-checked and left unchanged; do not claim a real storage upload integration test.
- F2 stable key contract (date is the current `YYYY-MM-DD` in Asia/Bangkok):
  - Shop-scoped `cap_unverified`: `push_cap_unverified:<lowercase existing local_service.shops.id UUID>:<YYYY-MM-DD>`.
  - System-scoped `quota_unreadable`: `quota_unreadable:global:<YYYY-MM-DD>`.
  - System-scoped `breaker_open`: `breaker_open:global:<YYYY-MM-DD>`.
  - SQL rejects empty/missing/dash/malformed keys, a shop UUID absent from `local_service.shops`, a missing/wrong `global` segment, a mismatched kind, or a noncurrent Bangkok date. The existing email claim RPC uses its alert enum/key/delivered parameters; no new RPC name or runtime identity is added. Hermes must update `pushAlertDedupeKey()` to these exact strings.

Prior f5fedb8 R1 migration and rollback files are unchanged. The F1/F2 migration redefines only existing function bodies/identities and preserves their owners and EXECUTE ACLs. Its rollback restores the f5fedb8 function definitions/owners/ACLs from the PG17.11 snapshot.
