-- Controller room 2026-10-01T15:35Z: same RPC names, final runtime cardinality 21.
CREATE TYPE local_service.bk01_ops_alert_kind AS ENUM ('cap_unverified','quota_unreadable','breaker_open');
REVOKE ALL ON TYPE local_service.bk01_ops_alert_kind FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON TYPE local_service.bk01_ops_alert_kind TO bk01_runtime;

CREATE TABLE local_service.ops_alert_delivery_ledger(
 kind local_service.bk01_ops_alert_kind NOT NULL,
 dedupe_key text NOT NULL CHECK(length(dedupe_key)<=128),
 thai_day date NOT NULL,
 claimed_at timestamptz NOT NULL,
 lease_until timestamptz NOT NULL,
 delivered_at timestamptz,
 PRIMARY KEY(kind,dedupe_key,thai_day)
);
ALTER TABLE local_service.ops_alert_delivery_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE local_service.ops_alert_delivery_ledger FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE local_service.ops_alert_delivery_ledger FROM PUBLIC,anon,authenticated,service_role,bk01_runtime;
CREATE POLICY bk01_ops_alert_migrator ON local_service.ops_alert_delivery_ledger TO bk01_migrator USING(true) WITH CHECK(true);

DROP FUNCTION local_service.get_line_notification_delivery_context(uuid,integer);
CREATE OR REPLACE FUNCTION local_service.get_line_notification_delivery_context(p_id uuid, p_attempt_count integer)
RETURNS TABLE(
    id uuid, shop_id uuid, booking_id uuid, event_type text, recipient_type text,
    attempt_count integer, line_user_id text, line_oa_id text, shop_name text,
    customer_name text, subscription_plan text, booking_date date, start_time time,
    customer_reminder_push boolean, customer_slip_decision_push boolean,
    monthly_push_cap integer, push_used_this_month integer, capped boolean,
    counting_unavailable boolean, central_breaker_open boolean, deposit_status text
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
      l.attempt_count, CASE WHEN l.recipient_type='customer' THEN c.line_user_id::text ELSE NULL::text END, s.line_oa_id::text, s.name::text, c.name::text, sub.plan::text,
      b.booking_date, b.start_time, v_reminder, v_slip_decision, v_cap, v_used,
      (NOT v_unavailable AND v_used >= v_cap), v_unavailable, NULL::boolean, b.deposit_status::text
    FROM local_service.line_notification_logs l
    JOIN local_service.bookings b ON b.id=l.booking_id
    JOIN local_service.shops s ON s.id=l.shop_id
    JOIN local_service.customers c ON c.id=b.customer_id
    LEFT JOIN local_service.subscriptions sub ON sub.shop_id=l.shop_id
    WHERE l.id=p_id AND l.attempt_count=p_attempt_count AND l.status='pending';
END;
$$;

REVOKE ALL ON FUNCTION local_service.get_line_notification_delivery_context(uuid,integer) FROM PUBLIC,anon,authenticated,service_role,bk01_runtime;

GRANT EXECUTE ON FUNCTION local_service.get_line_notification_delivery_context(uuid,integer) TO bk01_runtime;

DROP FUNCTION local_service.claim_due_shop_email_notifications(integer);
CREATE OR REPLACE FUNCTION local_service.claim_due_shop_email_notifications(p_limit integer DEFAULT 25,
 p_alert_kind local_service.bk01_ops_alert_kind DEFAULT NULL,
 p_alert_key text DEFAULT NULL, p_delivered boolean DEFAULT NULL)
RETURNS TABLE(notification_id uuid, shop_id uuid, event_type text, email text,
              attempt_count integer, idempotency_key text, pending_slip_count integer,
              alert_claimed boolean, alert_delivered boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,local_service AS $$
#variable_conflict use_column
DECLARE v_alert local_service.ops_alert_delivery_ledger%ROWTYPE; v_claimed boolean := false; v_expected text;
 v_local timestamp := now() AT TIME ZONE 'Asia/Bangkok'; v_slot text;
BEGIN
  IF p_alert_kind IS NOT NULL OR p_alert_key IS NOT NULL OR p_delivered IS NOT NULL THEN
    IF p_alert_kind IS NULL OR p_alert_key IS NULL OR p_delivered IS NULL THEN
      RAISE EXCEPTION 'Alert kind, key and delivered must be supplied together' USING ERRCODE='22023';
    END IF;
    IF p_alert_kind IN ('quota_unreadable','breaker_open') THEN
      v_expected := p_alert_kind::text||':'||v_local::date::text;
      IF p_alert_key<>v_expected THEN RAISE EXCEPTION 'Invalid current Thai day alert key' USING ERRCODE='22023'; END IF;
    ELSE
      IF p_alert_key !~ ('^push_cap_unverified:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|-):'||v_local::date::text||'$') THEN
        RAISE EXCEPTION 'Invalid current Thai day alert key' USING ERRCODE='22023';
      END IF;
    END IF;
    -- A key holds no email/customer payload. Serialize same kind/key/day before INSERT.
    PERFORM pg_advisory_xact_lock(hashtextextended('bk01-ops-alert:'||p_alert_kind::text||':'||p_alert_key,0));
    SELECT a.* INTO v_alert FROM local_service.ops_alert_delivery_ledger a
      WHERE a.kind=p_alert_kind AND a.dedupe_key=p_alert_key AND a.thai_day=v_local::date FOR UPDATE;
    IF p_delivered THEN
      IF NOT FOUND THEN RAISE EXCEPTION 'Alert must be claimed before delivery acknowledgement' USING ERRCODE='22023'; END IF;
      UPDATE local_service.ops_alert_delivery_ledger a SET delivered_at=COALESCE(a.delivered_at,now())
        WHERE a.kind=p_alert_kind AND a.dedupe_key=p_alert_key AND a.thai_day=v_local::date;
      -- Acknowledgement never authorizes another mail send.
      RETURN QUERY SELECT NULL::uuid,NULL::uuid,'ops_alert'::text,NULL::text,NULL::integer,p_alert_key,NULL::integer,false,true;
      RETURN;
    END IF;
    IF NOT FOUND THEN
      INSERT INTO local_service.ops_alert_delivery_ledger(kind,dedupe_key,thai_day,claimed_at,lease_until)
        VALUES(p_alert_kind,p_alert_key,v_local::date,now(),now()+interval '5 minutes');
      v_claimed:=true;
    ELSIF v_alert.delivered_at IS NULL AND v_alert.lease_until<=now() THEN
      UPDATE local_service.ops_alert_delivery_ledger a SET claimed_at=now(),lease_until=now()+interval '5 minutes'
        WHERE a.kind=p_alert_kind AND a.dedupe_key=p_alert_key AND a.thai_day=v_local::date;
      v_claimed:=true;
    END IF;
    RETURN QUERY SELECT NULL::uuid,NULL::uuid,'ops_alert'::text,NULL::text,NULL::integer,p_alert_key,NULL::integer,v_claimed,v_alert.delivered_at IS NOT NULL;
    RETURN;
  END IF;
  IF (v_local::time >= time '22:00' OR v_local::time < time '08:00') THEN RETURN; END IF;
  INSERT INTO local_service.line_notification_logs(shop_id,booking_id,event_type,recipient_type,status,idempotency_key,scheduled_for)
  SELECT s.id,NULL,'shop_email_slip_summary','shop_owner','pending',
    'shop-slip-summary:'||s.id::text||':'||v_local::date::text||':'||slots.slot,
    (v_local::date + slots.at_time) AT TIME ZONE 'Asia/Bangkok'
  FROM local_service.shops s
  JOIN local_service.shop_notification_contacts c ON c.shop_id=s.id AND c.verified_at IS NOT NULL
  JOIN local_service.entitlement_plans ep ON ep.plan_code=local_service.bk01_shop_effective_plan(s.id)
  CROSS JOIN (VALUES ('09',time '09:00'),('17',time '17:00')) AS slots(slot,at_time)
  WHERE s.is_active AND ep.shop_email_slip AND v_local::time>=slots.at_time
    AND EXISTS(SELECT 1 FROM local_service.bookings b WHERE b.shop_id=s.id AND b.status='pending_review' AND b.deposit_status='submitted')
  ON CONFLICT(idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
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
    ) ELSE NULL::integer END, NULL::boolean, NULL::boolean
  FROM claimed cl JOIN local_service.shop_notification_contacts c ON c.shop_id=cl.shop_id AND c.verified_at IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION local_service.claim_due_shop_email_notifications(integer,local_service.bk01_ops_alert_kind,text,boolean) FROM PUBLIC,anon,authenticated,service_role,bk01_runtime;

GRANT EXECUTE ON FUNCTION local_service.claim_due_shop_email_notifications(integer,local_service.bk01_ops_alert_kind,text,boolean) TO bk01_runtime;
