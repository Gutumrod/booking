-- HOUSE-BK01-SQL-GROUP67: notification entitlements, Bangkok push metering,
-- three-hour reminders, and isolated shop email notification contacts.
-- The migration runner owns the transaction; this file contains no transaction
-- control and does not touch shared schemas or local_service.shops.

-- 1. Plan configuration. Keep commercial price and sellability untouched.
ALTER TABLE local_service.entitlement_plans
    ADD COLUMN customer_reminder_push boolean NOT NULL DEFAULT true,
    ADD COLUMN customer_slip_decision_push boolean NOT NULL DEFAULT false,
    ADD COLUMN shop_email_slip boolean NOT NULL DEFAULT false,
    ADD COLUMN shop_email_booking boolean NOT NULL DEFAULT false,
    ADD COLUMN monthly_push_cap integer NOT NULL DEFAULT 50
        CHECK (monthly_push_cap > 0);

UPDATE local_service.entitlement_plans
   SET services_limit = CASE plan_code WHEN 'free' THEN 5 ELSE services_limit END,
       customer_reminder_push = true,
       customer_slip_decision_push = plan_code <> 'free',
       shop_email_slip = plan_code <> 'free',
       shop_email_booking = plan_code = 'pro_990',
       monthly_push_cap = CASE plan_code
         WHEN 'free' THEN 50 WHEN 'basic_490' THEN 600 WHEN 'pro_990' THEN 1500
         ELSE monthly_push_cap END,
       updated_at = now();

