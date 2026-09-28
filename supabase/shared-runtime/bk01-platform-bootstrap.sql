-- GENERATED FILE. DO NOT EDIT DIRECTLY.
-- Platform-admin bootstrap for BK01 shared-runtime migration isolation.
-- Legacy source SHA-256: 812b4656b5fcc65d881afd1712581d7c4ba0fd37f39a35c9d7d7d6173b695f5a
-- Legacy migration count: 30
--
-- Lane B criterion (b) remediation (Owner ruling 2026-09-26):
--   * no BK01 role is a LOGIN identity; the platform operator applies product
--     migrations with `set local role bk01_migrator` inside a reviewed transaction
--     (H2: a shared project hands no product a direct database LOGIN);
--   * no BK01 object and no BK01 function depends on schema `auth`;
--   * functions were re-emitted DERIVED from the frozen legacy chain, one expression
--     substituted, security mode preserved, search_path re-pinned.
--
-- Required psql variable: :'window_valid_until' is NOT used here. This file takes no
-- variable and contains no credential.

DO $bk01_roles$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'BK01 platform bootstrap requires postgres, got %', current_user;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bk01_migrator') THEN
    CREATE ROLE bk01_migrator NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'bk01_migrator'
      AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'Existing bk01_migrator has unsafe attributes';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bk01_migrator_login') THEN
    RAISE EXCEPTION 'Retired role bk01_migrator_login is present; run the reviewed retirement step before bootstrap';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bk01_runtime') THEN
    RAISE EXCEPTION 'bk01_runtime (NOLOGIN Data API runtime role) is required before bootstrap';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'bk01_runtime'
      AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit OR rolbypassrls OR rolreplication)
  ) THEN
    RAISE EXCEPTION 'Existing bk01_runtime has unsafe attributes';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
    RAISE EXCEPTION 'authenticator is required for the bk01_runtime Data API boundary';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_auth_members m
    JOIN pg_roles member ON member.oid = m.member
    WHERE member.rolname = 'bk01_runtime'
  ) THEN
    RAISE EXCEPTION 'bk01_runtime must not be a member of another role';
  END IF;
END
$bk01_roles$;

GRANT bk01_migrator TO postgres;
GRANT bk01_runtime TO authenticator WITH INHERIT FALSE, SET TRUE;


CREATE SCHEMA IF NOT EXISTS local_service_internal AUTHORIZATION bk01_migrator;
ALTER SCHEMA local_service OWNER TO bk01_migrator;
ALTER SCHEMA local_service_internal OWNER TO bk01_migrator;
REVOKE ALL ON SCHEMA local_service_internal FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA local_service TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA local_service TO bk01_runtime;
GRANT EXECUTE ON FUNCTION local_service.authorize_booking_recovery_attempt(uuid,text) TO bk01_runtime;
GRANT EXECUTE ON FUNCTION local_service.claim_due_line_notifications(integer) TO bk01_runtime;
GRANT EXECUTE ON FUNCTION local_service.claim_stripe_webhook_event(text,text,timestamp with time zone) TO bk01_runtime;
GRANT EXECUTE ON FUNCTION local_service.complete_line_notification(uuid,integer,text,timestamp with time zone,timestamp with time zone,text) TO bk01_runtime;
GRANT EXECUTE ON FUNCTION local_service.sync_subscription_state_bk_a(text,bigint,uuid,text,text,text,text,bigint,boolean) TO bk01_runtime;

-- NO grant is taken on schema auth or schema extensions. bk01_migrator must be able to
-- prove it cannot resolve auth.*; that proof is in the guard block below.
DO $bk01_db_privileges$
BEGIN
  EXECUTE format('REVOKE CREATE ON DATABASE %I FROM bk01_migrator', current_database());
END
$bk01_db_privileges$;


