-- House-owned one-time upload grant registry. Source-only candidate; do not apply
-- until a separate operator window and independent SQL review authorize it.
BEGIN;

DO $preflight$
BEGIN
    IF has_schema_privilege('bk01_runtime','wstera_platform_internal','USAGE')
       OR has_schema_privilege('bk01_migrator','wstera_platform_internal','USAGE') THEN
        RAISE EXCEPTION 'BK01 storage grant setup blocked: runtime/migrator already has House schema USAGE; review pre-existing grants first';
    END IF;
    IF has_schema_privilege('bk01_runtime','storage','USAGE')
       OR has_table_privilege('bk01_runtime','storage.objects','INSERT') THEN
        RAISE EXCEPTION 'BK01 storage grant setup blocked: runtime already has Storage schema/object insert authority; review pre-existing grants first';
    END IF;
END;
$preflight$;

-- House binds a database runtime role to its product. Callers cannot supply a
-- product_code; the RPC derives it from request.jwt.claim.role via this table.
CREATE TABLE wstera_platform_internal.storage_upload_runtime_roles (
    runtime_role text PRIMARY KEY CHECK (runtime_role ~ '^[a-z][a-z0-9_]{1,62}$'),
    product_code text NOT NULL UNIQUE CHECK (product_code ~ '^[a-z][a-z0-9_-]{1,62}$'),
    UNIQUE (runtime_role,product_code)
);
INSERT INTO wstera_platform_internal.storage_upload_runtime_roles(runtime_role,product_code)
VALUES ('bk01_runtime','bk01');

-- House allowlist: a product may request only explicitly approved Storage buckets.
CREATE TABLE wstera_platform_internal.storage_upload_bucket_allowlist (
    product_code text NOT NULL CHECK (product_code ~ '^[a-z][a-z0-9_-]{1,62}$'),
    bucket_id text NOT NULL CHECK (bucket_id ~ '^[a-z0-9][a-z0-9_-]{0,62}$'),
    PRIMARY KEY (product_code,bucket_id)
);
INSERT INTO wstera_platform_internal.storage_upload_bucket_allowlist(product_code,bucket_id)
VALUES ('bk01','deposit-slips');

