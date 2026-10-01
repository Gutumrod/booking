-- Snapshot-derived rollback to base 37a0535, W-1 catalog-base.json. Runner owns transaction.
DROP TRIGGER trg_bk01_received_deposit ON local_service.bookings;
DROP TRIGGER trg_bk01_extend_booking_token ON local_service.bookings;
DROP TRIGGER trg_enforce_booking_quota ON local_service.bookings;
DROP TABLE local_service.deposit_money_events;
DROP VIEW local_service.shop_public_profile;
DROP VIEW local_service.bk01_shop_entitlement_status;
DROP FUNCTION local_service.bk01_public_shop_profiles();
DROP FUNCTION local_service.bk01_public_entitlement_status();
DROP FUNCTION local_service.bk01_extend_booking_token();
DROP FUNCTION local_service.bk01_record_received_deposit();
DROP FUNCTION local_service.bk01_money_events_immutable();
ALTER TABLE local_service.bookings DROP CONSTRAINT bk01_booking_times_present;
ALTER TABLE local_service.bookings DROP CONSTRAINT prevent_overlapping_staff_bookings;
ALTER TABLE local_service.bookings ADD CONSTRAINT prevent_overlapping_staff_bookings EXCLUDE USING gist(staff_id WITH =,booking_range WITH &&) WHERE(status IN ('hold','pending_review','confirmed') AND queue_released_at IS NULL);
ALTER TABLE local_service.bookings ALTER COLUMN link_token TYPE varchar(64);
DROP FUNCTION local_service.update_shop_settings(uuid,text,text,text,text,text,text,integer,integer);
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
$function$
;
CREATE OR REPLACE FUNCTION local_service.bk01_line_bind_booking_trial(p_webhook_event_id text, p_booking_code text, p_link_token text, p_line_user_id text)
 RETURNS TABLE(claimed boolean, booking_id uuid, shop_id uuid, booking_context jsonb, lease_token uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'local_service'
AS $function$
DECLARE
    v_booking local_service.bookings%rowtype;
    v_event local_service.line_webhook_events%rowtype;
    v_customer local_service.customers%rowtype;
    v_mapped_customer_id uuid;
    v_lease uuid := pg_catalog.gen_random_uuid();
    v_inserted boolean := false;
BEGIN
    IF p_webhook_event_id IS NULL OR length(p_webhook_event_id) NOT BETWEEN 1 AND 200
       OR p_booking_code IS NULL OR length(p_booking_code) NOT BETWEEN 1 AND 20
       OR p_link_token IS NULL OR length(trim(p_link_token)) <> 10
       OR p_line_user_id IS NULL OR p_line_user_id !~ '^U[0-9a-f]{32}$' THEN
        RAISE EXCEPTION 'Invalid LINE trial booking binding input';
    END IF;

    INSERT INTO local_service.line_webhook_events
      (webhook_event_id, processing_status, processing_started_at, lease_token)
    VALUES (p_webhook_event_id, 'processing', now(), v_lease)
    ON CONFLICT (webhook_event_id) DO NOTHING
    RETURNING true INTO v_inserted;

    SELECT * INTO v_event FROM local_service.line_webhook_events e
      WHERE e.webhook_event_id = p_webhook_event_id FOR UPDATE;
    IF NOT coalesce(v_inserted, false) AND (v_event.processing_status = 'processed'
       OR (v_event.processing_status = 'processing'
           AND v_event.processing_started_at >= now() - interval '5 minutes')) THEN
        RETURN QUERY SELECT false, NULL::uuid, NULL::uuid, NULL::jsonb, NULL::uuid;
        RETURN;
    END IF;

    IF v_event.processing_status = 'failed'
       OR v_event.processing_started_at < now() - interval '5 minutes' THEN
        UPDATE local_service.line_webhook_events e
           SET processing_status = 'processing', processing_started_at = now(),
               lease_token = v_lease, attempt_count = e.attempt_count + 1,
               last_error = NULL, updated_at = now()
         WHERE e.webhook_event_id = p_webhook_event_id;
    END IF;

    SELECT b.* INTO v_booking
      FROM local_service.bookings b
     WHERE b.booking_code = upper(trim(p_booking_code))
     FOR UPDATE;

    IF NOT FOUND
       OR NOT local_service.authorize_booking_recovery_attempt(v_booking.id, p_link_token) THEN
        UPDATE local_service.line_webhook_events e
           SET processing_status = 'failed', lease_token = NULL,
               last_error = 'Invalid booking link or trial channel', updated_at = now()
         WHERE e.webhook_event_id = p_webhook_event_id;
        RETURN QUERY SELECT false, NULL::uuid, NULL::uuid, NULL::jsonb, NULL::uuid;
        RETURN;
    END IF;

    IF v_booking.link_token IS DISTINCT FROM upper(trim(p_link_token))
       OR v_booking.link_token_expires_at IS NULL OR v_booking.link_token_expires_at <= now()
       OR v_booking.status NOT IN ('hold', 'pending_deposit', 'confirmed')
       OR (v_booking.status = 'hold' AND v_booking.expires_at IS NOT NULL
           AND v_booking.expires_at <= now())
       OR (v_booking.line_binding_token_used_at IS NOT NULL
           AND v_booking.line_binding_webhook_event_id IS DISTINCT FROM p_webhook_event_id)
       OR NOT EXISTS (
          SELECT 1 FROM local_service.shops s
           WHERE s.id = v_booking.shop_id AND s.is_active = true
             AND nullif(btrim(s.line_oa_id), '') IS NULL
       ) THEN
        UPDATE local_service.line_webhook_events e
           SET processing_status = 'failed', lease_token = NULL,
               last_error = 'Invalid booking link or trial channel', updated_at = now()
         WHERE e.webhook_event_id = p_webhook_event_id;
        RETURN QUERY SELECT false, NULL::uuid, NULL::uuid, NULL::jsonb, NULL::uuid;
        RETURN;
    END IF;

    IF v_event.booking_id IS NOT NULL AND v_event.booking_id IS DISTINCT FROM v_booking.id THEN
        UPDATE local_service.line_webhook_events e
           SET processing_status = 'failed', lease_token = NULL,
               last_error = 'Invalid booking link or trial channel', updated_at = now()
         WHERE e.webhook_event_id = p_webhook_event_id;
        RETURN QUERY SELECT false, NULL::uuid, NULL::uuid, NULL::jsonb, NULL::uuid;
        RETURN;
    END IF;

    SELECT c.* INTO v_customer FROM local_service.customers c
     WHERE c.id = v_booking.customer_id AND c.shop_id = v_booking.shop_id
     FOR UPDATE;
    IF NOT FOUND OR (v_customer.line_user_id IS NOT NULL
       AND v_customer.line_user_id IS DISTINCT FROM p_line_user_id) THEN
        UPDATE local_service.line_webhook_events e
           SET processing_status = 'failed', lease_token = NULL,
               last_error = 'Invalid booking link or trial channel', updated_at = now()
         WHERE e.webhook_event_id = p_webhook_event_id;
        RETURN QUERY SELECT false, NULL::uuid, NULL::uuid, NULL::jsonb, NULL::uuid;
        RETURN;
    END IF;

    SELECT lu.customer_id INTO v_mapped_customer_id
      FROM local_service.line_users lu
     WHERE lu.shop_id = v_booking.shop_id AND lu.line_user_id = p_line_user_id
     FOR UPDATE;
    IF FOUND AND v_mapped_customer_id IS DISTINCT FROM v_booking.customer_id THEN
        UPDATE local_service.line_webhook_events e
           SET processing_status = 'failed', lease_token = NULL,
               last_error = 'Invalid booking link or trial channel', updated_at = now()
         WHERE e.webhook_event_id = p_webhook_event_id;
        RETURN QUERY SELECT false, NULL::uuid, NULL::uuid, NULL::jsonb, NULL::uuid;
        RETURN;
    END IF;

    INSERT INTO local_service.line_users(shop_id, customer_id, line_user_id)
      VALUES (v_booking.shop_id, v_booking.customer_id, p_line_user_id)
      ON CONFLICT ON CONSTRAINT line_users_shop_id_line_user_id_key DO NOTHING;
    UPDATE local_service.customers c SET line_user_id = p_line_user_id
      WHERE c.id = v_booking.customer_id AND c.shop_id = v_booking.shop_id
        AND c.line_user_id IS NULL;
    UPDATE local_service.bookings b
       SET line_binding_token_used_at = coalesce(b.line_binding_token_used_at, now()),
           line_binding_webhook_event_id = coalesce(b.line_binding_webhook_event_id, p_webhook_event_id)
     WHERE b.id = v_booking.id;
    UPDATE local_service.line_webhook_events e
       SET shop_id = v_booking.shop_id, booking_id = v_booking.id,
           lease_token = v_lease, updated_at = now()
     WHERE e.webhook_event_id = p_webhook_event_id;

    RETURN QUERY SELECT true, v_booking.id, v_booking.shop_id,
      jsonb_build_object('booking_code', v_booking.booking_code,
        'booking_date', v_booking.booking_date, 'start_time', v_booking.start_time,
        'shop_name', s.name), v_lease
      FROM local_service.shops s WHERE s.id = v_booking.shop_id;
END; $function$
;
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
$function$
;
CREATE OR REPLACE FUNCTION local_service.claim_due_line_notifications(p_limit integer DEFAULT 25)
 RETURNS SETOF local_service.line_notification_logs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'local_service'
AS $function$
BEGIN
  UPDATE local_service.line_notification_logs l SET status='failed',next_retry_at=NULL,error_message='Appointment has started; reminder suppressed'
    FROM local_service.bookings b WHERE b.id=l.booking_id AND l.status='pending'
      AND l.event_type IN ('reminder_1h','reminder_3h','reminder_24h')
      AND (b.start_timestamptz IS NULL OR b.start_timestamptz<=now());
  RETURN QUERY WITH due AS (
    SELECT l.id FROM local_service.line_notification_logs l JOIN local_service.bookings b ON b.id=l.booking_id
     WHERE l.status='pending' AND l.scheduled_for<=now() AND (l.next_retry_at IS NULL OR l.next_retry_at<=now())
       AND (l.event_type NOT IN ('reminder_1h','reminder_3h','reminder_24h') OR b.start_timestamptz>now())
       AND (l.event_type='booking_cancelled' OR b.status<>'cancelled')
     ORDER BY l.scheduled_for FOR UPDATE OF l SKIP LOCKED LIMIT greatest(1,least(p_limit,100))
  ) UPDATE local_service.line_notification_logs l SET attempt_count=l.attempt_count+1,next_retry_at=now()+interval '5 minutes'
    FROM due WHERE l.id=due.id RETURNING l.*;
END;
$function$
;
CREATE OR REPLACE FUNCTION local_service.claim_due_shop_email_notifications(p_limit integer DEFAULT 25)
 RETURNS TABLE(notification_id uuid, shop_id uuid, event_type text, email text, attempt_count integer, idempotency_key text, pending_slip_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'local_service'
AS $function$
DECLARE v_local timestamp := now() AT TIME ZONE 'Asia/Bangkok'; v_slot text;
BEGIN
  IF (v_local::time >= time '22:00' OR v_local::time < time '08:00') THEN RETURN; END IF;
  IF v_local::time >= time '09:00' AND v_local::time < time '09:01' THEN v_slot:='09';
  ELSIF v_local::time >= time '17:00' AND v_local::time < time '17:01' THEN v_slot:='17';
  ELSE v_slot:=NULL; END IF;
  IF v_slot IS NOT NULL THEN
    INSERT INTO local_service.line_notification_logs(shop_id,booking_id,event_type,recipient_type,status,idempotency_key,scheduled_for)
    SELECT s.id,NULL,'shop_email_slip_summary','shop_owner','pending',
      'shop-slip-summary:'||s.id::text||':'||v_local::date::text||':'||v_slot,
      (v_local::date + (v_slot||':00')::time) AT TIME ZONE 'Asia/Bangkok'
    FROM local_service.shops s
    JOIN local_service.shop_notification_contacts c ON c.shop_id=s.id AND c.verified_at IS NOT NULL
    JOIN local_service.entitlement_plans ep ON ep.plan_code=local_service.bk01_shop_effective_plan(s.id)
    WHERE ep.shop_email_slip AND EXISTS(
      SELECT 1 FROM local_service.bookings b WHERE b.shop_id=s.id AND b.status='pending_review' AND b.deposit_status='submitted'
    )
    ON CONFLICT(idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
  END IF;
  RETURN QUERY WITH due AS (
    SELECT l.id FROM local_service.line_notification_logs l
    JOIN local_service.shop_notification_contacts c ON c.shop_id=l.shop_id AND c.verified_at IS NOT NULL
    JOIN local_service.entitlement_plans ep ON ep.plan_code=local_service.bk01_shop_effective_plan(l.shop_id)
    WHERE l.recipient_type='shop_owner' AND l.status='pending' AND l.scheduled_for<=now()
      AND (l.next_retry_at IS NULL OR l.next_retry_at<=now())
      AND ((l.event_type IN ('shop_email_slip','shop_email_slip_summary') AND ep.shop_email_slip)
        OR (l.event_type='shop_email_booking' AND ep.shop_email_booking))
    ORDER BY l.scheduled_for FOR UPDATE OF l SKIP LOCKED LIMIT greatest(1,least(p_limit,100))
  ), claimed AS (
    UPDATE local_service.line_notification_logs l SET attempt_count=l.attempt_count+1,next_retry_at=now()+interval '5 minutes'
      FROM due WHERE l.id=due.id RETURNING l.id,l.shop_id,l.event_type::text,l.attempt_count,l.idempotency_key
  )
  SELECT cl.id,cl.shop_id,cl.event_type,c.email,cl.attempt_count,cl.idempotency_key,
    CASE WHEN cl.event_type='shop_email_slip_summary' THEN (
      SELECT count(*)::integer FROM local_service.bookings b WHERE b.shop_id=cl.shop_id
       AND b.status='pending_review' AND b.deposit_status='submitted'
    ) ELSE NULL::integer END
  FROM claimed cl JOIN local_service.shop_notification_contacts c ON c.shop_id=cl.shop_id AND c.verified_at IS NOT NULL;
END;
$function$
;
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
    v_limits RECORD;
    v_plan TEXT;
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

    -- F-7: no entitlement convergence here. This is the customer-facing booking
    -- path; it must not write local_service.services and must not run the
    -- automatic restore, which would reverse a service the owner switched off.
    -- Convergence belongs to the plan-change path only (I.5).

    SELECT * INTO v_service
    FROM local_service.services
    WHERE id = p_service_id
      AND shop_id = p_shop_id
      AND is_active = true;
    IF v_service.id IS NULL THEN
        RAISE EXCEPTION 'Service not found or inactive';
    END IF;

    -- F-11: the entitlements are resolved from the EFFECTIVE plan at read time,
    -- read-only. Nothing here writes local_service.services, nothing here runs
    -- the automatic restore (I.2/I.3) — which is what keeps F-7 closed — and the
    -- entitled set is the shop's ACTIVE services ordered created_at ASC, id ASC,
    -- of which the first services_limit are inside the plan. A service the OWNER
    -- switched off is not active, so it does not consume the allowance; it is
    -- also unbookable one check above, which is why the two facts can never
    -- disagree. A shop whose 14-day trial lapsed with no plan-change call
    -- resolves to FREE here through bk01_shop_effective_plan, so its 4th service
    -- is outside the entitlement and is refused below.
    v_plan := local_service.bk01_shop_effective_plan(p_shop_id);

    IF NOT EXISTS (
        SELECT 1
          FROM local_service.bk01_entitled_service_ids(p_shop_id) AS e
         WHERE e.service_id = p_service_id
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P0001',
            MESSAGE = 'SERVICE_OUTSIDE_PLAN';
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

    UPDATE local_service.bookings
       SET queue_released_at = now(), updated_at = now()
     WHERE shop_id = p_shop_id
       AND status = 'pending_review'
       AND deposit_status = 'submitted'
       AND queue_released_at IS NULL
       AND end_timestamptz <= now()
       AND tstzrange(start_timestamptz, end_timestamptz, '[)')
           && tstzrange(v_start_tz, v_end_tz, '[)');

    v_limits := NULL;

    SELECT *
      INTO v_limits
      FROM local_service.bk01_shop_limits(p_shop_id);

    IF v_limits.plan_code IS NULL THEN
        v_deposit_required := COALESCE(v_shop.require_deposit, true);
    ELSE
        v_deposit_required := COALESCE(v_shop.require_deposit, true)
                              AND v_limits.promptpay_deposit_allowed;
    END IF;

    IF v_deposit_required THEN
        IF v_service.deposit_amount IS NOT NULL AND v_service.deposit_amount > 0 THEN
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
              FROM local_service.bk01_entitled_staff_ids(p_shop_id) AS e
              WHERE e.staff_id = st.id
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
        -- F-11: the customer-chosen staff path applies the same entitlement
        -- predicate as the auto-select path. bk01_entitled_staff_ids is the
        -- shop's ACTIVE staff ordered created_at ASC, id ASC, first staff_limit
        -- entitled; an expired trial with no plan-change call resolves to FREE
        -- (staff_limit 1) through bk01_shop_effective_plan, so the 2nd staff
        -- member is refused here.
        IF NOT EXISTS (
            SELECT 1
            FROM local_service.bk01_entitled_staff_ids(p_shop_id) AS e
            WHERE e.staff_id = v_chosen_staff_id
        ) THEN
            RAISE EXCEPTION USING
                ERRCODE = 'P0001',
                MESSAGE = 'STAFF_OUTSIDE_PLAN';
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
        IF EXISTS (
            SELECT 1
            FROM local_service.staff_schedules s
            WHERE s.staff_id = v_chosen_staff_id
              AND s.day_of_week = v_day_of_week
              AND (
                  NOT COALESCE(s.is_working_day, false)
                  OR p_start_time < s.work_start
                  OR v_end_time > s.work_end
                  OR (
                      s.break_start IS NOT NULL
                      AND s.break_end IS NOT NULL
                      AND p_start_time < s.break_end
                      AND v_end_time > s.break_start
                  )
              )
        ) THEN
            RAISE EXCEPTION 'Selected staff is outside working hours or on a break';
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
    ON CONFLICT (shop_id, phone) DO NOTHING;

    SELECT id
      INTO v_customer_id
      FROM local_service.customers
     WHERE shop_id = p_shop_id
       AND phone = btrim(p_customer_phone);

    IF v_customer_id IS NULL THEN
        RAISE EXCEPTION 'Customer record could not be created';
    END IF;

    UPDATE local_service.customers
       SET name = btrim(p_customer_name),
           email = COALESCE(p_customer_email, email)
     WHERE id = v_customer_id;

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
$function$
;
CREATE OR REPLACE FUNCTION local_service.enforce_booking_quota()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'local_service'
AS $function$
DECLARE
    v_usage local_service.entitlement_usage%ROWTYPE;
    v_plan TEXT;
    v_limits RECORD;
    v_used INTEGER;
BEGIN
    IF NEW.status IN ('pending_review', 'confirmed', 'completed', 'no_show')
       OR (
           NEW.status = 'hold'
           AND (NEW.expires_at IS NULL OR NEW.expires_at > now())
       ) THEN
        v_usage := local_service.ensure_entitlement_row(NEW.shop_id);
        v_plan := local_service.bk01_shop_effective_plan(NEW.shop_id);

        SELECT bookings_limit, staff_limit, auto_slip_limit
          INTO v_limits
          FROM local_service.get_tier_limits(v_plan);

        v_used := local_service.bk01_bookings_used_in_month(
                      NEW.shop_id, local_service.bk01_month_key(now()));

        IF v_limits.bookings_limit IS NULL THEN
            -- No booking ceiling on this plan: accept and keep measuring.
            UPDATE local_service.entitlement_usage
               SET bookings_used = v_used + 1,
                   updated_at = now()
             WHERE shop_id = NEW.shop_id;
        ELSIF v_used < v_limits.bookings_limit THEN
            UPDATE local_service.entitlement_usage
               SET bookings_used = v_used + 1,
                   updated_at = now()
             WHERE shop_id = NEW.shop_id;
        ELSIF v_usage.bookings_topup_balance > 0 THEN
            UPDATE local_service.entitlement_usage
               SET bookings_used = v_used + 1,
                   bookings_topup_balance = bookings_topup_balance - 1,
                   updated_at = now()
             WHERE shop_id = NEW.shop_id;
        ELSE
            -- Refusal is an error, never a delete.
            RAISE EXCEPTION USING
                ERRCODE = 'P0001',
                MESSAGE = 'BOOKING_QUOTA_EXCEEDED';
        END IF;
    END IF;

    RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION local_service.generate_link_token()
 RETURNS text
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
    SELECT upper(substr(replace(pg_catalog.gen_random_uuid()::text, '-', ''), 1, 10))
$function$
;
CREATE OR REPLACE FUNCTION local_service.get_deposit_refund_history(p_booking_id uuid)
 RETURNS TABLE(created_at timestamp with time zone, by_user uuid, reference text, note text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'local_service'
AS $function$
DECLARE v_shop_id uuid;
BEGIN
    IF local_service_internal.request_user_id() IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Authentication required'; END IF;
    SELECT b.shop_id INTO v_shop_id FROM local_service.bookings b WHERE b.id=p_booking_id;
    IF v_shop_id IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;
    IF NOT local_service.has_shop_role(v_shop_id,ARRAY['owner','admin']::text[]) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Owner or admin role required'; END IF;
    RETURN QUERY SELECT e.created_at,e.actor_user_id,e.metadata->>'refund_reference',e.metadata->>'note'
      FROM local_service.audit_events e WHERE e.shop_id=v_shop_id AND e.target_type='booking' AND e.target_id=p_booking_id AND e.action='deposit_refunded' ORDER BY e.created_at;
END;
$function$
;
CREATE OR REPLACE FUNCTION local_service.get_line_notification_delivery_context(p_id uuid, p_attempt_count integer)
 RETURNS TABLE(id uuid, shop_id uuid, booking_id uuid, event_type text, recipient_type text, attempt_count integer, line_user_id text, line_oa_id text, shop_name text, customer_name text, subscription_plan text, booking_date date, start_time time without time zone, customer_reminder_push boolean, customer_slip_decision_push boolean, monthly_push_cap integer, push_used_this_month integer, capped boolean, counting_unavailable boolean, central_breaker_open boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'local_service'
AS $function$
DECLARE
    v_log local_service.line_notification_logs%rowtype;
    v_plan text;
    v_cap integer;
    v_used integer;
    v_unavailable boolean := false;
    v_reminder boolean;
    v_slip_decision boolean;
BEGIN
    SELECT l.* INTO v_log FROM local_service.line_notification_logs l
     WHERE l.id=p_id AND l.attempt_count=p_attempt_count AND l.status='pending';
    IF NOT FOUND THEN RETURN; END IF;
    v_plan := local_service.bk01_shop_effective_plan(v_log.shop_id);
    SELECT ep.monthly_push_cap, ep.customer_reminder_push, ep.customer_slip_decision_push
      INTO v_cap, v_reminder, v_slip_decision
      FROM local_service.entitlement_plans ep WHERE ep.plan_code=v_plan;
    BEGIN
      SELECT count(*)::integer INTO v_used
        FROM local_service.line_notification_logs m
       WHERE m.shop_id=v_log.shop_id AND m.recipient_type='customer'
         AND m.status='sent' AND m.sent_at >= date_trunc('month', now() AT TIME ZONE 'Asia/Bangkok') AT TIME ZONE 'Asia/Bangkok'
         AND m.sent_at < (date_trunc('month', now() AT TIME ZONE 'Asia/Bangkok') + interval '1 month') AT TIME ZONE 'Asia/Bangkok'
         AND m.event_type IN ('reminder_3h','reminder_24h','deposit_rejected','deposit_slip_decision');
    EXCEPTION WHEN OTHERS THEN
      v_used := NULL;
      v_unavailable := true;
    END;
    RETURN QUERY
    SELECT l.id, l.shop_id, l.booking_id, l.event_type::text, l.recipient_type::text,
      l.attempt_count, c.line_user_id::text, s.line_oa_id::text, s.name::text, c.name::text, sub.plan::text,
      b.booking_date, b.start_time, v_reminder, v_slip_decision, v_cap, v_used,
      (NOT v_unavailable AND v_used >= v_cap), v_unavailable, NULL::boolean
    FROM local_service.line_notification_logs l
    JOIN local_service.bookings b ON b.id=l.booking_id
    JOIN local_service.shops s ON s.id=l.shop_id
    JOIN local_service.customers c ON c.id=b.customer_id
    LEFT JOIN local_service.subscriptions sub ON sub.shop_id=l.shop_id
    WHERE l.id=p_id AND l.attempt_count=p_attempt_count AND l.status='pending';
END;
$function$
;
CREATE OR REPLACE FUNCTION local_service.record_deposit_refund(p_booking_id uuid, p_refund_reference text, p_note text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'local_service'
AS $function$
DECLARE
  v_booking local_service.bookings%ROWTYPE;
  v_reference text:=NULLIF(BTRIM(p_refund_reference),'');
  v_note text:=NULLIF(BTRIM(p_note),'');
BEGIN
  IF local_service_internal.request_user_id() IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Authentication required'; END IF;
  IF v_reference IS NULL OR length(v_reference)>120 THEN RAISE EXCEPTION 'Refund reference is required and must be at most 120 characters' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_booking FROM local_service.bookings WHERE id=p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF NOT local_service.has_shop_role(v_booking.shop_id,ARRAY['owner','admin']::text[]) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Owner or admin role required'; END IF;
  IF v_booking.deposit_status='refunded' THEN RAISE EXCEPTION 'Deposit already recorded as refunded'; END IF;
  IF v_booking.deposit_status NOT IN ('submitted','verified') THEN RAISE EXCEPTION 'No held deposit to refund on this booking'; END IF;
  IF NOT (v_booking.status IN ('cancelled','no_show','completed') OR (v_booking.queue_released_at IS NOT NULL AND v_booking.queue_released_at<now()) OR (v_booking.end_timestamptz IS NOT NULL AND v_booking.end_timestamptz<now())) THEN
    RAISE EXCEPTION 'Only a released queue or a booking past its appointment can be recorded as refunded';
  END IF;
  UPDATE local_service.bookings SET deposit_status='refunded',refunded_at=now(),refunded_by=local_service_internal.request_user_id(),refund_reference=v_reference,refund_note=v_note,updated_at=now() WHERE id=p_booking_id;
  INSERT INTO local_service.audit_events(shop_id,actor_user_id,actor_type,action,target_type,target_id,metadata)
    VALUES(v_booking.shop_id,local_service_internal.request_user_id(),'merchant','deposit_refunded','booking',p_booking_id,jsonb_build_object('refund_reference',v_reference,'note',v_note));
  RETURN json_build_object('success',true,'booking_id',p_booking_id,'deposit_status','refunded');
END;
$function$
;
CREATE OR REPLACE FUNCTION local_service.set_booking_outcome(p_booking_id uuid, p_outcome text, p_reason text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'local_service'
AS $function$
DECLARE v_booking local_service.bookings%ROWTYPE;
BEGIN
    SELECT * INTO v_booking FROM local_service.bookings WHERE id=p_booking_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found'; END IF;
    IF NOT local_service.has_shop_role(v_booking.shop_id,ARRAY['owner','admin']::text[]) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Owner or admin role required'; END IF;
    IF p_outcome NOT IN ('completed','no_show') THEN RAISE EXCEPTION 'Invalid booking outcome'; END IF;
    IF v_booking.status <> 'confirmed' THEN RAISE EXCEPTION 'Only confirmed bookings can receive an outcome'; END IF;
    IF v_booking.start_timestamptz IS NULL OR (p_outcome='no_show' AND v_booking.start_timestamptz>now()) THEN RAISE EXCEPTION 'Appointment has not started'; END IF;
    UPDATE local_service.bookings SET status=p_outcome,updated_at=now() WHERE id=p_booking_id;
    INSERT INTO local_service.audit_events(shop_id,actor_user_id,actor_type,action,target_type,target_id,metadata)
    VALUES(v_booking.shop_id,local_service_internal.request_user_id(),'merchant','booking_'||p_outcome,'booking',p_booking_id,jsonb_build_object('reason',p_reason));
    RETURN json_build_object('booking_id',p_booking_id,'status',p_outcome);
END;
$function$
;
CREATE OR REPLACE FUNCTION local_service.set_shop_notification_contact(p_shop_id uuid)
 RETURNS TABLE(email text, verified_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'local_service'
AS $function$
DECLARE
    v_claims jsonb := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb;
    v_email text := NULLIF(btrim(v_claims->>'email'), '');
BEGIN
    IF local_service_internal.request_user_id() IS NULL
       OR NOT local_service.has_shop_role(p_shop_id, ARRAY['owner','admin']::text[]) THEN
        RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Owner or admin role required';
    END IF;
    IF v_claims->>'email_verified' IS DISTINCT FROM 'true'
       OR v_email IS NULL OR v_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
        RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='A verified JWT email claim is required';
    END IF;
    UPDATE local_service.shop_notification_contacts
       SET email=v_email, verified_at=now(), updated_at=now()
     WHERE shop_id=p_shop_id;
    IF NOT FOUND THEN
        INSERT INTO local_service.shop_notification_contacts(shop_id,email,verified_at)
        VALUES(p_shop_id,v_email,now());
    END IF;
    RETURN QUERY SELECT c.email, c.verified_at
      FROM local_service.shop_notification_contacts c WHERE c.shop_id=p_shop_id;
END;
$function$
;
CREATE OR REPLACE FUNCTION local_service.update_shop_settings(p_shop_id uuid, p_name text, p_phone text, p_address text, p_promptpay_number text, p_promptpay_name text, p_line_oa_id text, p_customer_cancel_before_hours integer, p_customer_reschedule_before_hours integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'local_service'
AS $function$
BEGIN
    IF NOT local_service.is_shop_owner(p_shop_id) THEN
        RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Owner role required';
    END IF;
    IF p_customer_cancel_before_hours IS NULL OR p_customer_cancel_before_hours < 0
       OR p_customer_reschedule_before_hours IS NULL OR p_customer_reschedule_before_hours < 0 THEN
        RAISE EXCEPTION 'Customer booking policy hours must be non-null and non-negative' USING ERRCODE='22023';
    END IF;
    IF NULLIF(BTRIM(p_name), '') IS NULL THEN RAISE EXCEPTION 'Shop name is required' USING ERRCODE='22023'; END IF;
    IF NULLIF(BTRIM(p_phone), '') IS NULL THEN RAISE EXCEPTION 'Shop phone is required' USING ERRCODE='22023'; END IF;
    IF NULLIF(BTRIM(p_promptpay_number), '') IS NULL THEN RAISE EXCEPTION 'PromptPay number is required' USING ERRCODE='22023'; END IF;
    IF NULLIF(BTRIM(p_promptpay_name), '') IS NULL THEN RAISE EXCEPTION 'PromptPay account name is required' USING ERRCODE='22023'; END IF;
    UPDATE local_service.shops
       SET name=BTRIM(p_name), phone=BTRIM(p_phone), address=NULLIF(BTRIM(p_address), ''),
           promptpay_number=BTRIM(p_promptpay_number), promptpay_name=BTRIM(p_promptpay_name),
           line_oa_id=NULLIF(BTRIM(p_line_oa_id), ''),
           customer_cancel_before_hours=p_customer_cancel_before_hours,
           customer_reschedule_before_hours=p_customer_reschedule_before_hours,
           updated_at=now()
     WHERE id=p_shop_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Shop not found'; END IF;
END;
$function$
;
CREATE VIEW local_service.bk01_shop_entitlement_status AS
SELECT
    svc.shop_id AS shop_id,
    'service'::TEXT AS item_kind,
    svc.id AS item_id,
    svc.name AS item_name,
    svc.is_active AS is_active,
    (svc.is_active = true
     AND svc.id IN (
         SELECT e.service_id
           FROM local_service.bk01_entitled_service_ids(svc.shop_id) AS e
     )) AS plan_entitled,
    CASE
        WHEN svc.is_active = true
             AND svc.id IN (
                 SELECT e.service_id
                   FROM local_service.bk01_entitled_service_ids(svc.shop_id) AS e
             ) THEN 'bookable'
        WHEN svc.is_active = true THEN 'plan_excluded'
        ELSE 'switched_off'
    END AS state,
    svc.entitlement_disabled AS system_disabled,
    svc.created_at AS created_at
FROM local_service.services AS svc
UNION ALL
SELECT
    st.shop_id,
    'staff'::TEXT AS item_kind,
    st.id AS item_id,
    st.name AS item_name,
    st.is_active AS is_active,
    (st.is_active = true
     AND st.id IN (
         SELECT e.staff_id
           FROM local_service.bk01_entitled_staff_ids(st.shop_id) AS e
     )) AS plan_entitled,
    CASE
        WHEN st.is_active = true
             AND st.id IN (
                 SELECT e.staff_id
                   FROM local_service.bk01_entitled_staff_ids(st.shop_id) AS e
             ) THEN 'bookable'
        WHEN st.is_active = true THEN 'plan_excluded'
        ELSE 'switched_off'
    END AS state,
    NULL::BOOLEAN AS system_disabled,
    st.created_at AS created_at
FROM local_service.staff AS st;
REVOKE ALL ON TABLE local_service.bk01_shop_entitlement_status FROM PUBLIC,anon,authenticated,service_role,bk01_runtime;
CREATE VIEW local_service.shop_public_profile AS
SELECT
    s.id,
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
        WHEN sub.shop_id IS NULL THEN false
        WHEN sub.status IN ('canceled', 'incomplete', 'incomplete_expired', 'unpaid') THEN false
        WHEN sub.status = 'trialing'
             AND COALESCE(sub.current_period_end, s.trial_ends_at) IS NULL THEN false
        WHEN local_service.bk01_shop_effective_plan(s.id) = 'free'
             AND local_service.bk01_free_bookings_ceiling() IS NOT NULL
             AND local_service.bk01_bookings_used_in_month(
                     s.id, local_service.bk01_month_key(now()))
                 >= local_service.bk01_free_bookings_ceiling() THEN false
        WHEN sub.status IN ('trialing', 'active', 'past_due') THEN true
        ELSE false
    END AS is_accepting_online_bookings
FROM local_service.shops AS s
LEFT JOIN local_service.subscriptions AS sub
    ON sub.shop_id = s.id
WHERE s.is_active = true;
REVOKE ALL ON TABLE local_service.shop_public_profile FROM PUBLIC,anon,authenticated,service_role,bk01_runtime;
DROP POLICY bk01_booking_history_read ON local_service.booking_status_history;
CREATE POLICY "Members view status history" ON local_service.booking_status_history AS PERMISSIVE FOR ALL TO PUBLIC USING (local_service.is_shop_member(( SELECT bookings.shop_id
   FROM local_service.bookings
  WHERE (bookings.id = booking_status_history.booking_id))));
CREATE POLICY "Public customers insert" ON local_service.customers AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK (true);
CREATE POLICY "Public shops viewable by everyone" ON local_service.shops AS PERMISSIVE FOR SELECT TO PUBLIC USING ((is_active = true));
CREATE TRIGGER trg_enforce_booking_quota BEFORE INSERT ON local_service.bookings FOR EACH ROW EXECUTE FUNCTION local_service.enforce_booking_quota();
REVOKE DELETE ON TABLE local_service.tickets FROM authenticated;
GRANT SELECT ON TABLE local_service.account_closure_requests TO authenticated;
GRANT SELECT ON TABLE local_service.app_business_type_starter_services TO anon;
GRANT SELECT ON TABLE local_service.app_business_types TO anon;
GRANT SELECT ON TABLE local_service.app_business_types TO authenticated;
GRANT SELECT ON TABLE local_service.audit_events TO authenticated;
GRANT SELECT ON TABLE local_service.auto_slip_attempts TO authenticated;
GRANT SELECT ON TABLE local_service.bk01_shop_entitlement_status TO anon;
GRANT SELECT ON TABLE local_service.bk01_shop_entitlement_status TO authenticated;
GRANT DELETE ON TABLE local_service.booking_status_history TO anon;
GRANT INSERT ON TABLE local_service.booking_status_history TO anon;
GRANT MAINTAIN ON TABLE local_service.booking_status_history TO anon;
GRANT REFERENCES ON TABLE local_service.booking_status_history TO anon;
GRANT SELECT ON TABLE local_service.booking_status_history TO anon;
GRANT TRIGGER ON TABLE local_service.booking_status_history TO anon;
GRANT TRUNCATE ON TABLE local_service.booking_status_history TO anon;
GRANT UPDATE ON TABLE local_service.booking_status_history TO anon;
GRANT DELETE ON TABLE local_service.booking_status_history TO authenticated;
GRANT INSERT ON TABLE local_service.booking_status_history TO authenticated;
GRANT MAINTAIN ON TABLE local_service.booking_status_history TO authenticated;
GRANT REFERENCES ON TABLE local_service.booking_status_history TO authenticated;
GRANT SELECT ON TABLE local_service.booking_status_history TO authenticated;
GRANT TRIGGER ON TABLE local_service.booking_status_history TO authenticated;
GRANT TRUNCATE ON TABLE local_service.booking_status_history TO authenticated;
GRANT UPDATE ON TABLE local_service.booking_status_history TO authenticated;
GRANT DELETE ON TABLE local_service.bookings TO anon;
GRANT MAINTAIN ON TABLE local_service.bookings TO anon;
GRANT REFERENCES ON TABLE local_service.bookings TO anon;
GRANT SELECT ON TABLE local_service.bookings TO anon;
GRANT TRIGGER ON TABLE local_service.bookings TO anon;
GRANT TRUNCATE ON TABLE local_service.bookings TO anon;
GRANT UPDATE ON TABLE local_service.bookings TO anon;
GRANT MAINTAIN ON TABLE local_service.bookings TO authenticated;
GRANT REFERENCES ON TABLE local_service.bookings TO authenticated;
GRANT SELECT ON TABLE local_service.bookings TO authenticated;
GRANT TRIGGER ON TABLE local_service.bookings TO authenticated;
GRANT TRUNCATE ON TABLE local_service.bookings TO authenticated;
GRANT DELETE ON TABLE local_service.customers TO anon;
GRANT MAINTAIN ON TABLE local_service.customers TO anon;
GRANT REFERENCES ON TABLE local_service.customers TO anon;
GRANT SELECT ON TABLE local_service.customers TO anon;
GRANT TRIGGER ON TABLE local_service.customers TO anon;
GRANT TRUNCATE ON TABLE local_service.customers TO anon;
GRANT UPDATE ON TABLE local_service.customers TO anon;
GRANT DELETE ON TABLE local_service.customers TO authenticated;
GRANT INSERT ON TABLE local_service.customers TO authenticated;
GRANT MAINTAIN ON TABLE local_service.customers TO authenticated;
GRANT REFERENCES ON TABLE local_service.customers TO authenticated;
GRANT SELECT ON TABLE local_service.customers TO authenticated;
GRANT TRIGGER ON TABLE local_service.customers TO authenticated;
GRANT TRUNCATE ON TABLE local_service.customers TO authenticated;
GRANT UPDATE ON TABLE local_service.customers TO authenticated;
GRANT DELETE ON TABLE local_service.line_notification_logs TO anon;
GRANT INSERT ON TABLE local_service.line_notification_logs TO anon;
GRANT MAINTAIN ON TABLE local_service.line_notification_logs TO anon;
GRANT REFERENCES ON TABLE local_service.line_notification_logs TO anon;
GRANT SELECT ON TABLE local_service.line_notification_logs TO anon;
GRANT TRIGGER ON TABLE local_service.line_notification_logs TO anon;
GRANT TRUNCATE ON TABLE local_service.line_notification_logs TO anon;
GRANT UPDATE ON TABLE local_service.line_notification_logs TO anon;
GRANT DELETE ON TABLE local_service.line_notification_logs TO authenticated;
GRANT INSERT ON TABLE local_service.line_notification_logs TO authenticated;
GRANT MAINTAIN ON TABLE local_service.line_notification_logs TO authenticated;
GRANT REFERENCES ON TABLE local_service.line_notification_logs TO authenticated;
GRANT SELECT ON TABLE local_service.line_notification_logs TO authenticated;
GRANT TRIGGER ON TABLE local_service.line_notification_logs TO authenticated;
GRANT TRUNCATE ON TABLE local_service.line_notification_logs TO authenticated;
GRANT UPDATE ON TABLE local_service.line_notification_logs TO authenticated;
GRANT DELETE ON TABLE local_service.line_users TO anon;
GRANT INSERT ON TABLE local_service.line_users TO anon;
GRANT MAINTAIN ON TABLE local_service.line_users TO anon;
GRANT REFERENCES ON TABLE local_service.line_users TO anon;
GRANT SELECT ON TABLE local_service.line_users TO anon;
GRANT TRIGGER ON TABLE local_service.line_users TO anon;
GRANT TRUNCATE ON TABLE local_service.line_users TO anon;
GRANT UPDATE ON TABLE local_service.line_users TO anon;
GRANT DELETE ON TABLE local_service.line_users TO authenticated;
GRANT INSERT ON TABLE local_service.line_users TO authenticated;
GRANT MAINTAIN ON TABLE local_service.line_users TO authenticated;
GRANT REFERENCES ON TABLE local_service.line_users TO authenticated;
GRANT SELECT ON TABLE local_service.line_users TO authenticated;
GRANT TRIGGER ON TABLE local_service.line_users TO authenticated;
GRANT TRUNCATE ON TABLE local_service.line_users TO authenticated;
GRANT UPDATE ON TABLE local_service.line_users TO authenticated;
GRANT DELETE ON TABLE local_service.services TO anon;
GRANT INSERT ON TABLE local_service.services TO anon;
GRANT MAINTAIN ON TABLE local_service.services TO anon;
GRANT REFERENCES ON TABLE local_service.services TO anon;
GRANT TRIGGER ON TABLE local_service.services TO anon;
GRANT TRUNCATE ON TABLE local_service.services TO anon;
GRANT UPDATE ON TABLE local_service.services TO anon;
GRANT MAINTAIN ON TABLE local_service.services TO authenticated;
GRANT REFERENCES ON TABLE local_service.services TO authenticated;
GRANT TRIGGER ON TABLE local_service.services TO authenticated;
GRANT TRUNCATE ON TABLE local_service.services TO authenticated;
GRANT DELETE ON TABLE local_service.shop_holidays TO anon;
GRANT INSERT ON TABLE local_service.shop_holidays TO anon;
GRANT MAINTAIN ON TABLE local_service.shop_holidays TO anon;
GRANT REFERENCES ON TABLE local_service.shop_holidays TO anon;
GRANT SELECT ON TABLE local_service.shop_holidays TO anon;
GRANT TRIGGER ON TABLE local_service.shop_holidays TO anon;
GRANT TRUNCATE ON TABLE local_service.shop_holidays TO anon;
GRANT UPDATE ON TABLE local_service.shop_holidays TO anon;
GRANT MAINTAIN ON TABLE local_service.shop_holidays TO authenticated;
GRANT REFERENCES ON TABLE local_service.shop_holidays TO authenticated;
GRANT SELECT ON TABLE local_service.shop_holidays TO authenticated;
GRANT TRIGGER ON TABLE local_service.shop_holidays TO authenticated;
GRANT TRUNCATE ON TABLE local_service.shop_holidays TO authenticated;
GRANT SELECT ON TABLE local_service.shop_public_profile TO anon;
GRANT SELECT ON TABLE local_service.shop_public_profile TO authenticated;
GRANT DELETE ON TABLE local_service.shop_users TO anon;
GRANT INSERT ON TABLE local_service.shop_users TO anon;
GRANT MAINTAIN ON TABLE local_service.shop_users TO anon;
GRANT REFERENCES ON TABLE local_service.shop_users TO anon;
GRANT SELECT ON TABLE local_service.shop_users TO anon;
GRANT TRIGGER ON TABLE local_service.shop_users TO anon;
GRANT TRUNCATE ON TABLE local_service.shop_users TO anon;
GRANT UPDATE ON TABLE local_service.shop_users TO anon;
GRANT DELETE ON TABLE local_service.shop_users TO authenticated;
GRANT INSERT ON TABLE local_service.shop_users TO authenticated;
GRANT MAINTAIN ON TABLE local_service.shop_users TO authenticated;
GRANT REFERENCES ON TABLE local_service.shop_users TO authenticated;
GRANT SELECT ON TABLE local_service.shop_users TO authenticated;
GRANT TRIGGER ON TABLE local_service.shop_users TO authenticated;
GRANT TRUNCATE ON TABLE local_service.shop_users TO authenticated;
GRANT UPDATE ON TABLE local_service.shop_users TO authenticated;
GRANT MAINTAIN ON TABLE local_service.shops TO anon;
GRANT REFERENCES ON TABLE local_service.shops TO anon;
GRANT TRIGGER ON TABLE local_service.shops TO anon;
GRANT TRUNCATE ON TABLE local_service.shops TO anon;
GRANT MAINTAIN ON TABLE local_service.shops TO authenticated;
GRANT REFERENCES ON TABLE local_service.shops TO authenticated;
GRANT SELECT ON TABLE local_service.shops TO authenticated;
GRANT TRIGGER ON TABLE local_service.shops TO authenticated;
GRANT TRUNCATE ON TABLE local_service.shops TO authenticated;
GRANT DELETE ON TABLE local_service.staff TO anon;
GRANT INSERT ON TABLE local_service.staff TO anon;
GRANT MAINTAIN ON TABLE local_service.staff TO anon;
GRANT REFERENCES ON TABLE local_service.staff TO anon;
GRANT TRIGGER ON TABLE local_service.staff TO anon;
GRANT TRUNCATE ON TABLE local_service.staff TO anon;
GRANT UPDATE ON TABLE local_service.staff TO anon;
GRANT MAINTAIN ON TABLE local_service.staff TO authenticated;
GRANT REFERENCES ON TABLE local_service.staff TO authenticated;
GRANT TRIGGER ON TABLE local_service.staff TO authenticated;
GRANT TRUNCATE ON TABLE local_service.staff TO authenticated;
GRANT DELETE ON TABLE local_service.staff_schedules TO anon;
GRANT INSERT ON TABLE local_service.staff_schedules TO anon;
GRANT MAINTAIN ON TABLE local_service.staff_schedules TO anon;
GRANT REFERENCES ON TABLE local_service.staff_schedules TO anon;
GRANT SELECT ON TABLE local_service.staff_schedules TO anon;
GRANT TRIGGER ON TABLE local_service.staff_schedules TO anon;
GRANT TRUNCATE ON TABLE local_service.staff_schedules TO anon;
GRANT UPDATE ON TABLE local_service.staff_schedules TO anon;
GRANT MAINTAIN ON TABLE local_service.staff_schedules TO authenticated;
GRANT REFERENCES ON TABLE local_service.staff_schedules TO authenticated;
GRANT SELECT ON TABLE local_service.staff_schedules TO authenticated;
GRANT TRIGGER ON TABLE local_service.staff_schedules TO authenticated;
GRANT TRUNCATE ON TABLE local_service.staff_schedules TO authenticated;
GRANT SELECT ON TABLE local_service.subscriptions TO authenticated;
GRANT SELECT ON TABLE local_service.ticket_timeline_entries TO authenticated;
GRANT SELECT ON TABLE local_service.tickets TO authenticated;
REVOKE ALL ON FUNCTION local_service.apply_topup(uuid,integer,integer) FROM PUBLIC,anon,authenticated,service_role,bk01_runtime;
GRANT EXECUTE ON FUNCTION local_service.apply_topup(uuid,integer,integer) TO authenticated;
REVOKE ALL ON FUNCTION local_service.bk01_line_bind_booking_trial(text,text,text,text) FROM PUBLIC,anon,authenticated,service_role,bk01_runtime;
GRANT EXECUTE ON FUNCTION local_service.bk01_line_bind_booking_trial(text,text,text,text) TO bk01_runtime;
REVOKE ALL ON FUNCTION local_service.cancel_booking(uuid,text) FROM PUBLIC,anon,authenticated,service_role,bk01_runtime;
GRANT EXECUTE ON FUNCTION local_service.cancel_booking(uuid,text) TO authenticated;
REVOKE ALL ON FUNCTION local_service.claim_due_line_notifications(integer) FROM PUBLIC,anon,authenticated,service_role,bk01_runtime;
GRANT EXECUTE ON FUNCTION local_service.claim_due_line_notifications(integer) TO service_role;
GRANT EXECUTE ON FUNCTION local_service.claim_due_line_notifications(integer) TO bk01_runtime;
REVOKE ALL ON FUNCTION local_service.claim_due_shop_email_notifications(integer) FROM PUBLIC,anon,authenticated,service_role,bk01_runtime;
GRANT EXECUTE ON FUNCTION local_service.claim_due_shop_email_notifications(integer) TO bk01_runtime;
REVOKE ALL ON FUNCTION local_service.create_booking_hold(uuid,uuid,uuid,character varying,character varying,character varying,date,time without time zone,text) FROM PUBLIC,anon,authenticated,service_role,bk01_runtime;
GRANT EXECUTE ON FUNCTION local_service.create_booking_hold(uuid,uuid,uuid,character varying,character varying,character varying,date,time without time zone,text) TO anon;
GRANT EXECUTE ON FUNCTION local_service.create_booking_hold(uuid,uuid,uuid,character varying,character varying,character varying,date,time without time zone,text) TO authenticated;
GRANT EXECUTE ON FUNCTION local_service.create_booking_hold(uuid,uuid,uuid,character varying,character varying,character varying,date,time without time zone,text) TO service_role;
REVOKE ALL ON FUNCTION local_service.enforce_booking_quota() FROM PUBLIC,anon,authenticated,service_role,bk01_runtime;
REVOKE ALL ON FUNCTION local_service.get_deposit_refund_history(uuid) FROM PUBLIC,anon,authenticated,service_role,bk01_runtime;
GRANT EXECUTE ON FUNCTION local_service.get_deposit_refund_history(uuid) TO authenticated;
REVOKE ALL ON FUNCTION local_service.get_line_notification_delivery_context(uuid,integer) FROM PUBLIC,anon,authenticated,service_role,bk01_runtime;
GRANT EXECUTE ON FUNCTION local_service.get_line_notification_delivery_context(uuid,integer) TO bk01_runtime;
REVOKE ALL ON FUNCTION local_service.record_deposit_refund(uuid,text,text) FROM PUBLIC,anon,authenticated,service_role,bk01_runtime;
GRANT EXECUTE ON FUNCTION local_service.record_deposit_refund(uuid,text,text) TO authenticated;
REVOKE ALL ON FUNCTION local_service.set_booking_outcome(uuid,text,text) FROM PUBLIC,anon,authenticated,service_role,bk01_runtime;
GRANT EXECUTE ON FUNCTION local_service.set_booking_outcome(uuid,text,text) TO authenticated;
REVOKE ALL ON FUNCTION local_service.set_shop_notification_contact(uuid) FROM PUBLIC,anon,authenticated,service_role,bk01_runtime;
GRANT EXECUTE ON FUNCTION local_service.set_shop_notification_contact(uuid) TO authenticated;
REVOKE ALL ON FUNCTION local_service.update_shop_settings(uuid,text,text,text,text,text,text,integer,integer) FROM PUBLIC,anon,authenticated,service_role,bk01_runtime;
GRANT EXECUTE ON FUNCTION local_service.update_shop_settings(uuid,text,text,text,text,text,text,integer,integer) TO authenticated;
