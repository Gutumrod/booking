-- Compensating rollback for Group67; run only on the exact local/W-1 chain.
DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM local_service.line_notification_logs WHERE event_type IN ('reminder_3h','deposit_slip_decision','shop_email_slip','shop_email_booking','shop_email_slip_summary') AND status='sent') THEN
    RAISE EXCEPTION 'Rollback blocked: Group67 notification has already been delivered';
  END IF;
END;
$guard$;

DROP TRIGGER trg_enqueue_slip_notification_events ON local_service.bookings;
DROP FUNCTION local_service.enqueue_slip_notification_events();
DROP FUNCTION local_service.claim_due_shop_email_notifications(integer);
DROP FUNCTION local_service.set_shop_notification_contact(uuid);
DROP FUNCTION local_service.get_shop_notification_contact(uuid);
DROP TABLE local_service.shop_notification_contacts;

-- Restore the Group5 refund and legacy cancellation implementations.
CREATE OR REPLACE FUNCTION local_service.record_deposit_refund(p_booking_id uuid,p_refund_reference text,p_note text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,local_service AS $function$
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

CREATE OR REPLACE FUNCTION local_service.customer_cancel_booking(p_booking_id uuid,p_recovery_token text,p_reason text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,local_service AS $$
DECLARE v_booking local_service.bookings%rowtype; v_hours int; v_row record;
BEGIN
  SELECT b,s.customer_cancel_before_hours INTO v_row FROM local_service.bookings b JOIN local_service.shops s ON s.id=b.shop_id WHERE b.id=p_booking_id FOR UPDATE;
  IF NOT FOUND OR NOT local_service.authorize_booking_recovery_attempt(p_booking_id,p_recovery_token) THEN RETURN json_build_object('ok',false,'error','Invalid or expired booking recovery token'); END IF;
  v_booking:=v_row.b; v_hours:=v_row.customer_cancel_before_hours;
  IF v_hours IS NULL THEN RAISE EXCEPTION 'Customer cancellation policy is not configured'; END IF;
  IF v_booking.status NOT IN ('hold','pending_review','confirmed') THEN RAISE EXCEPTION 'Booking is not cancellable'; END IF;
  IF v_booking.start_timestamptz<=now()+make_interval(hours=>v_hours) THEN RAISE EXCEPTION 'Cancellation policy window has closed'; END IF;
  IF NULLIF(BTRIM(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Cancellation reason is required'; END IF;
  UPDATE local_service.bookings SET status='cancelled',notes=concat_ws(E'\n',notes,'Customer cancellation: '||BTRIM(p_reason)),updated_at=now() WHERE id=p_booking_id;
  INSERT INTO local_service.audit_events(shop_id,actor_type,action,target_type,target_id,metadata)
    VALUES(v_booking.shop_id,'customer','booking_cancelled','booking',p_booking_id,jsonb_build_object('reason',BTRIM(p_reason)));
  RETURN json_build_object('booking_id',p_booking_id,'status','cancelled');
END;
$$;
REVOKE ALL ON FUNCTION local_service.customer_cancel_booking(uuid,text,text) FROM PUBLIC,authenticated,service_role;
GRANT EXECUTE ON FUNCTION local_service.customer_cancel_booking(uuid,text,text) TO anon;

DELETE FROM local_service.line_notification_logs WHERE event_type IN ('reminder_3h','deposit_slip_decision','shop_email_slip','shop_email_booking','shop_email_slip_summary');
UPDATE local_service.line_notification_logs
   SET status='pending', error_message=NULL, next_retry_at=NULL
 WHERE event_type='reminder_24h' AND error_message='Replaced by three-hour reminder policy';
INSERT INTO local_service.line_notification_logs(shop_id,booking_id,event_type,recipient_type,status,idempotency_key,scheduled_for)
SELECT b.shop_id,b.id,'reminder_24h','customer','pending','reminder_24h:'||b.id::text,b.start_timestamptz-interval '24 hours'
  FROM local_service.bookings b
 WHERE b.status='confirmed' AND b.start_timestamptz>now()+interval '24 hours'
ON CONFLICT(idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
ALTER TABLE local_service.line_notification_logs DROP CONSTRAINT line_notification_logs_event_type_check;
ALTER TABLE local_service.line_notification_logs ADD CONSTRAINT line_notification_logs_event_type_check
  CHECK(event_type IN ('booking_created','booking_rescheduled','deposit_approved','booking_cancelled','reminder_1h','reminder_24h'));
DROP FUNCTION local_service.get_line_notification_delivery_context(uuid,integer);
CREATE FUNCTION local_service.get_line_notification_delivery_context(p_id uuid, p_attempt_count integer)
RETURNS TABLE(id uuid, shop_id uuid, booking_id uuid, event_type text,
  recipient_type text, attempt_count integer, line_user_id text, line_oa_id text,
  shop_name text, customer_name text, subscription_plan text, booking_date date, start_time time)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, local_service AS $$
    SELECT l.id, l.shop_id, l.booking_id, l.event_type::text, l.recipient_type::text,
      l.attempt_count, CASE WHEN l.recipient_type='customer' THEN c.line_user_id ELSE s.line_oa_id END,
      s.line_oa_id, s.name, c.name, sub.plan, b.booking_date, b.start_time
    FROM local_service.line_notification_logs l
    JOIN local_service.bookings b ON b.id=l.booking_id
    JOIN local_service.shops s ON s.id=l.shop_id
    JOIN local_service.customers c ON c.id=b.customer_id
    LEFT JOIN local_service.subscriptions sub ON sub.shop_id=l.shop_id
    WHERE l.id=p_id AND l.attempt_count=p_attempt_count AND l.status='pending'
$$;
REVOKE ALL ON FUNCTION local_service.get_line_notification_delivery_context(uuid,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION local_service.get_line_notification_delivery_context(uuid,integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION local_service.get_line_notification_delivery_context(uuid,integer) TO bk01_runtime;
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
REVOKE ALL ON FUNCTION local_service.claim_due_line_notifications(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION local_service.claim_due_line_notifications(integer) TO service_role,bk01_runtime;
CREATE OR REPLACE FUNCTION local_service.enqueue_booking_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, local_service
AS $$
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
$$;

DROP TRIGGER IF EXISTS trg_enqueue_booking_notifications ON local_service.bookings;
CREATE TRIGGER trg_enqueue_booking_notifications
AFTER INSERT OR UPDATE OF status ON local_service.bookings
FOR EACH ROW EXECUTE FUNCTION local_service.enqueue_booking_notifications();
CREATE OR REPLACE FUNCTION local_service.suppress_new_overdue_line_reminder()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, local_service
AS $$
BEGIN
    IF NEW.event_type = 'reminder_24h'
       AND NEW.status = 'pending'
       AND NEW.scheduled_for IS NOT NULL
       AND NEW.scheduled_for <= now() THEN
        RETURN NULL;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_suppress_new_overdue_line_reminder
    ON local_service.line_notification_logs;
CREATE TRIGGER trg_suppress_new_overdue_line_reminder
BEFORE INSERT ON local_service.line_notification_logs
FOR EACH ROW
EXECUTE FUNCTION local_service.suppress_new_overdue_line_reminder();
UPDATE local_service.entitlement_plans SET services_limit=3,updated_at=now() WHERE plan_code='free';
ALTER TABLE local_service.entitlement_plans DROP COLUMN customer_reminder_push, DROP COLUMN customer_slip_decision_push,
  DROP COLUMN shop_email_slip, DROP COLUMN shop_email_booking, DROP COLUMN monthly_push_cap;
-- After this file succeeds, delete the exact applied-ledger row as bk01_migrator:
-- DELETE FROM local_service_internal.schema_migrations WHERE migration_id='20261001140000_bk01_pack_notify_group67';
