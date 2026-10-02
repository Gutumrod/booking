-- Local-proof rollback restores the exact legacy body, including known42804.
-- This artifact does not authorize LAB rollback.
CREATE OR REPLACE FUNCTION local_service.platform_admin_list_shops()
RETURNS SETOF local_service.platform_admin_shop_row
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, local_service
AS $$
BEGIN
    IF NOT local_service.is_platform_admin() THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Not authorized';
    END IF;

    RETURN QUERY
    SELECT
        s.id,
        s.name,
        s.slug,
        s.business_category,
        s.owner_name,
        s.phone,
        s.promptpay_number,
        s.requested_plan,
        s.is_active,
        s.created_at,
        sub.plan,
        sub.status,
        sub.current_period_end,
        sub.cancel_at_period_end
    FROM local_service.shops AS s
    LEFT JOIN local_service.subscriptions AS sub ON sub.shop_id = s.id
    ORDER BY s.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION local_service.platform_admin_list_shops() FROM PUBLIC;