-- ---------------------------------------------------------------------------
-- JWT identity helper (replaces auth.uid() for every BK01 function).
--
-- This is deliberately the SAME expression Supabase's auth.uid() uses: coalesce the
-- legacy single-claim setting with the JSON claims object, THEN cast the coalesced
-- text to uuid. Casting per branch instead would silently diverge on a malformed
-- claim ({"sub":""}) — auth.uid() raises there, so this must raise there too.
-- Nothing but pg_catalog is read, so no product function needs schema auth.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION local_service_internal.request_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $bk01_helper$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.sub', true), ''),
    (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid;
$bk01_helper$;

REVOKE ALL ON FUNCTION local_service_internal.request_user_id() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION local_service_internal.request_user_id() TO bk01_migrator;


DO $bk01_rel_owners$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname, c.relkind, pg_get_userbyid(c.relowner) AS owner_name
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'local_service' AND c.relkind IN ('r','p','v','m','S','c')
    ORDER BY c.relkind, c.relname
  LOOP
    IF r.owner_name NOT IN ('postgres', 'bk01_migrator') THEN
      RAISE EXCEPTION 'Refusing to take ownership of local_service.% from unexpected owner %', r.relname, r.owner_name;
    END IF;
    IF r.owner_name = 'postgres' THEN
      CASE r.relkind
        WHEN 'r' THEN EXECUTE format('ALTER TABLE local_service.%I OWNER TO bk01_migrator', r.relname);
        WHEN 'p' THEN EXECUTE format('ALTER TABLE local_service.%I OWNER TO bk01_migrator', r.relname);
        WHEN 'v' THEN EXECUTE format('ALTER VIEW local_service.%I OWNER TO bk01_migrator', r.relname);
        WHEN 'm' THEN EXECUTE format('ALTER MATERIALIZED VIEW local_service.%I OWNER TO bk01_migrator', r.relname);
        WHEN 'S' THEN EXECUTE format('ALTER SEQUENCE local_service.%I OWNER TO bk01_migrator', r.relname);
        WHEN 'c' THEN EXECUTE format('ALTER TYPE local_service.%I OWNER TO bk01_migrator', r.relname);
        ELSE RAISE EXCEPTION 'Unsupported local_service relation kind %', r.relkind;
      END CASE;
    END IF;
  END LOOP;
END
$bk01_rel_owners$;


-- The exception inventory below is the measured set of functions that read
-- auth.users or storage.*: they keep their original owner and are never transferred.
DO $bk01_function_owners$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid, p.oid::regprocedure::text AS signature,
      pg_get_userbyid(p.proowner) AS owner_name,
      pg_get_functiondef(p.oid) AS definition
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'local_service' AND p.prokind = 'f'
    ORDER BY p.oid::regprocedure::text
  LOOP
    IF r.owner_name NOT IN ('postgres', 'bk01_migrator') THEN
      RAISE EXCEPTION 'Refusing to take ownership of % from unexpected owner %', r.signature, r.owner_name;
    END IF;
    IF r.definition ILIKE '%auth.users%' OR r.definition ILIKE '%storage.%' THEN
      IF r.signature NOT IN (
        'local_service.link_staff_user(uuid,text)',
        'local_service.submit_deposit_slip(uuid,text,text,text)',
        'local_service.submit_deposit_slip(uuid,text,text)'
      ) THEN
        RAISE EXCEPTION 'Unregistered shared-surface function dependency: %', r.signature;
      END IF;
      CONTINUE;
    END IF;
    IF r.owner_name = 'postgres' THEN
      EXECUTE format('ALTER FUNCTION %s OWNER TO bk01_migrator', r.signature);
    END IF;
  END LOOP;
END
$bk01_function_owners$;


-- ===========================================================================
-- Lane B criterion (b) — functions derived from the frozen legacy chain, with
-- auth.uid() replaced by local_service_internal.request_user_id().
--
-- Ordering is deliberate and measured: ownership is transferred FIRST ($bk01_function_owners$),
-- then the definition is replaced here. CREATE OR REPLACE preserves the owner and the
-- ACL, and the session legitimately holds replace authority because the bootstrap takes
-- `GRANT bk01_migrator TO postgres`. Doing it the other way round would have the
-- ownership pass re-own a definition that still resolves schema auth.
--
-- 16 function identities, each with its original security mode and an
-- explicit search_path (CREATE OR REPLACE resets a previous ALTER FUNCTION pin).
-- ===========================================================================
-- Rewritten from the frozen chain: supabase/migrations/20260819000000_quota_staff_topup_enforcement.sql
-- Change: auth.uid() -> local_service_internal.request_user_id() (schema auth is not reachable from bk01_migrator)
-- Preserved: RETURNS, LANGUAGE plpgsql, security mode, volatility.
-- search_path is re-pinned explicitly: CREATE OR REPLACE FUNCTION resets an ALTER FUNCTION pin.
create or replace function local_service.apply_topup(p_shop_id UUID,
    p_bookings_credits INTEGER DEFAULT 0,
    p_auto_slip_credits INTEGER DEFAULT 0)
returns JSON
language plpgsql
security definer
set search_path = pg_catalog, local_service
as $bk01$

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
$bk01$;

-- Rewritten from the frozen chain: supabase/migrations/20260807170901_phase_e2_admin_booking_actions.sql
-- Change: auth.uid() -> local_service_internal.request_user_id() (schema auth is not reachable from bk01_migrator)
-- Preserved: RETURNS, LANGUAGE plpgsql, security mode, volatility.
-- search_path is re-pinned explicitly: CREATE OR REPLACE FUNCTION resets an ALTER FUNCTION pin.
create or replace function local_service.approve_booking_deposit(p_booking_id UUID)
returns JSON
language plpgsql
security definer
set search_path = pg_catalog, local_service
as $bk01$

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
$bk01$;

-- Rewritten from the frozen chain: supabase/migrations/20260829105155_bk_a_v1_contract_remediation.sql
-- Change: auth.uid() -> local_service_internal.request_user_id() (schema auth is not reachable from bk01_migrator)
-- Preserved: RETURNS, LANGUAGE plpgsql, security mode, volatility.
-- search_path is re-pinned explicitly: CREATE OR REPLACE FUNCTION resets an ALTER FUNCTION pin.
create or replace function local_service.audit_platform_admin_update()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, local_service
as $bk01$

DECLARE v_shop_id uuid;
BEGIN
    IF local_service_internal.request_user_id() IS NOT NULL AND local_service.is_platform_admin() THEN
        v_shop_id := CASE WHEN TG_TABLE_NAME = 'shops' THEN NEW.id ELSE nullif(to_jsonb(NEW)->>'shop_id','')::uuid END;
        INSERT INTO local_service.audit_events(
          shop_id,actor_user_id,actor_type,action,target_type,target_id,metadata
        ) VALUES (
          v_shop_id,local_service_internal.request_user_id(),'platform','platform_admin_update',TG_TABLE_NAME,
          CASE WHEN TG_TABLE_NAME = 'shops' THEN NEW.id ELSE NEW.id END,
          jsonb_build_object('record_changed',true)
        );
    END IF;
    RETURN NEW;
END;
$bk01$;

-- Rewritten from the frozen chain: supabase/migrations/20260807170901_phase_e2_admin_booking_actions.sql
-- Change: auth.uid() -> local_service_internal.request_user_id() (schema auth is not reachable from bk01_migrator)
-- Preserved: RETURNS, LANGUAGE plpgsql, security mode, volatility.
-- search_path is re-pinned explicitly: CREATE OR REPLACE FUNCTION resets an ALTER FUNCTION pin.
create or replace function local_service.cancel_booking(p_booking_id UUID,
    p_reason TEXT)
returns JSON
language plpgsql
security definer
set search_path = pg_catalog, local_service
as $bk01$

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
$bk01$;

-- Rewritten from the frozen chain: supabase/migrations/20260829105155_bk_a_v1_contract_remediation.sql
-- Change: auth.uid() -> local_service_internal.request_user_id() (schema auth is not reachable from bk01_migrator)
-- Preserved: RETURNS, LANGUAGE sql, security mode, volatility.
-- search_path is re-pinned explicitly: CREATE OR REPLACE FUNCTION resets an ALTER FUNCTION pin.
create or replace function local_service.current_staff_id(p_shop_id uuid)
returns uuid
language sql
security definer stable
set search_path = pg_catalog, local_service
as $bk01$

    SELECT s.id
    FROM local_service.staff s
    JOIN local_service.shop_users su
      ON su.shop_id = s.shop_id
     AND su.user_id = s.user_id
     AND su.role = 'staff'
    WHERE s.shop_id = p_shop_id
      AND s.user_id = (SELECT local_service_internal.request_user_id())
      AND s.is_active = true
    LIMIT 1
$bk01$;

-- Rewritten from the frozen chain: supabase/migrations/20260807051755_product_rules_v1.sql
-- Change: auth.uid() -> local_service_internal.request_user_id() (schema auth is not reachable from bk01_migrator)
-- Preserved: RETURNS, LANGUAGE plpgsql, security mode, volatility.
-- search_path is re-pinned explicitly: CREATE OR REPLACE FUNCTION resets an ALTER FUNCTION pin.
create or replace function local_service.enforce_booking_status_transition()
returns TRIGGER
language plpgsql
security definer
set search_path = pg_catalog, local_service
as $bk01$

DECLARE
    v_user_id UUID := local_service_internal.request_user_id();
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
$bk01$;

-- Rewritten from the frozen chain: supabase/migrations/20260829105155_bk_a_v1_contract_remediation.sql
-- Change: auth.uid() -> local_service_internal.request_user_id() (schema auth is not reachable from bk01_migrator)
-- Preserved: RETURNS, LANGUAGE plpgsql, security mode, volatility.
-- search_path is re-pinned explicitly: CREATE OR REPLACE FUNCTION resets an ALTER FUNCTION pin.
create or replace function local_service.export_core_business_data(p_shop_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, local_service
as $bk01$

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
    INSERT INTO local_service.audit_events(shop_id,actor_user_id,actor_type,action,target_type,target_id) VALUES(p_shop_id,local_service_internal.request_user_id(),'merchant','core_data_exported','shop',p_shop_id);
    RETURN v_result;
END;
$bk01$;

-- Rewritten from the frozen chain: supabase/migrations/20260807104205_phase_a_data_integrity_and_authorization.sql
-- Change: auth.uid() -> local_service_internal.request_user_id() (schema auth is not reachable from bk01_migrator)
-- Preserved: RETURNS, LANGUAGE plpgsql, security mode, volatility.
-- search_path is re-pinned explicitly: CREATE OR REPLACE FUNCTION resets an ALTER FUNCTION pin.
create or replace function local_service.extend_booking_hold(p_booking_id UUID)
returns JSON
language plpgsql
security definer
set search_path = pg_catalog, local_service
as $bk01$

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
    IF local_service_internal.request_user_id() IS NULL OR NOT local_service.is_shop_member(v_booking.shop_id) THEN
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
$bk01$;

-- Rewritten from the frozen chain: supabase/migrations/20260819000000_quota_staff_topup_enforcement.sql
-- Change: auth.uid() -> local_service_internal.request_user_id() (schema auth is not reachable from bk01_migrator)
-- Preserved: RETURNS, LANGUAGE plpgsql, security mode, volatility.
-- search_path is re-pinned explicitly: CREATE OR REPLACE FUNCTION resets an ALTER FUNCTION pin.
create or replace function local_service.get_entitlement_usage(p_shop_id UUID)
returns JSON
language plpgsql
security definer
set search_path = pg_catalog, local_service
as $bk01$

DECLARE
    v_usage local_service.entitlement_usage%ROWTYPE;
    v_plan TEXT;
    v_limits RECORD;
    v_remaining_main INT;
BEGIN
    IF local_service_internal.request_user_id() IS NULL THEN
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
$bk01$;

-- Rewritten from the frozen chain: supabase/migrations/20260807175455_phase_e3_1_services_staff_authorization.sql
-- Change: auth.uid() -> local_service_internal.request_user_id() (schema auth is not reachable from bk01_migrator)
-- Preserved: RETURNS, LANGUAGE sql, security mode, volatility.
-- search_path is re-pinned explicitly: CREATE OR REPLACE FUNCTION resets an ALTER FUNCTION pin.
create or replace function local_service.has_shop_role(target_shop_id UUID,
    allowed_roles TEXT[])
returns BOOLEAN
language sql
security definer stable
set search_path = pg_catalog, local_service
as $bk01$

    SELECT local_service_internal.request_user_id() IS NOT NULL
       AND EXISTS (
            SELECT 1
              FROM local_service.shop_users
             WHERE shop_id = target_shop_id
               AND user_id = local_service_internal.request_user_id()
               AND role = ANY(allowed_roles)
       );
$bk01$;

-- Rewritten from the frozen chain: supabase/migrations/20260813092245_platform_admin_authorization.sql
-- Change: auth.uid() -> local_service_internal.request_user_id() (schema auth is not reachable from bk01_migrator)
-- Preserved: RETURNS, LANGUAGE sql, security mode, volatility.
-- search_path is re-pinned explicitly: CREATE OR REPLACE FUNCTION resets an ALTER FUNCTION pin.
create or replace function local_service.is_platform_admin()
returns BOOLEAN
language sql
security definer stable
set search_path = pg_catalog, local_service
as $bk01$

    SELECT local_service_internal.request_user_id() IS NOT NULL
       AND EXISTS (
            SELECT 1 FROM local_service.platform_admins WHERE user_id = local_service_internal.request_user_id()
       );
$bk01$;

-- Rewritten from the frozen chain: supabase/migrations/20260807051615_local_service_initial_schema.sql
-- Change: auth.uid() -> local_service_internal.request_user_id() (schema auth is not reachable from bk01_migrator)
-- Preserved: RETURNS, LANGUAGE plpgsql, security mode, volatility.
-- search_path is re-pinned explicitly: CREATE OR REPLACE FUNCTION resets an ALTER FUNCTION pin.
create or replace function local_service.is_shop_member(target_shop_id UUID)
returns BOOLEAN
language plpgsql
security definer
set search_path = pg_catalog, local_service
as $bk01$

BEGIN
    RETURN EXISTS (
        SELECT 1 FROM local_service.shop_users
        WHERE shop_id = target_shop_id AND user_id = local_service_internal.request_user_id()
    );
END;
$bk01$;

-- Rewritten from the frozen chain: supabase/migrations/20260807161412_phase_e1_owner_auth_and_provisioning.sql
-- Change: auth.uid() -> local_service_internal.request_user_id() (schema auth is not reachable from bk01_migrator)
-- Preserved: RETURNS, LANGUAGE plpgsql, security mode, volatility.
-- search_path is re-pinned explicitly: CREATE OR REPLACE FUNCTION resets an ALTER FUNCTION pin.
create or replace function local_service.provision_owner_shop(p_shop_name TEXT,
    p_shop_slug TEXT,
    p_business_category TEXT,
    p_owner_name TEXT,
    p_owner_phone TEXT,
    p_promptpay_number TEXT,
    p_promptpay_name TEXT,
    p_requested_plan TEXT,
    p_idempotency_key UUID)
returns TABLE (
    shop_id UUID,
    shop_slug TEXT
)
language plpgsql
security definer
set search_path = pg_catalog, local_service
as $bk01$

DECLARE
    v_user_id UUID := local_service_internal.request_user_id();
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
$bk01$;

-- Rewritten from the frozen chain: supabase/migrations/20260807104205_phase_a_data_integrity_and_authorization.sql
-- Change: auth.uid() -> local_service_internal.request_user_id() (schema auth is not reachable from bk01_migrator)
-- Preserved: RETURNS, LANGUAGE plpgsql, security mode, volatility.
-- search_path is re-pinned explicitly: CREATE OR REPLACE FUNCTION resets an ALTER FUNCTION pin.
create or replace function local_service.reject_deposit_slip(p_booking_id UUID,
    p_reason TEXT DEFAULT NULL)
returns JSON
language plpgsql
security definer
set search_path = pg_catalog, local_service
as $bk01$

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
    IF local_service_internal.request_user_id() IS NULL OR NOT local_service.is_shop_member(v_booking.shop_id) THEN
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
        local_service_internal.request_user_id(),
        COALESCE(NULLIF(btrim(p_reason), ''), 'Slip Rejected by Shop')
    );

    RETURN json_build_object(
        'success', true,
        'message', 'Slip rejected, hold reset to 15 minutes'
    );
END;
$bk01$;

-- Rewritten from the frozen chain: supabase/migrations/20260829105155_bk_a_v1_contract_remediation.sql
-- Change: auth.uid() -> local_service_internal.request_user_id() (schema auth is not reachable from bk01_migrator)
-- Preserved: RETURNS, LANGUAGE plpgsql, security mode, volatility.
-- search_path is re-pinned explicitly: CREATE OR REPLACE FUNCTION resets an ALTER FUNCTION pin.
create or replace function local_service.request_account_closure(p_shop_id uuid,p_reason text)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, local_service
as $bk01$

DECLARE v_id uuid;
BEGIN
    IF NOT local_service.has_shop_role(p_shop_id,ARRAY['owner']::text[]) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Owner role required'; END IF;
    IF nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Closure reason is required'; END IF;
    INSERT INTO local_service.account_closure_requests(shop_id,requested_by,reason) VALUES(p_shop_id,local_service_internal.request_user_id(),btrim(p_reason)) RETURNING id INTO v_id;
    INSERT INTO local_service.audit_events(shop_id,actor_user_id,actor_type,action,target_type,target_id) VALUES(p_shop_id,local_service_internal.request_user_id(),'merchant','account_closure_requested','account_closure_request',v_id);
    RETURN v_id;
END;
$bk01$;

-- Rewritten from the frozen chain: supabase/migrations/20260829105155_bk_a_v1_contract_remediation.sql
-- Change: auth.uid() -> local_service_internal.request_user_id() (schema auth is not reachable from bk01_migrator)
-- Preserved: RETURNS, LANGUAGE plpgsql, security mode, volatility.
-- search_path is re-pinned explicitly: CREATE OR REPLACE FUNCTION resets an ALTER FUNCTION pin.
create or replace function local_service.set_booking_outcome(p_booking_id uuid,p_outcome text,p_reason text DEFAULT NULL)
returns json
language plpgsql
security definer
set search_path = pg_catalog, local_service
as $bk01$

DECLARE v_booking local_service.bookings%rowtype;
BEGIN
    SELECT * INTO v_booking FROM local_service.bookings WHERE id=p_booking_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found'; END IF;
    IF NOT local_service.has_shop_role(v_booking.shop_id,ARRAY['owner','admin']::text[]) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Owner or admin role required'; END IF;
    IF p_outcome NOT IN ('completed','no_show') THEN RAISE EXCEPTION 'Invalid booking outcome'; END IF;
    IF v_booking.status <> 'confirmed' THEN RAISE EXCEPTION 'Only confirmed bookings can receive an outcome'; END IF;
    UPDATE local_service.bookings SET status=p_outcome,updated_at=now() WHERE id=p_booking_id;
    INSERT INTO local_service.audit_events(shop_id,actor_user_id,actor_type,action,target_type,target_id,metadata)
    VALUES(v_booking.shop_id,local_service_internal.request_user_id(),'merchant','booking_'||p_outcome,'booking',p_booking_id,jsonb_build_object('reason',p_reason));
    RETURN json_build_object('booking_id',p_booking_id,'status',p_outcome);
END;
$bk01$;

DO $bk01_rewrite_guard$
DECLARE missing integer;
BEGIN
  SELECT count(*) INTO missing
  FROM (VALUES
    ('local_service.apply_topup(uuid,integer,integer)'),
    ('local_service.approve_booking_deposit(uuid)'),
    ('local_service.audit_platform_admin_update()'),
    ('local_service.cancel_booking(uuid,text)'),
    ('local_service.current_staff_id(uuid)'),
    ('local_service.enforce_booking_status_transition()'),
    ('local_service.export_core_business_data(uuid)'),
    ('local_service.extend_booking_hold(uuid)'),
    ('local_service.get_entitlement_usage(uuid)'),
    ('local_service.has_shop_role(uuid,text[])'),
    ('local_service.is_platform_admin()'),
    ('local_service.is_shop_member(uuid)'),
    ('local_service.provision_owner_shop(text,text,text,text,text,text,text,text,uuid)'),
    ('local_service.reject_deposit_slip(uuid,text)'),
    ('local_service.request_account_closure(uuid,text)'),
    ('local_service.set_booking_outcome(uuid,text,text)')
  ) AS expected(identity)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'local_service'
      AND p.oid::regprocedure::text = expected.identity
  );
  IF missing <> 0 THEN
    RAISE EXCEPTION 'BK01 bootstrap did not emit % expected rewritten function(s)', missing;
  END IF;
