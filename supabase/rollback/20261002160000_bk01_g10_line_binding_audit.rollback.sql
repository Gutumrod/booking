DROP TRIGGER IF EXISTS bk01_customer_line_binding_audit_row ON local_service.customers;
DROP TRIGGER IF EXISTS bk01_line_binding_audit_row ON local_service.line_users;
DROP FUNCTION IF EXISTS local_service_internal.capture_line_binding_audit();
DROP TABLE IF EXISTS local_service_internal.line_binding_audit;
