-- One atomic statement, also safe inside an existing caller transaction.
-- Lock source writes and the ledger before inspecting retained audit evidence.
DO $bk01_170000_rollback$
BEGIN
    LOCK TABLE local_service.customers, local_service.line_users IN ACCESS EXCLUSIVE MODE;
    LOCK TABLE local_service_internal.line_binding_audit IN SHARE ROW EXCLUSIVE MODE;
    IF EXISTS (
        SELECT 1 FROM local_service_internal.line_binding_audit WHERE operation = 'TRUNCATE'
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '55000',
            MESSAGE = 'BK01 170000 rollback blocked: retained TRUNCATE audit evidence exists',
            HINT = 'Export and retain the audit evidence before any separately reviewed remediation. This rollback never deletes audit evidence.';
    END IF;

DROP TRIGGER IF EXISTS bk01_customer_line_binding_audit_delete ON local_service.customers;
DROP TRIGGER IF EXISTS bk01_customer_line_binding_audit_update ON local_service.customers;
DROP TRIGGER IF EXISTS bk01_customer_line_binding_audit_insert ON local_service.customers;
DROP TRIGGER IF EXISTS bk01_line_binding_audit_truncate ON local_service.line_users;
DROP TRIGGER IF EXISTS bk01_line_binding_audit_update ON local_service.line_users;
DROP TRIGGER IF EXISTS bk01_line_binding_audit_insert_delete ON local_service.line_users;

ALTER TABLE local_service_internal.line_binding_audit
    DROP CONSTRAINT line_binding_audit_operation_check;
ALTER TABLE local_service_internal.line_binding_audit
    ADD CONSTRAINT line_binding_audit_operation_check
    CHECK (operation IN ('INSERT','UPDATE','DELETE'));

CREATE OR REPLACE FUNCTION local_service_internal.capture_line_binding_audit()
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

CREATE TRIGGER bk01_line_binding_audit_row
AFTER INSERT OR UPDATE OR DELETE ON local_service.line_users
FOR EACH ROW EXECUTE FUNCTION local_service_internal.capture_line_binding_audit();

CREATE TRIGGER bk01_customer_line_binding_audit_row
AFTER UPDATE OF line_user_id ON local_service.customers
FOR EACH ROW
WHEN (OLD.line_user_id IS DISTINCT FROM NEW.line_user_id)
EXECUTE FUNCTION local_service_internal.capture_line_binding_audit();

END;
$bk01_170000_rollback$;
