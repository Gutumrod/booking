-- Snapshot of e0800ee P0 function bodies/owners/ACLs; run before P0 rollback.
DROP FUNCTION local_service.claim_due_shop_email_notifications(integer,local_service.bk01_ops_alert_kind,text,boolean);
DROP FUNCTION local_service.get_line_notification_delivery_context(uuid,integer);
DROP TABLE local_service.ops_alert_delivery_ledger;
DROP TYPE local_service.bk01_ops_alert_kind;
CREATE OR REPLACE FUNCTION local_service.claim_due_shop_email_notifications(p_limit integer DEFAULT 25)
 RETURNS TABLE(notification_id uuid, shop_id uuid, event_type text, email text, attempt_count integer, idempotency_key text, pending_slip_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'local_service'
AS $function$
#variable_conflict use_column
DECLARE v_local timestamp := now() AT TIME ZONE 'Asia/Bangkok'; v_slot text;
BEGIN
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
    ) ELSE NULL::integer END
  FROM claimed cl JOIN local_service.shop_notification_contacts c ON c.shop_id=cl.shop_id AND c.verified_at IS NOT NULL;
END;
$function$;
ALTER FUNCTION local_service.claim_due_shop_email_notifications(integer) OWNER TO bk01_migrator;
REVOKE ALL ON FUNCTION local_service.claim_due_shop_email_notifications(integer) FROM PUBLIC,anon,authenticated,service_role,bk01_runtime;
GRANT EXECUTE ON FUNCTION local_service.claim_due_shop_email_notifications(integer) TO bk01_runtime;
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
      l.attempt_count, CASE WHEN l.recipient_type='customer' THEN c.line_user_id::text ELSE NULL::text END, s.line_oa_id::text, s.name::text, c.name::text, sub.plan::text,
      b.booking_date, b.start_time, v_reminder, v_slip_decision, v_cap, v_used,
      (NOT v_unavailable AND v_used >= v_cap), v_unavailable, NULL::boolean
    FROM local_service.line_notification_logs l
    JOIN local_service.bookings b ON b.id=l.booking_id
    JOIN local_service.shops s ON s.id=l.shop_id
    JOIN local_service.customers c ON c.id=b.customer_id
    LEFT JOIN local_service.subscriptions sub ON sub.shop_id=l.shop_id
    WHERE l.id=p_id AND l.attempt_count=p_attempt_count AND l.status='pending';
END;
$function$;
ALTER FUNCTION local_service.get_line_notification_delivery_context(uuid,integer) OWNER TO bk01_migrator;
REVOKE ALL ON FUNCTION local_service.get_line_notification_delivery_context(uuid,integer) FROM PUBLIC,anon,authenticated,service_role,bk01_runtime;
GRANT EXECUTE ON FUNCTION local_service.get_line_notification_delivery_context(uuid,integer) TO bk01_runtime;
