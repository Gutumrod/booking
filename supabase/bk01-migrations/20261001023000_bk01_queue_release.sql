-- HOUSE-BK01-QUEUE-LOCK: preserve the existing GiST invariant and release only
-- pending_review rows whose full appointment interval has ended.

ALTER TABLE local_service.bookings
  ADD COLUMN queue_released_at timestamptz;

-- Normalize existing pending rows. Past appointments are released as of migration
-- time; future rows reserve through their appointment end.
UPDATE local_service.bookings
   SET expires_at = end_timestamptz,
       queue_released_at = CASE WHEN end_timestamptz <= now() THEN now() ELSE NULL END,
       updated_at = now()
 WHERE status = 'pending_review'
   AND deposit_status = 'submitted';

CREATE FUNCTION local_service_internal.bk01_assert_queue_overlap_free()
RETURNS boolean
LANGUAGE plpgsql
SET search_path = pg_catalog, local_service
AS $$
DECLARE v_conflicts uuid[];
BEGIN
  SELECT array_agg(x.id) INTO v_conflicts
  FROM (
    SELECT a.id
    FROM local_service.bookings a
    JOIN local_service.bookings b
      ON b.staff_id = a.staff_id
     AND b.id > a.id
     AND b.status IN ('hold','pending_review','confirmed')
     AND (b.status <> 'pending_review' OR b.queue_released_at IS NULL)
     AND tstzrange(b.start_timestamptz,b.end_timestamptz,'[)')
         && tstzrange(a.start_timestamptz,a.end_timestamptz,'[)')
    WHERE a.staff_id IS NOT NULL
      AND a.status IN ('hold','pending_review','confirmed')
      AND (a.status <> 'pending_review' OR a.queue_released_at IS NULL)
    ORDER BY a.id
    LIMIT 20
  ) x;
  IF v_conflicts IS NOT NULL THEN
    RAISE EXCEPTION 'Existing active booking overlaps block queue constraint migration; sample booking IDs: %', v_conflicts;
  END IF;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION local_service_internal.bk01_assert_queue_overlap_free() FROM PUBLIC;
SELECT local_service_internal.bk01_assert_queue_overlap_free();
DROP FUNCTION local_service_internal.bk01_assert_queue_overlap_free();

ALTER TABLE local_service.bookings
  DROP CONSTRAINT prevent_overlapping_staff_bookings;
ALTER TABLE local_service.bookings
  ADD CONSTRAINT prevent_overlapping_staff_bookings
  EXCLUDE USING gist (
    staff_id WITH =,
    booking_range WITH &&
  ) WHERE (
    status IN ('hold','pending_review','confirmed')
    AND queue_released_at IS NULL
  );

CREATE OR REPLACE FUNCTION local_service.bk01_pending_past_appointment_count(p_shop_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, local_service
AS $$
BEGIN
  IF local_service_internal.request_user_id() IS NULL
     OR NOT local_service.is_shop_member(p_shop_id) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Not authorized for this shop';
  END IF;
  RETURN (SELECT count(*)::integer FROM local_service.bookings
          WHERE shop_id=p_shop_id AND status='pending_review'
            AND end_timestamptz < now());
END;
$$;
REVOKE ALL ON FUNCTION local_service.bk01_pending_past_appointment_count(uuid) FROM PUBLIC,anon,service_role,bk01_runtime;
GRANT EXECUTE ON FUNCTION local_service.bk01_pending_past_appointment_count(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION local_service.trg_bk01_set_pending_review_expiry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, local_service
AS $$
BEGIN
  IF OLD.status = 'hold' AND NEW.status = 'pending_review'
     AND NEW.deposit_status = 'submitted' THEN
    NEW.expires_at := NEW.end_timestamptz;
    NEW.queue_released_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION local_service.trg_bk01_set_pending_review_expiry() FROM PUBLIC,anon,authenticated,service_role,bk01_runtime;
DROP TRIGGER IF EXISTS trg_bk01_set_pending_review_expiry ON local_service.bookings;
CREATE TRIGGER trg_bk01_set_pending_review_expiry
BEFORE UPDATE ON local_service.bookings
FOR EACH ROW EXECUTE FUNCTION local_service.trg_bk01_set_pending_review_expiry();
CREATE OR REPLACE FUNCTION local_service.create_booking_hold(p_shop_id uuid, p_service_id uuid, p_staff_id uuid DEFAULT NULL::uuid, p_customer_name varchar DEFAULT ''::varchar, p_customer_phone varchar DEFAULT ''::varchar, p_customer_email varchar DEFAULT NULL::varchar, p_booking_date date DEFAULT CURRENT_DATE, p_start_time time DEFAULT '09:00:00'::time, p_notes text DEFAULT NULL::text)
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
$function$;


REVOKE ALL ON FUNCTION local_service.create_booking_hold(uuid,uuid,uuid,varchar,varchar,varchar,date,time,text) FROM PUBLIC,anon,authenticated,service_role,bk01_runtime;
GRANT EXECUTE ON FUNCTION local_service.create_booking_hold(uuid,uuid,uuid,varchar,varchar,varchar,date,time,text) TO anon,authenticated,service_role;

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

    IF v_booking.queue_released_at IS NOT NULL THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P0001',
            MESSAGE = 'นัดผ่านแล้วและปล่อยคิวไปแล้ว / Appointment has passed and its slot was released; confirmation is unavailable. Review refund or close the booking.';
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


REVOKE ALL ON FUNCTION local_service.approve_booking_deposit(uuid) FROM PUBLIC,anon,service_role,bk01_runtime;
GRANT EXECUTE ON FUNCTION local_service.approve_booking_deposit(uuid) TO authenticated;

