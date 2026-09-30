-- Compensating rollback for 20260930120000_bk01_link_token_no_extensions.sql.
-- Run as platform postgres: restoring the frozen legacy policy requires schema auth.
-- Restore legacy behavior without changing function owner or ACL.
CREATE OR REPLACE FUNCTION local_service.generate_link_token()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path = pg_catalog
AS $$
BEGIN
    RETURN upper(substr(encode(extensions.gen_random_bytes(8), 'hex'), 1, 10));
END;
$$;
ALTER POLICY "Users view own shop memberships"
  ON local_service.shop_users
  USING ((SELECT auth.uid()) = user_id);
