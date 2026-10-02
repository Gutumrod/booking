-- Roll back only the G09/G10 follow-up to the exact 20261002140000 candidate.

CREATE OR REPLACE FUNCTION local_service.authorize_booking_recovery_attempt(
    p_booking_id uuid,
    p_recovery_token text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,local_service AS $$
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

CREATE OR REPLACE FUNCTION local_service.authorize_deposit_slip_upload(
    p_booking_id uuid, p_recovery_token text, p_content_type text, p_size_bytes bigint
) RETURNS TABLE(grant_id uuid, object_path text, expires_at timestamptz, grant_token text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, local_service AS $$
DECLARE
    v_booking local_service.bookings%rowtype;
    v_token text := encode(pg_catalog.sha256(
      pg_catalog.uuid_send(pg_catalog.gen_random_uuid()) || pg_catalog.uuid_send(pg_catalog.gen_random_uuid())
    ), 'hex');
    v_grant_id uuid := pg_catalog.gen_random_uuid();
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
    VALUES(v_grant_id,v_booking.id,encode(pg_catalog.sha256(convert_to(v_token,'UTF8')),'hex'),
      v_path,p_content_type,p_size_bytes,v_expiry);

    PERFORM wstera_platform_internal.register_storage_upload_grant(
      'deposit-slips', v_path,
      encode(pg_catalog.sha256(convert_to(v_token,'UTF8')),'hex'),
      p_content_type, p_size_bytes, v_expiry
    );
    RETURN QUERY SELECT v_grant_id,v_path,v_expiry,v_token;
END; $$;

CREATE OR REPLACE FUNCTION local_service.bk01_line_bind_booking(
    p_webhook_event_id text, p_booking_code text, p_link_token text,
    p_expected_shop_id uuid, p_line_user_id text
) RETURNS TABLE(claimed boolean, booking_id uuid, shop_id uuid,
                customer_id uuid, line_user_id text, booking_context jsonb,
                lease_token uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, local_service AS $$
DECLARE
    v_booking local_service.bookings%rowtype;
    v_event local_service.line_webhook_events%rowtype;
    v_lease uuid := pg_catalog.gen_random_uuid();
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

DROP INDEX local_service.booking_recovery_attempts_window_idx;
DROP TABLE local_service_internal.booking_upload_intent_attempts;
