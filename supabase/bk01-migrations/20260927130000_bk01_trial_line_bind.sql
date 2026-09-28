-- Target: BK01 product database
-- Predecessor: 20260927120000_bk01_runtime_route_rpcs.sql
-- Trial LINE binding uses the shared OA and has no trusted shop UUID in the webhook.

ALTER TABLE local_service.bookings
  ADD COLUMN line_binding_token_used_at timestamptz,
  ADD COLUMN line_binding_webhook_event_id text;
COMMENT ON COLUMN local_service.bookings.line_binding_token_used_at IS
  'One-time consumption timestamp for a booking link token used to bind a customer through the shared trial LINE OA.';
COMMENT ON COLUMN local_service.bookings.line_binding_webhook_event_id IS
  'LINE webhook event allowed to retry delivery after a successful one-time trial binding.';

CREATE FUNCTION local_service.bk01_line_bind_booking_trial(
    p_webhook_event_id text,
    p_booking_code text,
    p_link_token text,
    p_line_user_id text
) RETURNS TABLE(
    claimed boolean,
    booking_id uuid,
    shop_id uuid,
    booking_context jsonb,
    lease_token uuid
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, local_service AS $$
DECLARE
    v_booking local_service.bookings%rowtype;
    v_event local_service.line_webhook_events%rowtype;
    v_customer local_service.customers%rowtype;
    v_mapped_customer_id uuid;
    v_lease uuid := extensions.uuid_generate_v4();
    v_inserted boolean := false;
BEGIN
    IF p_webhook_event_id IS NULL OR length(p_webhook_event_id) NOT BETWEEN 1 AND 200
       OR p_booking_code IS NULL OR length(p_booking_code) NOT BETWEEN 1 AND 20
       OR p_link_token IS NULL OR length(trim(p_link_token)) <> 10
       OR p_line_user_id IS NULL OR p_line_user_id !~ '^U[0-9a-f]{32}$' THEN
        RAISE EXCEPTION 'Invalid LINE trial booking binding input';
    END IF;

    INSERT INTO local_service.line_webhook_events
      (webhook_event_id, processing_status, processing_started_at, lease_token)
    VALUES (p_webhook_event_id, 'processing', now(), v_lease)
    ON CONFLICT (webhook_event_id) DO NOTHING
    RETURNING true INTO v_inserted;

    SELECT * INTO v_event FROM local_service.line_webhook_events e
      WHERE e.webhook_event_id = p_webhook_event_id FOR UPDATE;
    IF NOT coalesce(v_inserted, false) AND (v_event.processing_status = 'processed'
       OR (v_event.processing_status = 'processing'
           AND v_event.processing_started_at >= now() - interval '5 minutes')) THEN
        RETURN QUERY SELECT false, NULL::uuid, NULL::uuid, NULL::jsonb, NULL::uuid;
        RETURN;
    END IF;

    IF v_event.processing_status = 'failed'
       OR v_event.processing_started_at < now() - interval '5 minutes' THEN
        UPDATE local_service.line_webhook_events e
           SET processing_status = 'processing', processing_started_at = now(),
               lease_token = v_lease, attempt_count = e.attempt_count + 1,
               last_error = NULL, updated_at = now()
         WHERE e.webhook_event_id = p_webhook_event_id;
    END IF;

    SELECT b.* INTO v_booking
      FROM local_service.bookings b
     WHERE b.booking_code = upper(trim(p_booking_code))
     FOR UPDATE;

    IF NOT FOUND
       OR NOT local_service.authorize_booking_recovery_attempt(v_booking.id, p_link_token) THEN
        UPDATE local_service.line_webhook_events e
           SET processing_status = 'failed', lease_token = NULL,
               last_error = 'Invalid booking link or trial channel', updated_at = now()
         WHERE e.webhook_event_id = p_webhook_event_id;
        RETURN QUERY SELECT false, NULL::uuid, NULL::uuid, NULL::jsonb, NULL::uuid;
        RETURN;
    END IF;

    IF v_booking.link_token IS DISTINCT FROM upper(trim(p_link_token))
       OR v_booking.link_token_expires_at IS NULL OR v_booking.link_token_expires_at <= now()
       OR v_booking.status NOT IN ('hold', 'pending_deposit', 'confirmed')
       OR (v_booking.status = 'hold' AND v_booking.expires_at IS NOT NULL
           AND v_booking.expires_at <= now())
       OR (v_booking.line_binding_token_used_at IS NOT NULL
           AND v_booking.line_binding_webhook_event_id IS DISTINCT FROM p_webhook_event_id)
       OR NOT EXISTS (
          SELECT 1 FROM local_service.shops s
           WHERE s.id = v_booking.shop_id AND s.is_active = true
             AND nullif(btrim(s.line_oa_id), '') IS NULL
       ) THEN
        UPDATE local_service.line_webhook_events e
           SET processing_status = 'failed', lease_token = NULL,
               last_error = 'Invalid booking link or trial channel', updated_at = now()
         WHERE e.webhook_event_id = p_webhook_event_id;
        RETURN QUERY SELECT false, NULL::uuid, NULL::uuid, NULL::jsonb, NULL::uuid;
        RETURN;
    END IF;

    IF v_event.booking_id IS NOT NULL AND v_event.booking_id IS DISTINCT FROM v_booking.id THEN
        UPDATE local_service.line_webhook_events e
           SET processing_status = 'failed', lease_token = NULL,
               last_error = 'Invalid booking link or trial channel', updated_at = now()
         WHERE e.webhook_event_id = p_webhook_event_id;
        RETURN QUERY SELECT false, NULL::uuid, NULL::uuid, NULL::jsonb, NULL::uuid;
        RETURN;
    END IF;

    SELECT c.* INTO v_customer FROM local_service.customers c
     WHERE c.id = v_booking.customer_id AND c.shop_id = v_booking.shop_id
     FOR UPDATE;
    IF NOT FOUND OR (v_customer.line_user_id IS NOT NULL
       AND v_customer.line_user_id IS DISTINCT FROM p_line_user_id) THEN
        UPDATE local_service.line_webhook_events e
           SET processing_status = 'failed', lease_token = NULL,
               last_error = 'Invalid booking link or trial channel', updated_at = now()
         WHERE e.webhook_event_id = p_webhook_event_id;
        RETURN QUERY SELECT false, NULL::uuid, NULL::uuid, NULL::jsonb, NULL::uuid;
        RETURN;
    END IF;

    SELECT lu.customer_id INTO v_mapped_customer_id
      FROM local_service.line_users lu
     WHERE lu.shop_id = v_booking.shop_id AND lu.line_user_id = p_line_user_id
     FOR UPDATE;
    IF FOUND AND v_mapped_customer_id IS DISTINCT FROM v_booking.customer_id THEN
        UPDATE local_service.line_webhook_events e
           SET processing_status = 'failed', lease_token = NULL,
               last_error = 'Invalid booking link or trial channel', updated_at = now()
         WHERE e.webhook_event_id = p_webhook_event_id;
        RETURN QUERY SELECT false, NULL::uuid, NULL::uuid, NULL::jsonb, NULL::uuid;
        RETURN;
    END IF;

    INSERT INTO local_service.line_users(shop_id, customer_id, line_user_id)
      VALUES (v_booking.shop_id, v_booking.customer_id, p_line_user_id)
      ON CONFLICT ON CONSTRAINT line_users_shop_id_line_user_id_key DO NOTHING;
    UPDATE local_service.customers c SET line_user_id = p_line_user_id
      WHERE c.id = v_booking.customer_id AND c.shop_id = v_booking.shop_id
        AND c.line_user_id IS NULL;
    UPDATE local_service.bookings b
       SET line_binding_token_used_at = coalesce(b.line_binding_token_used_at, now()),
           line_binding_webhook_event_id = coalesce(b.line_binding_webhook_event_id, p_webhook_event_id)
     WHERE b.id = v_booking.id;
    UPDATE local_service.line_webhook_events e
       SET shop_id = v_booking.shop_id, booking_id = v_booking.id,
           lease_token = v_lease, updated_at = now()
     WHERE e.webhook_event_id = p_webhook_event_id;

    RETURN QUERY SELECT true, v_booking.id, v_booking.shop_id,
      jsonb_build_object('booking_code', v_booking.booking_code,
        'booking_date', v_booking.booking_date, 'start_time', v_booking.start_time,
        'shop_name', s.name), v_lease
      FROM local_service.shops s WHERE s.id = v_booking.shop_id;
END; $$;

REVOKE ALL ON FUNCTION local_service.bk01_line_bind_booking_trial(text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION local_service.bk01_line_bind_booking_trial(text,text,text,text) FROM anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION local_service.bk01_line_bind_booking_trial(text,text,text,text) TO bk01_runtime;
