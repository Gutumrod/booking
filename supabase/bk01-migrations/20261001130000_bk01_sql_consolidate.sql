-- HOUSE-BK01-SQL-CONSOLIDATE
-- Product-local SQL from ADMIN-TRUTH v2, TRIAL-REFUND v2 and NOTIFY.
-- Recipient lookup and daily email summary are held: both require auth.users,
-- which is outside the BK01 product-local migration ownership boundary. Shop
-- enqueue and event-type changes are also held until the email consumer contract
-- is wired; the current dispatcher would route shop_owner to shop.line_oa_id.

-- Default customer policy for existing shops; preserve explicit owner choices.
UPDATE local_service.shops
   SET customer_cancel_before_hours = COALESCE(customer_cancel_before_hours, 24),
       customer_reschedule_before_hours = COALESCE(customer_reschedule_before_hours, 12)
 WHERE customer_cancel_before_hours IS NULL
    OR customer_reschedule_before_hours IS NULL;

ALTER TABLE local_service.shops
  ALTER COLUMN customer_cancel_before_hours SET DEFAULT 24,
  ALTER COLUMN customer_reschedule_before_hours SET DEFAULT 12;

-- The old seven-argument RPC must not remain callable after introducing the
-- policy inputs. No defaults on the two new arguments: callers must be explicit.
DROP FUNCTION local_service.update_shop_settings(uuid,text,text,text,text,text,text);
CREATE FUNCTION local_service.update_shop_settings(
    p_shop_id uuid,
    p_name text,
    p_phone text,
    p_address text,
    p_promptpay_number text,
    p_promptpay_name text,
    p_line_oa_id text,
    p_customer_cancel_before_hours integer,
    p_customer_reschedule_before_hours integer
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, local_service
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
$function$;
REVOKE ALL ON FUNCTION local_service.update_shop_settings(uuid,text,text,text,text,text,text,integer,integer) FROM PUBLIC,anon,service_role,bk01_runtime;
GRANT EXECUTE ON FUNCTION local_service.update_shop_settings(uuid,text,text,text,text,text,text,integer,integer) TO authenticated;

-- Reject approval after the full appointment interval ended, including when
-- the queue release timestamp was not set for a legacy row.
CREATE OR REPLACE FUNCTION local_service.approve_booking_deposit(p_booking_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, local_service
AS $function$
DECLARE v_booking local_service.bookings%ROWTYPE;
BEGIN
    IF local_service_internal.request_user_id() IS NULL THEN
        RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Authentication required';
    END IF;
    SELECT * INTO v_booking FROM local_service.bookings WHERE id=p_booking_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found'; END IF;
    IF NOT local_service.is_shop_member(v_booking.shop_id) THEN
        RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Not authorized for this shop';
    END IF;
    IF v_booking.queue_released_at IS NOT NULL OR v_booking.end_timestamptz IS NULL OR v_booking.end_timestamptz <= now() THEN
        RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='Appointment has passed; confirmation is unavailable';
    END IF;
    IF v_booking.status <> 'pending_review' OR v_booking.deposit_status <> 'submitted' THEN
        RAISE EXCEPTION 'Only submitted deposit slips pending review can be approved';
    END IF;
    UPDATE local_service.bookings SET status='confirmed',deposit_status='verified',expires_at=NULL,updated_at=now() WHERE id=p_booking_id;
    RETURN json_build_object('success',true,'booking_id',p_booking_id,'status','confirmed','deposit_status','verified');
END;
$function$;
REVOKE ALL ON FUNCTION local_service.approve_booking_deposit(uuid) FROM PUBLIC,anon,service_role,bk01_runtime;
GRANT EXECUTE ON FUNCTION local_service.approve_booking_deposit(uuid) TO authenticated;

-- Appointment-targeted lazy sweep only; no scheduled/global expiration job.
CREATE OR REPLACE FUNCTION local_service.customer_reschedule_booking(
    p_booking_id uuid, p_recovery_token text, p_booking_date date,
    p_start_time time, p_reason text
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, local_service
AS $function$
DECLARE v_booking local_service.bookings%ROWTYPE; v_hours integer; v_start timestamptz; v_end timestamptz; v_row record;
BEGIN
    SELECT b, s.customer_reschedule_before_hours INTO v_row
      FROM local_service.bookings b JOIN local_service.shops s ON s.id=b.shop_id
     WHERE b.id=p_booking_id FOR UPDATE;
    IF NOT FOUND OR NOT local_service.authorize_booking_recovery_attempt(p_booking_id,p_recovery_token) THEN
        RETURN json_build_object('ok',false,'error','Invalid or expired booking recovery token');
    END IF;
    v_booking := v_row.b; v_hours := v_row.customer_reschedule_before_hours;
    IF v_hours IS NULL THEN RAISE EXCEPTION 'Customer reschedule policy is not configured'; END IF;
    IF v_booking.status <> 'confirmed' THEN RAISE EXCEPTION 'Only confirmed bookings can be rescheduled'; END IF;
    IF v_booking.start_timestamptz <= now()+make_interval(hours=>v_hours) THEN RAISE EXCEPTION 'Reschedule policy window has closed'; END IF;
    IF NULLIF(BTRIM(p_reason),'') IS NULL OR p_booking_date IS NULL OR p_start_time IS NULL THEN RAISE EXCEPTION 'Reschedule date, time and reason are required'; END IF;
    v_start := (p_booking_date || ' ' || p_start_time)::timestamp AT TIME ZONE 'Asia/Bangkok';
    v_end := v_start + make_interval(mins=>v_booking.service_duration_minutes);
    IF v_start <= now() THEN RAISE EXCEPTION 'New booking time must be in the future'; END IF;
    IF NOT EXISTS (SELECT 1 FROM local_service.staff s WHERE s.id=v_booking.staff_id AND s.shop_id=v_booking.shop_id AND s.is_active) THEN RAISE EXCEPTION 'Assigned staff is no longer active'; END IF;
    IF NOT EXISTS (
        SELECT 1 FROM local_service.staff_schedules ss
         WHERE ss.shop_id=v_booking.shop_id AND ss.staff_id=v_booking.staff_id
           AND ss.day_of_week=extract(dow FROM p_booking_date)::integer AND ss.is_working_day
           AND p_start_time>=ss.work_start AND p_start_time+make_interval(mins=>v_booking.service_duration_minutes)<=ss.work_end
           AND NOT (ss.break_start IS NOT NULL AND ss.break_end IS NOT NULL AND p_start_time<ss.break_end
                    AND p_start_time+make_interval(mins=>v_booking.service_duration_minutes)>ss.break_start)
    ) THEN RAISE EXCEPTION 'Requested time is outside staff availability'; END IF;
    IF EXISTS (SELECT 1 FROM local_service.shop_holidays h WHERE h.shop_id=v_booking.shop_id AND h.holiday_date=p_booking_date AND (h.staff_id IS NULL OR h.staff_id=v_booking.staff_id)) THEN
        RAISE EXCEPTION 'Requested date is closed';
    END IF;
    -- Expire only stale holds overlapping this requested interval for this shop/staff.
    UPDATE local_service.bookings h SET status='expired',updated_at=now()
     WHERE h.shop_id=v_booking.shop_id AND h.staff_id=v_booking.staff_id AND h.status='hold'
       AND h.expires_at IS NOT NULL AND h.expires_at<=now()
       AND h.booking_range && tstzrange(v_start,v_end,'[)');
    UPDATE local_service.bookings
       SET booking_date=p_booking_date,start_time=p_start_time,
           end_time=(p_start_time+make_interval(mins=>service_duration_minutes))::time,
           start_timestamptz=v_start,end_timestamptz=v_end,
           notes=concat_ws(E'\n',notes,'Customer reschedule: '||BTRIM(p_reason)),updated_at=now()
     WHERE id=p_booking_id;
    UPDATE local_service.line_notification_logs SET status='failed',error_message='Superseded by customer reschedule',next_retry_at=NULL
     WHERE booking_id=p_booking_id AND event_type='reminder_24h' AND status='pending';
    INSERT INTO local_service.line_notification_logs(shop_id,booking_id,event_type,recipient_type,status,idempotency_key,scheduled_for)
    VALUES(v_booking.shop_id,p_booking_id,'reminder_24h','customer','pending','reminder_24h:'||p_booking_id::text||':'||extract(epoch FROM v_start)::bigint::text,v_start-interval '24 hours')
    ON CONFLICT(idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
    INSERT INTO local_service.audit_events(shop_id,actor_type,action,target_type,target_id,metadata)
    VALUES(v_booking.shop_id,'customer','booking_rescheduled','booking',p_booking_id,jsonb_build_object('reason',BTRIM(p_reason),'new_start',v_start));
    INSERT INTO local_service.line_notification_logs(shop_id,booking_id,event_type,recipient_type,status,idempotency_key,scheduled_for)
    VALUES(v_booking.shop_id,p_booking_id,'booking_rescheduled','customer','pending','booking_rescheduled:'||p_booking_id::text||':'||extract(epoch FROM v_start)::bigint::text,now())
    ON CONFLICT(idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
    RETURN json_build_object('booking_id',p_booking_id,'status','confirmed','start_timestamptz',v_start);
END;
$function$;
REVOKE ALL ON FUNCTION local_service.customer_reschedule_booking(uuid,text,date,time,text) FROM PUBLIC,authenticated,service_role,bk01_runtime;
GRANT EXECUTE ON FUNCTION local_service.customer_reschedule_booking(uuid,text,date,time,text) TO anon;

CREATE OR REPLACE FUNCTION local_service.set_booking_outcome(p_booking_id uuid,p_outcome text,p_reason text DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, local_service
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
$function$;
REVOKE ALL ON FUNCTION local_service.set_booking_outcome(uuid,text,text) FROM PUBLIC,anon,service_role,bk01_runtime;
GRANT EXECUTE ON FUNCTION local_service.set_booking_outcome(uuid,text,text) TO authenticated;

-- B8 v2: refund marking records the shop's action; it does not transfer funds
-- and leaves enforce_booking_status_transition unchanged. Financial actions are
-- restricted to owner/admin, matching the product's refund control surface.
ALTER TABLE local_service.bookings
  ADD COLUMN refunded_at timestamptz,
  ADD COLUMN refunded_by uuid,
  ADD COLUMN refund_reference varchar(120),
  ADD COLUMN refund_note text;

CREATE FUNCTION local_service.record_deposit_refund(p_booking_id uuid,p_refund_reference text,p_note text DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, local_service
AS $function$
DECLARE v_booking local_service.bookings%ROWTYPE; v_reference text:=NULLIF(BTRIM(p_refund_reference),''); v_note text:=NULLIF(BTRIM(p_note),'');
BEGIN
    IF local_service_internal.request_user_id() IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Authentication required'; END IF;
    IF v_reference IS NULL OR length(v_reference)>120 THEN RAISE EXCEPTION 'Refund reference is required and must be at most 120 characters' USING ERRCODE='22023'; END IF;
    SELECT * INTO v_booking FROM local_service.bookings WHERE id=p_booking_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found'; END IF;
    IF NOT local_service.has_shop_role(v_booking.shop_id,ARRAY['owner','admin']::text[]) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Owner or admin role required'; END IF;
    IF v_booking.deposit_status='refunded' THEN RAISE EXCEPTION 'Deposit already recorded as refunded'; END IF;
    IF v_booking.deposit_status NOT IN ('submitted','verified') THEN RAISE EXCEPTION 'No held deposit to refund on this booking'; END IF;
    IF NOT (v_booking.status IN ('cancelled','no_show','completed') OR (v_booking.queue_released_at IS NOT NULL AND v_booking.queue_released_at<now()) OR v_booking.end_timestamptz<now()) THEN
        RAISE EXCEPTION 'Only a released queue or a booking past its appointment can be recorded as refunded';
    END IF;
    UPDATE local_service.bookings SET deposit_status='refunded',refunded_at=now(),refunded_by=local_service_internal.request_user_id(),refund_reference=v_reference,refund_note=v_note,updated_at=now() WHERE id=p_booking_id;
    INSERT INTO local_service.audit_events(shop_id,actor_user_id,actor_type,action,target_type,target_id,metadata)
    VALUES(v_booking.shop_id,local_service_internal.request_user_id(),'merchant','deposit_refunded','booking',p_booking_id,jsonb_build_object('refund_reference',v_reference,'note',v_note));
    RETURN json_build_object('success',true,'booking_id',p_booking_id,'deposit_status','refunded');
END;
$function$;
REVOKE ALL ON FUNCTION local_service.record_deposit_refund(uuid,text,text) FROM PUBLIC,anon,service_role,bk01_runtime;
GRANT EXECUTE ON FUNCTION local_service.record_deposit_refund(uuid,text,text) TO authenticated;

CREATE FUNCTION local_service.get_deposit_refund_history(p_booking_id uuid)
RETURNS TABLE(created_at timestamptz,by_user uuid,reference text,note text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, local_service
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
$function$;
REVOKE ALL ON FUNCTION local_service.get_deposit_refund_history(uuid) FROM PUBLIC,anon,service_role,bk01_runtime;
GRANT EXECUTE ON FUNCTION local_service.get_deposit_refund_history(uuid) TO authenticated;

-- Customer status lookup; a recovery token is required and no contact data is returned.
CREATE FUNCTION local_service.get_booking_status(p_booking_id uuid,p_recovery_token text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, local_service
AS $function$
DECLARE v_booking local_service.bookings%ROWTYPE;
BEGIN
    SELECT * INTO v_booking FROM local_service.bookings WHERE id=p_booking_id;
    IF NOT FOUND OR NOT local_service.authorize_booking_recovery_attempt(p_booking_id,p_recovery_token) THEN
        RETURN json_build_object('ok',false,'error','Invalid or expired booking recovery token');
    END IF;
    RETURN json_build_object('ok',true,'booking_id',v_booking.id,'status',v_booking.status,
        'deposit_status',v_booking.deposit_status,'booking_date',v_booking.booking_date,
        'start_time',v_booking.start_time,'end_time',v_booking.end_time);
END;
$function$;
REVOKE ALL ON FUNCTION local_service.get_booking_status(uuid,text) FROM PUBLIC,authenticated,service_role,bk01_runtime;
GRANT EXECUTE ON FUNCTION local_service.get_booking_status(uuid,text) TO anon;

-- B9(b): retire overdue reminders before claiming due work. Rejection-induced
-- cancellation remains the existing generic booking-closed event/message; it
-- does not claim that the customer initiated the cancellation.
CREATE OR REPLACE FUNCTION local_service.claim_due_line_notifications(p_limit integer DEFAULT 25)
RETURNS SETOF local_service.line_notification_logs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, local_service
AS $function$
BEGIN
    -- Retire overdue appointment reminders, including rows not yet due for retry.
    UPDATE local_service.line_notification_logs l SET status='failed',next_retry_at=NULL,
           error_message='Appointment has started; reminder suppressed'
      FROM local_service.bookings b
     WHERE b.id=l.booking_id AND l.status='pending'
       AND l.event_type IN ('reminder_1h','reminder_24h')
       AND (b.start_timestamptz IS NULL OR b.start_timestamptz<=now());
    RETURN QUERY
    WITH due AS (
      SELECT l.id FROM local_service.line_notification_logs l
      JOIN local_service.bookings b ON b.id=l.booking_id
      WHERE l.status='pending' AND l.scheduled_for<=now()
        AND (l.next_retry_at IS NULL OR l.next_retry_at<=now())
        AND (l.event_type NOT IN ('reminder_1h','reminder_24h') OR b.start_timestamptz>now())
        AND (l.event_type='booking_cancelled' OR b.status<>'cancelled')
      ORDER BY l.scheduled_for FOR UPDATE OF l SKIP LOCKED
      LIMIT greatest(1,least(p_limit,100))
    )
    UPDATE local_service.line_notification_logs l SET attempt_count=l.attempt_count+1,next_retry_at=now()+interval '5 minutes'
      FROM due WHERE l.id=due.id RETURNING l.*;
END;
$function$;
REVOKE ALL ON FUNCTION local_service.claim_due_line_notifications(integer) FROM PUBLIC,anon,authenticated,bk01_runtime;
GRANT EXECUTE ON FUNCTION local_service.claim_due_line_notifications(integer) TO service_role;
