-- B8 SPEC ADDENDUM for ก้อน 5 — revision after Codex review round 2 (H1 not closed:
-- the app predicate and this spec were different predicates).
--
-- Authority: caretaker verdict, STATUS-HOUSE Addendum A-9 "คำตัดสินผู้คุมหลังรีวิว
-- รอบ 2" item (1) — ONE refund condition for the app and the SQL spec, character
-- for character:
--
--     deposit_status IN ('submitted','verified')
--     AND ( status IN ('cancelled','no_show','completed') OR end_timestamptz < now() )
--
-- Supersedes sections 3/4 of b8-spec-proposed-migration.sql (v1) and the whole of
-- the v2 addendum for section C.
--
-- This file is a SPEC for ก้อน 5 (which owns migrations). B8 does not write
-- migrations and nothing here has been applied anywhere.
--
-- Proposed filename: 20261001120000_bk01_deposit_refund_record.sql
-- Predecessor: 20260930120000_bk01_link_token_no_extensions.sql

-- ============================================================================
-- A. DROP the trigger replacement (caretaker decision, brief 23 §5c-3)
-- ============================================================================
-- The original spec §3.3 proposed CREATE OR REPLACE on
-- local_service.enforce_booking_status_transition. The caretaker ruled that
-- function out: it lives in the bootstrap shared surface and is named in the
-- runtime allowlist (scripts/lib/bk01-runtime-allowlist.mjs:33), so replacing it
-- is not worth the risk. The refund record is written the way set_booking_outcome
-- already writes its trail:
--
--   INSERT INTO local_service.audit_events(
--     shop_id, actor_user_id, actor_type, action, target_type, target_id, metadata)
--   VALUES (v_booking.shop_id, local_service_internal.request_user_id(),
--           'merchant', 'deposit_refunded', 'booking', p_booking_id,
--           jsonb_build_object('refund_reference', v_reference, 'note', v_note));
--
-- audit_events already exists and is readable by the shop
-- (supabase/migrations/20260829105155_bk_a_v1_contract_remediation.sql:420-436),
-- so no new audit table is needed.

-- ============================================================================
-- B. Columns (unchanged from the original spec except refunded_by type)
-- ============================================================================
-- ALTER TABLE local_service.bookings
--     ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ,
--     ADD COLUMN IF NOT EXISTS refunded_by UUID,
--     ADD COLUMN IF NOT EXISTS refund_reference VARCHAR(120),
--     ADD COLUMN IF NOT EXISTS refund_note TEXT;
--
-- DELETED from the original spec: the two booking_status_history columns
-- (refund_reference/refund_note). They only existed to carry the refund detail
-- through the trigger's history row; with the trigger untouched that path is gone.
--
-- NOTE for ก้อน 5: `rejected` is NOT a booking status. The bookings CHECK admits
-- only ('hold','pending_review','confirmed','completed','cancelled','no_show',
-- 'expired') — supabase/migrations/20260807051755_product_rules_v1.sql:43. A
-- refused slip is a `hold` row carrying deposit_status='rejected', which the
-- money rule below excludes. No branch of this spec may test for a booking
-- status of 'rejected'.

