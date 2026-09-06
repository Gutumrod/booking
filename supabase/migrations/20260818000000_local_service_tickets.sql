-- Ticket and Case Management Schema for Local Service Booking SaaS
-- Date: 2026-08-18
-- Migration: 20260818000000_local_service_tickets.sql

-- ============================================================================
-- 1. TABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS local_service.tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL REFERENCES local_service.shops(id) ON DELETE CASCADE,
    booking_id UUID REFERENCES local_service.bookings(id) ON DELETE SET NULL,
    service_id UUID REFERENCES local_service.services(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL CHECK (type IN ('ProductClaim', 'ServiceIssue', 'RecheckRequest', 'RefundRequest', 'Other')),
    status VARCHAR(50) NOT NULL DEFAULT 'New' CHECK (status IN ('New', 'Acknowledged', 'InReview', 'WaitingForCustomer', 'RecheckScheduled', 'Resolved', 'Closed', 'Reopened')),
    priority VARCHAR(50) NOT NULL DEFAULT 'Medium' CHECK (priority IN ('Low', 'Medium', 'High')),
    customer_name VARCHAR(255) NOT NULL,
    customer_phone VARCHAR(50) NOT NULL,
    normalized_phone VARCHAR(50) NOT NULL,
    contact_channel VARCHAR(100),
    assigned_to VARCHAR(255),
    description TEXT NOT NULL,
    issue_category VARCHAR(255) DEFAULT '',
    related_product_service VARCHAR(255) DEFAULT '',
    occurred_at TIMESTAMPTZ,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    due_at TIMESTAMPTZ NOT NULL,
    closed_at TIMESTAMPTZ,
    resolution TEXT,
    attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
    creation_idempotency_key UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS local_service.ticket_timeline_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID NOT NULL REFERENCES local_service.tickets(id) ON DELETE CASCADE,
    shop_id UUID NOT NULL REFERENCES local_service.shops(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL CHECK (event_type IN ('Created', 'StatusChanged', 'PriorityChanged', 'AssigneeChanged', 'CommentAdded', 'ResolutionSaved', 'Closed', 'Reopened')),
    message TEXT NOT NULL,
    actor VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 2. INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_tickets_shop_id ON local_service.tickets(shop_id);
CREATE INDEX IF NOT EXISTS idx_tickets_shop_normalized_phone ON local_service.tickets(shop_id, normalized_phone);
CREATE INDEX IF NOT EXISTS idx_tickets_shop_status ON local_service.tickets(shop_id, status);
CREATE INDEX IF NOT EXISTS idx_tickets_shop_due_at ON local_service.tickets(shop_id, due_at);
CREATE INDEX IF NOT EXISTS idx_tickets_booking_id ON local_service.tickets(booking_id);
CREATE INDEX IF NOT EXISTS idx_tickets_created_at ON local_service.tickets(shop_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ticket_timeline_ticket_id ON local_service.ticket_timeline_entries(ticket_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_ticket_timeline_shop_id ON local_service.ticket_timeline_entries(shop_id);

CREATE UNIQUE INDEX IF NOT EXISTS tickets_shop_creation_idempotency_key
    ON local_service.tickets (shop_id, creation_idempotency_key)
    WHERE creation_idempotency_key IS NOT NULL;

-- ============================================================================
-- 3. ROW LEVEL SECURITY (RLS) POLICIES & TABLE GRANTS
-- ============================================================================

ALTER TABLE local_service.tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE local_service.ticket_timeline_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members view shop tickets" ON local_service.tickets;
CREATE POLICY "Members view shop tickets"
    ON local_service.tickets
    FOR SELECT
    USING (local_service.is_shop_member(shop_id));

DROP POLICY IF EXISTS "Members view shop ticket timeline" ON local_service.ticket_timeline_entries;
CREATE POLICY "Members view shop ticket timeline"
    ON local_service.ticket_timeline_entries
    FOR SELECT
    USING (local_service.is_shop_member(shop_id));

-- Revoke all table writes from authenticated & anon. Writes must go through SECURITY DEFINER RPCs.
REVOKE ALL ON TABLE local_service.tickets, local_service.ticket_timeline_entries FROM PUBLIC, anon;
GRANT SELECT ON TABLE local_service.tickets, local_service.ticket_timeline_entries TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE local_service.tickets, local_service.ticket_timeline_entries FROM authenticated;

-- ============================================================================
-- 4. RPC FUNCTIONS
-- ============================================================================

-- 4.1 create_ticket
CREATE OR REPLACE FUNCTION local_service.create_ticket(
    p_shop_id UUID,
    p_booking_id UUID,
    p_service_id UUID,
    p_title TEXT,
    p_type TEXT,
    p_priority TEXT,
    p_customer_name TEXT,
    p_customer_phone TEXT,
    p_normalized_phone TEXT,
    p_contact_channel TEXT,
    p_description TEXT,
    p_issue_category TEXT,
    p_related_product_service TEXT,
    p_occurred_at TIMESTAMPTZ,
    p_received_at TIMESTAMPTZ,
    p_due_at TIMESTAMPTZ,
    p_idempotency_key UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, local_service
AS $$
DECLARE
    v_ticket_id UUID;
    v_norm_phone TEXT;
BEGIN
    IF NOT local_service.has_shop_role(p_shop_id, ARRAY['owner', 'admin']::TEXT[]) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Owner or admin role required';
    END IF;

    IF p_idempotency_key IS NULL THEN
        RAISE EXCEPTION 'Idempotency key is required' USING ERRCODE = '22023';
    END IF;

    IF NULLIF(BTRIM(p_title), '') IS NULL THEN
        RAISE EXCEPTION 'Ticket title is required' USING ERRCODE = '22023';
    END IF;

    IF NULLIF(BTRIM(p_description), '') IS NULL THEN
        RAISE EXCEPTION 'Ticket description is required' USING ERRCODE = '22023';
    END IF;

    IF NULLIF(BTRIM(p_customer_name), '') IS NULL THEN
        RAISE EXCEPTION 'Customer name is required' USING ERRCODE = '22023';
    END IF;

    IF NULLIF(BTRIM(p_customer_phone), '') IS NULL THEN
        RAISE EXCEPTION 'Customer phone is required' USING ERRCODE = '22023';
    END IF;

    IF p_type IS NULL OR p_type NOT IN ('ProductClaim', 'ServiceIssue', 'RecheckRequest', 'RefundRequest', 'Other') THEN
        RAISE EXCEPTION 'Invalid ticket type' USING ERRCODE = '22023';
    END IF;

    IF p_priority IS NULL OR p_priority NOT IN ('Low', 'Medium', 'High') THEN
        RAISE EXCEPTION 'Invalid ticket priority' USING ERRCODE = '22023';
    END IF;

    IF p_received_at IS NULL THEN
        RAISE EXCEPTION 'received_at is required' USING ERRCODE = '22023';
    END IF;

    IF p_due_at IS NULL THEN
        RAISE EXCEPTION 'due_at is required' USING ERRCODE = '22023';
    END IF;

    IF p_due_at < p_received_at THEN
        RAISE EXCEPTION 'due_at must be greater than or equal to received_at' USING ERRCODE = '22023';
    END IF;

    -- Idempotency check: return existing ticket if already created with this idempotency key
    SELECT id
      INTO v_ticket_id
      FROM local_service.tickets
     WHERE shop_id = p_shop_id
       AND creation_idempotency_key = p_idempotency_key;

    IF v_ticket_id IS NOT NULL THEN
        RETURN v_ticket_id;
    END IF;

    v_norm_phone := COALESCE(
        NULLIF(BTRIM(p_normalized_phone), ''),
        regexp_replace(p_customer_phone, '\D', '', 'g')
    );

    INSERT INTO local_service.tickets (
        shop_id,
        booking_id,
        service_id,
        title,
        type,
        status,
        priority,
        customer_name,
        customer_phone,
        normalized_phone,
        contact_channel,
        description,
        issue_category,
        related_product_service,
        occurred_at,
        received_at,
        due_at,
        creation_idempotency_key
    ) VALUES (
        p_shop_id,
        p_booking_id,
        p_service_id,
        BTRIM(p_title),
        p_type,
        'New',
        p_priority,
        BTRIM(p_customer_name),
        BTRIM(p_customer_phone),
        v_norm_phone,
        NULLIF(BTRIM(p_contact_channel), ''),
        BTRIM(p_description),
        COALESCE(BTRIM(p_issue_category), ''),
        COALESCE(BTRIM(p_related_product_service), ''),
        p_occurred_at,
        p_received_at,
        p_due_at,
        p_idempotency_key
    )
    RETURNING id INTO v_ticket_id;

    INSERT INTO local_service.ticket_timeline_entries (
        ticket_id,
        shop_id,
        event_type,
        message,
        actor
    ) VALUES (
        v_ticket_id,
        p_shop_id,
        'Created',
        'Ticket created',
        'Staff'
    );

    RETURN v_ticket_id;
END;
$$;

-- 4.2 update_ticket_status
CREATE OR REPLACE FUNCTION local_service.update_ticket_status(
    p_ticket_id UUID,
    p_new_status TEXT,
    p_actor TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, local_service
AS $$
DECLARE
    v_ticket local_service.tickets%ROWTYPE;
    v_is_valid BOOLEAN := FALSE;
    v_actor TEXT;
BEGIN
    SELECT * INTO v_ticket
      FROM local_service.tickets
     WHERE id = p_ticket_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Ticket not found' USING ERRCODE = 'P0002';
    END IF;

    IF NOT local_service.has_shop_role(v_ticket.shop_id, ARRAY['owner', 'admin']::TEXT[]) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Owner or admin role required';
    END IF;

    IF p_new_status IS NULL OR p_new_status NOT IN (
        'New', 'Acknowledged', 'InReview', 'WaitingForCustomer',
        'RecheckScheduled', 'Resolved', 'Closed', 'Reopened'
    ) THEN
        RAISE EXCEPTION 'Invalid ticket status' USING ERRCODE = '22023';
    END IF;

    -- Enforce transition rules aligned with ticket-domain.ts ALLOWED_TRANSITIONS
    IF v_ticket.status = 'New' AND p_new_status IN ('Acknowledged', 'InReview', 'WaitingForCustomer', 'Closed') THEN
        v_is_valid := TRUE;
    ELSIF v_ticket.status = 'Acknowledged' AND p_new_status IN ('InReview', 'WaitingForCustomer', 'Closed') THEN
        v_is_valid := TRUE;
    ELSIF v_ticket.status = 'InReview' AND p_new_status IN ('Acknowledged', 'WaitingForCustomer', 'RecheckScheduled', 'Resolved', 'Closed') THEN
        v_is_valid := TRUE;
    ELSIF v_ticket.status = 'WaitingForCustomer' AND p_new_status IN ('Acknowledged', 'InReview', 'Closed') THEN
        v_is_valid := TRUE;
    ELSIF v_ticket.status = 'RecheckScheduled' AND p_new_status IN ('InReview', 'Resolved', 'Closed') THEN
        v_is_valid := TRUE;
    ELSIF v_ticket.status = 'Resolved' AND p_new_status IN ('InReview', 'Closed') THEN
        v_is_valid := TRUE;
    ELSIF v_ticket.status = 'Closed' AND p_new_status = 'Reopened' THEN
        v_is_valid := TRUE;
    ELSIF v_ticket.status = 'Reopened' AND p_new_status IN ('Acknowledged', 'InReview', 'WaitingForCustomer', 'Closed') THEN
        v_is_valid := TRUE;
    END IF;

    IF NOT v_is_valid THEN
        IF v_ticket.status = 'Closed' THEN
            RAISE EXCEPTION 'Closed tickets must be reopened before changing status.' USING ERRCODE = '22023';
        ELSE
            RAISE EXCEPTION 'Cannot transition from "%" to "%"', v_ticket.status, p_new_status USING ERRCODE = '22023';
        END IF;
    END IF;

    v_actor := COALESCE(NULLIF(BTRIM(p_actor), ''), 'Staff');

    UPDATE local_service.tickets
       SET status = p_new_status,
           closed_at = CASE
               WHEN p_new_status = 'Closed' THEN NOW()
               WHEN v_ticket.status = 'Closed' AND p_new_status = 'Reopened' THEN NULL
               ELSE closed_at
           END,
           updated_at = NOW()
     WHERE id = p_ticket_id;

    INSERT INTO local_service.ticket_timeline_entries (
        ticket_id,
        shop_id,
        event_type,
        message,
        actor
    ) VALUES (
        p_ticket_id,
        v_ticket.shop_id,
        'StatusChanged',
        format('Status changed from %s to %s.', v_ticket.status, p_new_status),
        v_actor
    );
END;
$$;

-- 4.3 add_ticket_timeline_entry
CREATE OR REPLACE FUNCTION local_service.add_ticket_timeline_entry(
    p_ticket_id UUID,
    p_event_type TEXT,
    p_message TEXT,
    p_actor TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, local_service
AS $$
DECLARE
    v_ticket local_service.tickets%ROWTYPE;
    v_entry_id UUID;
    v_actor TEXT;
BEGIN
    SELECT * INTO v_ticket
      FROM local_service.tickets
     WHERE id = p_ticket_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Ticket not found' USING ERRCODE = 'P0002';
    END IF;

    IF NOT local_service.has_shop_role(v_ticket.shop_id, ARRAY['owner', 'admin']::TEXT[]) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Owner or admin role required';
    END IF;

    IF NULLIF(BTRIM(p_message), '') IS NULL THEN
        RAISE EXCEPTION 'Timeline message is required' USING ERRCODE = '22023';
    END IF;

    IF p_event_type IS NULL OR p_event_type NOT IN (
        'Created', 'StatusChanged', 'PriorityChanged', 'AssigneeChanged',
        'CommentAdded', 'ResolutionSaved', 'Closed', 'Reopened'
    ) THEN
        RAISE EXCEPTION 'Invalid event type' USING ERRCODE = '22023';
    END IF;

    v_actor := COALESCE(NULLIF(BTRIM(p_actor), ''), 'Staff');

    UPDATE local_service.tickets
       SET updated_at = NOW()
     WHERE id = p_ticket_id;

    INSERT INTO local_service.ticket_timeline_entries (
        ticket_id,
        shop_id,
        event_type,
        message,
        actor
    ) VALUES (
        p_ticket_id,
        v_ticket.shop_id,
        p_event_type,
        BTRIM(p_message),
        v_actor
    )
    RETURNING id INTO v_entry_id;

    RETURN v_entry_id;
END;
$$;

-- 4.4 preview_ticket_retention
CREATE OR REPLACE FUNCTION local_service.preview_ticket_retention(
    p_shop_id UUID,
    p_cutoff_date DATE
)
RETURNS TABLE(
    id UUID,
    closed_at TIMESTAMPTZ,
    customer_name TEXT,
    title TEXT,
    attachment_count INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, local_service
AS $$
BEGIN
    IF NOT local_service.has_shop_role(p_shop_id, ARRAY['owner', 'admin']::TEXT[]) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Owner or admin role required';
    END IF;

    IF p_cutoff_date IS NULL THEN
        RAISE EXCEPTION 'Cutoff date is required' USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    SELECT
        t.id,
        t.closed_at,
        t.customer_name::TEXT,
        t.title::TEXT,
        COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(t.attachments) = 'array' THEN t.attachments ELSE '[]'::jsonb END), 0)::INT AS attachment_count
    FROM local_service.tickets t
    WHERE t.shop_id = p_shop_id
      AND t.status = 'Closed'
      AND t.closed_at IS NOT NULL
      AND t.closed_at < (p_cutoff_date + INTERVAL '1 day')
    ORDER BY t.closed_at ASC;
END;
$$;

-- 4.5 delete_closed_tickets_before
CREATE OR REPLACE FUNCTION local_service.delete_closed_tickets_before(
    p_shop_id UUID,
    p_cutoff_date DATE
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, local_service
AS $$
DECLARE
    v_deleted_count INTEGER := 0;
BEGIN
    IF NOT local_service.has_shop_role(p_shop_id, ARRAY['owner', 'admin']::TEXT[]) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Owner or admin role required';
    END IF;

    IF p_cutoff_date IS NULL THEN
        RAISE EXCEPTION 'Cutoff date is required' USING ERRCODE = '22023';
    END IF;

    DELETE FROM local_service.tickets
     WHERE shop_id = p_shop_id
       AND status = 'Closed'
       AND closed_at IS NOT NULL
       AND closed_at < (p_cutoff_date + INTERVAL '1 day');

    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
    RETURN v_deleted_count;
END;
$$;

-- 4.6 update_ticket_priority
CREATE OR REPLACE FUNCTION local_service.update_ticket_priority(
    p_ticket_id UUID,
    p_new_priority TEXT,
    p_actor TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, local_service
AS $$
DECLARE
    v_ticket local_service.tickets%ROWTYPE;
    v_actor TEXT;
BEGIN
    SELECT * INTO v_ticket
      FROM local_service.tickets
     WHERE id = p_ticket_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Ticket not found' USING ERRCODE = 'P0002';
    END IF;

    IF NOT local_service.has_shop_role(v_ticket.shop_id, ARRAY['owner', 'admin']::TEXT[]) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Owner or admin role required';
    END IF;

    IF p_new_priority IS NULL OR p_new_priority NOT IN ('Low', 'Medium', 'High') THEN
        RAISE EXCEPTION 'Invalid ticket priority' USING ERRCODE = '22023';
    END IF;

    v_actor := COALESCE(NULLIF(BTRIM(p_actor), ''), 'Staff');

    UPDATE local_service.tickets
       SET priority = p_new_priority,
           updated_at = NOW()
     WHERE id = p_ticket_id;

    INSERT INTO local_service.ticket_timeline_entries (
        ticket_id,
        shop_id,
        event_type,
        message,
        actor
    ) VALUES (
        p_ticket_id,
        v_ticket.shop_id,
        'PriorityChanged',
        format('Priority changed from %s to %s.', v_ticket.priority, p_new_priority),
        v_actor
    );
END;
$$;

-- 4.7 update_ticket_assignee
CREATE OR REPLACE FUNCTION local_service.update_ticket_assignee(
    p_ticket_id UUID,
    p_new_assignee TEXT,
    p_actor TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, local_service
AS $$
DECLARE
    v_ticket local_service.tickets%ROWTYPE;
    v_actor TEXT;
    v_clean_assignee TEXT;
    v_prev_assignee TEXT;
    v_display_new TEXT;
BEGIN
    SELECT * INTO v_ticket
      FROM local_service.tickets
     WHERE id = p_ticket_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Ticket not found' USING ERRCODE = 'P0002';
    END IF;

    IF NOT local_service.has_shop_role(v_ticket.shop_id, ARRAY['owner', 'admin']::TEXT[]) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Owner or admin role required';
    END IF;

    v_clean_assignee := NULLIF(BTRIM(p_new_assignee), '');
    v_prev_assignee := COALESCE(v_ticket.assigned_to, 'Unassigned');
    v_display_new := COALESCE(v_clean_assignee, 'Unassigned');
    v_actor := COALESCE(NULLIF(BTRIM(p_actor), ''), 'Staff');

    UPDATE local_service.tickets
       SET assigned_to = v_clean_assignee,
           updated_at = NOW()
     WHERE id = p_ticket_id;

    INSERT INTO local_service.ticket_timeline_entries (
        ticket_id,
        shop_id,
        event_type,
        message,
        actor
    ) VALUES (
        p_ticket_id,
        v_ticket.shop_id,
        'AssigneeChanged',
        format('Assignee changed from %s to %s.', v_prev_assignee, v_display_new),
        v_actor
    );
END;
$$;

-- 4.8 save_ticket_resolution
CREATE OR REPLACE FUNCTION local_service.save_ticket_resolution(
    p_ticket_id UUID,
    p_resolution TEXT,
    p_actor TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, local_service
AS $$
DECLARE
    v_ticket local_service.tickets%ROWTYPE;
    v_actor TEXT;
BEGIN
    SELECT * INTO v_ticket
      FROM local_service.tickets
     WHERE id = p_ticket_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Ticket not found' USING ERRCODE = 'P0002';
    END IF;

    IF NOT local_service.has_shop_role(v_ticket.shop_id, ARRAY['owner', 'admin']::TEXT[]) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Owner or admin role required';
    END IF;

    IF NULLIF(BTRIM(p_resolution), '') IS NULL THEN
        RAISE EXCEPTION 'Resolution is required' USING ERRCODE = '22023';
    END IF;

    v_actor := COALESCE(NULLIF(BTRIM(p_actor), ''), 'Staff');

    UPDATE local_service.tickets
       SET resolution = BTRIM(p_resolution),
           updated_at = NOW()
     WHERE id = p_ticket_id;

    INSERT INTO local_service.ticket_timeline_entries (
        ticket_id,
        shop_id,
        event_type,
        message,
        actor
    ) VALUES (
        p_ticket_id,
        v_ticket.shop_id,
        'ResolutionSaved',
        format('Resolution recorded: %s', BTRIM(p_resolution)),
        v_actor
    );
END;
$$;

-- ============================================================================
-- 5. FUNCTION PERMISSIONS (REVOKE / GRANT)
-- ============================================================================

REVOKE ALL ON FUNCTION local_service.create_ticket(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION local_service.create_ticket(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, UUID) TO authenticated;

REVOKE ALL ON FUNCTION local_service.update_ticket_status(UUID, TEXT, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION local_service.update_ticket_status(UUID, TEXT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION local_service.add_ticket_timeline_entry(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION local_service.add_ticket_timeline_entry(UUID, TEXT, TEXT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION local_service.preview_ticket_retention(UUID, DATE) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION local_service.preview_ticket_retention(UUID, DATE) TO authenticated;

REVOKE ALL ON FUNCTION local_service.delete_closed_tickets_before(UUID, DATE) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION local_service.delete_closed_tickets_before(UUID, DATE) TO authenticated;

REVOKE ALL ON FUNCTION local_service.update_ticket_priority(UUID, TEXT, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION local_service.update_ticket_priority(UUID, TEXT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION local_service.update_ticket_assignee(UUID, TEXT, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION local_service.update_ticket_assignee(UUID, TEXT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION local_service.save_ticket_resolution(UUID, TEXT, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION local_service.save_ticket_resolution(UUID, TEXT, TEXT) TO authenticated;
