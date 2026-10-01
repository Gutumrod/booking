-- Compensating rollback for 20261001130000_bk01_sql_consolidate.
-- Run only after verifying no refund records exist.
-- After success, remove this exact applied-ledger row as bk01_migrator before
-- reapplying: DELETE FROM local_service_internal.schema_migrations
-- WHERE migration_id='20261001130000_bk01_sql_consolidate';
-- Keep the 24/12 backfill: it converts formerly-unconfigured rows into the
-- product's explicit defaults and must not be reverted to NULL.
DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM local_service.bookings WHERE refunded_at IS NOT NULL OR refunded_by IS NOT NULL OR refund_reference IS NOT NULL OR refund_note IS NOT NULL) THEN
    RAISE EXCEPTION 'Rollback blocked: refund records would be discarded';
  END IF;
  IF EXISTS (SELECT 1 FROM local_service.audit_events WHERE action='deposit_refunded') THEN
    RAISE EXCEPTION 'Rollback blocked: refund audit records exist';
  END IF;
END;
$guard$;

DROP FUNCTION local_service.get_booking_status(uuid,text);
DROP FUNCTION local_service.get_deposit_refund_history(uuid);
DROP FUNCTION local_service.record_deposit_refund(uuid,text,text);
DROP TRIGGER IF EXISTS trg_enqueue_shop_deposit_notification ON local_service.bookings;
DROP FUNCTION IF EXISTS local_service.enqueue_shop_deposit_notification();
ALTER TABLE local_service.bookings DROP COLUMN refunded_at, DROP COLUMN refunded_by, DROP COLUMN refund_reference, DROP COLUMN refund_note;

-- Normalize the notification CHECK to its pre-task shape if rolling back an
-- earlier draft that had added email event values.
ALTER TABLE local_service.line_notification_logs DROP CONSTRAINT IF EXISTS line_notification_logs_event_type_check;
ALTER TABLE local_service.line_notification_logs ADD CONSTRAINT line_notification_logs_event_type_check
  CHECK(event_type IN ('booking_created','booking_rescheduled','deposit_approved','booking_cancelled','reminder_1h','reminder_24h'));

CREATE OR REPLACE FUNCTION local_service.claim_due_line_notifications(p_limit int DEFAULT 25)
RETURNS SETOF local_service.line_notification_logs
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,local_service AS $$
BEGIN
  RETURN QUERY WITH due AS (
    SELECT l.id FROM local_service.line_notification_logs l
    JOIN local_service.bookings b ON b.id=l.booking_id
    WHERE l.status='pending' AND l.scheduled_for<=now()
      AND (l.next_retry_at IS NULL OR l.next_retry_at<=now())
      AND (l.event_type='booking_cancelled' OR b.status<>'cancelled')
    ORDER BY l.scheduled_for FOR UPDATE OF l SKIP LOCKED LIMIT greatest(1,least(p_limit,100))
  )
  UPDATE local_service.line_notification_logs l SET attempt_count=l.attempt_count+1,next_retry_at=now()+interval '5 minutes'
    FROM due WHERE l.id=due.id RETURNING l.*;
END;
$$;

