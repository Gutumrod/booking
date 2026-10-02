-- A-9 / G10 recovery evidence: retain only stable IDs, LINE IDs and actor/time data.
-- This ledger is internal and intentionally has no FK to deletable customer/shop rows.
CREATE TABLE local_service_internal.line_binding_audit (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    actor_user_id uuid,
    actor_session_user text NOT NULL,
    actor_effective_role text NOT NULL,
    table_name text NOT NULL CHECK (table_name IN ('line_users','customers')),
    operation text NOT NULL CHECK (operation IN ('INSERT','UPDATE','DELETE')),
    shop_id uuid NOT NULL,
    row_id uuid NOT NULL,
    customer_id uuid,
    old_line_user_id varchar(100),
    new_line_user_id varchar(100)
);

ALTER TABLE local_service_internal.line_binding_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE local_service_internal.line_binding_audit
    FROM PUBLIC, anon, authenticated, service_role, bk01_runtime;

CREATE FUNCTION local_service_internal.capture_line_binding_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, local_service_internal
AS $bk01$
DECLARE
    v_shop_id uuid;
    v_row_id uuid;
    v_customer_id uuid;
    v_old_line_user_id varchar(100);
    v_new_line_user_id varchar(100);
BEGIN
    IF TG_TABLE_NAME = 'line_users' THEN
        IF TG_OP = 'INSERT' THEN
            v_shop_id := NEW.shop_id;
            v_row_id := NEW.id;
            v_customer_id := NEW.customer_id;
            v_new_line_user_id := NEW.line_user_id;
        ELSIF TG_OP = 'UPDATE' THEN
            v_shop_id := NEW.shop_id;
            v_row_id := NEW.id;
            v_customer_id := NEW.customer_id;
            v_old_line_user_id := OLD.line_user_id;
            v_new_line_user_id := NEW.line_user_id;
        ELSE
            v_shop_id := OLD.shop_id;
            v_row_id := OLD.id;
            v_customer_id := OLD.customer_id;
            v_old_line_user_id := OLD.line_user_id;
        END IF;
    ELSE
        IF TG_OP <> 'UPDATE' OR OLD.line_user_id IS NOT DISTINCT FROM NEW.line_user_id THEN
            RETURN NEW;
        END IF;
        v_shop_id := NEW.shop_id;
        v_row_id := NEW.id;
        v_customer_id := NEW.id;
        v_old_line_user_id := OLD.line_user_id;
        v_new_line_user_id := NEW.line_user_id;
    END IF;

    INSERT INTO local_service_internal.line_binding_audit (
        actor_user_id, actor_session_user, actor_effective_role,
        table_name, operation, shop_id, row_id, customer_id,
        old_line_user_id, new_line_user_id
    ) VALUES (
        local_service_internal.request_user_id(), session_user::text,
        COALESCE(NULLIF(current_setting('role', true), 'none'), session_user::text),
        TG_TABLE_NAME, TG_OP, v_shop_id, v_row_id, v_customer_id,
        v_old_line_user_id, v_new_line_user_id
    );

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$bk01$;

REVOKE ALL ON FUNCTION local_service_internal.capture_line_binding_audit()
    FROM PUBLIC, anon, authenticated, service_role, bk01_runtime;

CREATE TRIGGER bk01_line_binding_audit_row
AFTER INSERT OR UPDATE OR DELETE ON local_service.line_users
FOR EACH ROW EXECUTE FUNCTION local_service_internal.capture_line_binding_audit();

CREATE TRIGGER bk01_customer_line_binding_audit_row
AFTER UPDATE OF line_user_id ON local_service.customers
FOR EACH ROW
WHEN (OLD.line_user_id IS DISTINCT FROM NEW.line_user_id)
EXECUTE FUNCTION local_service_internal.capture_line_binding_audit();
