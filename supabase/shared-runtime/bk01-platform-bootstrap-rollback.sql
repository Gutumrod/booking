-- PLATFORM-ADMIN ROLLBACK FOR BK01 MIGRATION-BOUNDARY BOOTSTRAP ONLY.
-- Valid only before any product-local BK01 migration has been applied.
--
-- Also retires bk01_migrator_login where it exists: H2 forbids a direct product
-- database LOGIN in the shared project.
DO $bk01_rollback_guard$
DECLARE applied_count integer;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'BK01 bootstrap rollback requires postgres, got %', current_user;
  END IF;
  IF to_regclass('local_service_internal.schema_migrations') IS NOT NULL THEN
    SELECT count(*) INTO applied_count FROM local_service_internal.schema_migrations;
    IF applied_count <> 0 THEN
      RAISE EXCEPTION 'BK01 bootstrap rollback blocked: % product-local migrations already applied', applied_count;
    END IF;
  END IF;
END
$bk01_rollback_guard$;

DO $bk01_retire_product_login$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='bk01_migrator_login') THEN
    IF EXISTS (SELECT 1 FROM pg_stat_activity WHERE usename='bk01_migrator_login') THEN
      RAISE EXCEPTION 'Active bk01_migrator_login session(s); drain before retiring';
    END IF;
    EXECUTE 'REVOKE ALL ON SCHEMA local_service FROM bk01_migrator_login';
    EXECUTE 'REVOKE ALL ON SCHEMA local_service_internal FROM bk01_migrator_login';
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='bk01_migrator') THEN
      EXECUTE 'REVOKE bk01_migrator FROM bk01_migrator_login';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='bk01_runtime') THEN
      EXECUTE 'REVOKE bk01_runtime FROM bk01_migrator_login';
    END IF;
    EXECUTE 'DROP ROLE bk01_migrator_login';
  END IF;
END
$bk01_retire_product_login$;

DO $bk01_restore_rel_owners$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname, c.relkind
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='local_service' AND c.relkind IN ('r','p','v','m','S','c')
  LOOP
    CASE r.relkind
      WHEN 'r' THEN EXECUTE format('ALTER TABLE local_service.%I OWNER TO postgres', r.relname);
      WHEN 'p' THEN EXECUTE format('ALTER TABLE local_service.%I OWNER TO postgres', r.relname);
      WHEN 'v' THEN EXECUTE format('ALTER VIEW local_service.%I OWNER TO postgres', r.relname);
      WHEN 'm' THEN EXECUTE format('ALTER MATERIALIZED VIEW local_service.%I OWNER TO postgres', r.relname);
      WHEN 'S' THEN EXECUTE format('ALTER SEQUENCE local_service.%I OWNER TO postgres', r.relname);
      WHEN 'c' THEN EXECUTE format('ALTER TYPE local_service.%I OWNER TO postgres', r.relname);
    END CASE;
  END LOOP;
END
$bk01_restore_rel_owners$;

DO $bk01_restore_function_owners$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS signature
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='local_service' AND p.prokind='f'
  LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO postgres', r.signature);
  END LOOP;
END
$bk01_restore_function_owners$;

