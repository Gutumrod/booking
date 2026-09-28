-- Compensating rollback for 20260926120000_bk01_entitlement_packs.sql.

-- Run only after rolling back 20260927130000 and 20260927120000. One transaction.

BEGIN;

DO $rollback_guard$ BEGIN
        IF to_regclass('local_service.entitlement_plans') IS NULL
           OR to_regclass('local_service.business_types') IS NULL
           OR to_regclass('local_service.service_entitlement_periods') IS NULL THEN
          RAISE EXCEPTION 'BK01 entitlement migration is not present';
        END IF;
        IF md5(coalesce((SELECT string_agg((to_jsonb(t)-'updated_at')::text, E'
' ORDER BY plan_code)
                           FROM local_service.entitlement_plans t),'')) <> '6a74424756820d4d3ce8b1a2a44f18d2'
           OR md5(coalesce((SELECT string_agg((to_jsonb(t)-'updated_at')::text, E'
' ORDER BY promotion_code)
                              FROM local_service.trial_promotions t),'')) <> 'bac65c32328d84eba438755e6f7bc878'
           OR md5(coalesce((SELECT string_agg((to_jsonb(t)-'created_at'-'updated_at')::text, E'
' ORDER BY type_code)
                              FROM local_service.business_types t),'')) <> 'c82116836d690b53991a8b5ad46d2de1' THEN
          RAISE EXCEPTION 'Rollback refused: BK01 migration seed data changed';
        END IF;
        IF EXISTS (SELECT 1 FROM local_service.service_entitlement_periods)
           OR EXISTS (SELECT 1 FROM local_service.services WHERE entitlement_disabled IS DISTINCT FROM false)
           OR EXISTS (SELECT 1 FROM local_service.shops WHERE starter_set_applied IS DISTINCT FROM false
             OR business_type_code IS DISTINCT FROM CASE
               WHEN EXISTS (SELECT 1 FROM local_service.business_types bt WHERE bt.type_code = btrim(lower(regexp_replace(
                 coalesce(local_service.shops.business_category, ''), '[^a-zA-Z0-9]+', '_', 'g'))))
                 THEN btrim(lower(regexp_replace(coalesce(local_service.shops.business_category, ''), '[^a-zA-Z0-9]+', '_', 'g')))
               ELSE 'other' END) THEN
          RAISE EXCEPTION 'Rollback refused: entitlement rows or migration-added columns contain product data';
        END IF;
      END; $rollback_guard$;

DROP TRIGGER IF EXISTS trg_apply_trial_promotion ON local_service.subscriptions;

DROP TRIGGER IF EXISTS trg_enforce_booking_quota ON local_service.bookings;

DROP TRIGGER IF EXISTS trg_enforce_shop_booking_acceptance ON local_service.bookings;

DROP VIEW local_service.app_business_type_starter_services;

DROP VIEW local_service.app_business_types;

DROP VIEW local_service.bk01_shop_entitlement_status;

DROP VIEW local_service.shop_public_profile;

ALTER TABLE local_service.services DROP CONSTRAINT services_not_active_and_entitlement_disabled;

REVOKE ALL ON FUNCTION local_service.add_ticket_timeline_entry(uuid,text,text,text) FROM PUBLIC, anon, authenticated, service_role, bk01_runtime, bk01_migrator;
CREATE OR REPLACE FUNCTION local_service.add_ticket_timeline_entry(p_ticket_id uuid, p_event_type text, p_message text, p_actor text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'local_service'
AS $function$
DECLARE
    v_ticket local_service.tickets%ROWTYPE;
    v_entry_id UUID;
    v_actor TEXT;
BEGIN
    SELECT * INTO v_ticket
      FROM local_service.tickets
     WHERE id = p_ticket_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Ticket not found' USING ERRCODE = 'P0002';
    END IF;

    IF NOT local_service.has_shop_role(v_ticket.shop_id, ARRAY['owner', 'admin']::TEXT[]) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Owner or admin role required';
    END IF;

    IF NULLIF(BTRIM(p_message), '') IS NULL THEN
        RAISE EXCEPTION 'Timeline message is required' USING ERRCODE = '22023';
    END IF;

    IF p_event_type IS NULL OR p_event_type NOT IN (
        'Created', 'StatusChanged', 'PriorityChanged', 'AssigneeChanged',
        'CommentAdded', 'ResolutionSaved', 'Closed', 'Reopened'
    ) THEN
        RAISE EXCEPTION 'Invalid event type' USING ERRCODE = '22023';
    END IF;

    v_actor := COALESCE(NULLIF(BTRIM(p_actor), ''), 'Staff');

    UPDATE local_service.tickets
       SET updated_at = NOW()
     WHERE id = p_ticket_id;

    INSERT INTO local_service.ticket_timeline_entries (
        ticket_id,
        shop_id,
        event_type,
        message,
        actor
    ) VALUES (
        p_ticket_id,
        v_ticket.shop_id,
        p_event_type,
        BTRIM(p_message),
        v_actor
    )
    RETURNING id INTO v_entry_id;

    RETURN v_entry_id;
END;
$function$;
GRANT EXECUTE ON FUNCTION local_service.add_ticket_timeline_entry(uuid,text,text,text) TO bk01_migrator;
GRANT EXECUTE ON FUNCTION local_service.add_ticket_timeline_entry(uuid,text,text,text) TO authenticated;

REVOKE ALL ON FUNCTION local_service.apply_topup(uuid,integer,integer) FROM PUBLIC, anon, authenticated, service_role, bk01_runtime, bk01_migrator;
CREATE OR REPLACE FUNCTION local_service.apply_topup(p_shop_id uuid, p_bookings_credits integer DEFAULT 0, p_auto_slip_credits integer DEFAULT 0)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'local_service'
AS $function$

DECLARE
    v_usage local_service.entitlement_usage%ROWTYPE;
BEGIN
    IF local_service_internal.request_user_id() IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Authentication required';
    END IF;

    IF NOT (local_service.is_shop_owner(p_shop_id) OR local_service.is_platform_admin()) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Owner or platform admin role required';
    END IF;

    IF p_bookings_credits < 0 OR p_auto_slip_credits < 0 THEN
        RAISE EXCEPTION 'Top-up credits cannot be negative' USING ERRCODE = '22023';
    END IF;

    IF COALESCE(p_bookings_credits, 0) = 0 AND COALESCE(p_auto_slip_credits, 0) = 0 THEN
        RAISE EXCEPTION 'At least one top-up credit amount must be greater than zero' USING ERRCODE = '22023';
    END IF;

    -- ตรวจสอบให้แน่ใจว่ามีแถว entitlement และล็อกแถว
    PERFORM local_service.ensure_entitlement_row(p_shop_id);

    UPDATE local_service.entitlement_usage
       SET bookings_topup_balance = bookings_topup_balance + COALESCE(p_bookings_credits, 0),
           auto_slip_topup_balance = auto_slip_topup_balance + COALESCE(p_auto_slip_credits, 0),
           updated_at = now()
     WHERE shop_id = p_shop_id
    RETURNING * INTO v_usage;

    RETURN json_build_object(
        'success', true,
        'shop_id', p_shop_id,
        'bookings_topup_balance', v_usage.bookings_topup_balance,
        'auto_slip_topup_balance', v_usage.auto_slip_topup_balance,
        'updated_at', v_usage.updated_at
    );
END;
$function$;
GRANT EXECUTE ON FUNCTION local_service.apply_topup(uuid,integer,integer) TO bk01_migrator;
GRANT EXECUTE ON FUNCTION local_service.apply_topup(uuid,integer,integer) TO authenticated;

REVOKE ALL ON FUNCTION local_service.approve_booking_deposit(uuid) FROM PUBLIC, anon, authenticated, service_role, bk01_runtime, bk01_migrator;
CREATE OR REPLACE FUNCTION local_service.approve_booking_deposit(p_booking_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'local_service'
AS $function$

DECLARE
    v_booking local_service.bookings%ROWTYPE;
BEGIN
    IF local_service_internal.request_user_id() IS NULL THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Authentication required';
    END IF;

    SELECT *
      INTO v_booking
      FROM local_service.bookings
     WHERE id = p_booking_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Booking not found';
    END IF;

    IF NOT local_service.is_shop_member(v_booking.shop_id) THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Not authorized for this shop';
    END IF;

    IF v_booking.status <> 'pending_review'
       OR v_booking.deposit_status <> 'submitted' THEN
        RAISE EXCEPTION 'Only submitted deposit slips pending review can be approved';
    END IF;

    UPDATE local_service.bookings
       SET status = 'confirmed',
           deposit_status = 'verified',
           expires_at = NULL,
           updated_at = NOW()
     WHERE id = p_booking_id;

    RETURN json_build_object(
        'success', true,
        'booking_id', p_booking_id,
        'status', 'confirmed',
        'deposit_status', 'verified'
    );
END;
$function$;
GRANT EXECUTE ON FUNCTION local_service.approve_booking_deposit(uuid) TO bk01_migrator;
GRANT EXECUTE ON FUNCTION local_service.approve_booking_deposit(uuid) TO authenticated;

REVOKE ALL ON FUNCTION local_service.audit_platform_admin_update() FROM PUBLIC, anon, authenticated, service_role, bk01_runtime, bk01_migrator;
CREATE OR REPLACE FUNCTION local_service.audit_platform_admin_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'local_service'
AS $function$

DECLARE v_shop_id uuid;
BEGIN
    IF local_service_internal.request_user_id() IS NOT NULL AND local_service.is_platform_admin() THEN
        v_shop_id := CASE WHEN TG_TABLE_NAME = 'shops' THEN NEW.id ELSE nullif(to_jsonb(NEW)->>'shop_id','')::uuid END;
        INSERT INTO local_service.audit_events(
          shop_id,actor_user_id,actor_type,action,target_type,target_id,metadata
        ) VALUES (
          v_shop_id,local_service_internal.request_user_id(),'platform','platform_admin_update',TG_TABLE_NAME,
          CASE WHEN TG_TABLE_NAME = 'shops' THEN NEW.id ELSE NEW.id END,
          jsonb_build_object('record_changed',true)
        );
    END IF;
    RETURN NEW;
END;
$function$;
GRANT EXECUTE ON FUNCTION local_service.audit_platform_admin_update() TO PUBLIC;

REVOKE ALL ON FUNCTION local_service.authorize_booking_recovery_attempt(uuid,text) FROM PUBLIC, anon, authenticated, service_role, bk01_runtime, bk01_migrator;
CREATE OR REPLACE FUNCTION local_service.authorize_booking_recovery_attempt(p_booking_id uuid, p_recovery_token text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'local_service'
AS $function$
DECLARE v_booking local_service.bookings%rowtype; v_attempt local_service.booking_recovery_attempts%rowtype; v_valid boolean;
BEGIN
  SELECT * INTO v_booking FROM local_service.bookings WHERE id=p_booking_id;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO v_attempt FROM local_service.booking_recovery_attempts WHERE booking_id=p_booking_id FOR UPDATE;
  IF FOUND AND v_attempt.blocked_until > now() THEN RETURN false; END IF;
  v_valid := v_booking.link_token = upper(trim(p_recovery_token))
             AND v_booking.link_token_expires_at IS NOT NULL
             AND v_booking.link_token_expires_at > now();
  IF v_valid THEN
    DELETE FROM local_service.booking_recovery_attempts WHERE booking_id=p_booking_id;
    RETURN true;
  END IF;
  INSERT INTO local_service.booking_recovery_attempts(booking_id,failed_attempts,window_started_at,blocked_until)
  VALUES(p_booking_id,1,now(),NULL)
  ON CONFLICT(booking_id) DO UPDATE SET
    failed_attempts=CASE WHEN booking_recovery_attempts.window_started_at < now()-interval '15 minutes' THEN 1 ELSE booking_recovery_attempts.failed_attempts+1 END,
    window_started_at=CASE WHEN booking_recovery_attempts.window_started_at < now()-interval '15 minutes' THEN now() ELSE booking_recovery_attempts.window_started_at END,
    blocked_until=CASE WHEN booking_recovery_attempts.failed_attempts+1 >= 5 THEN now()+interval '30 minutes' ELSE booking_recovery_attempts.blocked_until END;
  RETURN false;
END; $function$;
GRANT EXECUTE ON FUNCTION local_service.authorize_booking_recovery_attempt(uuid,text) TO bk01_migrator;
GRANT EXECUTE ON FUNCTION local_service.authorize_booking_recovery_attempt(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION local_service.authorize_booking_recovery_attempt(uuid,text) TO bk01_runtime;

REVOKE ALL ON FUNCTION local_service.cancel_booking(uuid,text) FROM PUBLIC, anon, authenticated, service_role, bk01_runtime, bk01_migrator;
CREATE OR REPLACE FUNCTION local_service.cancel_booking(p_booking_id uuid, p_reason text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'local_service'
AS $function$

DECLARE
    v_booking local_service.bookings%ROWTYPE;
    v_reason TEXT := NULLIF(BTRIM(p_reason), '');
BEGIN
    IF local_service_internal.request_user_id() IS NULL THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Authentication required';
    END IF;

    IF v_reason IS NULL THEN
        RAISE EXCEPTION 'Cancellation reason is required' USING ERRCODE = '22023';
    END IF;

    SELECT *
      INTO v_booking
      FROM local_service.bookings
     WHERE id = p_booking_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Booking not found';
    END IF;

    IF NOT local_service.is_shop_member(v_booking.shop_id) THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Not authorized for this shop';
    END IF;

    IF v_booking.status NOT IN ('hold', 'pending_review', 'confirmed') THEN
        RAISE EXCEPTION 'Only active bookings can be cancelled';
    END IF;

    UPDATE local_service.bookings
       SET status = 'cancelled',
           expires_at = NULL,
           notes = CASE
               WHEN NULLIF(BTRIM(notes), '') IS NULL THEN 'Cancellation reason: ' || v_reason
               ELSE notes || E'\nCancellation reason: ' || v_reason
           END,
           updated_at = NOW()
     WHERE id = p_booking_id;

    RETURN json_build_object(
        'success', true,
        'booking_id', p_booking_id,
        'status', 'cancelled'
    );
END;
$function$;
GRANT EXECUTE ON FUNCTION local_service.cancel_booking(uuid,text) TO bk01_migrator;
GRANT EXECUTE ON FUNCTION local_service.cancel_booking(uuid,text) TO authenticated;

REVOKE ALL ON FUNCTION local_service.claim_due_line_notifications(integer) FROM PUBLIC, anon, authenticated, service_role, bk01_runtime, bk01_migrator;
CREATE OR REPLACE FUNCTION local_service.claim_due_line_notifications(p_limit integer DEFAULT 25)
 RETURNS SETOF local_service.line_notification_logs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'local_service'
AS $function$
BEGIN
    RETURN QUERY
    WITH due AS (
        SELECT l.id
        FROM local_service.line_notification_logs l
        JOIN local_service.bookings b ON b.id=l.booking_id
        WHERE l.status='pending'
          AND l.scheduled_for <= now()
          AND (l.next_retry_at IS NULL OR l.next_retry_at <= now())
          AND (l.event_type = 'booking_cancelled' OR b.status <> 'cancelled')
        ORDER BY l.scheduled_for
        FOR UPDATE OF l SKIP LOCKED
        LIMIT greatest(1,least(p_limit,100))
    )
    UPDATE local_service.line_notification_logs l
       SET attempt_count=l.attempt_count+1,
           next_retry_at=now()+interval '5 minutes'
      FROM due WHERE l.id=due.id
    RETURNING l.*;
END;
$function$;
GRANT EXECUTE ON FUNCTION local_service.claim_due_line_notifications(integer) TO bk01_migrator;
GRANT EXECUTE ON FUNCTION local_service.claim_due_line_notifications(integer) TO service_role;
GRANT EXECUTE ON FUNCTION local_service.claim_due_line_notifications(integer) TO bk01_runtime;

REVOKE ALL ON FUNCTION local_service.claim_stripe_webhook_event(text,text,timestamp with time zone) FROM PUBLIC, anon, authenticated, service_role, bk01_runtime, bk01_migrator;
CREATE OR REPLACE FUNCTION local_service.claim_stripe_webhook_event(p_id text, p_type text, p_created_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'local_service'
AS $function$
DECLARE v_claimed boolean;
BEGIN
  INSERT INTO local_service.stripe_webhook_events(id,type,created_at,processed_at,processing_status,processing_started_at)
  VALUES(p_id,p_type,p_created_at,now(),'processing',now())
  ON CONFLICT(id) DO UPDATE SET processing_status='processing',processing_started_at=now(),last_error=NULL
  WHERE stripe_webhook_events.processing_status='failed'
     OR (stripe_webhook_events.processing_status='processing' AND stripe_webhook_events.processing_started_at < now()-interval '5 minutes')
  RETURNING true INTO v_claimed;
  RETURN coalesce(v_claimed,false);
END; $function$;
GRANT EXECUTE ON FUNCTION local_service.claim_stripe_webhook_event(text,text,timestamp with time zone) TO bk01_migrator;
GRANT EXECUTE ON FUNCTION local_service.claim_stripe_webhook_event(text,text,timestamp with time zone) TO service_role;
GRANT EXECUTE ON FUNCTION local_service.claim_stripe_webhook_event(text,text,timestamp with time zone) TO bk01_runtime;

REVOKE ALL ON FUNCTION local_service.complete_line_notification(uuid,integer,text,timestamp with time zone,timestamp with time zone,text) FROM PUBLIC, anon, authenticated, service_role, bk01_runtime, bk01_migrator;
CREATE OR REPLACE FUNCTION local_service.complete_line_notification(p_id uuid, p_attempt_count integer, p_status text, p_sent_at timestamp with time zone, p_next_retry_at timestamp with time zone, p_error_message text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'local_service'
AS $function$
DECLARE v_updated int;
BEGIN
  IF p_status NOT IN ('pending','sent','failed') THEN RAISE EXCEPTION 'Invalid notification status'; END IF;
  UPDATE local_service.line_notification_logs
     SET status=p_status,sent_at=p_sent_at,next_retry_at=p_next_retry_at,error_message=left(p_error_message,500)
   WHERE id=p_id AND attempt_count=p_attempt_count AND status='pending';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated=1;
END; $function$;
GRANT EXECUTE ON FUNCTION local_service.complete_line_notification(uuid,integer,text,timestamp with time zone,timestamp with time zone,text) TO bk01_migrator;
GRANT EXECUTE ON FUNCTION local_service.complete_line_notification(uuid,integer,text,timestamp with time zone,timestamp with time zone,text) TO service_role;
GRANT EXECUTE ON FUNCTION local_service.complete_line_notification(uuid,integer,text,timestamp with time zone,timestamp with time zone,text) TO bk01_runtime;

REVOKE ALL ON FUNCTION local_service.create_booking_hold(uuid,uuid,uuid,character varying,character varying,character varying,date,time without time zone,text) FROM PUBLIC, anon, authenticated, service_role, bk01_runtime, bk01_migrator;
CREATE OR REPLACE FUNCTION local_service.create_booking_hold(p_shop_id uuid, p_service_id uuid, p_staff_id uuid DEFAULT NULL::uuid, p_customer_name character varying DEFAULT ''::character varying, p_customer_phone character varying DEFAULT ''::character varying, p_customer_email character varying DEFAULT NULL::character varying, p_booking_date date DEFAULT CURRENT_DATE, p_start_time time without time zone DEFAULT '09:00:00'::time without time zone, p_notes text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'local_service'
AS $function$
DECLARE
    v_service RECORD;
    v_shop RECORD;
    v_customer_id UUID;
    v_chosen_staff_id UUID := p_staff_id;
    v_deposit_required BOOLEAN;
    v_deposit_amount NUMERIC(10,2) := 0.00;
    v_status VARCHAR(50);
    v_deposit_status VARCHAR(50);
    v_expires_at TIMESTAMPTZ;
    v_booking_code VARCHAR(20);
    v_link_token VARCHAR(10);
    v_start_tz TIMESTAMPTZ;
    v_end_tz TIMESTAMPTZ;
    v_booking_id UUID;
    v_day_of_week INTEGER;
    v_end_time TIME;
    v_constraint_name TEXT;
BEGIN
    IF NULLIF(btrim(p_customer_name), '') IS NULL THEN
        RAISE EXCEPTION 'Customer name is required';
    END IF;
    IF NULLIF(btrim(p_customer_phone), '') IS NULL THEN
        RAISE EXCEPTION 'Customer phone is required';
    END IF;
    IF p_booking_date IS NULL OR p_booking_date < CURRENT_DATE THEN
        RAISE EXCEPTION 'Booking date must be today or later';
    END IF;

    SELECT * INTO v_service
    FROM local_service.services
    WHERE id = p_service_id
      AND shop_id = p_shop_id
      AND is_active = true;
    IF v_service.id IS NULL THEN
        RAISE EXCEPTION 'Service not found or inactive';
    END IF;

    SELECT * INTO v_shop
    FROM local_service.shops
    WHERE id = p_shop_id
      AND is_active = true;
    IF v_shop.id IS NULL THEN
        RAISE EXCEPTION 'Shop not found or inactive';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM local_service.shop_holidays h
        WHERE h.shop_id = p_shop_id
          AND h.staff_id IS NULL
          AND h.holiday_date = p_booking_date
    ) THEN
        RAISE EXCEPTION 'Shop is closed on the requested date';
    END IF;

    v_start_tz := (p_booking_date || ' ' || p_start_time)::timestamp AT TIME ZONE 'Asia/Bangkok';
    v_end_tz := v_start_tz + (v_service.duration_minutes || ' minutes')::interval;
    v_end_time := (p_start_time + (v_service.duration_minutes || ' minutes')::interval)::time;
    v_day_of_week := EXTRACT(DOW FROM p_booking_date)::integer;

    UPDATE local_service.bookings
    SET status = 'expired',
        updated_at = NOW()
    WHERE shop_id = p_shop_id
      AND status = 'hold'
      AND expires_at IS NOT NULL
      AND expires_at <= NOW()
      AND tstzrange(start_timestamptz, end_timestamptz, '[)')
          && tstzrange(v_start_tz, v_end_tz, '[)');

    v_deposit_required := COALESCE(v_shop.require_deposit, true);
    IF v_deposit_required THEN
        IF v_service.deposit_amount IS NOT NULL THEN
            v_deposit_amount := v_service.deposit_amount;
        ELSIF v_shop.default_deposit_amount > 0 THEN
            v_deposit_amount := v_shop.default_deposit_amount;
        ELSE
            v_deposit_required := false;
        END IF;
    END IF;

    IF v_deposit_required AND v_deposit_amount > 0 THEN
        v_status := 'hold';
        v_deposit_status := 'awaiting';
        v_expires_at := NOW() + INTERVAL '15 minutes';
    ELSE
        v_status := 'confirmed';
        v_deposit_status := 'not_required';
        v_expires_at := NULL;
        v_deposit_amount := 0.00;
    END IF;

    IF v_chosen_staff_id IS NULL THEN
        SELECT st.id INTO v_chosen_staff_id
        FROM local_service.staff st
        WHERE st.shop_id = p_shop_id
          AND st.is_active = true
          AND NOT EXISTS (
              SELECT 1
              FROM local_service.shop_holidays h
              WHERE h.shop_id = p_shop_id
                AND h.staff_id = st.id
                AND h.holiday_date = p_booking_date
          )
          AND EXISTS (
              SELECT 1
              FROM local_service.staff_schedules s
              WHERE s.staff_id = st.id
                AND s.day_of_week = v_day_of_week
                AND COALESCE(s.is_working_day, false)
                AND p_start_time >= s.work_start
                AND v_end_time <= s.work_end
                AND NOT (
                    s.break_start IS NOT NULL
                    AND s.break_end IS NOT NULL
                    AND p_start_time < s.break_end
                    AND v_end_time > s.break_start
                )
          )
          AND NOT EXISTS (
              SELECT 1
              FROM local_service.bookings b
              WHERE b.staff_id = st.id
                AND b.status IN ('hold', 'pending_review', 'confirmed')
                AND (b.expires_at IS NULL OR b.expires_at > NOW())
                AND tstzrange(b.start_timestamptz, b.end_timestamptz, '[)')
                    && tstzrange(v_start_tz, v_end_tz, '[)')
          )
        ORDER BY (
            SELECT COUNT(*)
            FROM local_service.bookings b2
            WHERE b2.staff_id = st.id
              AND b2.booking_date = p_booking_date
              AND b2.status IN ('hold', 'pending_review', 'confirmed')
        ) ASC, st.created_at ASC
        LIMIT 1;

        IF v_chosen_staff_id IS NULL THEN
            RAISE EXCEPTION 'No available staff for the requested time slot';
        END IF;
    ELSE
        IF NOT EXISTS (
            SELECT 1
            FROM local_service.staff st
            WHERE st.id = v_chosen_staff_id
              AND st.shop_id = p_shop_id
              AND st.is_active = true
        ) THEN
            RAISE EXCEPTION 'Selected staff not found or inactive';
        END IF;
        IF EXISTS (
            SELECT 1
            FROM local_service.shop_holidays h
            WHERE h.shop_id = p_shop_id
              AND h.staff_id = v_chosen_staff_id
              AND h.holiday_date = p_booking_date
        ) THEN
            RAISE EXCEPTION 'Selected staff is off on the requested date';
        END IF;
        IF NOT EXISTS (
            SELECT 1
            FROM local_service.staff_schedules s
            WHERE s.staff_id = v_chosen_staff_id
              AND s.day_of_week = v_day_of_week
              AND COALESCE(s.is_working_day, false)
              AND p_start_time >= s.work_start
              AND v_end_time <= s.work_end
              AND NOT (
                  s.break_start IS NOT NULL
                  AND s.break_end IS NOT NULL
                  AND p_start_time < s.break_end
                  AND v_end_time > s.break_start
              )
        ) THEN
            RAISE EXCEPTION 'Selected staff is outside working hours, on a break, or has no schedule';
        END IF;
        IF EXISTS (
            SELECT 1
            FROM local_service.bookings b
            WHERE b.staff_id = v_chosen_staff_id
              AND b.status IN ('hold', 'pending_review', 'confirmed')
              AND (b.expires_at IS NULL OR b.expires_at > NOW())
              AND tstzrange(b.start_timestamptz, b.end_timestamptz, '[)')
                  && tstzrange(v_start_tz, v_end_tz, '[)')
        ) THEN
            RAISE EXCEPTION 'Selected staff is unavailable during this time slot';
        END IF;
    END IF;

    INSERT INTO local_service.customers (shop_id, name, phone, email)
    VALUES (
        p_shop_id,
        btrim(p_customer_name),
        btrim(p_customer_phone),
        p_customer_email
    )
    ON CONFLICT (shop_id, phone)
    DO UPDATE SET name = EXCLUDED.name,
        email = COALESCE(EXCLUDED.email, local_service.customers.email)
    RETURNING id INTO v_customer_id;

    v_booking_code := local_service.generate_booking_code();
    v_link_token := local_service.generate_link_token();

    BEGIN
        INSERT INTO local_service.bookings (
            shop_id, customer_id, staff_id, service_id, booking_code, link_token,
            link_token_expires_at, booking_date, start_time, end_time,
            start_timestamptz, end_timestamptz, status, deposit_status,
            service_price, service_duration_minutes, deposit_amount, total_price,
            deposit_price, expires_at, notes
        ) VALUES (
            p_shop_id, v_customer_id, v_chosen_staff_id, p_service_id, v_booking_code, v_link_token,
            NOW() + INTERVAL '24 hours', p_booking_date, p_start_time, v_end_time,
            v_start_tz, v_end_tz, v_status, v_deposit_status,
            v_service.price, v_service.duration_minutes, v_deposit_amount, v_service.price,
            v_deposit_amount, v_expires_at, p_notes
        )
        RETURNING id INTO v_booking_id;
    EXCEPTION
        WHEN exclusion_violation THEN
            GET STACKED DIAGNOSTICS v_constraint_name = CONSTRAINT_NAME;
            IF v_constraint_name = 'prevent_overlapping_staff_bookings' THEN
                RAISE EXCEPTION USING
                    ERRCODE = 'P0001',
                    MESSAGE = 'Selected staff is unavailable during this time slot';
            END IF;
            RAISE;
    END;

    RETURN json_build_object(
        'booking_id', v_booking_id,
        'booking_code', v_booking_code,
        'link_token', v_link_token,
        'status', v_status,
        'deposit_status', v_deposit_status,
        'deposit_amount', v_deposit_amount,
        'total_price', v_service.price,
        'expires_at', v_expires_at,
        'staff_id', v_chosen_staff_id
    );
END;
$function$;
GRANT EXECUTE ON FUNCTION local_service.create_booking_hold(uuid,uuid,uuid,character varying,character varying,character varying,date,time without time zone,text) TO bk01_migrator;
GRANT EXECUTE ON FUNCTION local_service.create_booking_hold(uuid,uuid,uuid,character varying,character varying,character varying,date,time without time zone,text) TO anon;
GRANT EXECUTE ON FUNCTION local_service.create_booking_hold(uuid,uuid,uuid,character varying,character varying,character varying,date,time without time zone,text) TO authenticated;
GRANT EXECUTE ON FUNCTION local_service.create_booking_hold(uuid,uuid,uuid,character varying,character varying,character varying,date,time without time zone,text) TO service_role;

REVOKE ALL ON FUNCTION local_service.create_service(uuid,text,text,integer,numeric,numeric,uuid) FROM PUBLIC, anon, authenticated, service_role, bk01_runtime, bk01_migrator;
CREATE OR REPLACE FUNCTION local_service.create_service(p_shop_id uuid, p_name text, p_description text, p_duration_minutes integer, p_price numeric, p_deposit_amount numeric, p_idempotency_key uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'local_service'
AS $function$
DECLARE
    v_shop_id UUID;
    v_service_id UUID;
BEGIN
    v_shop_id := p_shop_id;

    IF NOT local_service.has_shop_role(v_shop_id, ARRAY['owner', 'admin']::TEXT[]) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Owner or admin role required';
    END IF;

    IF p_idempotency_key IS NULL THEN
        RAISE EXCEPTION 'Idempotency key is required' USING ERRCODE = '22023';
    END IF;

    IF NULLIF(BTRIM(p_name), '') IS NULL THEN
        RAISE EXCEPTION 'Service name is required' USING ERRCODE = '22023';
    END IF;

    IF p_duration_minutes IS NULL OR p_duration_minutes < 15 OR p_duration_minutes % 15 <> 0 THEN
        RAISE EXCEPTION 'Duration must be a positive multiple of 15 minutes' USING ERRCODE = '22023';
    END IF;

    IF p_price IS NULL OR p_price < 0
       OR p_deposit_amount IS NULL OR p_deposit_amount < 0
       OR p_deposit_amount > p_price THEN
        RAISE EXCEPTION 'Invalid service price or deposit amount' USING ERRCODE = '22023';
    END IF;

    SELECT id
      INTO v_service_id
      FROM local_service.services
     WHERE shop_id = v_shop_id
       AND creation_idempotency_key = p_idempotency_key;

    IF v_service_id IS NOT NULL THEN
        RETURN v_service_id;
    END IF;

    INSERT INTO local_service.services (
        shop_id, name, description, duration_minutes, price,
        deposit_amount, is_active, creation_idempotency_key
    ) VALUES (
        v_shop_id, BTRIM(p_name), NULLIF(BTRIM(p_description), ''),
        p_duration_minutes, p_price, p_deposit_amount, true, p_idempotency_key
    )
    RETURNING id INTO v_service_id;

    RETURN v_service_id;
END;
$function$;
GRANT EXECUTE ON FUNCTION local_service.create_service(uuid,text,text,integer,numeric,numeric,uuid) TO bk01_migrator;
GRANT EXECUTE ON FUNCTION local_service.create_service(uuid,text,text,integer,numeric,numeric,uuid) TO authenticated;

REVOKE ALL ON FUNCTION local_service.create_shop_holiday(uuid,date,text,uuid) FROM PUBLIC, anon, authenticated, service_role, bk01_runtime, bk01_migrator;
CREATE OR REPLACE FUNCTION local_service.create_shop_holiday(p_shop_id uuid, p_holiday_date date, p_reason text, p_idempotency_key uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'local_service'
AS $function$
DECLARE
    v_holiday_id UUID;
BEGIN
    IF NOT local_service.has_shop_role(p_shop_id, ARRAY['owner', 'admin']::TEXT[]) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Owner or admin role required';
    END IF;

    IF p_holiday_date IS NULL THEN
        RAISE EXCEPTION 'Holiday date is required' USING ERRCODE = '22023';
    END IF;

    IF p_idempotency_key IS NULL THEN
        RAISE EXCEPTION 'Idempotency key is required' USING ERRCODE = '22023';
    END IF;

    SELECT id
      INTO v_holiday_id
      FROM local_service.shop_holidays
     WHERE shop_id = p_shop_id
       AND creation_idempotency_key = p_idempotency_key;

    IF v_holiday_id IS NOT NULL THEN
        RETURN v_holiday_id;
    END IF;

    SELECT id
      INTO v_holiday_id
      FROM local_service.shop_holidays
     WHERE shop_id = p_shop_id
       AND staff_id IS NULL
       AND holiday_date = p_holiday_date;

    IF v_holiday_id IS NOT NULL THEN
        RETURN v_holiday_id;
    END IF;

    INSERT INTO local_service.shop_holidays (
        shop_id, staff_id, holiday_date, reason, creation_idempotency_key
    ) VALUES (
        p_shop_id, NULL, p_holiday_date,
        COALESCE(NULLIF(BTRIM(p_reason), ''), 'วันหยุดพิเศษร้านค้า'),
        p_idempotency_key
    )
    RETURNING id INTO v_holiday_id;

    RETURN v_holiday_id;
END;
$function$;
GRANT EXECUTE ON FUNCTION local_service.create_shop_holiday(uuid,date,text,uuid) TO bk01_migrator;
GRANT EXECUTE ON FUNCTION local_service.create_shop_holiday(uuid,date,text,uuid) TO authenticated;

REVOKE ALL ON FUNCTION local_service.create_staff(uuid,text,text,uuid) FROM PUBLIC, anon, authenticated, service_role, bk01_runtime, bk01_migrator;
CREATE OR REPLACE FUNCTION local_service.create_staff(p_shop_id uuid, p_name text, p_phone text, p_idempotency_key uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'local_service'
AS $function$
DECLARE
    v_shop_id UUID;
    v_staff_id UUID;
    v_plan TEXT;
    v_limits RECORD;
    v_active_staff_count INT;
BEGIN
    v_shop_id := p_shop_id;

    IF NOT local_service.is_shop_owner(v_shop_id) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Owner role required';
    END IF;

    IF p_idempotency_key IS NULL THEN
        RAISE EXCEPTION 'Idempotency key is required' USING ERRCODE = '22023';
    END IF;

    IF NULLIF(BTRIM(p_name), '') IS NULL THEN
        RAISE EXCEPTION 'Staff name is required' USING ERRCODE = '22023';
    END IF;

    -- การคืนค่าแบบ Idempotent สำหรับคำขอเดิมที่สำเร็จไปแล้ว (ต้องทำงานก่อนเช็คขีดจำกัด)
    SELECT id
      INTO v_staff_id
      FROM local_service.staff
     WHERE shop_id = v_shop_id
       AND creation_idempotency_key = p_idempotency_key;

    IF v_staff_id IS NOT NULL THEN
        RETURN v_staff_id;
    END IF;

    -- Lock the shop's staff-limit slot transactionally so two concurrent
    -- create_staff calls near the limit cannot both pass the COUNT(*) gate.
    PERFORM pg_advisory_xact_lock(hashtext(v_shop_id::text));

    -- ตรวจสอบขีดจำกัดพนักงานตามแพ็กเกจ
    SELECT COALESCE(plan, 'free_trial')
      INTO v_plan
      FROM local_service.subscriptions
     WHERE shop_id = v_shop_id;

    IF NOT FOUND THEN
        v_plan := 'free_trial';
    END IF;

    SELECT staff_limit INTO v_limits FROM local_service.get_tier_limits(v_plan);

    SELECT COUNT(*)
      INTO v_active_staff_count
      FROM local_service.staff
     WHERE shop_id = v_shop_id
       AND is_active = true;

    IF v_active_staff_count >= v_limits.staff_limit THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P0001',
            MESSAGE = 'STAFF_LIMIT_EXCEEDED';
    END IF;

    INSERT INTO local_service.staff (
        shop_id, name, phone, is_active, creation_idempotency_key
    ) VALUES (
        v_shop_id, BTRIM(p_name), NULLIF(BTRIM(p_phone), ''), true, p_idempotency_key
    )
    RETURNING id INTO v_staff_id;

    RETURN v_staff_id;
END;
$function$;
GRANT EXECUTE ON FUNCTION local_service.create_staff(uuid,text,text,uuid) TO bk01_migrator;
GRANT EXECUTE ON FUNCTION local_service.create_staff(uuid,text,text,uuid) TO authenticated;

REVOKE ALL ON FUNCTION local_service.create_ticket(uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,uuid) FROM PUBLIC, anon, authenticated, service_role, bk01_runtime, bk01_migrator;
CREATE OR REPLACE FUNCTION local_service.create_ticket(p_shop_id uuid, p_booking_id uuid, p_service_id uuid, p_title text, p_type text, p_priority text, p_customer_name text, p_customer_phone text, p_normalized_phone text, p_contact_channel text, p_description text, p_issue_category text, p_related_product_service text, p_occurred_at timestamp with time zone, p_received_at timestamp with time zone, p_due_at timestamp with time zone, p_idempotency_key uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'local_service'
AS $function$
DECLARE
    v_ticket_id UUID;
    v_norm_phone TEXT;
BEGIN
    IF NOT local_service.has_shop_role(p_shop_id, ARRAY['owner', 'admin']::TEXT[]) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Owner or admin role required';
    END IF;

    IF p_idempotency_key IS NULL THEN
        RAISE EXCEPTION 'Idempotency key is required' USING ERRCODE = '22023';
    END IF;

    IF NULLIF(BTRIM(p_title), '') IS NULL THEN
        RAISE EXCEPTION 'Ticket title is required' USING ERRCODE = '22023';
    END IF;

    IF NULLIF(BTRIM(p_description), '') IS NULL THEN
        RAISE EXCEPTION 'Ticket description is required' USING ERRCODE = '22023';
    END IF;

    IF NULLIF(BTRIM(p_customer_name), '') IS NULL THEN
        RAISE EXCEPTION 'Customer name is required' USING ERRCODE = '22023';
    END IF;

    IF NULLIF(BTRIM(p_customer_phone), '') IS NULL THEN
        RAISE EXCEPTION 'Customer phone is required' USING ERRCODE = '22023';
    END IF;

    IF p_type IS NULL OR p_type NOT IN ('ProductClaim', 'ServiceIssue', 'RecheckRequest', 'RefundRequest', 'Other') THEN
        RAISE EXCEPTION 'Invalid ticket type' USING ERRCODE = '22023';
    END IF;

    IF p_priority IS NULL OR p_priority NOT IN ('Low', 'Medium', 'High') THEN
        RAISE EXCEPTION 'Invalid ticket priority' USING ERRCODE = '22023';
    END IF;

    IF p_received_at IS NULL THEN
        RAISE EXCEPTION 'received_at is required' USING ERRCODE = '22023';
    END IF;

    IF p_due_at IS NULL THEN
        RAISE EXCEPTION 'due_at is required' USING ERRCODE = '22023';
    END IF;

    IF p_due_at < p_received_at THEN
        RAISE EXCEPTION 'due_at must be greater than or equal to received_at' USING ERRCODE = '22023';
    END IF;

    -- Idempotency check: return existing ticket if already created with this idempotency key
    SELECT id
      INTO v_ticket_id
      FROM local_service.tickets
     WHERE shop_id = p_shop_id
       AND creation_idempotency_key = p_idempotency_key;

    IF v_ticket_id IS NOT NULL THEN
        RETURN v_ticket_id;
    END IF;

    v_norm_phone := COALESCE(
        NULLIF(BTRIM(p_normalized_phone), ''),
        regexp_replace(p_customer_phone, '\D', '', 'g')
    );

    INSERT INTO local_service.tickets (
        shop_id,
        booking_id,
        service_id,
        title,
        type,
        status,
        priority,
        customer_name,
        customer_phone,
        normalized_phone,
        contact_channel,
        description,
        issue_category,
        related_product_service,
        occurred_at,
        received_at,
        due_at,
        creation_idempotency_key
    ) VALUES (
        p_shop_id,
        p_booking_id,
        p_service_id,
        BTRIM(p_title),
        p_type,
        'New',
        p_priority,
        BTRIM(p_customer_name),
        BTRIM(p_customer_phone),
        v_norm_phone,
        NULLIF(BTRIM(p_contact_channel), ''),
        BTRIM(p_description),
        COALESCE(BTRIM(p_issue_category), ''),
        COALESCE(BTRIM(p_related_product_service), ''),
        p_occurred_at,
        p_received_at,
        p_due_at,
        p_idempotency_key
    )
    RETURNING id INTO v_ticket_id;

    INSERT INTO local_service.ticket_timeline_entries (
        ticket_id,
        shop_id,
        event_type,
        message,
        actor
    ) VALUES (
        v_ticket_id,
        p_shop_id,
        'Created',
        'Ticket created',
        'Staff'
    );

    RETURN v_ticket_id;
END;
$function$;
GRANT EXECUTE ON FUNCTION local_service.create_ticket(uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,uuid) TO bk01_migrator;
GRANT EXECUTE ON FUNCTION local_service.create_ticket(uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,uuid) TO authenticated;

REVOKE ALL ON FUNCTION local_service.current_staff_id(uuid) FROM PUBLIC, anon, authenticated, service_role, bk01_runtime, bk01_migrator;
CREATE OR REPLACE FUNCTION local_service.current_staff_id(p_shop_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'local_service'
AS $function$

    SELECT s.id
    FROM local_service.staff s
    JOIN local_service.shop_users su
      ON su.shop_id = s.shop_id
     AND su.user_id = s.user_id
     AND su.role = 'staff'
    WHERE s.shop_id = p_shop_id
      AND s.user_id = (SELECT local_service_internal.request_user_id())
      AND s.is_active = true
    LIMIT 1
$function$;
GRANT EXECUTE ON FUNCTION local_service.current_staff_id(uuid) TO bk01_migrator;
GRANT EXECUTE ON FUNCTION local_service.current_staff_id(uuid) TO authenticated;

REVOKE ALL ON FUNCTION local_service.customer_cancel_booking(uuid,text,text) FROM PUBLIC, anon, authenticated, service_role, bk01_runtime, bk01_migrator;
CREATE OR REPLACE FUNCTION local_service.customer_cancel_booking(p_booking_id uuid, p_recovery_token text, p_reason text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'local_service'
AS $function$
DECLARE v_booking local_service.bookings%rowtype; v_hours int; v_row record;
BEGIN
    SELECT b, s.customer_cancel_before_hours
      INTO v_row
      FROM local_service.bookings b JOIN local_service.shops s ON s.id = b.shop_id
     WHERE b.id = p_booking_id FOR UPDATE;
    IF NOT FOUND OR NOT local_service.authorize_booking_recovery_attempt(p_booking_id,p_recovery_token) THEN
        RETURN json_build_object('ok',false,'error','Invalid or expired booking recovery token');
    END IF;
    v_booking := v_row.b;
    v_hours := v_row.customer_cancel_before_hours;
    IF v_hours IS NULL THEN RAISE EXCEPTION 'Customer cancellation policy is not configured'; END IF;
    IF v_booking.status NOT IN ('hold','pending_review','confirmed') THEN RAISE EXCEPTION 'Booking is not cancellable'; END IF;
    IF v_booking.start_timestamptz <= now() + make_interval(hours => v_hours) THEN RAISE EXCEPTION 'Cancellation policy window has closed'; END IF;
    IF nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Cancellation reason is required'; END IF;
    UPDATE local_service.bookings SET status='cancelled', notes=concat_ws(E'\n', notes, 'Customer cancellation: ' || btrim(p_reason)), updated_at=now() WHERE id=p_booking_id;
    INSERT INTO local_service.audit_events(shop_id,actor_type,action,target_type,target_id,metadata)
    VALUES(v_booking.shop_id,'customer','booking_cancelled','booking',p_booking_id,jsonb_build_object('reason',btrim(p_reason)));
    RETURN json_build_object('booking_id',p_booking_id,'status','cancelled');
END;
$function$;
GRANT EXECUTE ON FUNCTION local_service.customer_cancel_booking(uuid,text,text) TO bk01_migrator;
GRANT EXECUTE ON FUNCTION local_service.customer_cancel_booking(uuid,text,text) TO anon;

REVOKE ALL ON FUNCTION local_service.customer_reschedule_booking(uuid,text,date,time without time zone,text) FROM PUBLIC, anon, authenticated, service_role, bk01_runtime, bk01_migrator;
CREATE OR REPLACE FUNCTION local_service.customer_reschedule_booking(p_booking_id uuid, p_recovery_token text, p_booking_date date, p_start_time time without time zone, p_reason text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'local_service'
AS $function$
DECLARE v_booking local_service.bookings%rowtype; v_hours int; v_start timestamptz; v_end timestamptz; v_row record;
BEGIN
    SELECT b, s.customer_reschedule_before_hours
      INTO v_row
      FROM local_service.bookings b JOIN local_service.shops s ON s.id=b.shop_id
     WHERE b.id=p_booking_id FOR UPDATE;
    IF NOT FOUND OR NOT local_service.authorize_booking_recovery_attempt(p_booking_id,p_recovery_token) THEN
        RETURN json_build_object('ok',false,'error','Invalid or expired booking recovery token');
    END IF;
    v_booking := v_row.b;
    v_hours := v_row.customer_reschedule_before_hours;
    IF v_hours IS NULL THEN RAISE EXCEPTION 'Customer reschedule policy is not configured'; END IF;
    IF v_booking.status <> 'confirmed' THEN RAISE EXCEPTION 'Only confirmed bookings can be rescheduled'; END IF;
    IF v_booking.start_timestamptz <= now() + make_interval(hours => v_hours) THEN RAISE EXCEPTION 'Reschedule policy window has closed'; END IF;
    IF nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Reschedule reason is required'; END IF;
    v_start := (p_booking_date || ' ' || p_start_time)::timestamp AT TIME ZONE 'Asia/Bangkok';
    v_end := v_start + make_interval(mins => v_booking.service_duration_minutes);
    IF v_start <= now() THEN RAISE EXCEPTION 'New booking time must be in the future'; END IF;
    IF NOT EXISTS (SELECT 1 FROM local_service.staff s WHERE s.id=v_booking.staff_id AND s.shop_id=v_booking.shop_id AND s.is_active=true) THEN RAISE EXCEPTION 'Assigned staff is no longer active'; END IF;
    IF NOT EXISTS (
        SELECT 1 FROM local_service.staff_schedules ss
        WHERE ss.shop_id=v_booking.shop_id AND ss.staff_id=v_booking.staff_id
          AND ss.day_of_week=extract(dow from p_booking_date)::int AND ss.is_working_day
          AND p_start_time >= ss.work_start AND (p_start_time + make_interval(mins=>v_booking.service_duration_minutes)) <= ss.work_end
          AND NOT (ss.break_start IS NOT NULL AND ss.break_end IS NOT NULL
                   AND p_start_time < ss.break_end AND (p_start_time + make_interval(mins=>v_booking.service_duration_minutes)) > ss.break_start)
    ) THEN RAISE EXCEPTION 'Requested time is outside staff availability'; END IF;
    IF EXISTS (
      SELECT 1 FROM local_service.shop_holidays h
      WHERE h.shop_id=v_booking.shop_id AND h.holiday_date=p_booking_date
        AND (h.staff_id IS NULL OR h.staff_id=v_booking.staff_id)
    ) THEN RAISE EXCEPTION 'Requested date is closed'; END IF;
    UPDATE local_service.bookings
       SET booking_date=p_booking_date,start_time=p_start_time,end_time=(p_start_time + make_interval(mins=>service_duration_minutes))::time,
           start_timestamptz=v_start,end_timestamptz=v_end,notes=concat_ws(E'\n',notes,'Customer reschedule: '||btrim(p_reason)),updated_at=now()
     WHERE id=p_booking_id;
    UPDATE local_service.line_notification_logs
       SET status='failed',error_message='Superseded by customer reschedule',next_retry_at=NULL
     WHERE booking_id=p_booking_id AND event_type='reminder_24h' AND status='pending';
    INSERT INTO local_service.line_notification_logs(shop_id,booking_id,event_type,recipient_type,status,idempotency_key,scheduled_for)
    VALUES(v_booking.shop_id,p_booking_id,'reminder_24h','customer','pending','reminder_24h:'||p_booking_id::text||':'||extract(epoch from v_start)::bigint::text,v_start-interval '24 hours')
    ON CONFLICT(idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
    INSERT INTO local_service.audit_events(shop_id,actor_type,action,target_type,target_id,metadata)
    VALUES(v_booking.shop_id,'customer','booking_rescheduled','booking',p_booking_id,jsonb_build_object('reason',btrim(p_reason),'new_start',v_start));
    INSERT INTO local_service.line_notification_logs(shop_id,booking_id,event_type,recipient_type,status,idempotency_key,scheduled_for)
    VALUES(v_booking.shop_id,p_booking_id,'booking_rescheduled','customer','pending','booking_rescheduled:'||p_booking_id::text||':'||extract(epoch from v_start)::bigint::text,now())
    ON CONFLICT(idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
    RETURN json_build_object('booking_id',p_booking_id,'status','confirmed','start_timestamptz',v_start);
END;
$function$;
GRANT EXECUTE ON FUNCTION local_service.customer_reschedule_booking(uuid,text,date,time without time zone,text) TO bk01_migrator;
GRANT EXECUTE ON FUNCTION local_service.customer_reschedule_booking(uuid,text,date,time without time zone,text) TO anon;

REVOKE ALL ON FUNCTION local_service.delete_closed_tickets_before(uuid,date) FROM PUBLIC, anon, authenticated, service_role, bk01_runtime, bk01_migrator;
CREATE OR REPLACE FUNCTION local_service.delete_closed_tickets_before(p_shop_id uuid, p_cutoff_date date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'local_service'
AS $function$
DECLARE
    v_deleted_count INTEGER := 0;
BEGIN
    IF NOT local_service.has_shop_role(p_shop_id, ARRAY['owner', 'admin']::TEXT[]) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Owner or admin role required';
    END IF;

    IF p_cutoff_date IS NULL THEN
        RAISE EXCEPTION 'Cutoff date is required' USING ERRCODE = '22023';
    END IF;

    DELETE FROM local_service.tickets
     WHERE shop_id = p_shop_id
       AND status = 'Closed'
       AND closed_at IS NOT NULL
       AND closed_at < (p_cutoff_date + INTERVAL '1 day');

    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
    RETURN v_deleted_count;
END;
$function$;
GRANT EXECUTE ON FUNCTION local_service.delete_closed_tickets_before(uuid,date) TO bk01_migrator;
GRANT EXECUTE ON FUNCTION local_service.delete_closed_tickets_before(uuid,date) TO authenticated;

REVOKE ALL ON FUNCTION local_service.delete_shop_holiday(uuid) FROM PUBLIC, anon, authenticated, service_role, bk01_runtime, bk01_migrator;
CREATE OR REPLACE FUNCTION local_service.delete_shop_holiday(p_holiday_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'local_service'
AS $function$
DECLARE
    v_shop_id UUID;
    v_staff_id UUID;
BEGIN
    SELECT shop_id, staff_id
      INTO v_shop_id, v_staff_id
      FROM local_service.shop_holidays
     WHERE id = p_holiday_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Shop holiday not found';
    END IF;

    IF v_staff_id IS NOT NULL THEN
        RAISE EXCEPTION 'Only shop-wide holidays can be managed here' USING ERRCODE = '22023';
    END IF;

    IF NOT local_service.has_shop_role(v_shop_id, ARRAY['owner', 'admin']::TEXT[]) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Owner or admin role required';
    END IF;

    DELETE FROM local_service.shop_holidays WHERE id = p_holiday_id;
END;
$function$;
GRANT EXECUTE ON FUNCTION local_service.delete_shop_holiday(uuid) TO bk01_migrator;
GRANT EXECUTE ON FUNCTION local_service.delete_shop_holiday(uuid) TO authenticated;

REVOKE ALL ON FUNCTION local_service.enforce_booking_quota() FROM PUBLIC, anon, authenticated, service_role, bk01_runtime, bk01_migrator;
CREATE OR REPLACE FUNCTION local_service.enforce_booking_quota()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'local_service'
AS $function$
DECLARE
    v_usage local_service.entitlement_usage%ROWTYPE;
    v_plan TEXT := 'free_trial';
    v_limits RECORD;
BEGIN
    -- ทำงานเฉพาะเมื่อสถานะเปลี่ยนเป็น 'confirmed' เท่านั้น
    IF NEW.status = 'confirmed' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'confirmed') THEN
        -- 1. ดึงข้อมูลการใช้งานและล็อกแถว ledger
        v_usage := local_service.ensure_entitlement_row(NEW.shop_id);

        -- 2. ตรวจสอบแผนปัจจุบัน
        SELECT COALESCE(plan, 'free_trial')
          INTO v_plan
          FROM local_service.subscriptions
         WHERE shop_id = NEW.shop_id;

        IF NOT FOUND THEN
            v_plan := 'free_trial';
        END IF;

        -- 3. ดึงขีดจำกัดตาม Tier
        SELECT bookings_limit, staff_limit, auto_slip_limit
          INTO v_limits
          FROM local_service.get_tier_limits(v_plan);

        -- 4. ตัดโควตาตามลำดับ (โควตาหลักก่อน -> แล้วค่อยตัด top-up)
        IF v_usage.bookings_used < v_limits.bookings_limit THEN
            -- หักจากโควตาหลักประจำงวด
            UPDATE local_service.entitlement_usage
               SET bookings_used = bookings_used + 1,
                   updated_at = now()
             WHERE shop_id = NEW.shop_id;
        ELSIF v_usage.bookings_topup_balance > 0 THEN
            -- โควตาหลักเต็มแล้ว หักจากเครดิต Top-up เสริม
            UPDATE local_service.entitlement_usage
               SET bookings_used = bookings_used + 1,
                   bookings_topup_balance = bookings_topup_balance - 1,
                   updated_at = now()
             WHERE shop_id = NEW.shop_id;
        ELSE
            -- โควตาทั้งหมดหมดแล้ว ไม่อนุญาตให้ยืนยันการจอง
            RAISE EXCEPTION USING
                ERRCODE = 'P0001',
                MESSAGE = 'BOOKING_QUOTA_EXCEEDED';
        END IF;
    END IF;

    RETURN NEW;
END;
$function$;
GRANT EXECUTE ON FUNCTION local_service.enforce_booking_quota() TO bk01_migrator;

REVOKE ALL ON FUNCTION local_service.enforce_booking_status_transition() FROM PUBLIC, anon, authenticated, service_role, bk01_runtime, bk01_migrator;
CREATE OR REPLACE FUNCTION local_service.enforce_booking_status_transition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'local_service'
AS $function$

DECLARE
    v_user_id UUID := local_service_internal.request_user_id();
BEGIN
    -- On INSERT: skip transition check, just log history
    IF (TG_OP = 'INSERT') THEN
        INSERT INTO local_service.booking_status_history (
            booking_id, old_status, new_status, old_deposit_status, new_deposit_status, changed_by, reason
        ) VALUES (
            NEW.id, NULL, NEW.status, NULL, NEW.deposit_status, v_user_id, 'Initial Booking Created'
        );
        RETURN NEW;
    END IF;

    -- On UPDATE: validate state transition if status changed
    IF (OLD.status IS DISTINCT FROM NEW.status) THEN
        -- Validation Matrix
        IF (OLD.status = 'hold' AND NEW.status NOT IN ('pending_review', 'confirmed', 'cancelled', 'expired')) THEN
            RAISE EXCEPTION 'Invalid status transition from hold to %', NEW.status;
        ELSIF (OLD.status = 'pending_review' AND NEW.status NOT IN ('confirmed', 'hold', 'cancelled')) THEN
            RAISE EXCEPTION 'Invalid status transition from pending_review to %', NEW.status;
        ELSIF (OLD.status = 'confirmed' AND NEW.status NOT IN ('completed', 'cancelled', 'no_show')) THEN
            RAISE EXCEPTION 'Invalid status transition from confirmed to %', NEW.status;
        ELSIF (OLD.status IN ('completed', 'cancelled', 'no_show', 'expired')) THEN
            RAISE EXCEPTION 'Terminal state % cannot be transitioned to %', OLD.status, NEW.status;
        END IF;

        -- Record Audit History
        INSERT INTO local_service.booking_status_history (
            booking_id, old_status, new_status, old_deposit_status, new_deposit_status, changed_by, reason
        ) VALUES (
            NEW.id, OLD.status, NEW.status, OLD.deposit_status, NEW.deposit_status, v_user_id, 'Status Update'
        );
    ELSIF (OLD.deposit_status IS DISTINCT FROM NEW.deposit_status) THEN
        -- Record Deposit Status Audit History
        INSERT INTO local_service.booking_status_history (
            booking_id, old_status, new_status, old_deposit_status, new_deposit_status, changed_by, reason
        ) VALUES (
            NEW.id, OLD.status, NEW.status, OLD.deposit_status, NEW.deposit_status, v_user_id, 'Deposit Status Update'
        );
    END IF;

    RETURN NEW;
END;
$function$;
GRANT EXECUTE ON FUNCTION local_service.enforce_booking_status_transition() TO PUBLIC;
GRANT EXECUTE ON FUNCTION local_service.enforce_booking_status_transition() TO bk01_migrator;
GRANT EXECUTE ON FUNCTION local_service.enforce_booking_status_transition() TO anon;
GRANT EXECUTE ON FUNCTION local_service.enforce_booking_status_transition() TO authenticated;
GRANT EXECUTE ON FUNCTION local_service.enforce_booking_status_transition() TO service_role;

REVOKE ALL ON FUNCTION local_service.enforce_shop_booking_acceptance() FROM PUBLIC, anon, authenticated, service_role, bk01_runtime, bk01_migrator;
CREATE OR REPLACE FUNCTION local_service.enforce_shop_booking_acceptance()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'local_service'
AS $function$
DECLARE
    v_subscription_status TEXT;
    v_trial_period_end TIMESTAMPTZ;
BEGIN
    SELECT
        sub.status,
        COALESCE(sub.current_period_end, s.trial_ends_at)
    INTO v_subscription_status, v_trial_period_end
    FROM local_service.shops AS s
    LEFT JOIN local_service.subscriptions AS sub
        ON sub.shop_id = s.id
    WHERE s.id = NEW.shop_id
      AND s.is_active = true;

    IF NOT FOUND
       OR v_subscription_status IS NULL
       OR v_subscription_status IN ('canceled', 'incomplete', 'incomplete_expired', 'unpaid')
       OR (
            v_subscription_status = 'trialing'
            AND (
                v_trial_period_end IS NULL
                OR v_trial_period_end <= NOW()
            )
       ) THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P0001',
            MESSAGE = 'SHOP_NOT_ACCEPTING_ONLINE_BOOKINGS';
    END IF;

    RETURN NEW;
END;
$function$;
GRANT EXECUTE ON FUNCTION local_service.enforce_shop_booking_acceptance() TO bk01_migrator;

REVOKE ALL ON FUNCTION local_service.enforce_ticket_owner_admin() FROM PUBLIC, anon, authenticated, service_role, bk01_runtime, bk01_migrator;
CREATE OR REPLACE FUNCTION local_service.enforce_ticket_owner_admin()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'local_service'
AS $function$
DECLARE v_shop_id uuid := COALESCE(NEW.shop_id,OLD.shop_id);
BEGIN
    IF NOT local_service.has_shop_role(v_shop_id,ARRAY['owner','admin']::text[]) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Owner or admin role required for ticket operations'; END IF;
    RETURN COALESCE(NEW,OLD);
END; $function$;
GRANT EXECUTE ON FUNCTION local_service.enforce_ticket_owner_admin() TO PUBLIC;

REVOKE ALL ON FUNCTION local_service.enqueue_booking_notifications() FROM PUBLIC, anon, authenticated, service_role, bk01_runtime, bk01_migrator;
CREATE OR REPLACE FUNCTION local_service.enqueue_booking_notifications()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'local_service'
AS $function$
BEGIN
    IF NEW.status = 'confirmed' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'confirmed') THEN
        INSERT INTO local_service.line_notification_logs(
            shop_id, booking_id, event_type, recipient_type, status,
            idempotency_key, scheduled_for
        ) VALUES
            (NEW.shop_id, NEW.id, 'booking_created', 'customer', 'pending',
             'confirmation:' || NEW.id::text, now()),
            (NEW.shop_id, NEW.id, 'reminder_24h', 'customer', 'pending',
             'reminder_24h:' || NEW.id::text, NEW.start_timestamptz - interval '24 hours')
        ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
    END IF;

    IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
        UPDATE local_service.line_notification_logs
        SET status = 'failed', error_message = 'Booking cancelled before delivery'
        WHERE booking_id = NEW.id AND status = 'pending' AND event_type LIKE 'reminder_%';
        INSERT INTO local_service.line_notification_logs(shop_id,booking_id,event_type,recipient_type,status,idempotency_key,scheduled_for)
        VALUES(NEW.shop_id,NEW.id,'booking_cancelled','customer','pending','booking_cancelled:'||NEW.id::text,now())
        ON CONFLICT(idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
    END IF;
    RETURN NEW;
END;
$function$;
GRANT EXECUTE ON FUNCTION local_service.enqueue_booking_notifications() TO PUBLIC;

REVOKE ALL ON FUNCTION local_service.ensure_entitlement_row(uuid) FROM PUBLIC, anon, authenticated, service_role, bk01_runtime, bk01_migrator;
CREATE OR REPLACE FUNCTION local_service.ensure_entitlement_row(p_shop_id uuid)
 RETURNS local_service.entitlement_usage
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'local_service'
AS $function$
DECLARE
    v_plan TEXT := 'free_trial';
    v_sub_period_end TIMESTAMPTZ;
    v_usage local_service.entitlement_usage%ROWTYPE;
BEGIN
    -- 1. ตรวจสอบข้อมูล subscription และ current_period_end ของร้าน
    SELECT COALESCE(s.plan, 'free_trial'), s.current_period_end
      INTO v_plan, v_sub_period_end
      FROM local_service.subscriptions s
     WHERE s.shop_id = p_shop_id;

    IF NOT FOUND THEN
        v_plan := 'free_trial';
        v_sub_period_end := NULL;
    END IF;

    -- 2. ดึงหรือสร้างแถว entitlement_usage พร้อมล็อก FOR UPDATE
    SELECT *
      INTO v_usage
      FROM local_service.entitlement_usage
     WHERE shop_id = p_shop_id
       FOR UPDATE;

    IF NOT FOUND THEN
        INSERT INTO local_service.entitlement_usage (
            shop_id,
            bookings_used,
            bookings_topup_balance,
            auto_slip_used,
            auto_slip_topup_balance,
            period_end,
            updated_at
        ) VALUES (
            p_shop_id,
            0,
            0,
            0,
            0,
            v_sub_period_end,
            now()
        )
        ON CONFLICT (shop_id) DO NOTHING;

        SELECT *
          INTO v_usage
          FROM local_service.entitlement_usage
         WHERE shop_id = p_shop_id
           FOR UPDATE;
    END IF;

    -- 3. ตรวจสอบการรีเซ็ตโควตารายเดือนสำหรับแพ็กเกจแบบชำระเงิน (basic_490, pro_990)
    -- สำหรับ free_trial จะไม่มีการรีเซ็ตรายเดือน (จำกัด 50 คิวตลอดอายุทดลองใช้)
    IF v_plan IN ('basic_490', 'pro_990') THEN
        IF (v_usage.period_end IS NOT NULL AND now() > v_usage.period_end)
           OR (v_usage.period_end IS NOT NULL AND v_sub_period_end IS NOT NULL AND v_sub_period_end > v_usage.period_end)
           OR (v_usage.period_end IS NULL AND v_sub_period_end IS NOT NULL) THEN
            UPDATE local_service.entitlement_usage
               SET bookings_used = CASE 
                       WHEN (v_usage.period_end IS NOT NULL AND now() > v_usage.period_end)
                            OR (v_usage.period_end IS NOT NULL AND v_sub_period_end IS NOT NULL AND v_sub_period_end > v_usage.period_end)
                       THEN 0 
                       ELSE bookings_used 
                   END,
                   auto_slip_used = CASE 
                       WHEN (v_usage.period_end IS NOT NULL AND now() > v_usage.period_end)
                            OR (v_usage.period_end IS NOT NULL AND v_sub_period_end IS NOT NULL AND v_sub_period_end > v_usage.period_end)
                       THEN 0 
                       ELSE auto_slip_used 
                   END,
                   period_end = v_sub_period_end,
                   updated_at = now()
             WHERE shop_id = p_shop_id
            RETURNING * INTO v_usage;
        END IF;
    END IF;

    RETURN v_usage;
END;
$function$;
GRANT EXECUTE ON FUNCTION local_service.ensure_entitlement_row(uuid) TO bk01_migrator;
GRANT EXECUTE ON FUNCTION local_service.ensure_entitlement_row(uuid) TO authenticated;

REVOKE ALL ON FUNCTION local_service.export_core_business_data(uuid) FROM PUBLIC, anon, authenticated, service_role, bk01_runtime, bk01_migrator;
CREATE OR REPLACE FUNCTION local_service.export_core_business_data(p_shop_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'local_service'
AS $function$

DECLARE v_result jsonb;
BEGIN
    IF NOT local_service.has_shop_role(p_shop_id,ARRAY['owner']::text[]) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Owner role required'; END IF;
    SELECT jsonb_build_object(
      'shop',(SELECT to_jsonb(s)-'subscription_status'-'trial_ends_at' FROM local_service.shops s WHERE s.id=p_shop_id),
      'services',COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT id,name,description,duration_minutes,price,deposit_amount,is_active,created_at FROM local_service.services WHERE shop_id=p_shop_id ORDER BY created_at) x),'[]'::jsonb),
      'staff',COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT id,name,nickname,phone,is_active,created_at FROM local_service.staff WHERE shop_id=p_shop_id ORDER BY created_at) x),'[]'::jsonb),
      'customers',COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT id,name,phone,email,created_at FROM local_service.customers WHERE shop_id=p_shop_id ORDER BY created_at) x),'[]'::jsonb),
      'bookings',COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT id,booking_code,customer_id,staff_id,service_id,booking_date,start_time,end_time,status,deposit_status,deposit_amount,total_price,created_at FROM local_service.bookings WHERE shop_id=p_shop_id ORDER BY created_at) x),'[]'::jsonb)
    ) INTO v_result;
    INSERT INTO local_service.audit_events(shop_id,actor_user_id,actor_type,action,target_type,target_id) VALUES(p_shop_id,local_service_internal.request_user_id(),'merchant','core_data_exported','shop',p_shop_id);
    RETURN v_result;
END;
$function$;
GRANT EXECUTE ON FUNCTION local_service.export_core_business_data(uuid) TO bk01_migrator;
GRANT EXECUTE ON FUNCTION local_service.export_core_business_data(uuid) TO authenticated;

REVOKE ALL ON FUNCTION local_service.extend_booking_hold(uuid) FROM PUBLIC, anon, authenticated, service_role, bk01_runtime, bk01_migrator;
CREATE OR REPLACE FUNCTION local_service.extend_booking_hold(p_booking_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'local_service'
AS $function$

DECLARE
    v_booking local_service.bookings%ROWTYPE;
BEGIN
    SELECT * INTO v_booking
    FROM local_service.bookings
    WHERE id = p_booking_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Booking not found';
    END IF;
    IF local_service_internal.request_user_id() IS NULL OR NOT local_service.is_shop_member(v_booking.shop_id) THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Not authorized for this shop';
    END IF;
    IF v_booking.status <> 'hold' THEN
        RAISE EXCEPTION 'Only hold bookings can be extended';
    END IF;
    IF v_booking.expires_at IS NULL OR v_booking.expires_at <= NOW() THEN
        RAISE EXCEPTION 'Booking hold has expired';
    END IF;
    IF v_booking.hold_extended THEN
        RETURN json_build_object(
            'success', false,
            'message', 'Hold already extended once',
            'expires_at', v_booking.expires_at
        );
    END IF;

    UPDATE local_service.bookings
    SET expires_at = expires_at + INTERVAL '5 minutes',
        hold_extended = true,
        updated_at = NOW()
    WHERE id = p_booking_id
    RETURNING * INTO v_booking;

    RETURN json_build_object(
        'success', true,
        'message', 'Hold extended by 5 minutes',
        'expires_at', v_booking.expires_at
    );
END;
$function$;
GRANT EXECUTE ON FUNCTION local_service.extend_booking_hold(uuid) TO bk01_migrator;
GRANT EXECUTE ON FUNCTION local_service.extend_booking_hold(uuid) TO authenticated;

REVOKE ALL ON FUNCTION local_service.generate_booking_code() FROM PUBLIC, anon, authenticated, service_role, bk01_runtime, bk01_migrator;
CREATE OR REPLACE FUNCTION local_service.generate_booking_code()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'local_service'
AS $function$
DECLARE
    v_chars TEXT := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; -- Exclude 0, O, 1, I, L, Q
    v_code TEXT;
    v_exists BOOLEAN;
    v_i INT;
BEGIN
    LOOP
        v_code := 'BK-';
        FOR v_i IN 1..6 LOOP
            v_code := v_code || substr(v_chars, floor(random() * length(v_chars) + 1)::int, 1);
        END LOOP;
        
        SELECT EXISTS (
            SELECT 1 FROM local_service.bookings WHERE booking_code = v_code
        ) INTO v_exists;
        
        EXIT WHEN NOT v_exists;
    END LOOP;
    
    RETURN v_code;
END;
$function$;
GRANT EXECUTE ON FUNCTION local_service.generate_booking_code() TO PUBLIC;
GRANT EXECUTE ON FUNCTION local_service.generate_booking_code() TO bk01_migrator;
GRANT EXECUTE ON FUNCTION local_service.generate_booking_code() TO anon;
GRANT EXECUTE ON FUNCTION local_service.generate_booking_code() TO authenticated;
GRANT EXECUTE ON FUNCTION local_service.generate_booking_code() TO service_role;

REVOKE ALL ON FUNCTION local_service.generate_link_token() FROM PUBLIC, anon, authenticated, service_role, bk01_runtime, bk01_migrator;
CREATE OR REPLACE FUNCTION local_service.generate_link_token()
 RETURNS text
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
    SELECT upper(substr(encode(extensions.gen_random_bytes(8), 'hex'), 1, 10))
$function$;
GRANT EXECUTE ON FUNCTION local_service.generate_link_token() TO PUBLIC;
GRANT EXECUTE ON FUNCTION local_service.generate_link_token() TO bk01_migrator;
GRANT EXECUTE ON FUNCTION local_service.generate_link_token() TO anon;
GRANT EXECUTE ON FUNCTION local_service.generate_link_token() TO authenticated;
GRANT EXECUTE ON FUNCTION local_service.generate_link_token() TO service_role;

REVOKE ALL ON FUNCTION local_service.get_entitlement_usage(uuid) FROM PUBLIC, anon, authenticated, service_role, bk01_runtime, bk01_migrator;
CREATE OR REPLACE FUNCTION local_service.get_entitlement_usage(p_shop_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'local_service'
AS $function$

DECLARE
    v_usage local_service.entitlement_usage%ROWTYPE;
    v_plan TEXT;
    v_limits RECORD;
    v_remaining_main INT;
BEGIN
    IF local_service_internal.request_user_id() IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Authentication required';
    END IF;

    IF NOT (local_service.is_shop_owner(p_shop_id) OR local_service.is_platform_admin()) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Owner or platform admin role required';
    END IF;

    -- สร้างหรืออัปเดตสถานะรอบบิลของแถวการใช้งาน
    v_usage := local_service.ensure_entitlement_row(p_shop_id);

    SELECT COALESCE(plan, 'free_trial')
      INTO v_plan
      FROM local_service.subscriptions
     WHERE shop_id = p_shop_id;

    IF NOT FOUND THEN
        v_plan := 'free_trial';
    END IF;

    SELECT bookings_limit, staff_limit, auto_slip_limit
      INTO v_limits
      FROM local_service.get_tier_limits(v_plan);

    v_remaining_main := GREATEST(0, v_limits.bookings_limit - v_usage.bookings_used);

    RETURN json_build_object(
        'shop_id', p_shop_id,
        'plan', v_plan,
        'bookings_limit', v_limits.bookings_limit,
        'bookings_used', v_usage.bookings_used,
        'bookings_remaining_main', v_remaining_main,
        'bookings_topup_balance', v_usage.bookings_topup_balance,
        'staff_limit', v_limits.staff_limit,
        'auto_slip_limit', v_limits.auto_slip_limit,
        'auto_slip_used', v_usage.auto_slip_used,
        'auto_slip_topup_balance', v_usage.auto_slip_topup_balance,
        'period_end', v_usage.period_end,
        'updated_at', v_usage.updated_at
    );
END;
$function$;
GRANT EXECUTE ON FUNCTION local_service.get_entitlement_usage(uuid) TO bk01_migrator;
GRANT EXECUTE ON FUNCTION local_service.get_entitlement_usage(uuid) TO authenticated;

REVOKE ALL ON FUNCTION local_service.get_tier_limits(text) FROM PUBLIC, anon, authenticated, service_role, bk01_runtime, bk01_migrator;
CREATE OR REPLACE FUNCTION local_service.get_tier_limits(p_plan text)
 RETURNS TABLE(bookings_limit integer, staff_limit integer, auto_slip_limit integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'local_service'
AS $function$
    SELECT
        CASE WHEN p_plan = 'free_trial' OR p_plan IS NULL THEN 50 ELSE 2147483647 END,
        CASE WHEN p_plan = 'pro_990' THEN 10 ELSE 5 END,
        CASE WHEN p_plan = 'basic_490' THEN 0 WHEN p_plan = 'pro_990' THEN 0 ELSE 0 END
$function$;
GRANT EXECUTE ON FUNCTION local_service.get_tier_limits(text) TO bk01_migrator;
GRANT EXECUTE ON FUNCTION local_service.get_tier_limits(text) TO authenticated;

REVOKE ALL ON FUNCTION local_service.has_shop_role(uuid,text[]) FROM PUBLIC, anon, authenticated, service_role, bk01_runtime, bk01_migrator;
CREATE OR REPLACE FUNCTION local_service.has_shop_role(target_shop_id uuid, allowed_roles text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'local_service'
AS $function$

    SELECT local_service_internal.request_user_id() IS NOT NULL
       AND EXISTS (
            SELECT 1
              FROM local_service.shop_users
             WHERE shop_id = target_shop_id
               AND user_id = local_service_internal.request_user_id()
               AND role = ANY(allowed_roles)
       );
$function$;
GRANT EXECUTE ON FUNCTION local_service.has_shop_role(uuid,text[]) TO bk01_migrator;
GRANT EXECUTE ON FUNCTION local_service.has_shop_role(uuid,text[]) TO authenticated;

REVOKE ALL ON FUNCTION local_service.initialize_shop_subscription() FROM PUBLIC, anon, authenticated, service_role, bk01_runtime, bk01_migrator;
CREATE OR REPLACE FUNCTION local_service.initialize_shop_subscription()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'local_service'
AS $function$
BEGIN
    INSERT INTO local_service.subscriptions (
        shop_id,
        plan,
        status,
        current_period_end,
        cancel_at_period_end
    ) VALUES (
        NEW.id,
        CASE
            WHEN NEW.subscription_status = 'trial' THEN 'free_trial'
            WHEN NEW.requested_plan IN ('basic_490', 'pro_990') THEN NEW.requested_plan
            ELSE 'free_trial'
        END,
        CASE NEW.subscription_status
            WHEN 'active' THEN 'active'
            WHEN 'past_due' THEN 'past_due'
            WHEN 'canceled' THEN 'canceled'
            WHEN 'unpaid' THEN 'unpaid'
            WHEN 'inactive' THEN 'incomplete'
            ELSE 'trialing'
        END,
        CASE
            WHEN NEW.subscription_status = 'trial' THEN NEW.trial_ends_at
            ELSE NULL
        END,
        false
    )
    ON CONFLICT (shop_id) DO NOTHING;

    RETURN NEW;
END;
$function$;
GRANT EXECUTE ON FUNCTION local_service.initialize_shop_subscription() TO bk01_migrator;

REVOKE ALL ON FUNCTION local_service.is_platform_admin() FROM PUBLIC, anon, authenticated, service_role, bk01_runtime, bk01_migrator;
CREATE OR REPLACE FUNCTION local_service.is_platform_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'local_service'
AS $function$

    SELECT local_service_internal.request_user_id() IS NOT NULL
       AND EXISTS (
            SELECT 1 FROM local_service.platform_admins WHERE user_id = local_service_internal.request_user_id()
       );
$function$;
GRANT EXECUTE ON FUNCTION local_service.is_platform_admin() TO bk01_migrator;
GRANT EXECUTE ON FUNCTION local_service.is_platform_admin() TO authenticated;

REVOKE ALL ON FUNCTION local_service.is_shop_member(uuid) FROM PUBLIC, anon, authenticated, service_role, bk01_runtime, bk01_migrator;
CREATE OR REPLACE FUNCTION local_service.is_shop_member(target_shop_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'local_service'
AS $function$

BEGIN
    RETURN EXISTS (
        SELECT 1 FROM local_service.shop_users
        WHERE shop_id = target_shop_id AND user_id = local_service_internal.request_user_id()
    );
END;
$function$;
GRANT EXECUTE ON FUNCTION local_service.is_shop_member(uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION local_service.is_shop_member(uuid) TO bk01_migrator;
GRANT EXECUTE ON FUNCTION local_service.is_shop_member(uuid) TO anon;
GRANT EXECUTE ON FUNCTION local_service.is_shop_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION local_service.is_shop_member(uuid) TO service_role;

REVOKE ALL ON FUNCTION local_service.is_shop_owner(uuid) FROM PUBLIC, anon, authenticated, service_role, bk01_runtime, bk01_migrator;
CREATE OR REPLACE FUNCTION local_service.is_shop_owner(target_shop_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'local_service'
AS $function$
    SELECT local_service.has_shop_role(target_shop_id, ARRAY['owner']::TEXT[]);
$function$;
GRANT EXECUTE ON FUNCTION local_service.is_shop_owner(uuid) TO bk01_migrator;
GRANT EXECUTE ON FUNCTION local_service.is_shop_owner(uuid) TO authenticated;

REVOKE ALL ON FUNCTION local_service.link_staff_user(uuid,text) FROM PUBLIC, anon, authenticated, service_role, bk01_runtime, bk01_migrator;
CREATE OR REPLACE FUNCTION local_service.link_staff_user(p_staff_id uuid, p_user_email text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'local_service', 'auth'
AS $function$
DECLARE v_staff local_service.staff%rowtype; v_user_id uuid;
BEGIN
  SELECT * INTO v_staff FROM local_service.staff WHERE id=p_staff_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Staff not found'; END IF;
  IF NOT local_service.has_shop_role(v_staff.shop_id,ARRAY['owner']::text[]) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Owner role required'; END IF;
  SELECT id INTO v_user_id FROM auth.users WHERE lower(email)=lower(trim(p_user_email)) LIMIT 1;
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'No registered user matches that email'; END IF;
  IF NOT EXISTS(SELECT 1 FROM local_service.shop_users WHERE shop_id=v_staff.shop_id AND user_id=v_user_id AND role='staff') THEN RAISE EXCEPTION 'The user must first be a staff member of this shop'; END IF;
  UPDATE local_service.staff SET user_id=v_user_id WHERE id=p_staff_id;
END; $function$;
GRANT EXECUTE ON FUNCTION local_service.link_staff_user(uuid,text) TO postgres;
GRANT EXECUTE ON FUNCTION local_service.link_staff_user(uuid,text) TO authenticated;

REVOKE ALL ON FUNCTION local_service.platform_admin_add_topup(uuid,integer,integer) FROM PUBLIC, anon, authenticated, service_role, bk01_runtime, bk01_migrator;
CREATE OR REPLACE FUNCTION local_service.platform_admin_add_topup(p_shop_id uuid, p_bookings_credits integer DEFAULT 0, p_auto_slip_credits integer DEFAULT 0)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'local_service'
AS $function$
BEGIN
    IF NOT local_service.is_platform_admin() THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Platform admin role required';
    END IF;

    RETURN local_service.apply_topup(p_shop_id, p_bookings_credits, p_auto_slip_credits);
END;
$function$;
GRANT EXECUTE ON FUNCTION local_service.platform_admin_add_topup(uuid,integer,integer) TO bk01_migrator;
GRANT EXECUTE ON FUNCTION local_service.platform_admin_add_topup(uuid,integer,integer) TO authenticated;

REVOKE ALL ON FUNCTION local_service.platform_admin_extend_trial(uuid,integer) FROM PUBLIC, anon, authenticated, service_role, bk01_runtime, bk01_migrator;
CREATE OR REPLACE FUNCTION local_service.platform_admin_extend_trial(p_shop_id uuid, p_days integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'local_service'
AS $function$
BEGIN
    IF NOT local_service.is_platform_admin() THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Not authorized';
    END IF;
    IF p_days IS NULL OR p_days = 0 THEN
        RETURN;
    END IF;

    UPDATE local_service.subscriptions
    SET current_period_end = COALESCE(
            current_period_end,
            (SELECT trial_ends_at FROM local_service.shops WHERE id = p_shop_id)
        ) + (p_days || ' days')::interval,
        updated_at = now()
    WHERE shop_id = p_shop_id
      AND status = 'trialing';

    UPDATE local_service.shops
    SET trial_ends_at = trial_ends_at + (p_days || ' days')::interval,
        updated_at = now()
    WHERE id = p_shop_id;
END;
$function$;
GRANT EXECUTE ON FUNCTION local_service.platform_admin_extend_trial(uuid,integer) TO bk01_migrator;
GRANT EXECUTE ON FUNCTION local_service.platform_admin_extend_trial(uuid,integer) TO authenticated;

REVOKE ALL ON FUNCTION local_service.platform_admin_list_shops() FROM PUBLIC, anon, authenticated, service_role, bk01_runtime, bk01_migrator;
CREATE OR REPLACE FUNCTION local_service.platform_admin_list_shops()
 RETURNS SETOF local_service.platform_admin_shop_row
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'local_service'
AS $function$
BEGIN
    IF NOT local_service.is_platform_admin() THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Not authorized';
    END IF;

    RETURN QUERY
    SELECT
        s.id,
        s.name,
        s.slug,
        s.business_category,
        s.owner_name,
        s.phone,
        s.promptpay_number,
        s.requested_plan,
        s.is_active,
        s.created_at,
        sub.plan,
        sub.status,
        sub.current_period_end,
        sub.cancel_at_period_end
    FROM local_service.shops AS s
    LEFT JOIN local_service.subscriptions AS sub ON sub.shop_id = s.id
    ORDER BY s.created_at DESC;
END;
$function$;
GRANT EXECUTE ON FUNCTION local_service.platform_admin_list_shops() TO bk01_migrator;
GRANT EXECUTE ON FUNCTION local_service.platform_admin_list_shops() TO authenticated;

REVOKE ALL ON FUNCTION local_service.platform_admin_set_shop_active(uuid,boolean) FROM PUBLIC, anon, authenticated, service_role, bk01_runtime, bk01_migrator;
CREATE OR REPLACE FUNCTION local_service.platform_admin_set_shop_active(p_shop_id uuid, p_is_active boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'local_service'
AS $function$
BEGIN
    IF NOT local_service.is_platform_admin() THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Not authorized';
    END IF;

    UPDATE local_service.shops
    SET is_active = p_is_active,
        updated_at = now()
    WHERE id = p_shop_id;
END;
$function$;
GRANT EXECUTE ON FUNCTION local_service.platform_admin_set_shop_active(uuid,boolean) TO bk01_migrator;
GRANT EXECUTE ON FUNCTION local_service.platform_admin_set_shop_active(uuid,boolean) TO authenticated;

REVOKE ALL ON FUNCTION local_service.platform_admin_update_plan(uuid,text) FROM PUBLIC, anon, authenticated, service_role, bk01_runtime, bk01_migrator;
CREATE OR REPLACE FUNCTION local_service.platform_admin_update_plan(p_shop_id uuid, p_plan text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'local_service'
AS $function$
BEGIN
    IF NOT local_service.is_platform_admin() THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Not authorized';
    END IF;
    IF p_plan NOT IN ('free_trial', 'basic_490', 'pro_990') THEN
        RAISE EXCEPTION 'Invalid plan' USING ERRCODE = '22023';
    END IF;

    UPDATE local_service.subscriptions
    SET plan = p_plan,
        updated_at = now()
    WHERE shop_id = p_shop_id;

    UPDATE local_service.shops
    SET requested_plan = p_plan,
        updated_at = now()
    WHERE id = p_shop_id;
END;
$function$;
GRANT EXECUTE ON FUNCTION local_service.platform_admin_update_plan(uuid,text) TO bk01_migrator;
GRANT EXECUTE ON FUNCTION local_service.platform_admin_update_plan(uuid,text) TO authenticated;

REVOKE ALL ON FUNCTION local_service.preview_ticket_retention(uuid,date) FROM PUBLIC, anon, authenticated, service_role, bk01_runtime, bk01_migrator;
CREATE OR REPLACE FUNCTION local_service.preview_ticket_retention(p_shop_id uuid, p_cutoff_date date)
 RETURNS TABLE(id uuid, closed_at timestamp with time zone, customer_name text, title text, attachment_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'local_service'
AS $function$
BEGIN
    IF NOT local_service.has_shop_role(p_shop_id, ARRAY['owner', 'admin']::TEXT[]) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Owner or admin role required';
    END IF;

    IF p_cutoff_date IS NULL THEN
        RAISE EXCEPTION 'Cutoff date is required' USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    SELECT
        t.id,
        t.closed_at,
        t.customer_name::TEXT,
        t.title::TEXT,
        COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(t.attachments) = 'array' THEN t.attachments ELSE '[]'::jsonb END), 0)::INT AS attachment_count
    FROM local_service.tickets t
    WHERE t.shop_id = p_shop_id
      AND t.status = 'Closed'
      AND t.closed_at IS NOT NULL
      AND t.closed_at < (p_cutoff_date + INTERVAL '1 day')
    ORDER BY t.closed_at ASC;
END;
$function$;
GRANT EXECUTE ON FUNCTION local_service.preview_ticket_retention(uuid,date) TO bk01_migrator;
GRANT EXECUTE ON FUNCTION local_service.preview_ticket_retention(uuid,date) TO authenticated;

REVOKE ALL ON FUNCTION local_service.provision_owner_shop(text,text,text,text,text,text,text,text,uuid) FROM PUBLIC, anon, authenticated, service_role, bk01_runtime, bk01_migrator;
CREATE OR REPLACE FUNCTION local_service.provision_owner_shop(p_shop_name text, p_shop_slug text, p_business_category text, p_owner_name text, p_owner_phone text, p_promptpay_number text, p_promptpay_name text, p_requested_plan text, p_idempotency_key uuid)
 RETURNS TABLE(shop_id uuid, shop_slug text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'local_service'
AS $function$

DECLARE
    v_user_id UUID := local_service_internal.request_user_id();
    v_shop_id UUID;
    v_shop_slug TEXT;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;

    IF p_idempotency_key IS NULL THEN
        RAISE EXCEPTION 'Idempotency key is required' USING ERRCODE = '22023';
    END IF;

    IF NULLIF(BTRIM(p_shop_name), '') IS NULL
       OR NULLIF(BTRIM(p_shop_slug), '') IS NULL
       OR NULLIF(BTRIM(p_business_category), '') IS NULL
       OR NULLIF(BTRIM(p_owner_name), '') IS NULL
       OR NULLIF(BTRIM(p_owner_phone), '') IS NULL
       OR NULLIF(BTRIM(p_promptpay_number), '') IS NULL
       OR NULLIF(BTRIM(p_promptpay_name), '') IS NULL THEN
        RAISE EXCEPTION 'All shop and owner fields are required' USING ERRCODE = '22023';
    END IF;

    IF p_shop_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' THEN
        RAISE EXCEPTION 'Shop slug must contain lowercase letters, numbers, and single hyphens only'
            USING ERRCODE = '22023';
    END IF;

    IF p_requested_plan NOT IN ('free_trial', 'basic_490', 'pro_990') THEN
        RAISE EXCEPTION 'Invalid requested plan' USING ERRCODE = '22023';
    END IF;

    SELECT s.id, s.slug
      INTO v_shop_id, v_shop_slug
      FROM local_service.shops AS s
      JOIN local_service.shop_users AS su ON su.shop_id = s.id
     WHERE su.user_id = v_user_id
       AND s.registration_idempotency_key = p_idempotency_key;

    IF v_shop_id IS NOT NULL THEN
        RETURN QUERY SELECT v_shop_id, v_shop_slug;
        RETURN;
    END IF;

    IF EXISTS (
        SELECT 1
          FROM local_service.shop_users
         WHERE user_id = v_user_id
           AND role = 'owner'
    ) THEN
        RAISE EXCEPTION 'This account already owns a shop' USING ERRCODE = '23505';
    END IF;

    INSERT INTO local_service.shops (
        name,
        slug,
        phone,
        promptpay_number,
        promptpay_name,
        line_oa_id,
        subscription_status,
        trial_ends_at,
        owner_name,
        business_category,
        requested_plan,
        registration_idempotency_key
    ) VALUES (
        BTRIM(p_shop_name),
        BTRIM(p_shop_slug),
        BTRIM(p_owner_phone),
        BTRIM(p_promptpay_number),
        BTRIM(p_promptpay_name),
        'central_booking_oa',
        'trial',
        NOW() + INTERVAL '14 days',
        BTRIM(p_owner_name),
        BTRIM(p_business_category),
        p_requested_plan,
        p_idempotency_key
    )
    RETURNING id, slug INTO v_shop_id, v_shop_slug;

    INSERT INTO local_service.shop_users (shop_id, user_id, role)
    VALUES (v_shop_id, v_user_id, 'owner');

    RETURN QUERY SELECT v_shop_id, v_shop_slug;
END;
$function$;
GRANT EXECUTE ON FUNCTION local_service.provision_owner_shop(text,text,text,text,text,text,text,text,uuid) TO bk01_migrator;
GRANT EXECUTE ON FUNCTION local_service.provision_owner_shop(text,text,text,text,text,text,text,text,uuid) TO authenticated;

REVOKE ALL ON FUNCTION local_service.reject_deposit_slip(uuid,text) FROM PUBLIC, anon, authenticated, service_role, bk01_runtime, bk01_migrator;
CREATE OR REPLACE FUNCTION local_service.reject_deposit_slip(p_booking_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'local_service'
AS $function$

DECLARE
    v_booking local_service.bookings%ROWTYPE;
BEGIN
    SELECT * INTO v_booking
    FROM local_service.bookings
    WHERE id = p_booking_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Booking not found';
    END IF;
    IF local_service_internal.request_user_id() IS NULL OR NOT local_service.is_shop_member(v_booking.shop_id) THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Not authorized for this shop';
    END IF;
    IF v_booking.status <> 'pending_review' OR v_booking.deposit_status <> 'submitted' THEN
        RAISE EXCEPTION 'Only submitted deposit slips can be rejected';
    END IF;

    UPDATE local_service.bookings
    SET status = 'hold',
        deposit_status = 'rejected',
        expires_at = NOW() + INTERVAL '15 minutes',
        updated_at = NOW()
    WHERE id = p_booking_id;

    -- Keep a dedicated reason-bearing audit row. The generic AFTER UPDATE
    -- trigger row is intentionally preserved, so each rejection has two rows.
    INSERT INTO local_service.booking_status_history (
        booking_id,
        old_status,
        new_status,
        old_deposit_status,
        new_deposit_status,
        changed_by,
        reason
    ) VALUES (
        p_booking_id,
        v_booking.status,
        'hold',
        v_booking.deposit_status,
        'rejected',
        local_service_internal.request_user_id(),
        COALESCE(NULLIF(btrim(p_reason), ''), 'Slip Rejected by Shop')
    );

    RETURN json_build_object(
        'success', true,
        'message', 'Slip rejected, hold reset to 15 minutes'
    );
END;
$function$;
GRANT EXECUTE ON FUNCTION local_service.reject_deposit_slip(uuid,text) TO bk01_migrator;
GRANT EXECUTE ON FUNCTION local_service.reject_deposit_slip(uuid,text) TO authenticated;

REVOKE ALL ON FUNCTION local_service.request_account_closure(uuid,text) FROM PUBLIC, anon, authenticated, service_role, bk01_runtime, bk01_migrator;
CREATE OR REPLACE FUNCTION local_service.request_account_closure(p_shop_id uuid, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'local_service'
AS $function$

DECLARE v_id uuid;
BEGIN
    IF NOT local_service.has_shop_role(p_shop_id,ARRAY['owner']::text[]) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Owner role required'; END IF;
    IF nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Closure reason is required'; END IF;
    INSERT INTO local_service.account_closure_requests(shop_id,requested_by,reason) VALUES(p_shop_id,local_service_internal.request_user_id(),btrim(p_reason)) RETURNING id INTO v_id;
    INSERT INTO local_service.audit_events(shop_id,actor_user_id,actor_type,action,target_type,target_id) VALUES(p_shop_id,local_service_internal.request_user_id(),'merchant','account_closure_requested','account_closure_request',v_id);
    RETURN v_id;
END;
$function$;
GRANT EXECUTE ON FUNCTION local_service.request_account_closure(uuid,text) TO bk01_migrator;
GRANT EXECUTE ON FUNCTION local_service.request_account_closure(uuid,text) TO authenticated;

REVOKE ALL ON FUNCTION local_service.save_ticket_resolution(uuid,text,text) FROM PUBLIC, anon, authenticated, service_role, bk01_runtime, bk01_migrator;
CREATE OR REPLACE FUNCTION local_service.save_ticket_resolution(p_ticket_id uuid, p_resolution text, p_actor text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'local_service'
AS $function$
DECLARE
    v_ticket local_service.tickets%ROWTYPE;
    v_actor TEXT;
BEGIN
    SELECT * INTO v_ticket
      FROM local_service.tickets
     WHERE id = p_ticket_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Ticket not found' USING ERRCODE = 'P0002';
    END IF;

    IF NOT local_service.has_shop_role(v_ticket.shop_id, ARRAY['owner', 'admin']::TEXT[]) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Owner or admin role required';
    END IF;

    IF NULLIF(BTRIM(p_resolution), '') IS NULL THEN
        RAISE EXCEPTION 'Resolution is required' USING ERRCODE = '22023';
    END IF;

    v_actor := COALESCE(NULLIF(BTRIM(p_actor), ''), 'Staff');

    UPDATE local_service.tickets
       SET resolution = BTRIM(p_resolution),
           updated_at = NOW()
     WHERE id = p_ticket_id;

    INSERT INTO local_service.ticket_timeline_entries (
        ticket_id,
        shop_id,
        event_type,
        message,
        actor
    ) VALUES (
        p_ticket_id,
        v_ticket.shop_id,
        'ResolutionSaved',
        format('Resolution recorded: %s', BTRIM(p_resolution)),
        v_actor
    );
END;
$function$;
GRANT EXECUTE ON FUNCTION local_service.save_ticket_resolution(uuid,text,text) TO bk01_migrator;
GRANT EXECUTE ON FUNCTION local_service.save_ticket_resolution(uuid,text,text) TO authenticated;

REVOKE ALL ON FUNCTION local_service.set_booking_outcome(uuid,text,text) FROM PUBLIC, anon, authenticated, service_role, bk01_runtime, bk01_migrator;
CREATE OR REPLACE FUNCTION local_service.set_booking_outcome(p_booking_id uuid, p_outcome text, p_reason text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'local_service'
AS $function$

DECLARE v_booking local_service.bookings%rowtype;
BEGIN
    SELECT * INTO v_booking FROM local_service.bookings WHERE id=p_booking_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found'; END IF;
    IF NOT local_service.has_shop_role(v_booking.shop_id,ARRAY['owner','admin']::text[]) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Owner or admin role required'; END IF;
    IF p_outcome NOT IN ('completed','no_show') THEN RAISE EXCEPTION 'Invalid booking outcome'; END IF;
    IF v_booking.status <> 'confirmed' THEN RAISE EXCEPTION 'Only confirmed bookings can receive an outcome'; END IF;
    UPDATE local_service.bookings SET status=p_outcome,updated_at=now() WHERE id=p_booking_id;
    INSERT INTO local_service.audit_events(shop_id,actor_user_id,actor_type,action,target_type,target_id,metadata)
    VALUES(v_booking.shop_id,local_service_internal.request_user_id(),'merchant','booking_'||p_outcome,'booking',p_booking_id,jsonb_build_object('reason',p_reason));
    RETURN json_build_object('booking_id',p_booking_id,'status',p_outcome);
END;
$function$;
GRANT EXECUTE ON FUNCTION local_service.set_booking_outcome(uuid,text,text) TO bk01_migrator;
GRANT EXECUTE ON FUNCTION local_service.set_booking_outcome(uuid,text,text) TO authenticated;

REVOKE ALL ON FUNCTION local_service.set_service_active(uuid,boolean) FROM PUBLIC, anon, authenticated, service_role, bk01_runtime, bk01_migrator;
CREATE OR REPLACE FUNCTION local_service.set_service_active(p_service_id uuid, p_is_active boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'local_service'
AS $function$
DECLARE
    v_shop_id UUID;
BEGIN
    SELECT shop_id INTO v_shop_id
      FROM local_service.services
     WHERE id = p_service_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Service not found';
    END IF;

    IF NOT local_service.has_shop_role(v_shop_id, ARRAY['owner', 'admin']::TEXT[]) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Owner or admin role required';
    END IF;

    UPDATE local_service.services
       SET is_active = p_is_active
     WHERE id = p_service_id;
END;
$function$;
GRANT EXECUTE ON FUNCTION local_service.set_service_active(uuid,boolean) TO bk01_migrator;
GRANT EXECUTE ON FUNCTION local_service.set_service_active(uuid,boolean) TO authenticated;

REVOKE ALL ON FUNCTION local_service.set_staff_active(uuid,boolean) FROM PUBLIC, anon, authenticated, service_role, bk01_runtime, bk01_migrator;
CREATE OR REPLACE FUNCTION local_service.set_staff_active(p_staff_id uuid, p_is_active boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'local_service'
AS $function$
DECLARE
    v_shop_id UUID;
    v_current_is_active BOOLEAN;
    v_plan TEXT;
    v_limits RECORD;
    v_active_staff_count INT;
BEGIN
    SELECT shop_id, is_active
      INTO v_shop_id, v_current_is_active
      FROM local_service.staff
     WHERE id = p_staff_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Staff member not found';
    END IF;

    IF NOT local_service.is_shop_owner(v_shop_id) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Owner role required';
    END IF;

    -- หากเป็นการเปิดใช้งานพนักงาน (Activate) ให้ตรวจเช็คขีดจำกัดพนักงานของร้าน
    IF p_is_active = true AND (v_current_is_active IS DISTINCT FROM true) THEN
        -- Lock the shop's staff-limit slot transactionally so two concurrent
        -- set_staff_active/reactivate calls near the limit cannot both pass
        -- the COUNT(*) gate.
        PERFORM pg_advisory_xact_lock(hashtext(v_shop_id::text));

        SELECT COALESCE(plan, 'free_trial')
          INTO v_plan
          FROM local_service.subscriptions
         WHERE shop_id = v_shop_id;

        IF NOT FOUND THEN
            v_plan := 'free_trial';
        END IF;

        SELECT staff_limit INTO v_limits FROM local_service.get_tier_limits(v_plan);

        SELECT COUNT(*)
          INTO v_active_staff_count
          FROM local_service.staff
         WHERE shop_id = v_shop_id
           AND is_active = true;

        IF v_active_staff_count >= v_limits.staff_limit THEN
            RAISE EXCEPTION USING
                ERRCODE = 'P0001',
                MESSAGE = 'STAFF_LIMIT_EXCEEDED';
        END IF;
    END IF;

    UPDATE local_service.staff
       SET is_active = p_is_active
     WHERE id = p_staff_id;
END;
$function$;
GRANT EXECUTE ON FUNCTION local_service.set_staff_active(uuid,boolean) TO bk01_migrator;
GRANT EXECUTE ON FUNCTION local_service.set_staff_active(uuid,boolean) TO authenticated;

REVOKE ALL ON FUNCTION local_service.submit_deposit_slip(uuid,text,text) FROM PUBLIC, anon, authenticated, service_role, bk01_runtime, bk01_migrator;
CREATE OR REPLACE FUNCTION local_service.submit_deposit_slip(p_booking_id uuid, p_slip_url text, p_trans_ref text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'local_service'
AS $function$
DECLARE
    v_booking local_service.bookings%ROWTYPE;
    v_expected_pattern TEXT;
    v_object_name TEXT;
BEGIN
    IF p_slip_url IS NULL OR btrim(p_slip_url) = '' THEN
        RAISE EXCEPTION 'Slip URL is required';
    END IF;

    SELECT * INTO v_booking
    FROM local_service.bookings
    WHERE id = p_booking_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Booking not found';
    END IF;
    IF v_booking.status <> 'hold' THEN
        RAISE EXCEPTION 'Booking is not accepting deposit slips';
    END IF;
    IF v_booking.expires_at IS NULL OR v_booking.expires_at <= NOW() THEN
        RAISE EXCEPTION 'Booking hold has expired';
    END IF;

    v_expected_pattern :=
        '^https://gyleqrjdzwwlqierdwcy[.]supabase[.]co/storage/v1/object/public/deposit-slips/'
        || p_booking_id::text
        || '/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|jpeg|png|webp)$';

    IF p_slip_url !~* v_expected_pattern THEN
        RAISE EXCEPTION 'Slip URL must belong to this booking in the deposit-slips bucket';
    END IF;

    v_object_name := regexp_replace(
        p_slip_url,
        '^https://gyleqrjdzwwlqierdwcy[.]supabase[.]co/storage/v1/object/public/deposit-slips/',
        '',
        'i'
    );

    IF NOT EXISTS (
        SELECT 1
        FROM storage.objects o
        WHERE o.bucket_id = 'deposit-slips'
          AND o.name = v_object_name
    ) THEN
        RAISE EXCEPTION 'Slip object was not found in the deposit-slips bucket';
    END IF;

    UPDATE local_service.bookings
    SET slip_url = p_slip_url,
        trans_ref = NULLIF(btrim(p_trans_ref), ''),
        deposit_status = 'submitted',
        status = 'pending_review',
        slip_uploaded_at = NOW(),
        slip_submit_count = COALESCE(slip_submit_count, 0) + 1,
        updated_at = NOW()
    WHERE id = p_booking_id
    RETURNING * INTO v_booking;

    RETURN json_build_object(
        'booking_id', v_booking.id,
        'status', v_booking.status,
        'deposit_status', v_booking.deposit_status,
        'slip_url', v_booking.slip_url,
        'slip_uploaded_at', v_booking.slip_uploaded_at,
        'slip_submit_count', v_booking.slip_submit_count
    );
END;
$function$;
GRANT EXECUTE ON FUNCTION local_service.submit_deposit_slip(uuid,text,text) TO postgres;

REVOKE ALL ON FUNCTION local_service.submit_deposit_slip(uuid,text,text,text) FROM PUBLIC, anon, authenticated, service_role, bk01_runtime, bk01_migrator;
CREATE OR REPLACE FUNCTION local_service.submit_deposit_slip(p_booking_id uuid, p_recovery_token text, p_slip_url text, p_trans_ref text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'local_service'
AS $function$
DECLARE v_booking local_service.bookings%rowtype;
BEGIN
    IF p_slip_url !~* ('^' || p_booking_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|jpeg|png|webp)$')
       OR p_slip_url LIKE '%..%' OR p_slip_url LIKE '%://%' THEN
        RAISE EXCEPTION 'Slip object reference must belong to this booking';
    END IF;
    SELECT * INTO v_booking FROM local_service.bookings WHERE id=p_booking_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found'; END IF;
    IF NOT local_service.authorize_booking_recovery_attempt(p_booking_id,p_recovery_token) THEN
        RETURN json_build_object('ok',false,'error','Invalid or expired booking recovery token');
    END IF;
    IF v_booking.status <> 'hold' OR v_booking.expires_at IS NULL OR v_booking.expires_at <= now() THEN
        RAISE EXCEPTION 'Booking is not accepting deposit slips';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='deposit-slips' AND o.name=p_slip_url) THEN
        RAISE EXCEPTION 'Slip object was not found in the private deposit-slips bucket';
    END IF;
    UPDATE local_service.bookings SET slip_url=p_slip_url,trans_ref=nullif(btrim(p_trans_ref),''),deposit_status='submitted',status='pending_review',slip_uploaded_at=now(),slip_submit_count=coalesce(slip_submit_count,0)+1,updated_at=now() WHERE id=p_booking_id RETURNING * INTO v_booking;
    RETURN json_build_object('booking_id',v_booking.id,'status',v_booking.status,'deposit_status',v_booking.deposit_status,'slip_object_path',v_booking.slip_url);
END;
$function$;
GRANT EXECUTE ON FUNCTION local_service.submit_deposit_slip(uuid,text,text,text) TO postgres;
GRANT EXECUTE ON FUNCTION local_service.submit_deposit_slip(uuid,text,text,text) TO anon;

REVOKE ALL ON FUNCTION local_service.suppress_new_overdue_line_reminder() FROM PUBLIC, anon, authenticated, service_role, bk01_runtime, bk01_migrator;
CREATE OR REPLACE FUNCTION local_service.suppress_new_overdue_line_reminder()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'local_service'
AS $function$
BEGIN
    IF NEW.event_type = 'reminder_24h'
       AND NEW.status = 'pending'
       AND NEW.scheduled_for IS NOT NULL
       AND NEW.scheduled_for <= now() THEN
        RETURN NULL;
    END IF;

    RETURN NEW;
END;
$function$;
GRANT EXECUTE ON FUNCTION local_service.suppress_new_overdue_line_reminder() TO PUBLIC;

REVOKE ALL ON FUNCTION local_service.sync_subscription_state(text,bigint,uuid,text,text,text,text,bigint,boolean) FROM PUBLIC, anon, authenticated, service_role, bk01_runtime, bk01_migrator;
CREATE OR REPLACE FUNCTION local_service.sync_subscription_state(p_event_type text, p_event_created bigint, p_shop_id uuid, p_stripe_customer_id text, p_stripe_subscription_id text, p_plan text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_current_period_end bigint DEFAULT NULL::bigint, p_cancel_at_period_end boolean DEFAULT NULL::boolean)
 RETURNS TABLE(applied boolean, matched_shop_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'local_service'
AS $function$
DECLARE
    v_target_shop_id    UUID;
    v_current_updated_at TIMESTAMPTZ;
    v_event_ts          TIMESTAMPTZ := to_timestamp(p_event_created);
    v_new_status        TEXT := p_status;
    v_legacy_status     TEXT;
BEGIN
    IF p_shop_id IS NOT NULL THEN
        v_target_shop_id := p_shop_id;
    ELSE
        SELECT subscriptions.shop_id INTO v_target_shop_id
          FROM local_service.subscriptions
         WHERE subscriptions.stripe_subscription_id = p_stripe_subscription_id
         LIMIT 1;
    END IF;

    IF v_target_shop_id IS NULL THEN
        RETURN QUERY SELECT false, NULL::uuid;
        RETURN;
    END IF;

    SELECT subscriptions.updated_at INTO v_current_updated_at
      FROM local_service.subscriptions
     WHERE subscriptions.shop_id = v_target_shop_id
     LIMIT 1;

    IF FOUND AND v_current_updated_at IS NOT NULL AND v_event_ts < v_current_updated_at THEN
        RETURN QUERY SELECT false, v_target_shop_id;
        RETURN;
    END IF;

    v_new_status := COALESCE(p_status, '');
    CASE v_new_status
        WHEN 'trialing'          THEN v_legacy_status := 'trial';
        WHEN 'active'            THEN v_legacy_status := 'active';
        WHEN 'past_due'          THEN v_legacy_status := 'past_due';
        WHEN 'canceled'          THEN v_legacy_status := 'canceled';
        WHEN 'incomplete'        THEN v_legacy_status := 'inactive';
        WHEN 'incomplete_expired' THEN v_legacy_status := 'canceled';
        WHEN 'unpaid'            THEN v_legacy_status := 'canceled';
        ELSE v_legacy_status := NULL;
    END CASE;

    IF p_event_type = 'checkout.session.completed' THEN
        INSERT INTO local_service.subscriptions (
            shop_id,
            stripe_customer_id,
            stripe_subscription_id,
            plan,
            status,
            current_period_end,
            cancel_at_period_end,
            updated_at
        ) VALUES (
            v_target_shop_id,
            p_stripe_customer_id,
            p_stripe_subscription_id,
            COALESCE(p_plan, 'free_trial'),
            COALESCE(p_status, 'trialing'),
            CASE WHEN p_current_period_end IS NOT NULL
                 THEN to_timestamp(p_current_period_end) ELSE NULL END,
            COALESCE(p_cancel_at_period_end, false),
            now()
        )
        ON CONFLICT (shop_id) DO UPDATE SET
            stripe_customer_id = EXCLUDED.stripe_customer_id,
            stripe_subscription_id = EXCLUDED.stripe_subscription_id,
            plan = EXCLUDED.plan,
            status = EXCLUDED.status,
            current_period_end = EXCLUDED.current_period_end,
            cancel_at_period_end = EXCLUDED.cancel_at_period_end,
            updated_at = now();

    ELSIF p_event_type = 'customer.subscription.updated' THEN
        UPDATE local_service.subscriptions
           SET plan = COALESCE(p_plan, subscriptions.plan),
               status = COALESCE(p_status, subscriptions.status),
               current_period_end = CASE
                   WHEN p_current_period_end IS NOT NULL
                   THEN to_timestamp(p_current_period_end)
                   ELSE subscriptions.current_period_end
               END,
               cancel_at_period_end = COALESCE(
                   p_cancel_at_period_end, subscriptions.cancel_at_period_end),
               updated_at = now()
         WHERE stripe_subscription_id = p_stripe_subscription_id;

    ELSIF p_event_type = 'customer.subscription.deleted' THEN
        UPDATE local_service.subscriptions
           SET status = 'canceled',
               cancel_at_period_end = false,
               updated_at = now()
         WHERE stripe_subscription_id = p_stripe_subscription_id;
        v_legacy_status := 'canceled';

    ELSIF p_event_type = 'invoice.paid' THEN
        UPDATE local_service.subscriptions
           SET status = 'active',
               current_period_end = CASE
                   WHEN p_current_period_end IS NOT NULL
                   THEN to_timestamp(p_current_period_end)
                   ELSE subscriptions.current_period_end
               END,
               updated_at = now()
         WHERE stripe_subscription_id = p_stripe_subscription_id;
        v_legacy_status := 'active';

    ELSIF p_event_type = 'invoice.payment_failed' THEN
        UPDATE local_service.subscriptions
           SET status = 'past_due',
               updated_at = now()
         WHERE stripe_subscription_id = p_stripe_subscription_id;
        v_legacy_status := 'past_due';

    ELSE
        RETURN QUERY SELECT false, v_target_shop_id;
        RETURN;
    END IF;

    IF v_legacy_status IS NOT NULL THEN
        UPDATE local_service.shops
           SET subscription_status = v_legacy_status,
               updated_at = now()
         WHERE id = v_target_shop_id;
    END IF;

    RETURN QUERY SELECT true, v_target_shop_id;
END;
$function$;
GRANT EXECUTE ON FUNCTION local_service.sync_subscription_state(text,bigint,uuid,text,text,text,text,bigint,boolean) TO bk01_migrator;
GRANT EXECUTE ON FUNCTION local_service.sync_subscription_state(text,bigint,uuid,text,text,text,text,bigint,boolean) TO service_role;

REVOKE ALL ON FUNCTION local_service.sync_subscription_state_bk_a(text,bigint,uuid,text,text,text,text,bigint,boolean) FROM PUBLIC, anon, authenticated, service_role, bk01_runtime, bk01_migrator;
CREATE OR REPLACE FUNCTION local_service.sync_subscription_state_bk_a(p_event_type text, p_event_created bigint, p_shop_id uuid, p_stripe_customer_id text, p_stripe_subscription_id text, p_plan text, p_status text, p_current_period_end bigint, p_cancel_at_period_end boolean)
 RETURNS TABLE(out_applied boolean, out_matched_shop_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'local_service'
AS $function$
DECLARE v_shop_id uuid; v_event_ts timestamptz:=to_timestamp(p_event_created); v_result record;
BEGIN
  v_shop_id:=p_shop_id;
  IF v_shop_id IS NULL THEN
    SELECT shop_id INTO v_shop_id FROM local_service.subscriptions
    WHERE stripe_subscription_id=p_stripe_subscription_id FOR UPDATE;
  ELSE
    PERFORM 1 FROM local_service.shops WHERE id=v_shop_id FOR UPDATE;
    PERFORM 1 FROM local_service.subscriptions WHERE shop_id=v_shop_id FOR UPDATE;
  END IF;
  IF v_shop_id IS NULL THEN RETURN QUERY SELECT false,NULL::uuid; RETURN; END IF;
  IF EXISTS(SELECT 1 FROM local_service.subscriptions WHERE shop_id=v_shop_id AND last_stripe_event_created_at > v_event_ts) THEN
    RETURN QUERY SELECT false,v_shop_id; RETURN;
  END IF;
  -- The legacy function compared Stripe creation time to local processing time.
  -- Normalize that legacy guard while this row remains locked.
  UPDATE local_service.subscriptions SET updated_at=v_event_ts-interval '1 microsecond' WHERE shop_id=v_shop_id;
  SELECT * INTO v_result FROM local_service.sync_subscription_state(
    p_event_type,p_event_created,v_shop_id,p_stripe_customer_id,p_stripe_subscription_id,
    p_plan,p_status,p_current_period_end,p_cancel_at_period_end
  );
  IF coalesce(v_result.applied,false) THEN
    UPDATE local_service.subscriptions SET last_stripe_event_created_at=v_event_ts WHERE shop_id=v_shop_id;
  END IF;
  RETURN QUERY SELECT coalesce(v_result.applied,false),v_shop_id;
END; $function$;
GRANT EXECUTE ON FUNCTION local_service.sync_subscription_state_bk_a(text,bigint,uuid,text,text,text,text,bigint,boolean) TO bk01_migrator;
GRANT EXECUTE ON FUNCTION local_service.sync_subscription_state_bk_a(text,bigint,uuid,text,text,text,text,bigint,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION local_service.sync_subscription_state_bk_a(text,bigint,uuid,text,text,text,text,bigint,boolean) TO bk01_runtime;

REVOKE ALL ON FUNCTION local_service.update_service(uuid,text,text,integer,numeric,numeric) FROM PUBLIC, anon, authenticated, service_role, bk01_runtime, bk01_migrator;
CREATE OR REPLACE FUNCTION local_service.update_service(p_service_id uuid, p_name text, p_description text, p_duration_minutes integer, p_price numeric, p_deposit_amount numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'local_service'
AS $function$
DECLARE
    v_service local_service.services%ROWTYPE;
BEGIN
    SELECT * INTO v_service
      FROM local_service.services
     WHERE id = p_service_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Service not found';
    END IF;

    IF NOT local_service.has_shop_role(v_service.shop_id, ARRAY['owner', 'admin']::TEXT[]) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Owner or admin role required';
    END IF;

    IF NULLIF(BTRIM(p_name), '') IS NULL THEN
        RAISE EXCEPTION 'Service name is required' USING ERRCODE = '22023';
    END IF;

    IF p_duration_minutes IS NULL OR p_duration_minutes < 15 OR p_duration_minutes % 15 <> 0 THEN
        RAISE EXCEPTION 'Duration must be a positive multiple of 15 minutes' USING ERRCODE = '22023';
    END IF;

    IF p_price IS NULL OR p_price < 0
       OR p_deposit_amount IS NULL OR p_deposit_amount < 0
       OR p_deposit_amount > p_price THEN
        RAISE EXCEPTION 'Invalid service price or deposit amount' USING ERRCODE = '22023';
    END IF;

    UPDATE local_service.services
       SET name = BTRIM(p_name),
           description = NULLIF(BTRIM(p_description), ''),
           duration_minutes = p_duration_minutes,
           price = p_price,
           deposit_amount = p_deposit_amount
     WHERE id = p_service_id;
END;
$function$;
GRANT EXECUTE ON FUNCTION local_service.update_service(uuid,text,text,integer,numeric,numeric) TO bk01_migrator;
GRANT EXECUTE ON FUNCTION local_service.update_service(uuid,text,text,integer,numeric,numeric) TO authenticated;

REVOKE ALL ON FUNCTION local_service.update_shop_settings(uuid,text,text,text,text,text,text) FROM PUBLIC, anon, authenticated, service_role, bk01_runtime, bk01_migrator;
CREATE OR REPLACE FUNCTION local_service.update_shop_settings(p_shop_id uuid, p_name text, p_phone text, p_address text, p_promptpay_number text, p_promptpay_name text, p_line_oa_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'local_service'
AS $function$
BEGIN
    IF NOT local_service.is_shop_owner(p_shop_id) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Owner role required';
    END IF;

    IF NULLIF(BTRIM(p_name), '') IS NULL THEN
        RAISE EXCEPTION 'Shop name is required' USING ERRCODE = '22023';
    END IF;

    IF NULLIF(BTRIM(p_phone), '') IS NULL THEN
        RAISE EXCEPTION 'Shop phone is required' USING ERRCODE = '22023';
    END IF;

    IF NULLIF(BTRIM(p_promptpay_number), '') IS NULL THEN
        RAISE EXCEPTION 'PromptPay number is required' USING ERRCODE = '22023';
    END IF;

    IF NULLIF(BTRIM(p_promptpay_name), '') IS NULL THEN
        RAISE EXCEPTION 'PromptPay account name is required' USING ERRCODE = '22023';
    END IF;

    UPDATE local_service.shops
       SET name = BTRIM(p_name),
           phone = BTRIM(p_phone),
           address = NULLIF(BTRIM(p_address), ''),
           promptpay_number = BTRIM(p_promptpay_number),
           promptpay_name = BTRIM(p_promptpay_name),
           line_oa_id = NULLIF(BTRIM(p_line_oa_id), ''),
           updated_at = NOW()
     WHERE id = p_shop_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Shop not found';
    END IF;
END;
$function$;
GRANT EXECUTE ON FUNCTION local_service.update_shop_settings(uuid,text,text,text,text,text,text) TO bk01_migrator;
GRANT EXECUTE ON FUNCTION local_service.update_shop_settings(uuid,text,text,text,text,text,text) TO authenticated;

REVOKE ALL ON FUNCTION local_service.update_ticket_assignee(uuid,text,text) FROM PUBLIC, anon, authenticated, service_role, bk01_runtime, bk01_migrator;
CREATE OR REPLACE FUNCTION local_service.update_ticket_assignee(p_ticket_id uuid, p_new_assignee text, p_actor text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'local_service'
AS $function$
DECLARE
    v_ticket local_service.tickets%ROWTYPE;
    v_actor TEXT;
    v_clean_assignee TEXT;
    v_prev_assignee TEXT;
    v_display_new TEXT;
BEGIN
    SELECT * INTO v_ticket
      FROM local_service.tickets
     WHERE id = p_ticket_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Ticket not found' USING ERRCODE = 'P0002';
    END IF;

    IF NOT local_service.has_shop_role(v_ticket.shop_id, ARRAY['owner', 'admin']::TEXT[]) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Owner or admin role required';
    END IF;

    v_clean_assignee := NULLIF(BTRIM(p_new_assignee), '');
    v_prev_assignee := COALESCE(v_ticket.assigned_to, 'Unassigned');
    v_display_new := COALESCE(v_clean_assignee, 'Unassigned');
    v_actor := COALESCE(NULLIF(BTRIM(p_actor), ''), 'Staff');

    UPDATE local_service.tickets
       SET assigned_to = v_clean_assignee,
           updated_at = NOW()
     WHERE id = p_ticket_id;

    INSERT INTO local_service.ticket_timeline_entries (
        ticket_id,
        shop_id,
        event_type,
        message,
        actor
    ) VALUES (
        p_ticket_id,
        v_ticket.shop_id,
        'AssigneeChanged',
        format('Assignee changed from %s to %s.', v_prev_assignee, v_display_new),
        v_actor
    );
END;
$function$;
GRANT EXECUTE ON FUNCTION local_service.update_ticket_assignee(uuid,text,text) TO bk01_migrator;
GRANT EXECUTE ON FUNCTION local_service.update_ticket_assignee(uuid,text,text) TO authenticated;

REVOKE ALL ON FUNCTION local_service.update_ticket_priority(uuid,text,text) FROM PUBLIC, anon, authenticated, service_role, bk01_runtime, bk01_migrator;
CREATE OR REPLACE FUNCTION local_service.update_ticket_priority(p_ticket_id uuid, p_new_priority text, p_actor text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'local_service'
AS $function$
DECLARE
    v_ticket local_service.tickets%ROWTYPE;
    v_actor TEXT;
BEGIN
    SELECT * INTO v_ticket
      FROM local_service.tickets
     WHERE id = p_ticket_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Ticket not found' USING ERRCODE = 'P0002';
    END IF;

    IF NOT local_service.has_shop_role(v_ticket.shop_id, ARRAY['owner', 'admin']::TEXT[]) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Owner or admin role required';
    END IF;

    IF p_new_priority IS NULL OR p_new_priority NOT IN ('Low', 'Medium', 'High') THEN
        RAISE EXCEPTION 'Invalid ticket priority' USING ERRCODE = '22023';
    END IF;

    v_actor := COALESCE(NULLIF(BTRIM(p_actor), ''), 'Staff');

    UPDATE local_service.tickets
       SET priority = p_new_priority,
           updated_at = NOW()
     WHERE id = p_ticket_id;

    INSERT INTO local_service.ticket_timeline_entries (
        ticket_id,
        shop_id,
        event_type,
        message,
        actor
    ) VALUES (
        p_ticket_id,
        v_ticket.shop_id,
        'PriorityChanged',
        format('Priority changed from %s to %s.', v_ticket.priority, p_new_priority),
        v_actor
    );
END;
$function$;
GRANT EXECUTE ON FUNCTION local_service.update_ticket_priority(uuid,text,text) TO bk01_migrator;
GRANT EXECUTE ON FUNCTION local_service.update_ticket_priority(uuid,text,text) TO authenticated;

REVOKE ALL ON FUNCTION local_service.update_ticket_status(uuid,text,text) FROM PUBLIC, anon, authenticated, service_role, bk01_runtime, bk01_migrator;
CREATE OR REPLACE FUNCTION local_service.update_ticket_status(p_ticket_id uuid, p_new_status text, p_actor text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'local_service'
AS $function$
DECLARE
    v_ticket local_service.tickets%ROWTYPE;
    v_is_valid BOOLEAN := FALSE;
    v_actor TEXT;
BEGIN
    SELECT * INTO v_ticket
      FROM local_service.tickets
     WHERE id = p_ticket_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Ticket not found' USING ERRCODE = 'P0002';
    END IF;

    IF NOT local_service.has_shop_role(v_ticket.shop_id, ARRAY['owner', 'admin']::TEXT[]) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Owner or admin role required';
    END IF;

    IF p_new_status IS NULL OR p_new_status NOT IN (
        'New', 'Acknowledged', 'InReview', 'WaitingForCustomer',
        'RecheckScheduled', 'Resolved', 'Closed', 'Reopened'
    ) THEN
        RAISE EXCEPTION 'Invalid ticket status' USING ERRCODE = '22023';
    END IF;

    -- Enforce transition rules aligned with ticket-domain.ts ALLOWED_TRANSITIONS
    IF v_ticket.status = 'New' AND p_new_status IN ('Acknowledged', 'InReview', 'WaitingForCustomer', 'Closed') THEN
        v_is_valid := TRUE;
    ELSIF v_ticket.status = 'Acknowledged' AND p_new_status IN ('InReview', 'WaitingForCustomer', 'Closed') THEN
        v_is_valid := TRUE;
    ELSIF v_ticket.status = 'InReview' AND p_new_status IN ('Acknowledged', 'WaitingForCustomer', 'RecheckScheduled', 'Resolved', 'Closed') THEN
        v_is_valid := TRUE;
    ELSIF v_ticket.status = 'WaitingForCustomer' AND p_new_status IN ('Acknowledged', 'InReview', 'Closed') THEN
        v_is_valid := TRUE;
    ELSIF v_ticket.status = 'RecheckScheduled' AND p_new_status IN ('InReview', 'Resolved', 'Closed') THEN
        v_is_valid := TRUE;
    ELSIF v_ticket.status = 'Resolved' AND p_new_status IN ('InReview', 'Closed') THEN
        v_is_valid := TRUE;
    ELSIF v_ticket.status = 'Closed' AND p_new_status = 'Reopened' THEN
        v_is_valid := TRUE;
    ELSIF v_ticket.status = 'Reopened' AND p_new_status IN ('Acknowledged', 'InReview', 'WaitingForCustomer', 'Closed') THEN
        v_is_valid := TRUE;
    END IF;

    IF NOT v_is_valid THEN
        IF v_ticket.status = 'Closed' THEN
            RAISE EXCEPTION 'Closed tickets must be reopened before changing status.' USING ERRCODE = '22023';
        ELSE
            RAISE EXCEPTION 'Cannot transition from "%" to "%"', v_ticket.status, p_new_status USING ERRCODE = '22023';
        END IF;
    END IF;

    v_actor := COALESCE(NULLIF(BTRIM(p_actor), ''), 'Staff');

    UPDATE local_service.tickets
       SET status = p_new_status,
           closed_at = CASE
               WHEN p_new_status = 'Closed' THEN NOW()
               WHEN v_ticket.status = 'Closed' AND p_new_status = 'Reopened' THEN NULL
               ELSE closed_at
           END,
           updated_at = NOW()
     WHERE id = p_ticket_id;

    INSERT INTO local_service.ticket_timeline_entries (
        ticket_id,
        shop_id,
        event_type,
        message,
        actor
    ) VALUES (
        p_ticket_id,
        v_ticket.shop_id,
        'StatusChanged',
        format('Status changed from %s to %s.', v_ticket.status, p_new_status),
        v_actor
    );
END;
$function$;
GRANT EXECUTE ON FUNCTION local_service.update_ticket_status(uuid,text,text) TO bk01_migrator;
GRANT EXECUTE ON FUNCTION local_service.update_ticket_status(uuid,text,text) TO authenticated;

REVOKE ALL ON FUNCTION local_service.upsert_staff_weekly_schedule(uuid,jsonb) FROM PUBLIC, anon, authenticated, service_role, bk01_runtime, bk01_migrator;
CREATE OR REPLACE FUNCTION local_service.upsert_staff_weekly_schedule(p_staff_id uuid, p_days jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'local_service'
AS $function$
DECLARE
    v_shop_id UUID;
    v_day_count INTEGER;
    v_distinct_day_count INTEGER;
    v_invalid_count INTEGER;
BEGIN
    SELECT shop_id
      INTO v_shop_id
      FROM local_service.staff
     WHERE id = p_staff_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Staff member not found';
    END IF;

    IF NOT local_service.has_shop_role(v_shop_id, ARRAY['owner', 'admin']::TEXT[]) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Owner or admin role required';
    END IF;

    IF p_days IS NULL OR jsonb_typeof(p_days) <> 'array' THEN
        RAISE EXCEPTION 'Schedule days must be a JSON array' USING ERRCODE = '22023';
    END IF;

    SELECT COUNT(*), COUNT(DISTINCT day_of_week)
      INTO v_day_count, v_distinct_day_count
      FROM jsonb_to_recordset(p_days) AS day_row(
          day_of_week INTEGER,
          is_working_day BOOLEAN,
          work_start TIME,
          work_end TIME,
          break_start TIME,
          break_end TIME
      );

    IF v_day_count <> 7 OR v_distinct_day_count <> 7 THEN
        RAISE EXCEPTION 'Schedule must contain each day from 0 through 6 exactly once' USING ERRCODE = '22023';
    END IF;

    SELECT COUNT(*)
      INTO v_invalid_count
      FROM jsonb_to_recordset(p_days) AS day_row(
          day_of_week INTEGER,
          is_working_day BOOLEAN,
          work_start TIME,
          work_end TIME,
          break_start TIME,
          break_end TIME
      )
     WHERE day_of_week NOT BETWEEN 0 AND 6
        OR is_working_day IS NULL
        OR work_start IS NULL
        OR work_end IS NULL
        OR work_start >= work_end
        OR ((break_start IS NULL) <> (break_end IS NULL))
        OR (break_start IS NOT NULL AND (
               break_start >= break_end
            OR break_start < work_start
            OR break_end > work_end
        ));

    IF v_invalid_count > 0 THEN
        RAISE EXCEPTION 'Invalid work or break time in weekly schedule' USING ERRCODE = '22023';
    END IF;

    INSERT INTO local_service.staff_schedules (
        shop_id, staff_id, day_of_week, is_working_day,
        work_start, work_end, break_start, break_end
    )
    SELECT
        v_shop_id, p_staff_id, day_of_week, is_working_day,
        work_start, work_end, break_start, break_end
      FROM jsonb_to_recordset(p_days) AS day_row(
          day_of_week INTEGER,
          is_working_day BOOLEAN,
          work_start TIME,
          work_end TIME,
          break_start TIME,
          break_end TIME
      )
    ON CONFLICT (staff_id, day_of_week) DO UPDATE
        SET shop_id = EXCLUDED.shop_id,
            is_working_day = EXCLUDED.is_working_day,
            work_start = EXCLUDED.work_start,
            work_end = EXCLUDED.work_end,
            break_start = EXCLUDED.break_start,
            break_end = EXCLUDED.break_end;
END;
$function$;
GRANT EXECUTE ON FUNCTION local_service.upsert_staff_weekly_schedule(uuid,jsonb) TO bk01_migrator;
GRANT EXECUTE ON FUNCTION local_service.upsert_staff_weekly_schedule(uuid,jsonb) TO authenticated;

REVOKE ALL ON FUNCTION local_service_internal.request_user_id() FROM PUBLIC, anon, authenticated, service_role, bk01_runtime, bk01_migrator;
CREATE OR REPLACE FUNCTION local_service_internal.request_user_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.sub', true), ''),
    (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid;
$function$;
GRANT EXECUTE ON FUNCTION local_service_internal.request_user_id() TO postgres;
GRANT EXECUTE ON FUNCTION local_service_internal.request_user_id() TO bk01_migrator;

DROP FUNCTION local_service.apply_trial_promotion();

DROP FUNCTION local_service.bk01_apply_plan_change(uuid);

DROP FUNCTION local_service.bk01_bookings_used_in_month(uuid,date);

DROP FUNCTION local_service.bk01_effective_plan(text,text);

DROP FUNCTION local_service.bk01_entitled_service_ids(uuid);

DROP FUNCTION local_service.bk01_entitled_staff_ids(uuid);

DROP FUNCTION local_service.bk01_free_bookings_ceiling();

DROP FUNCTION local_service.bk01_month_key(timestamp with time zone);

DROP FUNCTION local_service.bk01_reapply_shop_entitlements(uuid);

DROP FUNCTION local_service.bk01_restore_services_within_limit(uuid);

DROP FUNCTION local_service.bk01_shop_effective_plan(uuid);

DROP FUNCTION local_service.bk01_shop_limits(uuid);

ALTER TABLE local_service.services DROP COLUMN entitlement_disabled;

ALTER TABLE local_service.shops DROP COLUMN starter_set_applied, DROP COLUMN business_type_code;

DROP TABLE local_service.service_entitlement_periods;

DROP TABLE local_service.business_types;

DROP TABLE local_service.trial_promotions;

DROP TABLE local_service.entitlement_plans;

DROP TRIGGER IF EXISTS trg_enforce_booking_quota ON local_service.bookings;
CREATE TRIGGER trg_enforce_booking_quota BEFORE INSERT OR UPDATE ON local_service.bookings FOR EACH ROW EXECUTE FUNCTION local_service.enforce_booking_quota();

DROP TRIGGER IF EXISTS trg_enforce_booking_status_transition ON local_service.bookings;
CREATE TRIGGER trg_enforce_booking_status_transition AFTER INSERT OR UPDATE ON local_service.bookings FOR EACH ROW EXECUTE FUNCTION local_service.enforce_booking_status_transition();

DROP TRIGGER IF EXISTS trg_enforce_shop_booking_acceptance ON local_service.bookings;
CREATE TRIGGER trg_enforce_shop_booking_acceptance BEFORE INSERT ON local_service.bookings FOR EACH ROW EXECUTE FUNCTION local_service.enforce_shop_booking_acceptance();

DROP TRIGGER IF EXISTS trg_enqueue_booking_notifications ON local_service.bookings;
CREATE TRIGGER trg_enqueue_booking_notifications AFTER INSERT OR UPDATE OF status ON local_service.bookings FOR EACH ROW EXECUTE FUNCTION local_service.enqueue_booking_notifications();

DROP TRIGGER IF EXISTS trg_suppress_new_overdue_line_reminder ON local_service.line_notification_logs;
CREATE TRIGGER trg_suppress_new_overdue_line_reminder BEFORE INSERT ON local_service.line_notification_logs FOR EACH ROW EXECUTE FUNCTION local_service.suppress_new_overdue_line_reminder();

DROP TRIGGER IF EXISTS bk_a_audit_platform_shop_update ON local_service.shops;
CREATE TRIGGER bk_a_audit_platform_shop_update AFTER UPDATE ON local_service.shops FOR EACH ROW EXECUTE FUNCTION local_service.audit_platform_admin_update();

DROP TRIGGER IF EXISTS trg_initialize_shop_subscription ON local_service.shops;
CREATE TRIGGER trg_initialize_shop_subscription AFTER INSERT ON local_service.shops FOR EACH ROW EXECUTE FUNCTION local_service.initialize_shop_subscription();

DROP TRIGGER IF EXISTS bk_a_audit_platform_subscription_update ON local_service.subscriptions;
CREATE TRIGGER bk_a_audit_platform_subscription_update AFTER UPDATE ON local_service.subscriptions FOR EACH ROW EXECUTE FUNCTION local_service.audit_platform_admin_update();

DROP TRIGGER IF EXISTS trg_ticket_timeline_owner_admin ON local_service.ticket_timeline_entries;
CREATE TRIGGER trg_ticket_timeline_owner_admin BEFORE INSERT OR DELETE OR UPDATE ON local_service.ticket_timeline_entries FOR EACH ROW EXECUTE FUNCTION local_service.enforce_ticket_owner_admin();

DROP TRIGGER IF EXISTS trg_ticket_owner_admin ON local_service.tickets;
CREATE TRIGGER trg_ticket_owner_admin BEFORE INSERT OR DELETE OR UPDATE ON local_service.tickets FOR EACH ROW EXECUTE FUNCTION local_service.enforce_ticket_owner_admin();

SET ROLE bk01_migrator;
CREATE OR REPLACE VIEW local_service.shop_public_profile AS
 SELECT s.id,
    s.name,
    s.slug,
    s.phone,
    s.address,
    s.line_oa_id,
    s.promptpay_number,
    s.promptpay_name,
    s.require_deposit,
    s.default_deposit_amount,
        CASE
            WHEN (sub.shop_id IS NULL) THEN false
            WHEN ((sub.status)::text = ANY ((ARRAY['canceled'::character varying, 'incomplete'::character varying, 'incomplete_expired'::character varying, 'unpaid'::character varying])::text[])) THEN false
            WHEN (((sub.status)::text = 'trialing'::text) AND (COALESCE(sub.current_period_end, s.trial_ends_at) IS NULL)) THEN false
            WHEN (((sub.status)::text = 'trialing'::text) AND (COALESCE(sub.current_period_end, s.trial_ends_at) <= now())) THEN false
            WHEN ((sub.status)::text = ANY ((ARRAY['trialing'::character varying, 'active'::character varying, 'past_due'::character varying])::text[])) THEN true
            ELSE false
        END AS is_accepting_online_bookings
   FROM (local_service.shops s
     LEFT JOIN local_service.subscriptions sub ON ((sub.shop_id = s.id)))
  WHERE (s.is_active = true);;
GRANT ALL ON TABLE local_service.shop_public_profile TO bk01_migrator;
GRANT SELECT ON TABLE local_service.shop_public_profile TO anon, authenticated;
RESET ROLE;

COMMIT;
