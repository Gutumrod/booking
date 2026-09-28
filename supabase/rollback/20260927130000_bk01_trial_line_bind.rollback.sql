-- Compensating rollback for 20260927130000_bk01_trial_line_bind.sql.
-- Run as one transaction with the BK01 platform operator identity.
BEGIN;

DO $rollback_guard$
BEGIN
    IF to_regprocedure('local_service.bk01_line_bind_booking_trial(text,text,text,text)') IS NULL THEN
        RAISE EXCEPTION 'BK01 trial LINE binding migration is not present';
    END IF;
    IF EXISTS (
        SELECT 1 FROM local_service.bookings
         WHERE line_binding_token_used_at IS NOT NULL
            OR line_binding_webhook_event_id IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'Rollback refused: trial LINE binding columns contain application data';
    END IF;
END;
$rollback_guard$;

DROP FUNCTION local_service.bk01_line_bind_booking_trial(text, text, text, text);
ALTER TABLE local_service.bookings
    DROP COLUMN line_binding_webhook_event_id,
    DROP COLUMN line_binding_token_used_at;

COMMIT;