-- ============================================================================
-- C. RPC 1 — record_deposit_refund (THE single predicate)
-- ============================================================================
-- Round 2 (this revision): `expired` is gone from the settled-status list and
-- `rejected` is gone entirely; the END-OF-APPOINTMENT test is NOT gated by the
-- booking status, so confirmed / hold / pending_review / expired all qualify once
-- their end is in the past, and an `expired` row whose end is still ahead does NOT
-- qualify (its name is not a queue release).
--
-- `queue_released_at` (v2's third disjunct, from ก้อน 1's migration) is REMOVED:
--   (ก) the caretaker's round-2 formula is authoritative and does not contain it;
--   (ข) the app side has no source for it in this branch, so keeping it would
--       re-open exactly the app-vs-SQL divergence this revision exists to close;
--   (ค) the end-time rule already covers "the appointment is over", which is the
--       only case ก้อน 1's release adds for a refund gate.
-- Recorded as a deviation for the caretaker to confirm (see section E note 4).
CREATE OR REPLACE FUNCTION local_service.record_deposit_refund(
    p_booking_id UUID,
    p_refund_reference TEXT,
    p_note TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, local_service
AS $bk01$
DECLARE
    v_booking local_service.bookings%ROWTYPE;
    v_reference TEXT := NULLIF(BTRIM(p_refund_reference), '');
    v_note TEXT := NULLIF(BTRIM(p_note), '');
    v_refundable BOOLEAN;
BEGIN
    IF local_service_internal.request_user_id() IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Authentication required';
    END IF;

    IF v_reference IS NULL THEN
        RAISE EXCEPTION 'Refund reference is required' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_booking
      FROM local_service.bookings
     WHERE id = p_booking_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Booking not found';
    END IF;

    IF NOT local_service.is_shop_member(v_booking.shop_id) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Not authorized for this shop';
    END IF;

    -- THE single refund predicate (caretaker A-9 round 2, item (1)). Mirror of
    -- canRecordRefund() in apps/booking-admin/src/lib/refund-eligibility.ts.
    -- tests/bk01-refund-spec-parity.test.ts fails if the two drift apart.
    v_refundable := v_booking.deposit_status IN ('submitted', 'verified')
        AND (
            v_booking.status IN ('cancelled', 'no_show', 'completed')
            OR v_booking.end_timestamptz < now()
        );

    -- Fail-closed for the operator: an unset end_timestamptz makes the time
    -- disjunct NULL, never TRUE, so such a row is refused until backfilled
    -- (read-only preflight is a precondition before GO — see section E note 3).
    IF v_booking.deposit_status = 'refunded' THEN
        RAISE EXCEPTION 'Deposit already recorded as refunded';
    END IF;

    IF NOT v_refundable THEN
        RAISE EXCEPTION 'Only a booking whose queue is settled or whose appointment has ended can be recorded as refunded';
    END IF;

    UPDATE local_service.bookings
       SET deposit_status = 'refunded',
           refunded_at = now(),
           refunded_by = local_service_internal.request_user_id(),
           refund_reference = v_reference,
           refund_note = v_note,
           updated_at = now()
     WHERE id = p_booking_id;

    INSERT INTO local_service.audit_events(
        shop_id, actor_user_id, actor_type, action, target_type, target_id, metadata)
    VALUES (
        v_booking.shop_id, local_service_internal.request_user_id(),
        'merchant', 'deposit_refunded', 'booking', p_booking_id,
        jsonb_build_object('refund_reference', v_reference, 'note', v_note));

    RETURN json_build_object(
        'success', true,
        'booking_id', p_booking_id,
        'deposit_status', 'refunded'
    );
END;
$bk01$;

REVOKE ALL ON FUNCTION local_service.record_deposit_refund(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION local_service.record_deposit_refund(UUID, TEXT, TEXT) FROM anon, service_role;
GRANT EXECUTE ON FUNCTION local_service.record_deposit_refund(UUID, TEXT, TEXT) TO authenticated;

-- ============================================================================
-- D. RPC 2 — get_deposit_refund_history (sourced from audit_events)
-- ============================================================================
-- Returns exactly what the admin UI renders: at / by / reference / note.
-- The UI maps these onto DepositRefundAuditEntry (refund-eligibility.ts).
CREATE OR REPLACE FUNCTION local_service.get_deposit_refund_history(p_booking_id UUID)
RETURNS TABLE (created_at TIMESTAMPTZ, by_user UUID, reference TEXT, note TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, local_service
AS $bk01$
DECLARE
    v_shop_id UUID;
BEGIN
    IF local_service_internal.request_user_id() IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Authentication required';
    END IF;

    SELECT b.shop_id INTO v_shop_id FROM local_service.bookings b WHERE b.id = p_booking_id;
    IF v_shop_id IS NULL THEN
        RAISE EXCEPTION 'Booking not found';
    END IF;

    IF NOT local_service.is_shop_member(v_shop_id) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Not authorized for this shop';
    END IF;

    RETURN QUERY
    SELECT e.created_at,
           e.actor_user_id,
           e.metadata ->> 'refund_reference',
           e.metadata ->> 'note'
      FROM local_service.audit_events e
     WHERE e.shop_id = v_shop_id
       AND e.target_type = 'booking'
       AND e.target_id = p_booking_id
       AND e.action = 'deposit_refunded'
     ORDER BY e.created_at ASC;
END;
$bk01$;

REVOKE ALL ON FUNCTION local_service.get_deposit_refund_history(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION local_service.get_deposit_refund_history(UUID) FROM anon, service_role;
GRANT EXECUTE ON FUNCTION local_service.get_deposit_refund_history(UUID) TO authenticated;

-- ============================================================================
-- E. Ordering / prerequisites for ก้อน 5
-- ============================================================================
-- 1. No dependency on ก้อน 1's `queue_released_at` remains — this version reads
--    only columns that exist on the frozen chain (status, deposit_status,
--    end_timestamptz), so ordering against the queue-lock migration is no longer
--    a correctness requirement. Sorting it after that file is still fine.
-- 2. `bookings.end_timestamptz` already exists
--    (supabase/migrations/20260807051755_product_rules_v1.sql:61) and
--    create_booking_hold populates it on every insert, so the time rule has a
--    real input with no new column.
-- 3. Still unverified by B8 (no database): whether every existing LAB row has
--    end_timestamptz populated. The app side derives the end from date +
--    start_time + service duration_minutes when end_timestamptz is null, and
--    fails closed otherwise; the SQL side cannot derive and therefore REFUSES
--    such rows until backfill. Operator must check read-only before GO.
-- 4. OPEN QUESTION for the caretaker: dropping the `queue_released_at` disjunct
--    is a narrowing of the earlier §5c-4 wording ("เวลาจบนัด < now() /
--    `queue_released_at`"). It was dropped to satisfy the round-2 requirement
--    that both sides be one predicate (the app cannot see that column). Confirm
--    or send back — B8 does not decide this.