-- Restore the frozen pre-bootstrap definitions before dropping their helper schema.
-- These statements are copied from the frozen migration chain, not re-authored.
-- Verbatim definition from supabase/migrations/20260819000000_quota_staff_topup_enforcement.sql
CREATE OR REPLACE FUNCTION local_service.apply_topup(
    p_shop_id UUID,
    p_bookings_credits INTEGER DEFAULT 0,
    p_auto_slip_credits INTEGER DEFAULT 0
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, local_service
AS $$
DECLARE
    v_usage local_service.entitlement_usage%ROWTYPE;
BEGIN
    IF auth.uid() IS NULL THEN
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
$$;

-- Verbatim definition from supabase/migrations/20260807170901_phase_e2_admin_booking_actions.sql
CREATE OR REPLACE FUNCTION local_service.approve_booking_deposit(
    p_booking_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, local_service
AS $$
DECLARE
    v_booking local_service.bookings%ROWTYPE;
BEGIN
    IF auth.uid() IS NULL THEN
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
$$;

-- Verbatim definition from supabase/migrations/20260829105155_bk_a_v1_contract_remediation.sql
CREATE OR REPLACE FUNCTION local_service.audit_platform_admin_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,local_service AS $$
DECLARE v_shop_id uuid;
BEGIN
    IF auth.uid() IS NOT NULL AND local_service.is_platform_admin() THEN
        v_shop_id := CASE WHEN TG_TABLE_NAME = 'shops' THEN NEW.id ELSE nullif(to_jsonb(NEW)->>'shop_id','')::uuid END;
        INSERT INTO local_service.audit_events(
          shop_id,actor_user_id,actor_type,action,target_type,target_id,metadata
        ) VALUES (
          v_shop_id,auth.uid(),'platform','platform_admin_update',TG_TABLE_NAME,
          CASE WHEN TG_TABLE_NAME = 'shops' THEN NEW.id ELSE NEW.id END,
          jsonb_build_object('record_changed',true)
        );
    END IF;
    RETURN NEW;
END; $$;

-- Verbatim definition from supabase/migrations/20260807170901_phase_e2_admin_booking_actions.sql
CREATE OR REPLACE FUNCTION local_service.cancel_booking(
    p_booking_id UUID,
    p_reason TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, local_service
AS $$
DECLARE
    v_booking local_service.bookings%ROWTYPE;
    v_reason TEXT := NULLIF(BTRIM(p_reason), '');
BEGIN
    IF auth.uid() IS NULL THEN
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
$$;

-- Verbatim definition from supabase/migrations/20260829105155_bk_a_v1_contract_remediation.sql
CREATE OR REPLACE FUNCTION local_service.current_staff_id(p_shop_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT s.id
    FROM local_service.staff s
    JOIN local_service.shop_users su
      ON su.shop_id = s.shop_id
     AND su.user_id = s.user_id
     AND su.role = 'staff'
    WHERE s.shop_id = p_shop_id
      AND s.user_id = (SELECT auth.uid())
      AND s.is_active = true
    LIMIT 1
$$;

-- Verbatim definition from supabase/migrations/20260807051755_product_rules_v1.sql
CREATE OR REPLACE FUNCTION local_service.enforce_booking_status_transition()
RETURNS TRIGGER AS $$
DECLARE
    v_user_id UUID := auth.uid();
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Verbatim definition from supabase/migrations/20260829105155_bk_a_v1_contract_remediation.sql
CREATE OR REPLACE FUNCTION local_service.export_core_business_data(p_shop_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,local_service AS $$
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
    INSERT INTO local_service.audit_events(shop_id,actor_user_id,actor_type,action,target_type,target_id) VALUES(p_shop_id,auth.uid(),'merchant','core_data_exported','shop',p_shop_id);
    RETURN v_result;
END; $$;

-- Verbatim definition from supabase/migrations/20260807104205_phase_a_data_integrity_and_authorization.sql
CREATE OR REPLACE FUNCTION local_service.extend_booking_hold(p_booking_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, local_service
AS $$
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
    IF auth.uid() IS NULL OR NOT local_service.is_shop_member(v_booking.shop_id) THEN
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
$$;

-- Verbatim definition from supabase/migrations/20260819000000_quota_staff_topup_enforcement.sql
CREATE OR REPLACE FUNCTION local_service.get_entitlement_usage(
    p_shop_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, local_service
AS $$
DECLARE
    v_usage local_service.entitlement_usage%ROWTYPE;
    v_plan TEXT;
    v_limits RECORD;
    v_remaining_main INT;
BEGIN
    IF auth.uid() IS NULL THEN
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
$$;

-- Verbatim definition from supabase/migrations/20260807175455_phase_e3_1_services_staff_authorization.sql
CREATE OR REPLACE FUNCTION local_service.has_shop_role(
    target_shop_id UUID,
    allowed_roles TEXT[]
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, local_service
AS $$
    SELECT auth.uid() IS NOT NULL
       AND EXISTS (
            SELECT 1
              FROM local_service.shop_users
             WHERE shop_id = target_shop_id
               AND user_id = auth.uid()
               AND role = ANY(allowed_roles)
       );
$$;

-- Verbatim definition from supabase/migrations/20260813092245_platform_admin_authorization.sql
CREATE OR REPLACE FUNCTION local_service.is_platform_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, local_service
AS $$
    SELECT auth.uid() IS NOT NULL
       AND EXISTS (
            SELECT 1 FROM local_service.platform_admins WHERE user_id = auth.uid()
       );
$$;

-- Verbatim definition from supabase/migrations/20260807051615_local_service_initial_schema.sql
CREATE OR REPLACE FUNCTION local_service.is_shop_member(target_shop_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM local_service.shop_users
        WHERE shop_id = target_shop_id AND user_id = auth.uid()
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Verbatim definition from supabase/migrations/20260807161412_phase_e1_owner_auth_and_provisioning.sql
CREATE OR REPLACE FUNCTION local_service.provision_owner_shop(
    p_shop_name TEXT,
    p_shop_slug TEXT,
    p_business_category TEXT,
    p_owner_name TEXT,
    p_owner_phone TEXT,
    p_promptpay_number TEXT,
    p_promptpay_name TEXT,
    p_requested_plan TEXT,
    p_idempotency_key UUID
)
RETURNS TABLE (
    shop_id UUID,
    shop_slug TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, local_service
AS $$
DECLARE
    v_user_id UUID := auth.uid();
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
$$;

-- Verbatim definition from supabase/migrations/20260807104205_phase_a_data_integrity_and_authorization.sql
CREATE OR REPLACE FUNCTION local_service.reject_deposit_slip(
    p_booking_id UUID,
    p_reason TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, local_service
AS $$
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
    IF auth.uid() IS NULL OR NOT local_service.is_shop_member(v_booking.shop_id) THEN
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
        auth.uid(),
        COALESCE(NULLIF(btrim(p_reason), ''), 'Slip Rejected by Shop')
    );

    RETURN json_build_object(
        'success', true,
        'message', 'Slip rejected, hold reset to 15 minutes'
    );
END;
$$;

-- Verbatim definition from supabase/migrations/20260829105155_bk_a_v1_contract_remediation.sql
CREATE OR REPLACE FUNCTION local_service.request_account_closure(p_shop_id uuid,p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,local_service AS $$
DECLARE v_id uuid;
BEGIN
    IF NOT local_service.has_shop_role(p_shop_id,ARRAY['owner']::text[]) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Owner role required'; END IF;
    IF nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Closure reason is required'; END IF;
    INSERT INTO local_service.account_closure_requests(shop_id,requested_by,reason) VALUES(p_shop_id,auth.uid(),btrim(p_reason)) RETURNING id INTO v_id;
    INSERT INTO local_service.audit_events(shop_id,actor_user_id,actor_type,action,target_type,target_id) VALUES(p_shop_id,auth.uid(),'merchant','account_closure_requested','account_closure_request',v_id);
    RETURN v_id;
END; $$;

-- Verbatim definition from supabase/migrations/20260829105155_bk_a_v1_contract_remediation.sql
CREATE OR REPLACE FUNCTION local_service.set_booking_outcome(p_booking_id uuid,p_outcome text,p_reason text DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, local_service
AS $$
DECLARE v_booking local_service.bookings%rowtype;
BEGIN
    SELECT * INTO v_booking FROM local_service.bookings WHERE id=p_booking_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found'; END IF;
    IF NOT local_service.has_shop_role(v_booking.shop_id,ARRAY['owner','admin']::text[]) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Owner or admin role required'; END IF;
    IF p_outcome NOT IN ('completed','no_show') THEN RAISE EXCEPTION 'Invalid booking outcome'; END IF;
    IF v_booking.status <> 'confirmed' THEN RAISE EXCEPTION 'Only confirmed bookings can receive an outcome'; END IF;
    UPDATE local_service.bookings SET status=p_outcome,updated_at=now() WHERE id=p_booking_id;
    INSERT INTO local_service.audit_events(shop_id,actor_user_id,actor_type,action,target_type,target_id,metadata)
    VALUES(v_booking.shop_id,auth.uid(),'merchant','booking_'||p_outcome,'booking',p_booking_id,jsonb_build_object('reason',p_reason));
    RETURN json_build_object('booking_id',p_booking_id,'status',p_outcome);
END;
$$;

-- Restore search_path pins from the original hardening migration.
ALTER FUNCTION local_service.is_shop_member(UUID) SET search_path = pg_catalog, local_service;
ALTER FUNCTION local_service.enforce_booking_status_transition() SET search_path = pg_catalog, local_service;
ALTER FUNCTION local_service.extend_booking_hold(UUID) SET search_path = pg_catalog, local_service;
ALTER FUNCTION local_service.reject_deposit_slip(UUID, TEXT) SET search_path = pg_catalog, local_service;


-- Remove only the runtime boundary grants introduced by this bootstrap. The role
-- itself is pre-provisioned by House and is intentionally not dropped here.
REVOKE EXECUTE ON FUNCTION local_service.authorize_booking_recovery_attempt(uuid,text) FROM bk01_runtime;
REVOKE EXECUTE ON FUNCTION local_service.claim_due_line_notifications(integer) FROM bk01_runtime;
REVOKE EXECUTE ON FUNCTION local_service.claim_stripe_webhook_event(text,text,timestamp with time zone) FROM bk01_runtime;
REVOKE EXECUTE ON FUNCTION local_service.complete_line_notification(uuid,integer,text,timestamp with time zone,timestamp with time zone,text) FROM bk01_runtime;
REVOKE EXECUTE ON FUNCTION local_service.sync_subscription_state_bk_a(text,bigint,uuid,text,text,text,text,bigint,boolean) FROM bk01_runtime;
REVOKE USAGE ON SCHEMA local_service FROM bk01_runtime;
REVOKE bk01_runtime FROM authenticator;

ALTER SCHEMA local_service OWNER TO postgres;
DROP SCHEMA IF EXISTS local_service_internal CASCADE;

DO $bk01_drop_roles$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='bk01_migrator') THEN
    REVOKE ALL ON SCHEMA local_service FROM bk01_migrator;
    REVOKE bk01_migrator FROM postgres;
  END IF;
END
$bk01_drop_roles$;

DROP ROLE IF EXISTS bk01_migrator;
-- bk01_runtime is NOT dropped here: it is a runtime identity owned by the Data API
-- lane, not by this bootstrap.