-- 2. Email addresses are isolated from public shop data and never directly
-- selectable through PostgREST. The RLS policy is defense in depth for owner
-- RPCs and future grants; no direct table grant is issued here.
CREATE TABLE local_service.shop_notification_contacts (
    shop_id uuid PRIMARY KEY REFERENCES local_service.shops(id) ON DELETE CASCADE,
    email text NOT NULL CHECK (email = btrim(email) AND email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
    verified_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE local_service.shop_notification_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE local_service.shop_notification_contacts FORCE ROW LEVEL SECURITY;
CREATE POLICY shop_notification_contacts_owner_admin
    ON local_service.shop_notification_contacts
    FOR ALL TO authenticated
    USING (local_service.has_shop_role(shop_id, ARRAY['owner','admin']::text[]))
    WITH CHECK (local_service.has_shop_role(shop_id, ARRAY['owner','admin']::text[]));
-- The SECURITY DEFINER RPCs run as the non-login migration owner. This policy
-- lets those RPCs access rows after FORCE RLS; app roles have no table grants.
CREATE POLICY shop_notification_contacts_rpc_owner
    ON local_service.shop_notification_contacts
    FOR ALL TO bk01_migrator
    USING (true)
    WITH CHECK (true);
REVOKE ALL ON TABLE local_service.shop_notification_contacts FROM PUBLIC, anon, authenticated, service_role, bk01_runtime;

CREATE FUNCTION local_service.get_shop_notification_contact(p_shop_id uuid)
RETURNS TABLE(email text, verified_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, local_service AS $$
BEGIN
    IF local_service_internal.request_user_id() IS NULL
       OR NOT local_service.has_shop_role(p_shop_id, ARRAY['owner','admin']::text[]) THEN
        RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Owner or admin role required';
    END IF;
    RETURN QUERY SELECT c.email, c.verified_at
      FROM local_service.shop_notification_contacts c WHERE c.shop_id=p_shop_id;
END;
$$;
REVOKE ALL ON FUNCTION local_service.get_shop_notification_contact(uuid) FROM PUBLIC, anon, service_role, bk01_runtime;
GRANT EXECUTE ON FUNCTION local_service.get_shop_notification_contact(uuid) TO authenticated;

-- Email is sourced only from an Auth-signed, verified email claim. The caller
-- cannot submit an arbitrary destination address.
CREATE FUNCTION local_service.set_shop_notification_contact(p_shop_id uuid)
RETURNS TABLE(email text, verified_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, local_service AS $$
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
$$;
REVOKE ALL ON FUNCTION local_service.set_shop_notification_contact(uuid) FROM PUBLIC, anon, service_role, bk01_runtime;
GRANT EXECUTE ON FUNCTION local_service.set_shop_notification_contact(uuid) TO authenticated;

-- 3. The pending notification ledger is also the idempotency ledger for shop
-- emails. Preserve legacy event values while adding the current dispatch set.
ALTER TABLE local_service.line_notification_logs
    DROP CONSTRAINT line_notification_logs_event_type_check;
ALTER TABLE local_service.line_notification_logs
    ADD CONSTRAINT line_notification_logs_event_type_check
    CHECK (event_type IN (
      'booking_created','booking_rescheduled','deposit_approved','booking_cancelled',
      'reminder_1h','reminder_24h','reminder_3h','deposit_rejected',
      'deposit_slip_decision','shop_email_slip','shop_email_booking','shop_email_slip_summary'
    ));

-- Existing pending 24-hour rows are retired, then eligible future bookings get
-- exactly one replacement reminder at start minus three hours.
UPDATE local_service.line_notification_logs
   SET status='failed', next_retry_at=NULL,
       error_message='Replaced by three-hour reminder policy'
 WHERE event_type='reminder_24h' AND status='pending';
INSERT INTO local_service.line_notification_logs(
    shop_id, booking_id, event_type, recipient_type, status,
    idempotency_key, scheduled_for
)
SELECT b.shop_id, b.id, 'reminder_3h', 'customer', 'pending',
       'reminder_3h:' || b.id::text || ':' || extract(epoch FROM b.start_timestamptz)::bigint::text,
       b.start_timestamptz - interval '3 hours'
  FROM local_service.bookings b
 WHERE b.status='confirmed' AND b.start_timestamptz > now()+interval '3 hours'
ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;

-- Rebuild this output function because PostgreSQL cannot append OUT columns
-- with CREATE OR REPLACE. Its existing bk01_runtime ACL is restored exactly.
DROP FUNCTION local_service.get_line_notification_delivery_context(uuid,integer);
CREATE FUNCTION local_service.get_line_notification_delivery_context(p_id uuid, p_attempt_count integer)
RETURNS TABLE(
    id uuid, shop_id uuid, booking_id uuid, event_type text, recipient_type text,
    attempt_count integer, line_user_id text, line_oa_id text, shop_name text,
    customer_name text, subscription_plan text, booking_date date, start_time time,
    customer_reminder_push boolean, customer_slip_decision_push boolean,
    monthly_push_cap integer, push_used_this_month integer, capped boolean,
    counting_unavailable boolean, central_breaker_open boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, local_service AS $$
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
$$;
REVOKE ALL ON FUNCTION local_service.get_line_notification_delivery_context(uuid,integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION local_service.get_line_notification_delivery_context(uuid,integer) TO bk01_runtime;

-- 4. Booking-created notification producer now schedules reminder_3h only
-- when at least three full hours remain. Plan flags gate optional channels.
-- BK01-PRESERVE-EXISTING-PUBLIC-EXECUTE: local_service.enqueue_booking_notifications()
CREATE OR REPLACE FUNCTION local_service.enqueue_booking_notifications()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, local_service AS $$
DECLARE v_plan text; v_email_booking boolean;
BEGIN
    v_plan := local_service.bk01_shop_effective_plan(NEW.shop_id);
    SELECT ep.shop_email_booking INTO v_email_booking FROM local_service.entitlement_plans ep WHERE ep.plan_code=v_plan;
    IF NEW.status='confirmed' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM 'confirmed') THEN
      INSERT INTO local_service.line_notification_logs(shop_id,booking_id,event_type,recipient_type,status,idempotency_key,scheduled_for)
      VALUES(NEW.shop_id,NEW.id,'booking_created','customer','pending','confirmation:'||NEW.id::text,now())
      ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
      IF NEW.start_timestamptz > now()+interval '3 hours' THEN
        INSERT INTO local_service.line_notification_logs(shop_id,booking_id,event_type,recipient_type,status,idempotency_key,scheduled_for)
        VALUES(NEW.shop_id,NEW.id,'reminder_3h','customer','pending',
          'reminder_3h:'||NEW.id::text||':'||extract(epoch FROM NEW.start_timestamptz)::bigint::text,
          NEW.start_timestamptz-interval '3 hours')
        ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
      END IF;
      IF COALESCE(v_email_booking,false) THEN
        INSERT INTO local_service.line_notification_logs(shop_id,booking_id,event_type,recipient_type,status,idempotency_key,scheduled_for)
        VALUES(NEW.shop_id,NEW.id,'shop_email_booking','shop_owner','pending','shop-booking:'||NEW.id::text,now())
        ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
      END IF;
    END IF;
    IF NEW.status='cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
      UPDATE local_service.line_notification_logs SET status='failed',error_message='Booking cancelled before delivery',next_retry_at=NULL
       WHERE booking_id=NEW.id AND status='pending' AND event_type IN ('reminder_1h','reminder_24h','reminder_3h');
      INSERT INTO local_service.line_notification_logs(shop_id,booking_id,event_type,recipient_type,status,idempotency_key,scheduled_for)
      VALUES(NEW.shop_id,NEW.id,'booking_cancelled','customer','pending','booking_cancelled:'||NEW.id::text,now())
      ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$;

-- Slip decision push and incoming-slip email are produced transactionally from
-- booking state transitions. No email data or customer data is copied to jobs.
CREATE FUNCTION local_service.enqueue_slip_notification_events()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, local_service AS $$
DECLARE v_plan text; v_push boolean; v_email boolean;
BEGIN
    IF NEW.deposit_status IS NOT DISTINCT FROM OLD.deposit_status THEN RETURN NEW; END IF;
    v_plan := local_service.bk01_shop_effective_plan(NEW.shop_id);
    SELECT ep.customer_slip_decision_push,ep.shop_email_slip INTO v_push,v_email
      FROM local_service.entitlement_plans ep WHERE ep.plan_code=v_plan;
    IF NEW.deposit_status='submitted' AND COALESCE(v_email,false) THEN
      INSERT INTO local_service.line_notification_logs(shop_id,booking_id,event_type,recipient_type,status,idempotency_key,scheduled_for)
      VALUES(NEW.shop_id,NEW.id,'shop_email_slip','shop_owner','pending','shop-slip:'||NEW.id::text||':'||extract(epoch FROM now())::bigint::text,now())
      ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
    ELSIF NEW.deposit_status IN ('verified','rejected') AND COALESCE(v_push,false) THEN
      INSERT INTO local_service.line_notification_logs(shop_id,booking_id,event_type,recipient_type,status,idempotency_key,scheduled_for)
      VALUES(NEW.shop_id,NEW.id,'deposit_slip_decision','customer','pending',
        'slip-decision:'||NEW.id::text||':'||NEW.deposit_status||':'||extract(epoch FROM now())::bigint::text,now())
      ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION local_service.enqueue_slip_notification_events() FROM PUBLIC, anon, authenticated, service_role, bk01_runtime;
CREATE TRIGGER trg_enqueue_slip_notification_events
AFTER UPDATE OF deposit_status ON local_service.bookings
FOR EACH ROW EXECUTE FUNCTION local_service.enqueue_slip_notification_events();

-- 5. Reschedule invalidates every pending reminder for the old appointment,
-- then creates a fresh three-hour row only when the new slot is >=3 hours away.
-- The Group5 nullable timestamps must fail closed before evaluating policy windows.
CREATE OR REPLACE FUNCTION local_service.record_deposit_refund(
    p_booking_id uuid, p_refund_reference text, p_note text DEFAULT NULL
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,local_service AS $$
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
$$;
REVOKE ALL ON FUNCTION local_service.record_deposit_refund(uuid,text,text) FROM PUBLIC,anon,service_role,bk01_runtime;
GRANT EXECUTE ON FUNCTION local_service.record_deposit_refund(uuid,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION local_service.customer_cancel_booking(p_booking_id uuid,p_recovery_token text,p_reason text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,local_service AS $$
DECLARE v_booking local_service.bookings%ROWTYPE; v_hours integer; v_row record;
BEGIN
  SELECT b,s.customer_cancel_before_hours INTO v_row FROM local_service.bookings b JOIN local_service.shops s ON s.id=b.shop_id WHERE b.id=p_booking_id FOR UPDATE;
  IF NOT FOUND OR NOT local_service.authorize_booking_recovery_attempt(p_booking_id,p_recovery_token) THEN RETURN json_build_object('ok',false,'error','Invalid or expired booking recovery token'); END IF;
  v_booking:=v_row.b; v_hours:=v_row.customer_cancel_before_hours;
  IF v_hours IS NULL THEN RAISE EXCEPTION 'Customer cancellation policy is not configured'; END IF;
  IF v_booking.status NOT IN ('hold','pending_review','confirmed') THEN RAISE EXCEPTION 'Booking is not cancellable'; END IF;
  IF v_booking.start_timestamptz IS NULL OR v_booking.start_timestamptz<=now()+make_interval(hours=>v_hours) THEN RAISE EXCEPTION 'Cancellation policy window is closed or appointment time is missing'; END IF;
  IF NULLIF(BTRIM(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Cancellation reason is required'; END IF;
  UPDATE local_service.bookings SET status='cancelled',notes=concat_ws(E'\n',notes,'Customer cancellation: '||BTRIM(p_reason)),updated_at=now() WHERE id=p_booking_id;
  INSERT INTO local_service.audit_events(shop_id,actor_type,action,target_type,target_id,metadata)
    VALUES(v_booking.shop_id,'customer','booking_cancelled','booking',p_booking_id,jsonb_build_object('reason',BTRIM(p_reason)));
  RETURN json_build_object('booking_id',p_booking_id,'status','cancelled');
END;
$$;
REVOKE ALL ON FUNCTION local_service.customer_cancel_booking(uuid,text,text) FROM PUBLIC,authenticated,service_role;
GRANT EXECUTE ON FUNCTION local_service.customer_cancel_booking(uuid,text,text) TO anon;

CREATE OR REPLACE FUNCTION local_service.customer_reschedule_booking(
    p_booking_id uuid, p_recovery_token text, p_booking_date date,
    p_start_time time, p_reason text
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, local_service AS $$
DECLARE v_booking local_service.bookings%ROWTYPE; v_hours integer; v_start timestamptz; v_end timestamptz; v_row record;
BEGIN
    SELECT b, s.customer_reschedule_before_hours INTO v_row FROM local_service.bookings b
      JOIN local_service.shops s ON s.id=b.shop_id WHERE b.id=p_booking_id FOR UPDATE;
    IF NOT FOUND OR NOT local_service.authorize_booking_recovery_attempt(p_booking_id,p_recovery_token) THEN
      RETURN json_build_object('ok',false,'error','Invalid or expired booking recovery token');
    END IF;
    v_booking:=v_row.b; v_hours:=v_row.customer_reschedule_before_hours;
    IF v_hours IS NULL THEN RAISE EXCEPTION 'Customer reschedule policy is not configured'; END IF;
    IF v_booking.status<>'confirmed' THEN RAISE EXCEPTION 'Only confirmed bookings can be rescheduled'; END IF;
    IF v_booking.start_timestamptz IS NULL OR v_booking.start_timestamptz<=now()+make_interval(hours=>v_hours) THEN RAISE EXCEPTION 'Reschedule policy window is closed or appointment time is missing'; END IF;
    IF NULLIF(BTRIM(p_reason),'') IS NULL OR p_booking_date IS NULL OR p_start_time IS NULL THEN RAISE EXCEPTION 'Reschedule date, time and reason are required'; END IF;
    v_start:=(p_booking_date||' '||p_start_time)::timestamp AT TIME ZONE 'Asia/Bangkok';
    v_end:=v_start+make_interval(mins=>v_booking.service_duration_minutes);
    IF v_start<=now() THEN RAISE EXCEPTION 'New booking time must be in the future'; END IF;
    IF NOT EXISTS(SELECT 1 FROM local_service.staff s WHERE s.id=v_booking.staff_id AND s.shop_id=v_booking.shop_id AND s.is_active) THEN RAISE EXCEPTION 'Assigned staff is no longer active'; END IF;
    IF NOT EXISTS(SELECT 1 FROM local_service.staff_schedules ss WHERE ss.shop_id=v_booking.shop_id AND ss.staff_id=v_booking.staff_id
      AND ss.day_of_week=extract(dow FROM p_booking_date)::integer AND ss.is_working_day AND p_start_time>=ss.work_start
      AND p_start_time+make_interval(mins=>v_booking.service_duration_minutes)<=ss.work_end
      AND NOT(ss.break_start IS NOT NULL AND ss.break_end IS NOT NULL AND p_start_time<ss.break_end
      AND p_start_time+make_interval(mins=>v_booking.service_duration_minutes)>ss.break_start)) THEN RAISE EXCEPTION 'Requested time is outside staff availability'; END IF;
    IF EXISTS(SELECT 1 FROM local_service.shop_holidays h WHERE h.shop_id=v_booking.shop_id AND h.holiday_date=p_booking_date AND (h.staff_id IS NULL OR h.staff_id=v_booking.staff_id)) THEN RAISE EXCEPTION 'Requested date is closed'; END IF;
    UPDATE local_service.bookings h SET status='expired',updated_at=now() WHERE h.shop_id=v_booking.shop_id AND h.staff_id=v_booking.staff_id
      AND h.status='hold' AND h.expires_at IS NOT NULL AND h.expires_at<=now() AND h.booking_range&&tstzrange(v_start,v_end,'[)');
    UPDATE local_service.bookings SET booking_date=p_booking_date,start_time=p_start_time,
      end_time=(p_start_time+make_interval(mins=>service_duration_minutes))::time,start_timestamptz=v_start,end_timestamptz=v_end,
      notes=concat_ws(E'\n',notes,'Customer reschedule: '||BTRIM(p_reason)),updated_at=now() WHERE id=p_booking_id;
    UPDATE local_service.line_notification_logs SET status='failed',error_message='Superseded by customer reschedule',next_retry_at=NULL
      WHERE booking_id=p_booking_id AND event_type IN ('reminder_1h','reminder_24h','reminder_3h') AND status='pending';
    IF v_start>now()+interval '3 hours' THEN
      INSERT INTO local_service.line_notification_logs(shop_id,booking_id,event_type,recipient_type,status,idempotency_key,scheduled_for)
      VALUES(v_booking.shop_id,p_booking_id,'reminder_3h','customer','pending',
        'reminder_3h:'||p_booking_id::text||':'||extract(epoch FROM v_start)::bigint::text,v_start-interval '3 hours')
      ON CONFLICT(idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
    END IF;
    INSERT INTO local_service.audit_events(shop_id,actor_type,action,target_type,target_id,metadata)
      VALUES(v_booking.shop_id,'customer','booking_rescheduled','booking',p_booking_id,jsonb_build_object('reason',BTRIM(p_reason),'new_start',v_start));
    INSERT INTO local_service.line_notification_logs(shop_id,booking_id,event_type,recipient_type,status,idempotency_key,scheduled_for)
      VALUES(v_booking.shop_id,p_booking_id,'booking_rescheduled','customer','pending','booking_rescheduled:'||p_booking_id::text||':'||extract(epoch FROM v_start)::bigint::text,now())
      ON CONFLICT(idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
    RETURN json_build_object('booking_id',p_booking_id,'status','confirmed','start_timestamptz',v_start);
END;
$$;
REVOKE ALL ON FUNCTION local_service.customer_reschedule_booking(uuid,text,date,time,text) FROM PUBLIC, authenticated, service_role, bk01_runtime;
GRANT EXECUTE ON FUNCTION local_service.customer_reschedule_booking(uuid,text,date,time,text) TO anon;

-- Extend overdue suppression and runtime claiming to the three-hour event.
-- BK01-PRESERVE-EXISTING-PUBLIC-EXECUTE: local_service.suppress_new_overdue_line_reminder()
CREATE OR REPLACE FUNCTION local_service.suppress_new_overdue_line_reminder()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,local_service AS $$
BEGIN
  IF NEW.event_type IN ('reminder_1h','reminder_3h','reminder_24h') AND NEW.status='pending'
     AND NEW.scheduled_for IS NOT NULL AND NEW.scheduled_for<=now() THEN RETURN NULL; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION local_service.claim_due_line_notifications(p_limit integer DEFAULT 25)
RETURNS SETOF local_service.line_notification_logs LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,local_service AS $$
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
$$;
REVOKE ALL ON FUNCTION local_service.claim_due_line_notifications(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION local_service.claim_due_line_notifications(integer) TO service_role, bk01_runtime;

-- 6. The only new bk01_runtime RPC: due shop email work, no shop input and no
-- booking/customer identifiers. A call inside a quiet window returns no work.
CREATE FUNCTION local_service.claim_due_shop_email_notifications(p_limit integer DEFAULT 25)
RETURNS TABLE(notification_id uuid, shop_id uuid, event_type text, email text,
              attempt_count integer, idempotency_key text, pending_slip_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,local_service AS $$
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
$$;
REVOKE ALL ON FUNCTION local_service.claim_due_shop_email_notifications(integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION local_service.claim_due_shop_email_notifications(integer) TO bk01_runtime;
