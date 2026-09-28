-- Compensating rollback for 20260927120000_bk01_runtime_route_rpcs.sql.
-- Roll back 20260927130000 first. Run as one transaction.
BEGIN;

DO $rollback_guard$
BEGIN
    IF to_regclass('local_service.line_webhook_events') IS NULL
       OR to_regclass('local_service.deposit_slip_upload_grants') IS NULL THEN
        RAISE EXCEPTION 'BK01 runtime route migration is not present';
    END IF;
    IF EXISTS (SELECT 1 FROM local_service.line_webhook_events)
       OR EXISTS (SELECT 1 FROM local_service.deposit_slip_upload_grants) THEN
        RAISE EXCEPTION 'Rollback refused: runtime route tables contain application data';
    END IF;
END;
$rollback_guard$;

DROP FUNCTION local_service.bk01_line_bind_booking(text, text, text, uuid, text);
DROP FUNCTION local_service.bk01_finish_line_webhook_delivery(text, uuid, text, text);
DROP FUNCTION local_service.get_line_notification_delivery_context(uuid, integer);
DROP FUNCTION local_service.authorize_deposit_slip_upload(uuid, text, text, bigint);
DROP FUNCTION local_service.finish_stripe_webhook_event(text, text, text);
DROP TABLE local_service.deposit_slip_upload_grants;
DROP TABLE local_service.line_webhook_events;

COMMIT;
