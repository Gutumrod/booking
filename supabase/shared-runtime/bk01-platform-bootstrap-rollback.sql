-- PLATFORM-ADMIN ROLLBACK FOR BK01 MIGRATION-BOUNDARY BOOTSTRAP ONLY.
-- Valid only before any product-local BK01 migration has been applied.
DO $bk01_rollback_guard$
DECLARE applied_count integer;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'BK01 bootstrap rollback requires postgres, got %', current_user;
  END IF;
  IF to_regclass('local_service_internal.schema_migrations') IS NOT NULL THEN
    SELECT count(*) INTO applied_count FROM local_service_internal.schema_migrations;
    IF applied_count <> 0 THEN
      RAISE EXCEPTION 'BK01 bootstrap rollback blocked: % product-local migrations already applied', applied_count;
    END IF;
  END IF;
END
$bk01_rollback_guard$;

DO $bk01_restore_rel_owners$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname, c.relkind
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='local_service' AND c.relkind IN ('r','p','v','m','S','c')
  LOOP
    CASE r.relkind
      WHEN 'r' THEN EXECUTE format('ALTER TABLE local_service.%I OWNER TO postgres', r.relname);
      WHEN 'p' THEN EXECUTE format('ALTER TABLE local_service.%I OWNER TO postgres', r.relname);
      WHEN 'v' THEN EXECUTE format('ALTER VIEW local_service.%I OWNER TO postgres', r.relname);
      WHEN 'm' THEN EXECUTE format('ALTER MATERIALIZED VIEW local_service.%I OWNER TO postgres', r.relname);
      WHEN 'S' THEN EXECUTE format('ALTER SEQUENCE local_service.%I OWNER TO postgres', r.relname);
      WHEN 'c' THEN EXECUTE format('ALTER TYPE local_service.%I OWNER TO postgres', r.relname);
    END CASE;
  END LOOP;
END
$bk01_restore_rel_owners$;

DO $bk01_restore_function_owners$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS signature
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='local_service' AND p.prokind='f'
  LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO postgres', r.signature);
  END LOOP;
END
$bk01_restore_function_owners$;

ALTER SCHEMA local_service OWNER TO postgres;
DROP SCHEMA IF EXISTS local_service_internal CASCADE;

DO $bk01_drop_roles$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='bk01_migrator') THEN
    REVOKE USAGE ON SCHEMA auth, extensions FROM bk01_migrator;
    REVOKE ALL ON SCHEMA local_service FROM bk01_migrator;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='bk01_migrator_login')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname='bk01_migrator') THEN
    REVOKE bk01_migrator FROM bk01_migrator_login;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='bk01_migrator') THEN
    REVOKE bk01_migrator FROM postgres;
  END IF;
END
$bk01_drop_roles$;

DROP ROLE IF EXISTS bk01_migrator_login;
DROP ROLE IF EXISTS bk01_migrator;
