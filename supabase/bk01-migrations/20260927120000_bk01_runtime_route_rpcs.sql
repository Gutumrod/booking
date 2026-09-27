-- BK01 runtime route RPCs. Forward-only additions; the shared runtime boundary
-- remains exact and the House-owned Storage policy is intentionally separate.

CREATE TABLE local_service.line_webhook_events (
    webhook_event_id text PRIMARY KEY,
    shop_id uuid REFERENCES local_service.shops(id) ON DELETE SET NULL,
    booking_id uuid REFERENCES local_service.bookings(id) ON DELETE SET NULL,
    processing_status text NOT NULL CHECK (processing_status IN ('processing','processed','failed')),
    processing_started_at timestamptz NOT NULL,
    attempt_count integer NOT NULL DEFAULT 1 CHECK (attempt_count > 0),
    lease_token uuid,
    last_error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE local_service.line_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE local_service.line_webhook_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE local_service.line_webhook_events TO service_role;

CREATE TABLE local_service.deposit_slip_upload_grants (
    id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    booking_id uuid NOT NULL REFERENCES local_service.bookings(id) ON DELETE CASCADE,
    grant_token_hash text NOT NULL UNIQUE,
    object_path text NOT NULL UNIQUE,
    content_type text NOT NULL CHECK (content_type IN ('image/jpeg','image/png','image/webp')),
    size_bytes bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880),
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE local_service.deposit_slip_upload_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE local_service.deposit_slip_upload_grants FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE local_service.deposit_slip_upload_grants TO service_role;

CREATE FUNCTION local_service.bk01_line_bind_booking(
    p_webhook_event_id text, p_booking_code text, p_link_token text,
    p_expected_shop_id uuid, p_line_user_id text
) RETURNS TABLE(claimed boolean, booking_id uuid, shop_id uuid,
                customer_id uuid, line_user_id text, booking_context jsonb,
                lease_token uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, local_service AS $$
DECLARE
    v_booking local_service.bookings%rowtype;
    v_event local_service.line_webhook_events%rowtype;
    v_lease uuid := extensions.uuid_generate_v4();
    v_inserted boolean := false;
BEGIN
    IF p_webhook_event_id IS NULL OR length(p_webhook_event_id) NOT BETWEEN 1 AND 200
       OR p_booking_code IS NULL OR p_link_token IS NULL OR p_expected_shop_id IS NULL
       OR p_line_user_id IS NULL OR p_line_user_id !~ '^U[0-9a-f]{32}$' THEN
        RAISE EXCEPTION 'Invalid LINE booking binding input';
    END IF;
    INSERT INTO local_service.line_webhook_events
      (webhook_event_id, processing_status, processing_started_at, lease_token)
    VALUES (p_webhook_event_id, 'processing', now(), v_lease)
    ON CONFLICT (webhook_event_id) DO NOTHING
    RETURNING true INTO v_inserted;
    SELECT * INTO v_event FROM local_service.line_webhook_events e
      WHERE e.webhook_event_id = p_webhook_event_id FOR UPDATE;
    IF NOT coalesce(v_inserted,false) AND (v_event.processing_status = 'processed'
       OR (v_event.processing_status = 'processing'
           AND v_event.processing_started_at >= now() - interval '5 minutes')) THEN
        RETURN QUERY SELECT false, NULL::uuid, NULL::uuid, NULL::uuid,
          NULL::text, NULL::jsonb, NULL::uuid;
        RETURN;
    END IF;
    IF v_event.processing_status = 'failed'
       OR v_event.processing_started_at < now() - interval '5 minutes' THEN
        UPDATE local_service.line_webhook_events e
           SET processing_status='processing', processing_started_at=now(), lease_token=v_lease,
               attempt_count=e.attempt_count+1, last_error=NULL, updated_at=now()
         WHERE e.webhook_event_id=p_webhook_event_id;
    END IF;
    SELECT b.* INTO v_booking FROM local_service.bookings b
      WHERE b.booking_code=p_booking_code AND b.shop_id=p_expected_shop_id FOR UPDATE;
    IF NOT FOUND OR v_booking.link_token IS DISTINCT FROM upper(trim(p_link_token))
       OR v_booking.link_token_expires_at IS NULL OR v_booking.link_token_expires_at <= now()
       OR NOT local_service.authorize_booking_recovery_attempt(v_booking.id, p_link_token)
       OR NOT EXISTS (SELECT 1 FROM local_service.shops s
          WHERE s.id=v_booking.shop_id AND s.line_oa_id IS NOT NULL AND s.line_oa_id <> '') THEN
        UPDATE local_service.line_webhook_events e SET processing_status='failed', lease_token=NULL,
          last_error='Invalid booking link or shop', updated_at=now()
          WHERE e.webhook_event_id=p_webhook_event_id;
        RETURN QUERY SELECT false, NULL::uuid, NULL::uuid, NULL::uuid,
          NULL::text, NULL::jsonb, NULL::uuid;
        RETURN;
    END IF;
    INSERT INTO local_service.line_users(shop_id, customer_id, line_user_id)
      VALUES(v_booking.shop_id, v_booking.customer_id, p_line_user_id)
      ON CONFLICT ON CONSTRAINT line_users_shop_id_line_user_id_key DO NOTHING;
    UPDATE local_service.line_users lu SET customer_id=v_booking.customer_id
      WHERE lu.shop_id=v_booking.shop_id AND lu.line_user_id=p_line_user_id
        AND lu.customer_id IS DISTINCT FROM v_booking.customer_id;
    UPDATE local_service.customers c SET line_user_id=p_line_user_id
      WHERE c.id=v_booking.customer_id AND c.shop_id=v_booking.shop_id;
    UPDATE local_service.line_webhook_events e SET shop_id=v_booking.shop_id,
      booking_id=v_booking.id, lease_token=v_lease, updated_at=now()
      WHERE e.webhook_event_id=p_webhook_event_id;
    RETURN QUERY SELECT true, v_booking.id, v_booking.shop_id, v_booking.customer_id,
      p_line_user_id,
      jsonb_build_object('booking_code',v_booking.booking_code,'booking_date',v_booking.booking_date,
        'start_time',v_booking.start_time,'customer_name',c.name,'shop_name',s.name),
      v_lease
      FROM local_service.customers c CROSS JOIN local_service.shops s
      WHERE c.id=v_booking.customer_id AND s.id=v_booking.shop_id;
END; $$;
REVOKE ALL ON FUNCTION local_service.bk01_line_bind_booking(text,text,text,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION local_service.bk01_line_bind_booking(text,text,text,uuid,text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION local_service.bk01_line_bind_booking(text,text,text,uuid,text) TO bk01_runtime;

CREATE FUNCTION local_service.bk01_finish_line_webhook_delivery(
    p_webhook_event_id text, p_lease_token uuid, p_status text, p_error_message text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, local_service AS $$
DECLARE v_count integer; v_error text;
BEGIN
    IF p_webhook_event_id IS NULL OR p_lease_token IS NULL OR p_status IS NULL
       OR p_status NOT IN ('processed','failed') THEN
        RAISE EXCEPTION 'Invalid LINE webhook completion input';
    END IF;
    v_error := left(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
      coalesce(p_error_message,''), '(?i)(bearer[[:space:]]+)[^[:space:]]+', '\1[REDACTED]', 'g'),
      '(?i)((access[_-]?token|refresh[_-]?token|api[_-]?key|token|secret|authorization)[[:space:]]*[:=][[:space:]]*)[^[:space:],;]+', '\1[REDACTED]', 'g'),
      '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[REDACTED_EMAIL]', 'g'),
      '(\+?[0-9][0-9() .-]{7,}[0-9])', '[REDACTED_PHONE]', 'g'), 500);
    UPDATE local_service.line_webhook_events e SET processing_status=p_status,
      last_error=CASE WHEN p_status='failed' THEN v_error ELSE NULL END,
      lease_token=NULL, updated_at=now()
      WHERE e.webhook_event_id=p_webhook_event_id AND e.lease_token=p_lease_token
        AND e.processing_status='processing';
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count=1;
END; $$;
REVOKE ALL ON FUNCTION local_service.bk01_finish_line_webhook_delivery(text,uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION local_service.bk01_finish_line_webhook_delivery(text,uuid,text,text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION local_service.bk01_finish_line_webhook_delivery(text,uuid,text,text) TO bk01_runtime;

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

CREATE FUNCTION local_service.authorize_deposit_slip_upload(
    p_booking_id uuid, p_recovery_token text, p_content_type text, p_size_bytes bigint
) RETURNS TABLE(grant_id uuid, object_path text, expires_at timestamptz, grant_token text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, local_service AS $$
DECLARE
    v_booking local_service.bookings%rowtype;
    v_token text := encode(extensions.gen_random_bytes(32), 'hex');
    v_grant_id uuid := extensions.uuid_generate_v4();
    v_path text;
    v_extension text;
    v_expiry timestamptz := now() + interval '5 minutes';
BEGIN
    IF p_booking_id IS NULL OR p_recovery_token IS NULL OR p_content_type IS NULL
       OR p_content_type NOT IN ('image/jpeg','image/png','image/webp')
       OR p_size_bytes IS NULL OR p_size_bytes <= 0 OR p_size_bytes > 5242880 THEN
        RAISE EXCEPTION 'Invalid deposit upload input';
    END IF;
    SELECT b.* INTO v_booking FROM local_service.bookings b WHERE b.id=p_booking_id FOR UPDATE;
    IF NOT FOUND OR v_booking.status <> 'hold'
       OR v_booking.deposit_status NOT IN ('awaiting','rejected')
       OR v_booking.expires_at IS NULL OR v_booking.expires_at <= now()
       OR v_booking.link_token_expires_at IS NULL OR v_booking.link_token_expires_at <= now()
       OR v_booking.link_token IS DISTINCT FROM upper(trim(p_recovery_token))
       OR NOT local_service.authorize_booking_recovery_attempt(p_booking_id,p_recovery_token) THEN
        RAISE EXCEPTION 'Booking is not authorized for deposit upload';
    END IF;
    v_extension := CASE p_content_type WHEN 'image/jpeg' THEN 'jpg'
      WHEN 'image/png' THEN 'png' ELSE 'webp' END;
    v_path := v_booking.id::text || '/' || v_grant_id::text || '.' || v_extension;
    INSERT INTO local_service.deposit_slip_upload_grants
      (id,booking_id,grant_token_hash,object_path,content_type,size_bytes,expires_at)
    VALUES(v_grant_id,v_booking.id,encode(extensions.digest(convert_to(v_token,'UTF8'),'sha256'),'hex'),
      v_path,p_content_type,p_size_bytes,v_expiry);
    RETURN QUERY SELECT v_grant_id,v_path,v_expiry,v_token;
END; $$;
REVOKE ALL ON FUNCTION local_service.authorize_deposit_slip_upload(uuid,text,text,bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION local_service.authorize_deposit_slip_upload(uuid,text,text,bigint) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION local_service.authorize_deposit_slip_upload(uuid,text,text,bigint) TO bk01_runtime;

CREATE FUNCTION local_service.finish_stripe_webhook_event(p_id text, p_status text, p_error text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, local_service AS $$
DECLARE v_count integer; v_error text;
BEGIN
    IF p_id IS NULL OR length(p_id) NOT BETWEEN 1 AND 255 OR p_status IS NULL
       OR p_status NOT IN ('processed','failed') THEN
        RAISE EXCEPTION 'Invalid Stripe webhook completion input';
    END IF;
    v_error := left(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
      coalesce(p_error,''), '(?i)(bearer[[:space:]]+)[^[:space:]]+', '\1[REDACTED]', 'g'),
      '(?i)((access[_-]?token|refresh[_-]?token|api[_-]?key|token|secret|authorization)[[:space:]]*[:=][[:space:]]*)[^[:space:],;]+', '\1[REDACTED]', 'g'),
      '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[REDACTED_EMAIL]', 'g'),
      '(\+?[0-9][0-9() .-]{7,}[0-9])', '[REDACTED_PHONE]', 'g'), 500);
    UPDATE local_service.stripe_webhook_events e SET processing_status=p_status,
      processed_at=CASE WHEN p_status='processed' THEN now() ELSE e.processed_at END,
      last_error=CASE WHEN p_status='failed' THEN v_error ELSE NULL END
      WHERE e.id=p_id AND e.processing_status='processing';
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count=1;
END; $$;
REVOKE ALL ON FUNCTION local_service.finish_stripe_webhook_event(text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION local_service.finish_stripe_webhook_event(text,text,text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION local_service.finish_stripe_webhook_event(text,text,text) TO bk01_runtime;
