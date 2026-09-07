-- BK-SR-03 staging defect remediation: do not create an already-overdue 24h reminder.
-- A booking confirmed/rescheduled inside the 24h window already receives its immediate event;
-- creating reminder_24h with scheduled_for <= now() causes a second near-simultaneous push.

CREATE OR REPLACE FUNCTION local_service.suppress_new_overdue_line_reminder()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, local_service
AS $$
BEGIN
    IF NEW.event_type = 'reminder_24h'
       AND NEW.status = 'pending'
       AND NEW.scheduled_for IS NOT NULL
       AND NEW.scheduled_for <= now() THEN
        RETURN NULL;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_suppress_new_overdue_line_reminder
    ON local_service.line_notification_logs;
CREATE TRIGGER trg_suppress_new_overdue_line_reminder
BEFORE INSERT ON local_service.line_notification_logs
FOR EACH ROW
EXECUTE FUNCTION local_service.suppress_new_overdue_line_reminder();
