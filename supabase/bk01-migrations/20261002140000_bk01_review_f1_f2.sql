-- Remediate opencode R1 review findings F1/F2 on top of f5fedb8 without editing shipped migrations.
CREATE OR REPLACE FUNCTION local_service.create_booking_hold(p_shop_id uuid, p_service_id uuid, p_staff_id uuid DEFAULT NULL::uuid, p_customer_name character varying DEFAULT ''::varchar, p_customer_phone character varying DEFAULT ''::varchar, p_customer_email character varying DEFAULT NULL::varchar, p_booking_date date DEFAULT CURRENT_DATE, p_start_time time without time zone DEFAULT '09:00:00'::time, p_notes text DEFAULT NULL::text)
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
    v_link_token VARCHAR(32);
    v_start_tz TIMESTAMPTZ;
    v_end_tz TIMESTAMPTZ;
    v_booking_id UUID;
    v_day_of_week INTEGER;
    v_end_time TIME;
    v_constraint_name TEXT;
    v_limits RECORD;
    v_plan TEXT;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('bk01:phone:'||p_shop_id::text||':'||btrim(p_customer_phone),0));
    IF (SELECT count(*) FROM local_service.bookings busy JOIN local_service.customers c ON c.id=busy.customer_id
      WHERE busy.shop_id=p_shop_id AND c.phone=btrim(p_customer_phone)
        AND ((busy.status='hold' AND busy.expires_at>now()) OR (busy.status='pending_review' AND busy.end_timestamptz>now())))>=3 THEN
      RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='BOOKING_PENDING_LIMIT';
    END IF;
    IF NULLIF(btrim(p_customer_name), '') IS NULL THEN
        RAISE EXCEPTION 'Customer name is required';
    END IF;
    IF NULLIF(btrim(p_customer_phone), '') IS NULL THEN
        RAISE EXCEPTION 'Customer phone is required';
    END IF;
    IF p_booking_date IS NULL OR p_booking_date < (now() AT TIME ZONE 'Asia/Bangkok')::date THEN
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
    IF p_start_time IS NULL OR v_start_tz IS NULL OR v_start_tz<=now() THEN RAISE EXCEPTION 'Booking time must be in the future'; END IF;
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
                AND b.start_timestamptz IS NOT NULL AND b.end_timestamptz IS NOT NULL AND tstzrange(b.start_timestamptz, b.end_timestamptz, '[)')
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
              AND b.start_timestamptz IS NOT NULL AND b.end_timestamptz IS NOT NULL AND tstzrange(b.start_timestamptz, b.end_timestamptz, '[)')
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
            v_end_tz+interval '7 days', p_booking_date, p_start_time, v_end_time,
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

REVOKE ALL ON FUNCTION local_service.create_booking_hold(uuid,uuid,uuid,character varying,character varying,character varying,date,time without time zone,text) FROM PUBLIC,anon,authenticated,service_role,bk01_runtime;
GRANT EXECUTE ON FUNCTION local_service.create_booking_hold(uuid,uuid,uuid,character varying,character varying,character varying,date,time without time zone,text) TO bk01_runtime;


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
      v_expected := p_alert_kind::text||':global:'||v_local::date::text;
      IF p_alert_key<>v_expected THEN RAISE EXCEPTION 'Invalid current Thai day alert key' USING ERRCODE='22023'; END IF;
    ELSE
      IF p_alert_key !~ ('^push_cap_unverified:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):'||v_local::date::text||'$')
         OR NOT EXISTS (SELECT 1 FROM local_service.shops s WHERE s.id=split_part(p_alert_key,':',2)::uuid) THEN
        RAISE EXCEPTION 'Invalid shop-scoped current Thai day alert key' USING ERRCODE='22023';
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
