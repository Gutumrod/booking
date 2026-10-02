-- G10 F1 remediation: preserve the service_role TRUNCATE grant and audit every deleted binding.
ALTER TABLE local_service_internal.line_binding_audit
    DROP CONSTRAINT line_binding_audit_operation_check;
ALTER TABLE local_service_internal.line_binding_audit
    ADD CONSTRAINT line_binding_audit_operation_check
    CHECK (operation IN ('INSERT','UPDATE','DELETE','TRUNCATE'));

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
        IF TG_OP = 'TRUNCATE' THEN
            INSERT INTO local_service_internal.line_binding_audit (
                actor_user_id, actor_session_user, actor_effective_role,
                table_name, operation, shop_id, row_id, customer_id,
                old_line_user_id, new_line_user_id
            )
            SELECT local_service_internal.request_user_id(), session_user::text,
                COALESCE(NULLIF(current_setting('role', true), 'none'), session_user::text),
                'line_users', 'TRUNCATE', lu.shop_id, lu.id, lu.customer_id,
                lu.line_user_id, NULL
            FROM local_service.line_users AS lu;
            RETURN NULL;
        ELSIF TG_OP = 'INSERT' THEN
            v_shop_id := NEW.shop_id;
            v_row_id := NEW.id;
            v_customer_id := NEW.customer_id;
            v_new_line_user_id := NEW.line_user_id;
        ELSIF TG_OP = 'UPDATE' THEN
            IF OLD.line_user_id IS NOT DISTINCT FROM NEW.line_user_id THEN
                RETURN NEW;
            END IF;
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
        IF TG_OP = 'INSERT' THEN
            IF NEW.line_user_id IS NULL THEN RETURN NEW; END IF;
            v_shop_id := NEW.shop_id;
            v_row_id := NEW.id;
            v_customer_id := NEW.id;
            v_new_line_user_id := NEW.line_user_id;
        ELSIF TG_OP = 'DELETE' THEN
            IF OLD.line_user_id IS NULL THEN RETURN OLD; END IF;
            v_shop_id := OLD.shop_id;
            v_row_id := OLD.id;
            v_customer_id := OLD.id;
            v_old_line_user_id := OLD.line_user_id;
        ELSE
            IF OLD.line_user_id IS NOT DISTINCT FROM NEW.line_user_id THEN
                RETURN NEW;
            END IF;
            v_shop_id := NEW.shop_id;
            v_row_id := NEW.id;
            v_customer_id := NEW.id;
            v_old_line_user_id := OLD.line_user_id;
            v_new_line_user_id := NEW.line_user_id;
        END IF;
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

    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$bk01$;

REVOKE ALL ON FUNCTION local_service_internal.capture_line_binding_audit()
    FROM PUBLIC, anon, authenticated, service_role, bk01_runtime;

DROP TRIGGER bk01_line_binding_audit_row ON local_service.line_users;
CREATE TRIGGER bk01_line_binding_audit_insert_delete
AFTER INSERT OR DELETE ON local_service.line_users
FOR EACH ROW EXECUTE FUNCTION local_service_internal.capture_line_binding_audit();

CREATE TRIGGER bk01_line_binding_audit_update
AFTER UPDATE OF line_user_id ON local_service.line_users
FOR EACH ROW
WHEN (OLD.line_user_id IS DISTINCT FROM NEW.line_user_id)
EXECUTE FUNCTION local_service_internal.capture_line_binding_audit();

CREATE TRIGGER bk01_line_binding_audit_truncate
BEFORE TRUNCATE ON local_service.line_users
FOR EACH STATEMENT EXECUTE FUNCTION local_service_internal.capture_line_binding_audit();

DROP TRIGGER bk01_customer_line_binding_audit_row ON local_service.customers;
CREATE TRIGGER bk01_customer_line_binding_audit_insert
AFTER INSERT ON local_service.customers
FOR EACH ROW
WHEN (NEW.line_user_id IS NOT NULL)
EXECUTE FUNCTION local_service_internal.capture_line_binding_audit();

CREATE TRIGGER bk01_customer_line_binding_audit_update
AFTER UPDATE OF line_user_id ON local_service.customers
FOR EACH ROW
WHEN (OLD.line_user_id IS DISTINCT FROM NEW.line_user_id)
EXECUTE FUNCTION local_service_internal.capture_line_binding_audit();

CREATE TRIGGER bk01_customer_line_binding_audit_delete
AFTER DELETE ON local_service.customers
FOR EACH ROW
WHEN (OLD.line_user_id IS NOT NULL)
EXECUTE FUNCTION local_service_internal.capture_line_binding_audit();
