-- Target: BK01 product database
-- Predecessor: 20260928120000_bk01_house_upload_grants.sql
-- Preserve the legacy function's owner and ACL while replacing its extension dependency.
-- BK01-PRESERVE-EXISTING-PUBLIC-EXECUTE: local_service.generate_link_token()
CREATE OR REPLACE FUNCTION local_service.generate_link_token()
RETURNS text
LANGUAGE sql
VOLATILE
SET search_path = pg_catalog
AS $$
    SELECT upper(substr(replace(pg_catalog.gen_random_uuid()::text, '-', ''), 1, 10))
$$;

-- The frozen legacy RLS policy also retained auth.uid() in an object re-owned
-- by bk01_migrator. Read the same JWT claim settings with pg_catalog built-ins
-- so the policy remains callable by authenticated without exposing the private
-- request_user_id helper or granting USAGE on schema auth.
ALTER POLICY "Users view own shop memberships"
  ON local_service.shop_users
  USING (COALESCE(
    NULLIF(current_setting('request.jwt.claim.sub', true), ''),
    (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid = user_id);
