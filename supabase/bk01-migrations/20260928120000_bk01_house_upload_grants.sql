-- Register BK01's short-lived upload grant in the House registry in the same
-- transaction as the existing authorization RPC. The prior three migrations are frozen.
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
REVOKE ALL ON FUNCTION local_service.authorize_deposit_slip_upload(uuid,text,text,bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION local_service.authorize_deposit_slip_upload(uuid,text,text,bigint) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION local_service.authorize_deposit_slip_upload(uuid,text,text,bigint) TO bk01_runtime;