CREATE TABLE wstera_platform_internal.storage_upload_grants (
    grant_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product_code   text NOT NULL,
    runtime_role   text NOT NULL,
    bucket_id      text NOT NULL,
    object_path    text NOT NULL CHECK (object_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'),
    grant_token_hash text NOT NULL CHECK (grant_token_hash ~ '^[0-9a-f]{64}$'),
    content_type   text NOT NULL CHECK (content_type IN ('image/jpeg','image/png','image/webp')),
    size_bytes     bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
    expires_at     timestamptz NOT NULL CHECK (expires_at <= created_at + interval '5 minutes'),
    created_at     timestamptz NOT NULL DEFAULT statement_timestamp(),
    consumed_at    timestamptz,
    UNIQUE (grant_token_hash),
    FOREIGN KEY (runtime_role,product_code)
      REFERENCES wstera_platform_internal.storage_upload_runtime_roles(runtime_role,product_code),
    FOREIGN KEY (product_code,bucket_id)
      REFERENCES wstera_platform_internal.storage_upload_bucket_allowlist(product_code,bucket_id)
);
ALTER TABLE wstera_platform_internal.storage_upload_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE wstera_platform_internal.storage_upload_grants FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE wstera_platform_internal.storage_upload_grants,
  wstera_platform_internal.storage_upload_runtime_roles,
  wstera_platform_internal.storage_upload_bucket_allowlist
    FROM PUBLIC, anon, authenticated, service_role, bk01_runtime;

CREATE FUNCTION wstera_platform_internal.register_storage_upload_grant(
    p_bucket_id text,
    p_object_path text,
    p_grant_token_hash text,
    p_content_type text,
    p_size_bytes bigint,
    p_expires_at timestamptz
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, wstera_platform_internal
AS $function$
DECLARE v_grant_id uuid; v_role text; v_product text;
BEGIN
    v_role := current_setting('request.jwt.claim.role', true);
    SELECT product_code INTO v_product
      FROM wstera_platform_internal.storage_upload_runtime_roles
     WHERE runtime_role=v_role;
    IF v_product IS NULL OR NOT EXISTS (
      SELECT 1 FROM wstera_platform_internal.storage_upload_bucket_allowlist
       WHERE product_code=v_product AND bucket_id=p_bucket_id
    ) THEN
        RAISE EXCEPTION 'Storage grant role/bucket pair is not allowlisted';
    END IF;
    IF p_object_path IS NULL OR p_object_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
       OR p_grant_token_hash IS NULL OR p_grant_token_hash !~ '^[0-9a-f]{64}$'
       OR p_content_type NOT IN ('image/jpeg','image/png','image/webp')
       OR p_size_bytes NOT BETWEEN 1 AND 5242880
       OR p_expires_at <= statement_timestamp()
       OR p_expires_at > statement_timestamp() + interval '5 minutes' THEN
        RAISE EXCEPTION 'Invalid storage upload grant';
    END IF;
    IF (p_content_type='image/jpeg' AND right(p_object_path,4) <> '.jpg')
       OR (p_content_type='image/png' AND right(p_object_path,4) <> '.png')
       OR (p_content_type='image/webp' AND right(p_object_path,5) <> '.webp') THEN
        RAISE EXCEPTION 'Storage grant extension does not match content type';
    END IF;
    INSERT INTO wstera_platform_internal.storage_upload_grants(
      product_code,runtime_role,bucket_id,object_path,grant_token_hash,content_type,size_bytes,expires_at)
    VALUES (v_product,v_role,p_bucket_id,p_object_path,p_grant_token_hash,
      p_content_type,p_size_bytes,p_expires_at)
    RETURNING grant_id INTO v_grant_id;
    RETURN v_grant_id;
END;
$function$;

CREATE FUNCTION wstera_platform_internal.can_create_storage_upload(
    p_bucket_id text, p_object_path text
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, wstera_platform_internal
AS $function$
    SELECT EXISTS (
      SELECT 1 FROM wstera_platform_internal.storage_upload_runtime_roles r
      JOIN wstera_platform_internal.storage_upload_bucket_allowlist a
        ON a.product_code=r.product_code AND a.bucket_id=p_bucket_id
      JOIN wstera_platform_internal.storage_upload_grants g
        ON g.product_code=r.product_code AND g.runtime_role=r.runtime_role
       AND g.bucket_id=a.bucket_id AND g.object_path=p_object_path
     WHERE r.runtime_role=current_setting('request.jwt.claim.role',true)
       AND g.expires_at > statement_timestamp() AND g.consumed_at IS NULL
    )
$function$;

CREATE FUNCTION wstera_platform_internal.consume_storage_upload()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, wstera_platform_internal, storage
AS $function$
DECLARE v_role text; v_product text; v_mimetype text; v_size bigint;
BEGIN
    v_role := current_setting('request.jwt.claim.role', true);
    SELECT product_code INTO v_product
      FROM wstera_platform_internal.storage_upload_runtime_roles WHERE runtime_role=v_role;
    IF v_product IS NULL THEN RETURN NEW; END IF;
    IF NOT EXISTS (SELECT 1 FROM wstera_platform_internal.storage_upload_bucket_allowlist
      WHERE product_code=v_product AND bucket_id=NEW.bucket_id) THEN
        RAISE EXCEPTION 'Storage grant role/bucket pair is not allowlisted';
    END IF;
    v_mimetype := NEW.metadata ->> 'mimetype';
    BEGIN v_size := (NEW.metadata ->> 'size')::bigint;
    EXCEPTION WHEN others THEN RAISE EXCEPTION 'Upload metadata size is invalid';
    END;
    UPDATE wstera_platform_internal.storage_upload_grants g
       SET consumed_at=statement_timestamp()
     WHERE g.product_code=v_product AND g.runtime_role=v_role
       AND g.bucket_id=NEW.bucket_id AND g.object_path=NEW.name
       AND g.expires_at > statement_timestamp() AND g.consumed_at IS NULL
       AND g.content_type=v_mimetype AND v_size=g.size_bytes;
    IF NOT FOUND THEN RAISE EXCEPTION 'No matching unused product storage grant'; END IF;
    RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION wstera_platform_internal.register_storage_upload_grant(text,text,text,text,bigint,timestamptz)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION wstera_platform_internal.can_create_storage_upload(text,text)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION wstera_platform_internal.consume_storage_upload()
    FROM PUBLIC, anon, authenticated, service_role, bk01_runtime;
GRANT USAGE ON SCHEMA wstera_platform_internal TO bk01_runtime, bk01_migrator;
GRANT EXECUTE ON FUNCTION wstera_platform_internal.register_storage_upload_grant(text,text,text,text,bigint,timestamptz)
    TO bk01_migrator;
GRANT EXECUTE ON FUNCTION wstera_platform_internal.can_create_storage_upload(text,text)
    TO bk01_runtime;
GRANT USAGE ON SCHEMA storage TO bk01_runtime;
GRANT INSERT ON storage.objects TO bk01_runtime;

CREATE POLICY product_storage_upload_grant_insert ON storage.objects
    FOR INSERT TO PUBLIC
    WITH CHECK (wstera_platform_internal.can_create_storage_upload(bucket_id,name));
CREATE TRIGGER wstera_consume_product_storage_upload_grant
    BEFORE INSERT ON storage.objects
    FOR EACH ROW EXECUTE FUNCTION wstera_platform_internal.consume_storage_upload();

DO $postflight$
BEGIN
    IF has_table_privilege('bk01_runtime','wstera_platform_internal.storage_upload_grants','SELECT')
       OR has_table_privilege('bk01_runtime','wstera_platform_internal.storage_upload_grants','INSERT')
       OR has_function_privilege('bk01_runtime',to_regprocedure('wstera_platform_internal.register_storage_upload_grant(text,text,text,text,bigint,timestamptz)'),'EXECUTE')
       OR NOT has_function_privilege('bk01_migrator',to_regprocedure('wstera_platform_internal.register_storage_upload_grant(text,text,text,text,bigint,timestamptz)'),'EXECUTE')
       OR has_function_privilege('anon',to_regprocedure('wstera_platform_internal.register_storage_upload_grant(text,text,text,text,bigint,timestamptz)'),'EXECUTE')
       OR has_function_privilege('authenticated',to_regprocedure('wstera_platform_internal.register_storage_upload_grant(text,text,text,text,bigint,timestamptz)'),'EXECUTE') THEN
        RAISE EXCEPTION 'House storage grant privilege boundary is not exact';
    END IF;
END;
$postflight$;

COMMIT;
