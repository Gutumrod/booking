-- BK-A V1 contract remediation
-- Authority: docs/01_PRD.md + docs/PRODUCT_DECISIONS.md

-- A1: private deposit-slip storage. Database stores object paths, never public URLs.
UPDATE storage.buckets
SET public = false,
    file_size_limit = 5242880,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
WHERE id = 'deposit-slips';

DROP POLICY IF EXISTS "Anonymous users upload deposit slips" ON storage.objects;
DROP POLICY IF EXISTS "BK-A customer uploads active booking slip" ON storage.objects;

DROP POLICY IF EXISTS "BK-A owner admin reads own shop slips" ON storage.objects;
CREATE POLICY "BK-A owner admin reads own shop slips"
ON storage.objects FOR SELECT TO authenticated
USING (
    bucket_id = 'deposit-slips'
    AND EXISTS (
        SELECT 1
        FROM local_service.bookings b
        WHERE b.id = CASE
            WHEN (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
            THEN (storage.foldername(name))[1]::uuid
            ELSE NULL
        END
          AND local_service.has_shop_role(b.shop_id, ARRAY['owner', 'admin']::text[])
    )
);

CREATE TABLE IF NOT EXISTS local_service.booking_recovery_attempts(
  booking_id uuid PRIMARY KEY REFERENCES local_service.bookings(id) ON DELETE CASCADE,
  failed_attempts int NOT NULL DEFAULT 0,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  blocked_until timestamptz
);
ALTER TABLE local_service.booking_recovery_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON local_service.booking_recovery_attempts FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION local_service.authorize_booking_recovery_attempt(p_booking_id uuid,p_recovery_token text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,local_service AS $$
DECLARE v_booking local_service.bookings%rowtype; v_attempt local_service.booking_recovery_attempts%rowtype; v_valid boolean;
BEGIN
  SELECT * INTO v_booking FROM local_service.bookings WHERE id=p_booking_id;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO v_attempt FROM local_service.booking_recovery_attempts WHERE booking_id=p_booking_id FOR UPDATE;
  IF FOUND AND v_attempt.blocked_until > now() THEN RETURN false; END IF;
  v_valid := v_booking.link_token = upper(trim(p_recovery_token))
             AND v_booking.link_token_expires_at IS NOT NULL
             AND v_booking.link_token_expires_at > now();
  IF v_valid THEN
    DELETE FROM local_service.booking_recovery_attempts WHERE booking_id=p_booking_id;
    RETURN true;
  END IF;
  INSERT INTO local_service.booking_recovery_attempts(booking_id,failed_attempts,window_started_at,blocked_until)
  VALUES(p_booking_id,1,now(),NULL)
  ON CONFLICT(booking_id) DO UPDATE SET
    failed_attempts=CASE WHEN booking_recovery_attempts.window_started_at < now()-interval '15 minutes' THEN 1 ELSE booking_recovery_attempts.failed_attempts+1 END,
    window_started_at=CASE WHEN booking_recovery_attempts.window_started_at < now()-interval '15 minutes' THEN now() ELSE booking_recovery_attempts.window_started_at END,
    blocked_until=CASE WHEN booking_recovery_attempts.failed_attempts+1 >= 5 THEN now()+interval '30 minutes' ELSE booking_recovery_attempts.blocked_until END;
  RETURN false;
END; $$;
REVOKE ALL ON FUNCTION local_service.authorize_booking_recovery_attempt(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION local_service.authorize_booking_recovery_attempt(uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION local_service.submit_deposit_slip(
    p_booking_id uuid,
    p_recovery_token text,
    p_slip_url text,
    p_trans_ref text DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, local_service
AS $$
DECLARE v_booking local_service.bookings%rowtype;
BEGIN
    IF p_slip_url !~* ('^' || p_booking_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|jpeg|png|webp)$')
       OR p_slip_url LIKE '%..%' OR p_slip_url LIKE '%://%' THEN
        RAISE EXCEPTION 'Slip object reference must belong to this booking';
    END IF;
    SELECT * INTO v_booking FROM local_service.bookings WHERE id=p_booking_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found'; END IF;
    IF NOT local_service.authorize_booking_recovery_attempt(p_booking_id,p_recovery_token) THEN
        RETURN json_build_object('ok',false,'error','Invalid or expired booking recovery token');
    END IF;
    IF v_booking.status <> 'hold' OR v_booking.expires_at IS NULL OR v_booking.expires_at <= now() THEN
        RAISE EXCEPTION 'Booking is not accepting deposit slips';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='deposit-slips' AND o.name=p_slip_url) THEN
        RAISE EXCEPTION 'Slip object was not found in the private deposit-slips bucket';
    END IF;
    UPDATE local_service.bookings SET slip_url=p_slip_url,trans_ref=nullif(btrim(p_trans_ref),''),deposit_status='submitted',status='pending_review',slip_uploaded_at=now(),slip_submit_count=coalesce(slip_submit_count,0)+1,updated_at=now() WHERE id=p_booking_id RETURNING * INTO v_booking;
    RETURN json_build_object('booking_id',v_booking.id,'status',v_booking.status,'deposit_status',v_booking.deposit_status,'slip_object_path',v_booking.slip_url);
END;
$$;
REVOKE ALL ON FUNCTION local_service.submit_deposit_slip(uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION local_service.submit_deposit_slip(uuid,text,text,text) FROM PUBLIC,authenticated,service_role;
GRANT EXECUTE ON FUNCTION local_service.submit_deposit_slip(uuid,text,text,text) TO anon;

-- A2: explicit auth user -> staff mapping and fail-closed operational scope.
ALTER TABLE local_service.staff
    ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS staff_shop_user_unique
    ON local_service.staff(shop_id, user_id)
    WHERE user_id IS NOT NULL;
-- Public booking must never expose auth-user linkage or internal idempotency metadata.
DROP POLICY IF EXISTS "Public staff viewable by everyone" ON local_service.staff;
DROP POLICY IF EXISTS "BK-A public active staff" ON local_service.staff;
CREATE POLICY "BK-A public active staff"
ON local_service.staff FOR SELECT TO anon
USING (is_active = true);


REVOKE SELECT ON TABLE local_service.staff FROM anon, authenticated;
GRANT SELECT (id, shop_id, name, nickname, is_active) ON local_service.staff TO anon;
GRANT SELECT (id, shop_id, name, nickname, phone, is_active, created_at) ON local_service.staff TO authenticated;

REVOKE SELECT ON TABLE local_service.services FROM anon, authenticated;
GRANT SELECT (id, shop_id, name, description, duration_minutes, price, deposit_amount, is_active) ON local_service.services TO anon;
GRANT SELECT (id, shop_id, name, description, duration_minutes, price, deposit_amount, is_active, created_at) ON local_service.services TO authenticated;

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

REVOKE ALL ON FUNCTION local_service.current_staff_id(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION local_service.current_staff_id(uuid) TO authenticated;

DROP POLICY IF EXISTS "BK-A scoped staff reads" ON local_service.staff;
CREATE POLICY "BK-A scoped staff reads"
ON local_service.staff FOR SELECT TO authenticated
USING (
    local_service.has_shop_role(shop_id, ARRAY['owner', 'admin']::text[])
    OR id = local_service.current_staff_id(shop_id)
);

CREATE OR REPLACE FUNCTION local_service.link_staff_user(p_staff_id uuid,p_user_email text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,local_service,auth AS $$
DECLARE v_staff local_service.staff%rowtype; v_user_id uuid;
BEGIN
  SELECT * INTO v_staff FROM local_service.staff WHERE id=p_staff_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Staff not found'; END IF;
  IF NOT local_service.has_shop_role(v_staff.shop_id,ARRAY['owner']::text[]) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Owner role required'; END IF;
  SELECT id INTO v_user_id FROM auth.users WHERE lower(email)=lower(trim(p_user_email)) LIMIT 1;
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'No registered user matches that email'; END IF;
  IF NOT EXISTS(SELECT 1 FROM local_service.shop_users WHERE shop_id=v_staff.shop_id AND user_id=v_user_id AND role='staff') THEN RAISE EXCEPTION 'The user must first be a staff member of this shop'; END IF;
  UPDATE local_service.staff SET user_id=v_user_id WHERE id=p_staff_id;
END; $$;
REVOKE ALL ON FUNCTION local_service.link_staff_user(uuid,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION local_service.link_staff_user(uuid,text) TO authenticated;

DROP POLICY IF EXISTS "Members view bookings" ON local_service.bookings;
DROP POLICY IF EXISTS "BK-A scoped booking reads" ON local_service.bookings;
CREATE POLICY "BK-A scoped booking reads"
ON local_service.bookings FOR SELECT TO authenticated
USING (
    local_service.has_shop_role(shop_id, ARRAY['owner', 'admin']::text[])
    OR staff_id = local_service.current_staff_id(shop_id)
);

DROP POLICY IF EXISTS "Members view customers" ON local_service.customers;
DROP POLICY IF EXISTS "BK-A scoped customer reads" ON local_service.customers;
CREATE POLICY "BK-A scoped customer reads"
ON local_service.customers FOR SELECT TO authenticated
USING (
    local_service.has_shop_role(shop_id, ARRAY['owner', 'admin']::text[])
    OR EXISTS (
        SELECT 1 FROM local_service.bookings b
        WHERE b.customer_id = customers.id
          AND b.staff_id = local_service.current_staff_id(customers.shop_id)
    )
);

DROP POLICY IF EXISTS "Members manage shop services" ON local_service.services;
CREATE POLICY "BK-A owner admin manage services"
ON local_service.services FOR ALL TO authenticated
USING (local_service.has_shop_role(shop_id, ARRAY['owner', 'admin']::text[]))
WITH CHECK (local_service.has_shop_role(shop_id, ARRAY['owner', 'admin']::text[]));

DROP POLICY IF EXISTS "Members manage shop staff" ON local_service.staff;
CREATE POLICY "BK-A owner manages staff"
ON local_service.staff FOR ALL TO authenticated
USING (local_service.has_shop_role(shop_id, ARRAY['owner']::text[]))
WITH CHECK (local_service.has_shop_role(shop_id, ARRAY['owner']::text[]));

DROP POLICY IF EXISTS "Members manage staff schedules" ON local_service.staff_schedules;
DROP POLICY IF EXISTS "Public staff schedules viewable by everyone" ON local_service.staff_schedules;
CREATE POLICY "BK-A public schedules for booking availability" ON local_service.staff_schedules
FOR SELECT TO anon USING (true);
CREATE POLICY "BK-A staff reads own schedule" ON local_service.staff_schedules
FOR SELECT TO authenticated USING (
  local_service.has_shop_role(shop_id, ARRAY['owner','admin']::text[])
  OR staff_id = local_service.current_staff_id(shop_id)
);
CREATE POLICY "BK-A owner admin manage schedules"
ON local_service.staff_schedules FOR ALL TO authenticated
USING (local_service.has_shop_role(shop_id, ARRAY['owner', 'admin']::text[]))
WITH CHECK (local_service.has_shop_role(shop_id, ARRAY['owner', 'admin']::text[]));

DROP POLICY IF EXISTS "Members manage shop holidays" ON local_service.shop_holidays;
CREATE POLICY "BK-A owner admin manage holidays"
ON local_service.shop_holidays FOR ALL TO authenticated
USING (local_service.has_shop_role(shop_id, ARRAY['owner', 'admin']::text[]))
WITH CHECK (local_service.has_shop_role(shop_id, ARRAY['owner', 'admin']::text[]));

-- A4: paid usage remains measured but never hits the retired 100/500 value wall.
ALTER TABLE local_service.stripe_webhook_events
  ADD COLUMN IF NOT EXISTS processing_status text NOT NULL DEFAULT 'processed' CHECK(processing_status IN ('processing','processed','failed')),
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error text;
GRANT UPDATE ON local_service.stripe_webhook_events TO service_role;
CREATE OR REPLACE FUNCTION local_service.claim_stripe_webhook_event(p_id text,p_type text,p_created_at timestamptz)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,local_service AS $$
DECLARE v_claimed boolean;
BEGIN
  INSERT INTO local_service.stripe_webhook_events(id,type,created_at,processed_at,processing_status,processing_started_at)
  VALUES(p_id,p_type,p_created_at,now(),'processing',now())
  ON CONFLICT(id) DO UPDATE SET processing_status='processing',processing_started_at=now(),last_error=NULL
  WHERE stripe_webhook_events.processing_status='failed'
     OR (stripe_webhook_events.processing_status='processing' AND stripe_webhook_events.processing_started_at < now()-interval '5 minutes')
  RETURNING true INTO v_claimed;
  RETURN coalesce(v_claimed,false);
END; $$;
REVOKE ALL ON FUNCTION local_service.claim_stripe_webhook_event(text,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION local_service.claim_stripe_webhook_event(text,text,timestamptz) TO service_role;
ALTER TABLE local_service.subscriptions ADD COLUMN IF NOT EXISTS last_stripe_event_created_at timestamptz;

CREATE OR REPLACE FUNCTION local_service.sync_subscription_state_bk_a(
  p_event_type text,p_event_created bigint,p_shop_id uuid,p_stripe_customer_id text,
  p_stripe_subscription_id text,p_plan text,p_status text,p_current_period_end bigint,
  p_cancel_at_period_end boolean
) RETURNS TABLE(out_applied boolean,out_matched_shop_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,local_service AS $$
DECLARE v_shop_id uuid; v_event_ts timestamptz:=to_timestamp(p_event_created); v_result record;
BEGIN
  v_shop_id:=p_shop_id;
  IF v_shop_id IS NULL THEN
    SELECT shop_id INTO v_shop_id FROM local_service.subscriptions
    WHERE stripe_subscription_id=p_stripe_subscription_id FOR UPDATE;
  ELSE
    PERFORM 1 FROM local_service.shops WHERE id=v_shop_id FOR UPDATE;
    PERFORM 1 FROM local_service.subscriptions WHERE shop_id=v_shop_id FOR UPDATE;
  END IF;
  IF v_shop_id IS NULL THEN RETURN QUERY SELECT false,NULL::uuid; RETURN; END IF;
  IF EXISTS(SELECT 1 FROM local_service.subscriptions WHERE shop_id=v_shop_id AND last_stripe_event_created_at > v_event_ts) THEN
    RETURN QUERY SELECT false,v_shop_id; RETURN;
  END IF;
  -- The legacy function compared Stripe creation time to local processing time.
  -- Normalize that legacy guard while this row remains locked.
  UPDATE local_service.subscriptions SET updated_at=v_event_ts-interval '1 microsecond' WHERE shop_id=v_shop_id;
  SELECT * INTO v_result FROM local_service.sync_subscription_state(
    p_event_type,p_event_created,v_shop_id,p_stripe_customer_id,p_stripe_subscription_id,
    p_plan,p_status,p_current_period_end,p_cancel_at_period_end
  );
  IF coalesce(v_result.out_applied,false) THEN
    UPDATE local_service.subscriptions SET last_stripe_event_created_at=v_event_ts WHERE shop_id=v_shop_id;
  END IF;
  RETURN QUERY SELECT coalesce(v_result.out_applied,false),v_shop_id;
END; $$;
REVOKE ALL ON FUNCTION local_service.sync_subscription_state_bk_a(text,bigint,uuid,text,text,text,text,bigint,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION local_service.sync_subscription_state_bk_a(text,bigint,uuid,text,text,text,text,bigint,boolean) TO service_role;

CREATE OR REPLACE FUNCTION local_service.get_tier_limits(p_plan text)
RETURNS TABLE(bookings_limit int, staff_limit int, auto_slip_limit int)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, local_service
AS $$
    SELECT
        CASE WHEN p_plan = 'free_trial' OR p_plan IS NULL THEN 50 ELSE 2147483647 END,
        CASE WHEN p_plan = 'pro_990' THEN 10 ELSE 5 END,
        CASE WHEN p_plan = 'basic_490' THEN 0 WHEN p_plan = 'pro_990' THEN 0 ELSE 0 END
$$;

-- A6: durable notification jobs and delivery evidence. Delivery is performed server-side.
ALTER TABLE local_service.line_notification_logs
    ADD COLUMN IF NOT EXISTS idempotency_key text,
    ADD COLUMN IF NOT EXISTS attempt_count int NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS scheduled_for timestamptz,
    ADD COLUMN IF NOT EXISTS sent_at timestamptz,
    ADD COLUMN IF NOT EXISTS next_retry_at timestamptz;

ALTER TABLE local_service.line_notification_logs DROP CONSTRAINT IF EXISTS line_notification_logs_event_type_check;
ALTER TABLE local_service.line_notification_logs ADD CONSTRAINT line_notification_logs_event_type_check
CHECK(event_type IN ('booking_created','booking_rescheduled','deposit_approved','booking_cancelled','reminder_1h','reminder_24h'));

DROP POLICY IF EXISTS "Public line logs insert" ON local_service.line_notification_logs;
DROP POLICY IF EXISTS "Public line users insert" ON local_service.line_users;
DROP POLICY IF EXISTS "Members view line logs" ON local_service.line_notification_logs;
CREATE POLICY "BK-A owner admin view notification logs" ON local_service.line_notification_logs
FOR SELECT TO authenticated USING(local_service.has_shop_role(shop_id,ARRAY['owner','admin']::text[]));
DROP POLICY IF EXISTS "Members view line users" ON local_service.line_users;
CREATE POLICY "BK-A owner admin view line users" ON local_service.line_users
FOR SELECT TO authenticated USING(local_service.has_shop_role(shop_id,ARRAY['owner','admin']::text[]));

CREATE UNIQUE INDEX IF NOT EXISTS line_notification_idempotency_unique
    ON local_service.line_notification_logs(idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE OR REPLACE FUNCTION local_service.claim_due_line_notifications(p_limit int DEFAULT 25)
RETURNS SETOF local_service.line_notification_logs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, local_service
AS $$
BEGIN
    RETURN QUERY
    WITH due AS (
        SELECT l.id
        FROM local_service.line_notification_logs l
        JOIN local_service.bookings b ON b.id=l.booking_id
        WHERE l.status='pending'
          AND l.scheduled_for <= now()
          AND (l.next_retry_at IS NULL OR l.next_retry_at <= now())
          AND (l.event_type = 'booking_cancelled' OR b.status <> 'cancelled')
        ORDER BY l.scheduled_for
        FOR UPDATE OF l SKIP LOCKED
        LIMIT greatest(1,least(p_limit,100))
    )
    UPDATE local_service.line_notification_logs l
       SET attempt_count=l.attempt_count+1,
           next_retry_at=now()+interval '5 minutes'
      FROM due WHERE l.id=due.id
    RETURNING l.*;
END;
$$;
REVOKE ALL ON FUNCTION local_service.claim_due_line_notifications(int) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION local_service.claim_due_line_notifications(int) TO service_role;

CREATE OR REPLACE FUNCTION local_service.complete_line_notification(
  p_id uuid,p_attempt_count int,p_status text,p_sent_at timestamptz,p_next_retry_at timestamptz,p_error_message text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,local_service AS $$
DECLARE v_updated int;
BEGIN
  IF p_status NOT IN ('pending','sent','failed') THEN RAISE EXCEPTION 'Invalid notification status'; END IF;
  UPDATE local_service.line_notification_logs
     SET status=p_status,sent_at=p_sent_at,next_retry_at=p_next_retry_at,error_message=left(p_error_message,500)
   WHERE id=p_id AND attempt_count=p_attempt_count AND status='pending';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated=1;
END; $$;
REVOKE ALL ON FUNCTION local_service.complete_line_notification(uuid,int,text,timestamptz,timestamptz,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION local_service.complete_line_notification(uuid,int,text,timestamptz,timestamptz,text) TO service_role;

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

-- A7: provider-neutral, auditable attempts. Provider selection remains an owner blocker.
CREATE TABLE IF NOT EXISTS local_service.auto_slip_attempts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id uuid NOT NULL REFERENCES local_service.shops(id) ON DELETE CASCADE,
    booking_id uuid NOT NULL REFERENCES local_service.bookings(id) ON DELETE CASCADE,
    provider_key text NOT NULL,
    idempotency_key text NOT NULL UNIQUE,
    status text NOT NULL CHECK (status IN ('pending','verified','manual_review','timeout','unknown','ambiguous','provider_error','duplicate')),
    transaction_reference text,
    provider_result jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz
);
ALTER TABLE local_service.auto_slip_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON local_service.auto_slip_attempts FROM anon, authenticated;
GRANT SELECT ON local_service.auto_slip_attempts TO authenticated;
CREATE POLICY "BK-A owner admin reads auto slip attempts"
ON local_service.auto_slip_attempts FOR SELECT TO authenticated
USING (local_service.has_shop_role(shop_id, ARRAY['owner','admin']::text[]));

-- A9/A10/A11/A12 shared immutable audit/analytics evidence.
CREATE TABLE IF NOT EXISTS local_service.audit_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id uuid REFERENCES local_service.shops(id) ON DELETE SET NULL,
    actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    actor_type text NOT NULL CHECK (actor_type IN ('customer','merchant','platform','system')),
    action text NOT NULL,
    target_type text NOT NULL,
    target_id uuid,
    outcome text NOT NULL DEFAULT 'succeeded',
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE local_service.audit_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON local_service.audit_events FROM anon, authenticated;
GRANT SELECT ON local_service.audit_events TO authenticated;
CREATE POLICY "BK-A owner reads own audit events"
ON local_service.audit_events FOR SELECT TO authenticated
USING (local_service.has_shop_role(shop_id, ARRAY['owner']::text[]) OR local_service.is_platform_admin());

CREATE OR REPLACE FUNCTION local_service.audit_platform_admin_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,local_service AS $$
DECLARE v_shop_id uuid;
BEGIN
    IF auth.uid() IS NOT NULL AND local_service.is_platform_admin() THEN
        v_shop_id := CASE WHEN TG_TABLE_NAME = 'shops' THEN NEW.id ELSE NEW.shop_id END;
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
DROP TRIGGER IF EXISTS bk_a_audit_platform_shop_update ON local_service.shops;
CREATE TRIGGER bk_a_audit_platform_shop_update AFTER UPDATE ON local_service.shops
FOR EACH ROW EXECUTE FUNCTION local_service.audit_platform_admin_update();
DROP TRIGGER IF EXISTS bk_a_audit_platform_subscription_update ON local_service.subscriptions;
CREATE TRIGGER bk_a_audit_platform_subscription_update AFTER UPDATE ON local_service.subscriptions
FOR EACH ROW EXECUTE FUNCTION local_service.audit_platform_admin_update();

ALTER TABLE local_service.shops
    ADD COLUMN IF NOT EXISTS customer_cancel_before_hours int CHECK (customer_cancel_before_hours IS NULL OR customer_cancel_before_hours >= 0),
    ADD COLUMN IF NOT EXISTS customer_reschedule_before_hours int CHECK (customer_reschedule_before_hours IS NULL OR customer_reschedule_before_hours >= 0);

ALTER TABLE local_service.bookings ALTER COLUMN link_token TYPE varchar(64);
UPDATE local_service.bookings
SET link_token = upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 10)),
    link_token_expires_at = greatest(coalesce(link_token_expires_at, now()), now() + interval '24 hours')
WHERE length(link_token) < 10
  AND status IN ('hold','pending_review','confirmed');
CREATE OR REPLACE FUNCTION local_service.generate_link_token()
RETURNS text
LANGUAGE sql
VOLATILE
SET search_path = pg_catalog
AS $$
    SELECT upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 10))
$$;

CREATE OR REPLACE FUNCTION local_service.customer_cancel_booking(
    p_booking_id uuid,
    p_recovery_token text,
    p_reason text
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, local_service
AS $$
DECLARE v_booking local_service.bookings%rowtype; v_hours int;
BEGIN
    SELECT b, s.customer_cancel_before_hours
      INTO v_booking, v_hours
      FROM local_service.bookings b JOIN local_service.shops s ON s.id = b.shop_id
     WHERE b.id = p_booking_id FOR UPDATE;
    IF NOT FOUND OR NOT local_service.authorize_booking_recovery_attempt(p_booking_id,p_recovery_token) THEN
        RETURN json_build_object('ok',false,'error','Invalid or expired booking recovery token');
    END IF;
    IF v_hours IS NULL THEN RAISE EXCEPTION 'Customer cancellation policy is not configured'; END IF;
    IF v_booking.status NOT IN ('hold','pending_review','confirmed') THEN RAISE EXCEPTION 'Booking is not cancellable'; END IF;
    IF v_booking.start_timestamptz <= now() + make_interval(hours => v_hours) THEN RAISE EXCEPTION 'Cancellation policy window has closed'; END IF;
    IF nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Cancellation reason is required'; END IF;
    UPDATE local_service.bookings SET status='cancelled', notes=concat_ws(E'\n', notes, 'Customer cancellation: ' || btrim(p_reason)), updated_at=now() WHERE id=p_booking_id;
    INSERT INTO local_service.audit_events(shop_id,actor_type,action,target_type,target_id,metadata)
    VALUES(v_booking.shop_id,'customer','booking_cancelled','booking',p_booking_id,jsonb_build_object('reason',btrim(p_reason)));
    RETURN json_build_object('booking_id',p_booking_id,'status','cancelled');
END;
$$;
REVOKE ALL ON FUNCTION local_service.customer_cancel_booking(uuid,text,text) FROM PUBLIC, authenticated, service_role;
GRANT EXECUTE ON FUNCTION local_service.customer_cancel_booking(uuid,text,text) TO anon;

CREATE OR REPLACE FUNCTION local_service.customer_reschedule_booking(
    p_booking_id uuid,
    p_recovery_token text,
    p_booking_date date,
    p_start_time time,
    p_reason text
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, local_service
AS $$
DECLARE v_booking local_service.bookings%rowtype; v_hours int; v_start timestamptz; v_end timestamptz;
BEGIN
    SELECT b, s.customer_reschedule_before_hours
      INTO v_booking, v_hours
      FROM local_service.bookings b JOIN local_service.shops s ON s.id=b.shop_id
     WHERE b.id=p_booking_id FOR UPDATE;
    IF NOT FOUND OR NOT local_service.authorize_booking_recovery_attempt(p_booking_id,p_recovery_token) THEN
        RETURN json_build_object('ok',false,'error','Invalid or expired booking recovery token');
    END IF;
    IF v_hours IS NULL THEN RAISE EXCEPTION 'Customer reschedule policy is not configured'; END IF;
    IF v_booking.status <> 'confirmed' THEN RAISE EXCEPTION 'Only confirmed bookings can be rescheduled'; END IF;
    IF v_booking.start_timestamptz <= now() + make_interval(hours => v_hours) THEN RAISE EXCEPTION 'Reschedule policy window has closed'; END IF;
    IF nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Reschedule reason is required'; END IF;
    v_start := (p_booking_date || ' ' || p_start_time)::timestamp AT TIME ZONE 'Asia/Bangkok';
    v_end := v_start + make_interval(mins => v_booking.service_duration_minutes);
    IF v_start <= now() THEN RAISE EXCEPTION 'New booking time must be in the future'; END IF;
    IF NOT EXISTS (SELECT 1 FROM local_service.staff s WHERE s.id=v_booking.staff_id AND s.shop_id=v_booking.shop_id AND s.is_active=true) THEN RAISE EXCEPTION 'Assigned staff is no longer active'; END IF;
    IF NOT EXISTS (
        SELECT 1 FROM local_service.staff_schedules ss
        WHERE ss.shop_id=v_booking.shop_id AND ss.staff_id=v_booking.staff_id
          AND ss.day_of_week=extract(dow from p_booking_date)::int AND ss.is_working_day
          AND p_start_time >= ss.work_start AND (p_start_time + make_interval(mins=>v_booking.service_duration_minutes)) <= ss.work_end
          AND NOT (ss.break_start IS NOT NULL AND ss.break_end IS NOT NULL
                   AND p_start_time < ss.break_end AND (p_start_time + make_interval(mins=>v_booking.service_duration_minutes)) > ss.break_start)
    ) THEN RAISE EXCEPTION 'Requested time is outside staff availability'; END IF;
    IF EXISTS (
      SELECT 1 FROM local_service.shop_holidays h
      WHERE h.shop_id=v_booking.shop_id AND h.holiday_date=p_booking_date
        AND (h.staff_id IS NULL OR h.staff_id=v_booking.staff_id)
    ) THEN RAISE EXCEPTION 'Requested date is closed'; END IF;
    UPDATE local_service.bookings
       SET booking_date=p_booking_date,start_time=p_start_time,end_time=(p_start_time + make_interval(mins=>service_duration_minutes))::time,
           start_timestamptz=v_start,end_timestamptz=v_end,notes=concat_ws(E'\n',notes,'Customer reschedule: '||btrim(p_reason)),updated_at=now()
     WHERE id=p_booking_id;
    UPDATE local_service.line_notification_logs
       SET status='failed',error_message='Superseded by customer reschedule',next_retry_at=NULL
     WHERE booking_id=p_booking_id AND event_type='reminder_24h' AND status='pending';
    INSERT INTO local_service.line_notification_logs(shop_id,booking_id,event_type,recipient_type,status,idempotency_key,scheduled_for)
    VALUES(v_booking.shop_id,p_booking_id,'reminder_24h','customer','pending','reminder_24h:'||p_booking_id::text||':'||extract(epoch from v_start)::bigint::text,v_start-interval '24 hours')
    ON CONFLICT(idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
    INSERT INTO local_service.audit_events(shop_id,actor_type,action,target_type,target_id,metadata)
    VALUES(v_booking.shop_id,'customer','booking_rescheduled','booking',p_booking_id,jsonb_build_object('reason',btrim(p_reason),'new_start',v_start));
    INSERT INTO local_service.line_notification_logs(shop_id,booking_id,event_type,recipient_type,status,idempotency_key,scheduled_for)
    VALUES(v_booking.shop_id,p_booking_id,'booking_rescheduled','customer','pending','booking_rescheduled:'||p_booking_id::text||':'||extract(epoch from v_start)::bigint::text,now())
    ON CONFLICT(idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
    RETURN json_build_object('booking_id',p_booking_id,'status','confirmed','start_timestamptz',v_start);
END;
$$;
REVOKE ALL ON FUNCTION local_service.customer_reschedule_booking(uuid,text,date,time,text) FROM PUBLIC, authenticated, service_role;
GRANT EXECUTE ON FUNCTION local_service.customer_reschedule_booking(uuid,text,date,time,text) TO anon;

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
REVOKE ALL ON FUNCTION local_service.set_booking_outcome(uuid,text,text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION local_service.set_booking_outcome(uuid,text,text) TO authenticated;

CREATE TABLE IF NOT EXISTS local_service.account_closure_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id uuid NOT NULL REFERENCES local_service.shops(id) ON DELETE RESTRICT,
    requested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    status text NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','identity_verified','in_review','approved','rejected','completed')),
    reason text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE local_service.account_closure_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON local_service.account_closure_requests FROM anon, authenticated;
GRANT SELECT ON local_service.account_closure_requests TO authenticated;
CREATE POLICY "BK-A owner reads own closure requests" ON local_service.account_closure_requests
FOR SELECT TO authenticated USING (local_service.has_shop_role(shop_id,ARRAY['owner']::text[]));

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
REVOKE ALL ON FUNCTION local_service.request_account_closure(uuid,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION local_service.request_account_closure(uuid,text) TO authenticated;

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
REVOKE ALL ON FUNCTION local_service.export_core_business_data(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION local_service.export_core_business_data(uuid) TO authenticated;

-- A12: staff cannot read or mutate shop-wide ticket/support data.
DROP POLICY IF EXISTS "Members view shop tickets" ON local_service.tickets;
CREATE POLICY "BK-A owner admin view shop tickets" ON local_service.tickets
FOR SELECT TO authenticated USING(local_service.has_shop_role(shop_id,ARRAY['owner','admin']::text[]));
DROP POLICY IF EXISTS "Members view shop ticket timeline" ON local_service.ticket_timeline_entries;
CREATE POLICY "BK-A owner admin view ticket timeline" ON local_service.ticket_timeline_entries
FOR SELECT TO authenticated USING(local_service.has_shop_role(shop_id,ARRAY['owner','admin']::text[]));

CREATE OR REPLACE FUNCTION local_service.enforce_ticket_owner_admin()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,local_service AS $$
DECLARE v_shop_id uuid := COALESCE(NEW.shop_id,OLD.shop_id);
BEGIN
    IF NOT local_service.has_shop_role(v_shop_id,ARRAY['owner','admin']::text[]) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Owner or admin role required for ticket operations'; END IF;
    RETURN COALESCE(NEW,OLD);
END; $$;
DROP TRIGGER IF EXISTS trg_ticket_owner_admin ON local_service.tickets;
CREATE TRIGGER trg_ticket_owner_admin BEFORE INSERT OR UPDATE OR DELETE ON local_service.tickets FOR EACH ROW EXECUTE FUNCTION local_service.enforce_ticket_owner_admin();
DROP TRIGGER IF EXISTS trg_ticket_timeline_owner_admin ON local_service.ticket_timeline_entries;
CREATE TRIGGER trg_ticket_timeline_owner_admin BEFORE INSERT OR UPDATE OR DELETE ON local_service.ticket_timeline_entries FOR EACH ROW EXECUTE FUNCTION local_service.enforce_ticket_owner_admin();

-- Final grants for newly exposed Data API objects are explicit; RLS remains authoritative.
GRANT USAGE ON SCHEMA local_service TO anon, authenticated, service_role;