CREATE OR REPLACE FUNCTION local_service.customer_reschedule_booking(
  p_booking_id uuid,p_recovery_token text,p_booking_date date,p_start_time time,p_reason text
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,local_service AS $$
DECLARE v_booking local_service.bookings%rowtype; v_hours int; v_start timestamptz; v_end timestamptz; v_row record;
BEGIN
  SELECT b,s.customer_reschedule_before_hours INTO v_row FROM local_service.bookings b JOIN local_service.shops s ON s.id=b.shop_id WHERE b.id=p_booking_id FOR UPDATE;
  IF NOT FOUND OR NOT local_service.authorize_booking_recovery_attempt(p_booking_id,p_recovery_token) THEN RETURN json_build_object('ok',false,'error','Invalid or expired booking recovery token'); END IF;
  v_booking:=v_row.b; v_hours:=v_row.customer_reschedule_before_hours;
  IF v_hours IS NULL THEN RAISE EXCEPTION 'Customer reschedule policy is not configured'; END IF;
  IF v_booking.status<>'confirmed' THEN RAISE EXCEPTION 'Only confirmed bookings can be rescheduled'; END IF;
  IF v_booking.start_timestamptz<=now()+make_interval(hours=>v_hours) THEN RAISE EXCEPTION 'Reschedule policy window has closed'; END IF;
  IF NULLIF(BTRIM(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Reschedule reason is required'; END IF;
  v_start:=(p_booking_date||' '||p_start_time)::timestamp AT TIME ZONE 'Asia/Bangkok'; v_end:=v_start+make_interval(mins=>v_booking.service_duration_minutes);
  IF v_start<=now() THEN RAISE EXCEPTION 'New booking time must be in the future'; END IF;
  IF NOT EXISTS(SELECT 1 FROM local_service.staff s WHERE s.id=v_booking.staff_id AND s.shop_id=v_booking.shop_id AND s.is_active=true) THEN RAISE EXCEPTION 'Assigned staff is no longer active'; END IF;
  IF NOT EXISTS(SELECT 1 FROM local_service.staff_schedules ss WHERE ss.shop_id=v_booking.shop_id AND ss.staff_id=v_booking.staff_id AND ss.day_of_week=extract(dow FROM p_booking_date)::int AND ss.is_working_day AND p_start_time>=ss.work_start AND p_start_time+make_interval(mins=>v_booking.service_duration_minutes)<=ss.work_end AND NOT(ss.break_start IS NOT NULL AND ss.break_end IS NOT NULL AND p_start_time<ss.break_end AND p_start_time+make_interval(mins=>v_booking.service_duration_minutes)>ss.break_start)) THEN RAISE EXCEPTION 'Requested time is outside staff availability'; END IF;
  IF EXISTS(SELECT 1 FROM local_service.shop_holidays h WHERE h.shop_id=v_booking.shop_id AND h.holiday_date=p_booking_date AND (h.staff_id IS NULL OR h.staff_id=v_booking.staff_id)) THEN RAISE EXCEPTION 'Requested date is closed'; END IF;
  UPDATE local_service.bookings SET booking_date=p_booking_date,start_time=p_start_time,end_time=(p_start_time+make_interval(mins=>service_duration_minutes))::time,start_timestamptz=v_start,end_timestamptz=v_end,notes=concat_ws(E'\n',notes,'Customer reschedule: '||btrim(p_reason)),updated_at=now() WHERE id=p_booking_id;
  UPDATE local_service.line_notification_logs SET status='failed',error_message='Superseded by customer reschedule',next_retry_at=NULL WHERE booking_id=p_booking_id AND event_type='reminder_24h' AND status='pending';
  INSERT INTO local_service.line_notification_logs(shop_id,booking_id,event_type,recipient_type,status,idempotency_key,scheduled_for) VALUES(v_booking.shop_id,p_booking_id,'reminder_24h','customer','pending','reminder_24h:'||p_booking_id::text||':'||extract(epoch FROM v_start)::bigint::text,v_start-interval '24 hours') ON CONFLICT(idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
  INSERT INTO local_service.audit_events(shop_id,actor_type,action,target_type,target_id,metadata) VALUES(v_booking.shop_id,'customer','booking_rescheduled','booking',p_booking_id,jsonb_build_object('reason',btrim(p_reason),'new_start',v_start));
  INSERT INTO local_service.line_notification_logs(shop_id,booking_id,event_type,recipient_type,status,idempotency_key,scheduled_for) VALUES(v_booking.shop_id,p_booking_id,'booking_rescheduled','customer','pending','booking_rescheduled:'||p_booking_id::text||':'||extract(epoch FROM v_start)::bigint::text,now()) ON CONFLICT(idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
  RETURN json_build_object('booking_id',p_booking_id,'status','confirmed','start_timestamptz',v_start);
END; $$;
REVOKE ALL ON FUNCTION local_service.customer_reschedule_booking(uuid,text,date,time,text) FROM PUBLIC,authenticated,service_role,bk01_runtime;
GRANT EXECUTE ON FUNCTION local_service.customer_reschedule_booking(uuid,text,date,time,text) TO anon;

CREATE OR REPLACE FUNCTION local_service.set_booking_outcome(p_booking_id uuid,p_outcome text,p_reason text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,local_service AS $$
DECLARE v_booking local_service.bookings%rowtype;
BEGIN
  SELECT * INTO v_booking FROM local_service.bookings WHERE id=p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF NOT local_service.has_shop_role(v_booking.shop_id,ARRAY['owner','admin']::text[]) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Owner or admin role required'; END IF;
  IF p_outcome NOT IN ('completed','no_show') THEN RAISE EXCEPTION 'Invalid booking outcome'; END IF;
  IF v_booking.status<>'confirmed' THEN RAISE EXCEPTION 'Only confirmed bookings can receive an outcome'; END IF;
  UPDATE local_service.bookings SET status=p_outcome,updated_at=now() WHERE id=p_booking_id;
  INSERT INTO local_service.audit_events(shop_id,actor_user_id,actor_type,action,target_type,target_id,metadata) VALUES(v_booking.shop_id,local_service_internal.request_user_id(),'merchant','booking_'||p_outcome,'booking',p_booking_id,jsonb_build_object('reason',p_reason));
  RETURN json_build_object('booking_id',p_booking_id,'status',p_outcome);
END; $$;

CREATE OR REPLACE FUNCTION local_service.approve_booking_deposit(p_booking_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,local_service AS $$
DECLARE v_booking local_service.bookings%rowtype;
BEGIN
  IF local_service_internal.request_user_id() IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Authentication required'; END IF;
  SELECT * INTO v_booking FROM local_service.bookings WHERE id=p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF NOT local_service.is_shop_member(v_booking.shop_id) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Not authorized for this shop'; END IF;
  IF v_booking.queue_released_at IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='Appointment has passed and its slot was released; confirmation is unavailable.'; END IF;
  IF v_booking.status<>'pending_review' OR v_booking.deposit_status<>'submitted' THEN RAISE EXCEPTION 'Only submitted deposit slips pending review can be approved'; END IF;
  UPDATE local_service.bookings SET status='confirmed',deposit_status='verified',expires_at=NULL,updated_at=now() WHERE id=p_booking_id;
  RETURN json_build_object('success',true,'booking_id',p_booking_id,'status','confirmed','deposit_status','verified');
END; $$;
REVOKE ALL ON FUNCTION local_service.approve_booking_deposit(uuid) FROM PUBLIC,anon,service_role,bk01_runtime;
GRANT EXECUTE ON FUNCTION local_service.approve_booking_deposit(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION local_service.update_shop_settings(p_shop_id uuid,p_name text,p_phone text,p_address text,p_promptpay_number text,p_promptpay_name text,p_line_oa_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,local_service AS $$
BEGIN
  IF NOT local_service.is_shop_owner(p_shop_id) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Owner role required'; END IF;
  IF NULLIF(BTRIM(p_name),'') IS NULL THEN RAISE EXCEPTION 'Shop name is required' USING ERRCODE='22023'; END IF;
  IF NULLIF(BTRIM(p_phone),'') IS NULL THEN RAISE EXCEPTION 'Shop phone is required' USING ERRCODE='22023'; END IF;
  IF NULLIF(BTRIM(p_promptpay_number),'') IS NULL THEN RAISE EXCEPTION 'PromptPay number is required' USING ERRCODE='22023'; END IF;
  IF NULLIF(BTRIM(p_promptpay_name),'') IS NULL THEN RAISE EXCEPTION 'PromptPay account name is required' USING ERRCODE='22023'; END IF;
  UPDATE local_service.shops SET name=BTRIM(p_name),phone=BTRIM(p_phone),address=NULLIF(BTRIM(p_address),''),promptpay_number=BTRIM(p_promptpay_number),promptpay_name=BTRIM(p_promptpay_name),line_oa_id=NULLIF(BTRIM(p_line_oa_id),''),updated_at=now() WHERE id=p_shop_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Shop not found'; END IF;
END; $$;
REVOKE ALL ON FUNCTION local_service.update_shop_settings(uuid,text,text,text,text,text,text) FROM PUBLIC,anon,service_role,bk01_runtime;
GRANT EXECUTE ON FUNCTION local_service.update_shop_settings(uuid,text,text,text,text,text,text) TO authenticated;
DROP FUNCTION local_service.update_shop_settings(uuid,text,text,text,text,text,text,integer,integer);
ALTER TABLE local_service.shops ALTER COLUMN customer_cancel_before_hours DROP DEFAULT, ALTER COLUMN customer_reschedule_before_hours DROP DEFAULT;