END
$bk01_rewrite_guard$;


-- ---------------------------------------------------------------------------
-- Negative proof: after this bootstrap, no BK01 function that was transferred to
-- bk01_migrator may depend on schema auth. Measured from the catalog, not asserted.
--
-- The declared ownership exceptions are exempt by construction: they keep their
-- original owner and their shared-surface dependency is the reviewed exception.
-- ---------------------------------------------------------------------------
DO $bk01_auth_boundary_guard$
DECLARE offenders text;
BEGIN
  SELECT string_agg(sig, ', ') INTO offenders
  FROM (
    SELECT DISTINCT p.oid::regprocedure::text AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'local_service'
      AND p.oid::regprocedure::text NOT IN (
        'local_service.link_staff_user(uuid,text)',
        'local_service.submit_deposit_slip(uuid,text,text,text)',
        'local_service.submit_deposit_slip(uuid,text,text)'
      )
      AND p.prosrc ~ '(^|[^a-zA-Z0-9_])auth[[:space:]]*\.[[:space:]]*(uid|users|identities|sessions|refresh_tokens)'
    ORDER BY sig
  ) AS offenders;
  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION 'BK01 functions still depend on schema auth: %', offenders;
  END IF;

  IF has_schema_privilege('bk01_migrator', 'auth', 'USAGE') THEN
    RAISE EXCEPTION 'bk01_migrator unexpectedly holds USAGE on schema auth';
  END IF;
  IF to_regprocedure('local_service_internal.request_user_id()') IS NULL THEN
    RAISE EXCEPTION 'JWT identity helper local_service_internal.request_user_id() is missing';
  END IF;
  IF has_function_privilege('anon', 'local_service_internal.request_user_id()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'local_service_internal.request_user_id()', 'EXECUTE')
     OR has_function_privilege('service_role', 'local_service_internal.request_user_id()', 'EXECUTE') THEN
    RAISE EXCEPTION 'JWT identity helper is executable by a Data API role';
  END IF;
END
$bk01_auth_boundary_guard$;


DO $bk01_runtime_boundary_check$
DECLARE v_exec_count integer; v_route_function_count integer;
  v_expected_exec_count integer; v_table_write_count integer;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname='bk01_runtime'
      AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit OR rolbypassrls OR rolreplication)
  ) THEN
    RAISE EXCEPTION 'bk01_runtime role attributes are unsafe';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_auth_members m
    JOIN pg_roles member ON member.oid=m.member
    JOIN pg_roles granted ON granted.oid=m.roleid
    WHERE member.rolname='authenticator' AND granted.rolname='bk01_runtime'
      AND m.set_option AND NOT m.inherit_option
  ) THEN
    RAISE EXCEPTION 'authenticator membership for bk01_runtime is not SET-only';
  END IF;
  IF has_database_privilege('bk01_runtime', current_database(), 'CREATE')
     OR has_schema_privilege('bk01_runtime','local_service','CREATE') THEN
    RAISE EXCEPTION 'bk01_runtime has unexpected CREATE authority';
  END IF;
  IF has_schema_privilege('bk01_runtime','local_service_internal','USAGE') THEN
    RAISE EXCEPTION 'bk01_runtime has unexpected product/managed schema reach';
  END IF;
  -- H2 treats pre-existing PUBLIC ACLs on managed net/cron/extensions at the Data API
  -- boundary. Check that this bootstrap adds no direct USAGE ACL for the runtime role;
  -- effective reach through PUBLIC is not a role-specific grant and is not narrowed here.
  IF EXISTS (
    SELECT 1
    FROM pg_namespace n
    JOIN pg_roles runtime ON runtime.rolname='bk01_runtime'
    CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl, acldefault('n',n.nspowner))) acl
    WHERE n.nspname IN ('ps01','ps01_internal','mt01','mt01_private',
      'wstera_platform_internal','auth','storage','extensions','net','cron')
      AND acl.grantee=runtime.oid AND acl.privilege_type='USAGE'
  ) THEN
    RAISE EXCEPTION 'bk01_runtime has a direct USAGE ACL on a foreign or managed schema';
  END IF;
  SELECT count(*) INTO v_exec_count
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='local_service' AND has_function_privilege('bk01_runtime',p.oid,'EXECUTE');
  SELECT count(*) INTO v_route_function_count
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='local_service' AND p.oid::regprocedure::text IN (
    'local_service.authorize_deposit_slip_upload(uuid,text,text,bigint)',
    'local_service.bk01_finish_line_webhook_delivery(text,uuid,text,text)',
    'local_service.bk01_line_bind_booking(text,text,text,uuid,text)',
    'local_service.bk01_line_bind_booking_trial(text,text,text,text)',
    'local_service.finish_stripe_webhook_event(text,text,text)',
    'local_service.get_line_notification_delivery_context(uuid,integer)'
  );
  IF v_route_function_count NOT IN (0, 5, 6)
     OR (v_route_function_count = 5 AND to_regprocedure('local_service.bk01_line_bind_booking_trial(text,text,text,text)') IS NOT NULL) THEN
    RAISE EXCEPTION 'BK01 route RPC migration is partially present';
  END IF;
  v_expected_exec_count := CASE v_route_function_count
    WHEN 0 THEN 13
    WHEN 5 THEN 18
    ELSE 19 END;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='local_service' AND has_function_privilege('bk01_runtime',p.oid,'EXECUTE')
      AND p.oid::regprocedure::text NOT IN (
        'local_service.authorize_booking_recovery_attempt(uuid,text)',
        'local_service.authorize_deposit_slip_upload(uuid,text,text,bigint)',
        'local_service.bk01_finish_line_webhook_delivery(text,uuid,text,text)',
        'local_service.bk01_line_bind_booking(text,text,text,uuid,text)',
        'local_service.bk01_line_bind_booking_trial(text,text,text,text)',
        'local_service.claim_due_line_notifications(integer)',
        'local_service.claim_stripe_webhook_event(text,text,timestamp with time zone)',
        'local_service.complete_line_notification(uuid,integer,text,timestamp with time zone,timestamp with time zone,text)',
        'local_service.finish_stripe_webhook_event(text,text,text)',
        'local_service.get_line_notification_delivery_context(uuid,integer)',
        'local_service.sync_subscription_state_bk_a(text,bigint,uuid,text,text,text,text,bigint,boolean)',
        'local_service.audit_platform_admin_update()',
        'local_service.enforce_booking_status_transition()',
        'local_service.enforce_ticket_owner_admin()',
        'local_service.enqueue_booking_notifications()',
        'local_service.generate_booking_code()',
        'local_service.generate_link_token()',
        'local_service.is_shop_member(uuid)',
        'local_service.suppress_new_overdue_line_reminder()'
      )
  ) OR v_exec_count <> v_expected_exec_count THEN
    RAISE EXCEPTION 'bk01_runtime effective EXECUTE set differs from an exact approved migration phase (observed count %, expected %)', v_exec_count, v_expected_exec_count;
  END IF;
  SELECT count(*) INTO v_table_write_count
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='local_service' AND c.relkind IN ('r','p','v','m')
    AND (has_table_privilege('bk01_runtime',c.oid,'INSERT')
      OR has_table_privilege('bk01_runtime',c.oid,'UPDATE')
      OR has_table_privilege('bk01_runtime',c.oid,'DELETE')
      OR has_table_privilege('bk01_runtime',c.oid,'TRUNCATE'));
  IF v_table_write_count <> 0 THEN
    RAISE EXCEPTION 'bk01_runtime has direct local_service table write authority';
  END IF;
