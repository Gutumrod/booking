# CONTRACT BK01 P0 SQL — 2026-10-02

Status: implemented R1 contract; fresh W-1 SQL proof PASS, independent review pending. Base 37a0535ddd0f75a2658b90740edf2bd7abb43af6. Branch codex/bk01-p0-sql-20261002.

## Source-of-Truth References
- Vault briefs/codex-parallel-20260927/28-BK01-COUNCIL-P0-FIX.md §0–§3, §5 and STATUS-HOUSE A-24.
- Base supabase/bk01-migrations/20261001130000_bk01_sql_consolidate.sql and 20261001140000_bk01_pack_notify_group67.sql.
- apps/booking-consumer/src/lib/booking-service.ts; apps/booking-admin/src/lib/admin-service.ts and ticket-service.ts.
- Hub docs/platform/MODULE-REUSE-POLICY.md; PORTFOLIO_PRODUCTION_MASTER_PLAN.md.

## App contract
- create_booking_hold keeps the existing nine named inputs and JSON return. Only bk01_runtime may execute; anon/authenticated are revoked. Runtime effective exact allowlist becomes 21. Server route owns Turnstile and IP/shop rate limiting. SQL adds atomic shop+phone concurrent hold/pending cap of 3; pending_review retains its appointment deadline. Past/NULL times fail closed.
- shop_public_profile keeps all customer-facing columns except line_oa_id is removed. Consumer must remove that column from its select. Public eligibility is computed by a safe SECURITY DEFINER wrapper, not grants to internal entitlement helpers.
- bk01_shop_entitlement_status keeps shop_id,item_kind,item_id,item_name,is_active,plan_entitled,state,system_disabled,created_at. A wrapper exposes members' rows and only active public-shop rows to outsiders.
- update_shop_settings(uuid,text,text,text,text,text,text,integer,integer) keeps named inputs; p_customer_cancel_before_hours and p_customer_reschedule_before_hours DEFAULT NULL preserve stored settings under row lock. Both seven and nine named args work; only one catalog identity exists.
- set_shop_notification_contact(p_shop_id uuid) keeps return email,verified_at. Requires owner/admin, top-level email and is_anonymous=false. No email_verified/user_metadata/auth.users dependency. Confirm email ON is a Window 2 release prerequisite.
- record_deposit_refund(p_booking_id uuid,p_refund_reference text,p_note text DEFAULT NULL) keeps JSON return and inputs. Reference is mandatory attached textual transfer evidence; supports submitted/verified/rejected after existing appointment/release time guard. No new storage scope or upload route is authorized. File attachments are held pending a separate storage contract; never reuse customer slip upload to upload merchant evidence.
- get_deposit_refund_history(p_booking_id uuid) keeps existing return fields and reads immutable refund_recorded events. The new deposit_money_events ledger is append-only, FORCE RLS, RPC access only. received and refund_recorded facts are recorded without rewriting history.
- cancel_booking keeps existing signature; owner/admin only. set_booking_outcome completed rejects missing or future start. New tokens are 32 hex characters (128 random bits); legacy 10-character tokens remain accepted until expiry. Confirmation, approval and future slip rejection extend expiry to appointment end +7 days.
- LINE claim only claims customer rows; context returns line_user_id only for customer recipients. Context output columns and event CHECK set are unchanged. App must handle every permitted event explicitly.
- claim_due_shop_email_notifications(p_limit integer DEFAULT 25) keeps output notification_id,shop_id,event_type,email,attempt_count,idempotency_key,pending_slip_count. Digests catch up due 09/17 Bangkok slots once per shop/date/slot, silent during 22–08. No LINE JOIN changes.
- Reschedule checks destination-month quota atomically; reminder reschedule semantics stay 3h. Basic/trial has no booking ceiling. apply_topup is platform-admin only; existing balances preserved.

## Write matrix and preflight
All application database writes inspected with insert/update/delete/upsert search: only booking-admin ticket-service.ts directly DELETEs tickets; all other SQL writes use RPC. authenticated is granted DELETE tickets through its existing RLS, no other direct DML. anon retains no DML. Both roles lose TRUNCATE/REFERENCES/TRIGGER on every product table. Reads are governed by existing RLS plus restricted shops policy.

Reuse Gate: N/A — bounded remediation of existing product SQL, grants, booking state and refund evidence; no new runtime, central billing, storage scope, or copied module. Existing tenant boundary/runner/ledger primitives are reused locally. MT01 Bootstrap Check: N/A for this existing-runtime remediation; no bootstrap architecture introduced. Platform owns roles/global schemas/extensions; R1 cannot mutate them.

## Evidence gates
PG17.11 fresh W-1 UTC, operator non-superuser, platform bootstrap creates product roles; extensions PUBLIC USAGE revoked. Real-role exact projections, NULL/time/race/guard mutations, before/after ACL, app RPC named-argument/catalog and write matrix checks. Full catalog snapshot rollback diff must be zero. Frozen legacy hashes checked by runner before creating a DB client. LAB/production/GO/merge remain HOLD.

Implementation note: existing link_token column is varchar(64), unchanged; 32 hex token derives from SHA-256 of two independent UUIDv4 values. Frozen platform bootstrap remains a pre-P0 prerequisite; P0 exact 21/14/54 role surfaces are checked by scripts/proofs/bk01-p0-surface-gate.mjs.