END
$bk01_runtime_boundary_check$;


CREATE TABLE IF NOT EXISTS local_service_internal.migration_baseline (
  baseline_id text PRIMARY KEY,
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  migration_count integer NOT NULL CHECK (migration_count > 0),
  last_legacy_version text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE local_service_internal.migration_baseline OWNER TO bk01_migrator;

CREATE TABLE IF NOT EXISTS local_service_internal.schema_migrations (
  migration_id text PRIMARY KEY,
  filename text NOT NULL UNIQUE,
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  release_id text NOT NULL,
  runner_version text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE local_service_internal.schema_migrations OWNER TO bk01_migrator;
REVOKE ALL ON ALL TABLES IN SCHEMA local_service_internal FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA local_service_internal FROM PUBLIC, anon, authenticated, service_role;

INSERT INTO local_service_internal.migration_baseline (
  baseline_id, source_sha256, migration_count, last_legacy_version
) VALUES (
  'legacy-global-history', '812b4656b5fcc65d881afd1712581d7c4ba0fd37f39a35c9d7d7d6173b695f5a', 30, '20260907181500'
) ON CONFLICT (baseline_id) DO NOTHING;

DO $bk01_baseline_check$
DECLARE baseline record;
BEGIN
  SELECT * INTO baseline
  FROM local_service_internal.migration_baseline
  WHERE baseline_id = 'legacy-global-history';
  IF baseline.source_sha256 <> '812b4656b5fcc65d881afd1712581d7c4ba0fd37f39a35c9d7d7d6173b695f5a'
     OR baseline.migration_count <> 30
     OR baseline.last_legacy_version <> '20260907181500' THEN
    RAISE EXCEPTION 'BK01 legacy baseline mismatch; refusing shared-runtime bootstrap';
  END IF;
END
$bk01_baseline_check$;


DO $bk01_boundary_check$
DECLARE unexpected_count integer;
BEGIN
  IF pg_get_userbyid((SELECT nspowner FROM pg_namespace WHERE nspname='local_service')) <> 'bk01_migrator'
     OR pg_get_userbyid((SELECT nspowner FROM pg_namespace WHERE nspname='local_service_internal')) <> 'bk01_migrator' THEN
    RAISE EXCEPTION 'BK01 schema ownership boundary is not established';
  END IF;
  IF has_database_privilege('bk01_migrator', current_database(), 'CREATE') THEN
    RAISE EXCEPTION 'BK01 migration role has database-wide CREATE';
  END IF;
  IF has_schema_privilege('bk01_migrator', 'ps01', 'USAGE')
     OR has_schema_privilege('bk01_migrator', 'ps01_internal', 'USAGE') THEN
    RAISE EXCEPTION 'BK01 migration role crosses PS01 schema boundary';
  END IF;
  IF has_schema_privilege('bk01_migrator', 'auth', 'USAGE') THEN
    RAISE EXCEPTION 'BK01 migration role holds USAGE on schema auth';
  END IF;
  IF has_schema_privilege('bk01_migrator', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'BK01 migration role can create in public';
  END IF;

  SELECT count(*) INTO unexpected_count
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='local_service' AND c.relkind IN ('r','p','v','m','S','c')
    AND pg_get_userbyid(c.relowner) <> 'bk01_migrator';
  IF unexpected_count <> 0 THEN RAISE EXCEPTION 'BK01 relation ownership transfer incomplete: %', unexpected_count; END IF;
END
$bk01_boundary_check$;


DO $bk01_function_boundary_check$
DECLARE unexpected_count integer;
BEGIN
  SELECT count(*) INTO unexpected_count
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='local_service' AND p.prokind='f'
    AND (
      (p.oid::regprocedure::text IN (
        'local_service.link_staff_user(uuid,text)',
        'local_service.submit_deposit_slip(uuid,text,text,text)',
        'local_service.submit_deposit_slip(uuid,text,text)'
      ) AND pg_get_userbyid(p.proowner) <> 'postgres')
      OR
      (p.oid::regprocedure::text NOT IN (
        'local_service.link_staff_user(uuid,text)',
        'local_service.submit_deposit_slip(uuid,text,text,text)',
        'local_service.submit_deposit_slip(uuid,text,text)'
      ) AND pg_get_userbyid(p.proowner) <> 'bk01_migrator')
    );
  IF unexpected_count <> 0 THEN
    RAISE EXCEPTION 'BK01 function ownership boundary mismatch: %', unexpected_count;
  END IF;
END
$bk01_function_boundary_check$;
