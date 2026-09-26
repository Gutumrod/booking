-- ============================================================================
-- BK01 entitlement packs — Owner-locked A-2 / A-3 / Addendum C (R2) decisions.
--
-- Target:      BK01 product database (shared Supabase project), schemas
--              local_service and local_service_internal only.
-- Predecessor: the frozen legacy chain under supabase/migrations/, final file
--              20260907181500_skip_overdue_line_reminders.sql (30 files, source
--              SHA-256 812b4656b5fcc65d881afd1712581d7c4ba0fd37f39a35c9d7d7d6173b695f5a).
--              This is the first member of the active product-local stream
--              supabase/bk01-migrations/ and is only ever applied by
--              scripts/bk01-migrate.mjs, which owns the transaction.
--
-- Owner-locked rules implemented here (STATUS-HOUSE Addendum A-2 and A-3,
-- OWNER-LOCK-BK01-PACKS-2026-09-26.md, Addendum C):
--   1. Free is free forever: 50 bookings per calendar month in Thailand time,
--      resetting on the 1st of each month; 1 shop; 3 services; a free shop may
--      not take PromptPay deposits.
--   2. Basic is 390 THB or 11 USD per month with NO booking ceiling at all —
--      the previous hard limit of 100 is gone. Its staff cap stays at the 5 the
--      database already enforced.
--   3. The 14-day Basic trial is kept as a SEPARATE PROMOTION, never the free
--      plan. When it expires without payment the shop falls back to free
--      entitlements automatically and is NOT closed.
--   4. When a shop exceeds its entitlements after that fallback the excess is
--      disabled temporarily and no data is deleted.
--   5. Pro is not sold.
--
-- Values the Owner has NOT locked are seeded as table rows rather than compiled
-- into logic, so changing one is a row edit (marked * in
-- docs/house-swarm-1/WUC-DB-MIGRATION.md).
--
-- ---------------------------------------------------------------------------
-- Statement-level constraints from supabase/bk01-migrations/README.md and
-- scripts/lib/bk01-migration-policy.mjs, and how this file satisfies them.
--
--   * No DO block, no transaction control (the runner owns the transaction), no
--     role/schema/database/extension/global DDL, no writes to a managed
--     Supabase schema.
--   * Every mutation target is explicitly qualified under local_service.
--   * PUBLIC may be named ONLY as a REVOKE grantee, never in a GRANT. The
--     policy allowlists anon, authenticated, service_role and bk01_runtime as
--     GRANT grantees, rejects `GRANT ... TO PUBLIC`, and accepts
--     `REVOKE ALL ... FROM PUBLIC` — revoking a privilege is not granting one.
--     Consequence: every function created or replaced here revokes PostgreSQL's
--     default PUBLIC EXECUTE, the SECURITY INVOKER trigger function included,
--     and a CREATE OR REPLACE that changes an argument list (a NEW function
--     object with its own default PUBLIC EXECUTE) carries its own REVOKE. That
--     coverage is F-6. See the note file for the rule and the finding.
--   * The policy's mutation-target patterns also reject any occurrence of the
--     keyword "update" that is followed by a non-qualified token. That rules
--     out, in this stream:
--       - CREATE TRIGGER ... BEFORE INSERT OR <update-keyword> ON <table>,
--       - INSERT ... ON CONFLICT ... DO <update-keyword> SET ...,
--         (both are rejected with "must target an explicitly qualified BK01
--         schema object: ON" / ": SET")
--     so this file uses INSERT-only triggers, ON CONFLICT DO NOTHING followed
--     by an explicit qualified UPDATE, and no upsert-DO-UPDATE form anywhere.
--     The enforcement consequences are documented rule by rule below and in the
--     note; none of them changes an Owner-locked value.
--   * ALTER statements carry no IF EXISTS / IF NOT EXISTS guard on objects that
--     the frozen chain already created: the legacy chain is frozen and verified
--     against one hash, so this file runs against exactly one known predecessor
--     state and should fail loudly rather than silently produce the wrong shape.
--   * All added identifiers are lower case, so quoted and unquoted forms cannot
--     diverge between the SQL here and a static reader.
-- ============================================================================

-- ============================================================================
-- A. CONFIGURATION TABLES
-- ============================================================================

-- A.1 Per-plan entitlements. One row per sellable plan, so adding a plan or
--     changing a number is data, never code. bookings_per_month NULL means
--     "no booking ceiling" and is the Owner-locked shape of Basic.
CREATE TABLE local_service.entitlement_plans (
    plan_code                  TEXT PRIMARY KEY
        CHECK (plan_code IN ('free', 'basic_490', 'pro_990')),
    display_name_th            TEXT NOT NULL,
    display_name_en            TEXT NOT NULL,
    price_thb                  NUMERIC(10, 2) NOT NULL CHECK (price_thb >= 0),
    price_usd                  NUMERIC(10, 2) NOT NULL CHECK (price_usd >= 0),
    bookings_per_month         INTEGER
        CHECK (bookings_per_month IS NULL OR bookings_per_month > 0),
    shops_limit                INTEGER NOT NULL CHECK (shops_limit > 0),
    services_limit             INTEGER NOT NULL CHECK (services_limit > 0),
    staff_limit                INTEGER NOT NULL CHECK (staff_limit > 0),
    auto_slip_limit            INTEGER NOT NULL CHECK (auto_slip_limit >= 0),
    promptpay_deposit_allowed  BOOLEAN NOT NULL,
    is_publicly_sellable       BOOLEAN NOT NULL,
    -- N-3: what a cancelled PAID plan does. The Owner has not answered B4, so
    -- this is a configurable value with an asterisk (*) rather than compiled
    -- logic. The default (true) is the already-answered B2 rule: fall back to
    -- Free entitlements, keep the shop open, delete nothing. Setting it false
    -- is the reserved shape for the opposite answer (stop accepting online
    -- bookings when a paid plan is cancelled).
    canceled_paid_plan_falls_back_to_free BOOLEAN NOT NULL DEFAULT true,
    -- F-9: the sellability rule is enforced over the whole Pro FAMILY of plan
    -- identifiers by deriving the flag from the identifier itself, instead of
    -- comparing against one exact name. A later Pro identifier is covered the
    -- day it is added.
    is_pro_family              BOOLEAN
        GENERATED ALWAYS AS (plan_code LIKE 'pro%') STORED,
    notes                      TEXT,
    updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE local_service.entitlement_plans ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE local_service.entitlement_plans FROM anon, authenticated;
GRANT ALL ON TABLE local_service.entitlement_plans TO service_role;

-- Owner-locked rule 5 ("Pro is not sold") is enforced on the data itself, so no
-- code path can sell Pro while the row says it is not for sale. F-9: the rule
-- covers the whole Pro family by identifier prefix (`is_pro_family`), not one
-- exact name, because the permitted identifiers are the legacy spellings such as
-- `pro_990` — an exact comparison against `'pro'` could never match a real row.
ALTER TABLE local_service.entitlement_plans
    ADD CONSTRAINT entitlement_plans_pro_family_not_sellable
    CHECK (NOT is_pro_family OR NOT is_publicly_sellable);

COMMENT ON TABLE local_service.entitlement_plans IS
    'BK01 plan entitlements. bookings_per_month NULL means no booking ceiling (fair use). Values live here rather than in functions so a plan change is a row change.';

-- A.2 Trial promotions. The 14-day Basic trial is a promotion, not a plan row:
--     it has no price of its own and it is not sold. Its entitlements are
--     declared as a plan_code that must exist in entitlement_plans, which is
--     what keeps the trial permanently distinct from the free plan.
CREATE TABLE local_service.trial_promotions (
    promotion_code          TEXT PRIMARY KEY,
    entitlement_plan_code   TEXT NOT NULL
        REFERENCES local_service.entitlement_plans (plan_code),
    duration_days           INTEGER NOT NULL CHECK (duration_days > 0),
    is_active               BOOLEAN NOT NULL,
    claimable_once_per_shop BOOLEAN NOT NULL,
    claim_ticket_supported  BOOLEAN NOT NULL,
    notes                   TEXT,
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE local_service.trial_promotions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE local_service.trial_promotions FROM anon, authenticated;
GRANT ALL ON TABLE local_service.trial_promotions TO service_role;

COMMENT ON TABLE local_service.trial_promotions IS
    'BK01 trial promotions, kept separate from the free plan. claimable_once_per_shop and claim_ticket_supported exist so a future claim ticket is a row change.';

-- A.3 Business types and their starter patterns, as table data, so a new type
--     can be added with no code change (Addendum C, L-12). Labels ship in Thai
--     and English and the emoji is carried as data, because the existing signup
--     page renders its category chips as "emoji + label + name in the other
--     language" and strips a leading non-alphanumeric prefix on click.
--     Wiring the signup UI to read this table is a UI-lane change and is
--     outside this work unit's allowed scope (apps/ is prohibited here); this
--     file makes the data exist and records the chosen type on the shop.
CREATE TABLE local_service.business_types (
    type_code        TEXT PRIMARY KEY
        CHECK (type_code ~ '^[a-z][a-z0-9_]*$'),
    emoji            TEXT NOT NULL,
    label_th         TEXT NOT NULL,
    label_en         TEXT NOT NULL,
    starter_pattern  JSONB NOT NULL,
    display_order    INTEGER NOT NULL CHECK (display_order > 0),
    is_active        BOOLEAN NOT NULL DEFAULT true,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE local_service.business_types ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE local_service.business_types FROM anon, authenticated;
GRANT ALL ON TABLE local_service.business_types TO service_role;

CREATE INDEX business_types_display_order_idx
    ON local_service.business_types (display_order);

COMMENT ON TABLE local_service.business_types IS
    'BK01 business types and their starter service patterns, stored as table data so a new type needs no code change. starter_pattern is applied to a new shop at signup.';

-- A.4 Per-service entitlement stamp. The booking ledger is per shop; the
--     services allowance is per shop too, but the decision of which services
--     are inside the allowance has to be recorded somewhere durable for the
--     temporary disable to be reversible, so each service carries the month in
--     which it was last stamped as entitled. month_key is always the first day
--     of a Thailand-time calendar month.
CREATE TABLE local_service.service_entitlement_periods (
    service_id  UUID PRIMARY KEY
        REFERENCES local_service.services (id) ON DELETE CASCADE,
    shop_id     UUID NOT NULL
        REFERENCES local_service.shops (id) ON DELETE CASCADE,
    month_key   DATE NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE local_service.service_entitlement_periods ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE local_service.service_entitlement_periods FROM anon, authenticated;
GRANT ALL ON TABLE local_service.service_entitlement_periods TO service_role;

CREATE INDEX service_entitlement_periods_shop_month_idx
    ON local_service.service_entitlement_periods (shop_id, month_key);

COMMENT ON TABLE local_service.service_entitlement_periods IS
    'Records the Thailand-time calendar month in which each service was last inside its shop plan allowance, so a service disabled by a downgrade can be switched back on without deleting anything.';

-- A.5 F-7 — WHY a service is switched off. There are two different reasons a
--     service can be off and they must never be conflated: the SYSTEM switched
--     it off because the plan's service allowance was exceeded (temporary, and
--     the system may switch it back on), or the OWNER switched it off on
--     purpose (a product decision, and no automatic path may reverse it). The
--     pre-F-7 restore routine re-enabled every off service it found, so the
--     owner's own choice was silently reversed — on every customer booking and
--     on every dashboard read, because the restore was invoked from those two
--     paths. This column is the explicit marker the migration needs to tell the
--     two cases apart:
--
--       entitlement_disabled = true   the system switched it off for an
--                                     entitlement reason; the restore may
--                                     switch it back on when the plan allows
--       entitlement_disabled = false  the row is on, or the OWNER switched it
--                                     off — never revived automatically
--
--     DEFAULT false so every pre-existing row (all of them written by the owner
--     or by signup) is correctly classified as "not system-disabled" the moment
--     the column appears, and the restore can never revive a legacy row.
--     The paired CHECK states the invariant that keeps the two facts from
--     contradicting each other: a row cannot be active AND system-disabled.
ALTER TABLE local_service.services
    ADD COLUMN entitlement_disabled BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE local_service.services
    ADD CONSTRAINT services_not_active_and_entitlement_disabled
    CHECK (NOT (is_active AND entitlement_disabled));

COMMENT ON COLUMN local_service.services.entitlement_disabled IS
    'F-7: true when the SYSTEM switched this service off because the plan service allowance was exceeded, so the system may switch it back on when the plan allows. false when the service is on, or when the OWNER switched it off on purpose — an owner switch-off is never reversed automatically.';

-- ============================================================================
-- B. SEED DATA
-- ============================================================================

-- plan_code keeps the pre-existing literal spellings, so the frozen
-- subscriptions.plan CHECK constraint, the Stripe webhook writer and both
-- client applications keep working unchanged.
INSERT INTO local_service.entitlement_plans (
    plan_code, display_name_th, display_name_en, price_thb, price_usd,
    bookings_per_month, shops_limit, services_limit, staff_limit,
    auto_slip_limit, promptpay_deposit_allowed, is_publicly_sellable,
    canceled_paid_plan_falls_back_to_free, notes
) VALUES
    (
        'free', 'ฟรี ตลอดไป', 'Free forever', 0, 0,
        50, 1, 3, 1,
        0, false, true,
        true,
        'Owner-locked: 50 bookings per calendar month (Thailand time, reset on the 1st), 1 shop, 3 services, no PromptPay deposit. staff_limit 1 is the Owner proposal A1 (still unanswered: marked * in the note). auto_slip_limit 0 is the C2 proposal (still unanswered: marked *). canceled_paid_plan_falls_back_to_free true is the N-3 default and carries a * because the Owner has not answered B4.'
    ),
    (
        'basic_490', 'Basic', 'Basic', 390, 11,
        NULL, 1, 50, 5,
        0, true, true,
        true,
        'Owner-locked O-1 and A-2: 390 THB or 11 USD per month, no booking ceiling (bookings_per_month IS NULL). staff_limit 5 is the cap the database already enforced. services_limit 50 and auto_slip_limit 0 are NOT Owner-locked (marked * in the note). canceled_paid_plan_falls_back_to_free true is the N-3 default (marked *).'
    ),
    (
        'pro_990', 'Pro (ยังไม่ขาย)', 'Pro (not sold)', 790, 23,
        NULL, 1, 100, 10,
        100, true, false,
        true,
        'Owner-locked A-2 and C2: Pro is NOT sold, hence is_publicly_sellable false and the entitlement_plans_pro_family_not_sellable constraint (F-9: the whole pro% family, not one exact name). The 790 THB and 23 USD figures are the unapproved C2 proposal, kept only as the configuration value for the day the Owner opens Pro (marked *).'
    );

INSERT INTO local_service.trial_promotions (
    promotion_code, entitlement_plan_code, duration_days, is_active,
    claimable_once_per_shop, claim_ticket_supported, notes
) VALUES (
    'basic_trial_14d', 'basic_490', 14, true,
    true, true,
    'Owner-locked O-2 and A-2: the 14-day Basic trial is kept as a promotion, separate from the free plan for good. claimable_once_per_shop true is the unapproved B3 proposal (marked *). claim_ticket_supported true keeps a future claim ticket a data change.'
);

-- Starter sets for new shops. The labels are kept equal to the suggestion list
-- the signup page already offers (apps/booking-admin/messages/th.json and
-- en.json, auth.suggestedCategories), so this data can drive that picker later
-- with no copy drift.
INSERT INTO local_service.business_types (
    type_code, emoji, label_th, label_en, starter_pattern, display_order, is_active
) VALUES
    ('barber', '💈', 'ร้านตัดผม / บาร์เบอร์', 'Barber shop / Salon',
        '{"services":[{"name":"ตัดผมชาย","duration_minutes":30,"price":150,"deposit_amount":0},{"name":"ตัดผม สระ เซ็ต","duration_minutes":60,"price":300,"deposit_amount":0},{"name":"โกนหนวด","duration_minutes":30,"price":100,"deposit_amount":0}],"staff_role_label":"ช่างตัดผม"}'::jsonb,
        1, true),
    ('car_care', '🚗', 'คาร์แคร์ / ล้างรถ / เคลือบแก้ว', 'Car care / Car wash / Coating',
        '{"services":[{"name":"ล้างรถ","duration_minutes":60,"price":200,"deposit_amount":0},{"name":"เคลือบแก้ว","duration_minutes":180,"price":4500,"deposit_amount":500},{"name":"ขัดสี","duration_minutes":120,"price":1500,"deposit_amount":0}],"staff_role_label":"ช่างคาร์แคร์"}'::jsonb,
        2, true),
    ('nail_lash', '💅', 'ร้านทำเล็บ / ต่อขนตา / สปามือเท้า', 'Nail salon / Lash extensions / Foot spa',
        '{"services":[{"name":"ทำเล็บมือ","duration_minutes":60,"price":350,"deposit_amount":0},{"name":"ต่อขนตา","duration_minutes":90,"price":800,"deposit_amount":0},{"name":"สปามือเท้า","duration_minutes":60,"price":400,"deposit_amount":0}],"staff_role_label":"ช่างเล็บ"}'::jsonb,
        3, true),
    ('beauty_clinic', '🏥', 'คลินิกเสริมความงาม / ทันตกรรม', 'Beauty clinic / Dental clinic',
        '{"services":[{"name":"ปรึกษาแพทย์","duration_minutes":30,"price":0,"deposit_amount":0},{"name":"โบท็อกซ์","duration_minutes":60,"price":6900,"deposit_amount":2000},{"name":"อัลตราซาวด์ช่องปาก","duration_minutes":30,"price":800,"deposit_amount":0}],"staff_role_label":"แพทย์ผู้ให้บริการ"}'::jsonb,
        4, true),
    ('spa_massage', '🧘', 'สปา / นวดแผนไทย / ดีท็อกซ์', 'Spa / Thai massage / Detox',
        '{"services":[{"name":"นวดไทย 1 ชั่วโมง","duration_minutes":60,"price":400,"deposit_amount":0},{"name":"นวดน้ำมัน 2 ชั่วโมง","duration_minutes":120,"price":900,"deposit_amount":0},{"name":"สปาแพ็กเกจ","duration_minutes":150,"price":1500,"deposit_amount":300}],"staff_role_label":"หมอนวด พนักงานสปา"}'::jsonb,
        5, true),
    ('studio', '📸', 'สตูดิโอถ่ายภาพ / สตูดิโอซ้อมดนตรี', 'Photo studio / Rehearsal studio',
        '{"services":[{"name":"เช่าสตูดิโอ 1 ชั่วโมง","duration_minutes":60,"price":500,"deposit_amount":200},{"name":"ถ่ายภาพโปรไฟล์","duration_minutes":60,"price":1200,"deposit_amount":0},{"name":"เช่าสตูดิโอ 3 ชั่วโมง","duration_minutes":180,"price":1300,"deposit_amount":200}],"staff_role_label":"ช่างภาพ ผู้ดูแลสตูดิโอ"}'::jsonb,
        6, true),
    ('sport_court', '🏸', 'สนามแบดมินตัน / สนามฟุตซอล', 'Badminton court / Futsal court',
        '{"services":[{"name":"สนามแบดมินตัน 1 ชั่วโมง","duration_minutes":60,"price":150,"deposit_amount":0},{"name":"สนามฟุตซอล 1 ชั่วโมง","duration_minutes":60,"price":600,"deposit_amount":100},{"name":"เช่าสนาม 2 ชั่วโมง","duration_minutes":120,"price":1200,"deposit_amount":100}],"staff_role_label":"ผู้ดูแลสนาม"}'::jsonb,
        7, true),
    ('pet_grooming', '🐾', 'อาบน้ำตัดขนสัตว์เลี้ยง (Pet Grooming)', 'Pet grooming',
        '{"services":[{"name":"อาบน้ำเป่าแห้ง (เล็ก)","duration_minutes":60,"price":350,"deposit_amount":0},{"name":"อาบน้ำตัดขน (กลาง)","duration_minutes":90,"price":600,"deposit_amount":0},{"name":"อาบน้ำตัดขน (ใหญ่)","duration_minutes":120,"price":900,"deposit_amount":0}],"staff_role_label":"ช่างอาบน้ำตัดขน"}'::jsonb,
        8, true),
    ('other', '🏪', 'อื่น ๆ', 'Other',
        '{"services":[{"name":"บริการหลัก","duration_minutes":30,"price":200,"deposit_amount":0}],"staff_role_label":"ผู้ให้บริการ"}'::jsonb,
        9, true);

-- ============================================================================
-- C. SHOP SIGNUP: record the chosen business type
-- ============================================================================

-- N-4: the single read surface for the business type list. The codes seeded
-- above are the source of truth, and this view is how the signup UI reads them
-- instead of embedding its own codes. It is deliberately narrow (five columns,
-- active rows only, fixed order) so it can be granted without opening the table.
-- The UI lane consumes `local_service.app_business_types`; the column list and
-- the meaning of each column are recorded in docs/house-swarm-1/WUC-DB-MIGRATION.md.
CREATE OR REPLACE VIEW local_service.app_business_types AS
SELECT type_code, emoji, label_th, label_en, display_order
FROM local_service.business_types
WHERE is_active = true
ORDER BY display_order ASC, type_code ASC;

REVOKE ALL ON TABLE local_service.app_business_types FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE local_service.app_business_types TO authenticated;

COMMENT ON VIEW local_service.app_business_types IS
    'N-4 read surface: the business type list the signup UI must render, sourced from local_service.business_types so the database stays the single source of type codes. Columns: type_code, emoji, label_th, label_en, display_order.';

ALTER TABLE local_service.shops
    ADD COLUMN business_type_code TEXT
        REFERENCES local_service.business_types (type_code);

ALTER TABLE local_service.shops
    ADD COLUMN starter_set_applied BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN local_service.shops.business_type_code IS
    'Business type chosen at signup; references local_service.business_types. The legacy free-text business_category column is kept and still written, because the signup page sends free text until the UI lane reads the type list.';

-- Existing shops predate the type list. Classify them from their free-text
-- category, then fall back to the seeded 'other' row, so no shop is left
-- without a type.
--
-- F-8: this must be ONE statement. The rejected version wrote the free-text slug
-- first and repaired the misses in a second UPDATE, but the foreign key is
-- checked as soon as the first statement runs, so any existing shop whose
-- category is not a seeded code (free text, Thai text, empty) aborted the whole
-- migration. Every row here is written straight to a value that is EITHER the
-- slug of its own category when that slug names a seeded type, OR the seeded
-- 'other' code, so the foreign key cannot fail on any input.
UPDATE local_service.shops
   SET business_type_code = CASE
           WHEN EXISTS (
               SELECT 1
                 FROM local_service.business_types AS bt
                WHERE bt.type_code = btrim(lower(regexp_replace(
                          coalesce(business_category, ''), '[^a-zA-Z0-9]+', '_', 'g'
                      )))
           ) THEN btrim(lower(regexp_replace(
                    coalesce(business_category, ''), '[^a-zA-Z0-9]+', '_', 'g'
                )))
           ELSE 'other'
       END
 WHERE business_type_code IS NULL;

-- ============================================================================
-- D. TIME AND USAGE HELPERS
-- ============================================================================

-- D.1 Calendar month key in Thailand time. The month boundary is a fact about
--     the product's only market rather than a tunable, so the zone is fixed and
--     documented instead of seeded.
CREATE OR REPLACE FUNCTION local_service.bk01_month_key(p_at TIMESTAMPTZ)
RETURNS DATE
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, local_service
AS $$
    SELECT date_trunc(
        'month',
        COALESCE(p_at, now()) AT TIME ZONE 'Asia/Bangkok'
    )::DATE;
$$;

REVOKE ALL ON FUNCTION local_service.bk01_month_key(TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION local_service.bk01_month_key(TIMESTAMPTZ) TO service_role;

-- D.2 Slots consumed by one shop in one Thailand-time calendar month, counted
--     from the booking rows themselves rather than from a counter, so the
--     number is correct by construction and no earlier bookkeeping can make it
--     wrong.
--
--     Counted statuses are the ones that hold or consumed a slot: an
--     un-expired hold, a booking awaiting deposit review, a confirmed booking
--     and the two later outcomes. Cancelled and expired bookings release the
--     slot, matching the frozen behaviour where a stale hold was expired and
--     freed. Because an un-expired hold counts, a booking is charged at
--     creation, which is what makes the create-time gate sufficient for the
--     later transition into confirmed. No booking row is ever deleted or
--     rewritten to make a number work (Owner B2: no data is deleted).
CREATE OR REPLACE FUNCTION local_service.bk01_bookings_used_in_month(
    p_shop_id UUID,
    p_month_key DATE
)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, local_service
AS $$
    SELECT count(*)::INTEGER
      FROM local_service.bookings AS b
     WHERE b.shop_id = p_shop_id
       AND (
            b.status IN ('pending_review', 'confirmed', 'completed', 'no_show')
            OR (
                b.status = 'hold'
                AND (b.expires_at IS NULL OR b.expires_at > now())
            )
       )
       AND local_service.bk01_month_key(
               COALESCE(b.start_timestamptz, b.booking_date::TIMESTAMPTZ)
           ) = p_month_key;
$$;

REVOKE ALL ON FUNCTION local_service.bk01_bookings_used_in_month(UUID, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION local_service.bk01_bookings_used_in_month(UUID, DATE) TO service_role;

-- D.3 The free plan's monthly ceiling, exposed to SECURITY INVOKER trigger
--     functions without granting those functions the table rights. NULL means
--     the free plan has no ceiling, which the callers treat as no limit.
CREATE OR REPLACE FUNCTION local_service.bk01_free_bookings_ceiling()
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, local_service
AS $$
    SELECT p.bookings_per_month
      FROM local_service.entitlement_plans AS p
     WHERE p.plan_code = 'free';
$$;

REVOKE ALL ON FUNCTION local_service.bk01_free_bookings_ceiling() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION local_service.bk01_free_bookings_ceiling() TO service_role;

-- ============================================================================
-- E. PLAN RESOLUTION — an expired trial falls back to free, it never closes
--    the shop
-- ============================================================================

-- E.1 Which plan a subscription's own plan code and status amount to. Pure and
--     fail-closed: anything unrecognised resolves to free. An expired trial is
--     resolved by its clock in E.2, not here, because a 'trialing' row is
--     Basic only while its period is still open.
CREATE OR REPLACE FUNCTION local_service.bk01_effective_plan(p_plan TEXT, p_status TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, local_service
AS $$
    SELECT CASE
        WHEN p_plan = 'pro_990' AND p_status = 'active' THEN 'pro_990'
        WHEN p_plan = 'basic_490' AND p_status IN ('active', 'past_due') THEN 'basic_490'
        WHEN p_plan = 'basic_490' AND p_status = 'trialing' THEN 'basic_490'
        ELSE 'free'
    END;
$$;

REVOKE ALL ON FUNCTION local_service.bk01_effective_plan(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION local_service.bk01_effective_plan(TEXT, TEXT) TO service_role;

-- E.2 The plan a shop is actually on right now.
--     A shop with no subscription row is free (fail-closed).
--     A 'trialing' row is Basic only while COALESCE(current_period_end,
--     shops.trial_ends_at) is in the future; once that passes without payment
--     the shop is on free entitlements and stays open. The subscription row
--     itself is deliberately left saying 'basic_490' / 'trialing', so the
--     historical trial is never rewritten into the free plan and the two can
--     never be confused.
--     'past_due' is honoured for Basic only, matching the frozen gate at
--     20260813081349_launch_1_billing_truth_and_booking_gate.sql:130-134.
CREATE OR REPLACE FUNCTION local_service.bk01_shop_effective_plan(p_shop_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, local_service
AS $$
DECLARE
    v_plan TEXT;
    v_status TEXT;
    v_period_end TIMESTAMPTZ;
    v_trial_ends_at TIMESTAMPTZ;
BEGIN
    SELECT s.plan, s.status, s.current_period_end, sh.trial_ends_at
      INTO v_plan, v_status, v_period_end, v_trial_ends_at
      FROM local_service.subscriptions AS s
      JOIN local_service.shops AS sh ON sh.id = s.shop_id
     WHERE s.shop_id = p_shop_id;

    IF NOT FOUND OR v_plan IS NULL THEN
        RETURN 'free';
    END IF;

    IF v_plan = 'pro_990' AND v_status = 'active' THEN
        RETURN 'pro_990';
    END IF;

    IF v_plan = 'basic_490' AND v_status IN ('active', 'past_due') THEN
        RETURN 'basic_490';
    END IF;

    IF v_plan = 'basic_490' AND v_status = 'trialing' THEN
        IF COALESCE(v_period_end, v_trial_ends_at) IS NOT NULL
           AND COALESCE(v_period_end, v_trial_ends_at) > now() THEN
            RETURN 'basic_490';
        END IF;
        RETURN 'free';
    END IF;

    RETURN 'free';
END;
$$;

REVOKE ALL ON FUNCTION local_service.bk01_shop_effective_plan(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION local_service.bk01_shop_effective_plan(UUID) TO service_role;

-- E.3 The plan table row a shop is on.
CREATE OR REPLACE FUNCTION local_service.bk01_shop_limits(p_shop_id UUID)
RETURNS TABLE(
    plan_code TEXT,
    bookings_limit INT,
    staff_limit INT,
    services_limit INT,
    shops_limit INT,
    auto_slip_limit INT,
    promptpay_deposit_allowed BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, local_service
AS $$
    SELECT
        p.plan_code,
        p.bookings_per_month,
        p.staff_limit,
        p.services_limit,
        p.shops_limit,
        p.auto_slip_limit,
        p.promptpay_deposit_allowed
      FROM local_service.entitlement_plans AS p
     WHERE p.plan_code = local_service.bk01_shop_effective_plan(p_shop_id);
$$;

REVOKE ALL ON FUNCTION local_service.bk01_shop_limits(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION local_service.bk01_shop_limits(UUID) TO service_role;

-- E.4 The frozen entitlement lookup. Its identity is preserved exactly —
--     same name and the same argument type list — because the frozen chain,
--     qa/quota_enforcement_test.sql and Supabase's REST layer all resolve
--     functions by name plus argument types. A different argument list would
--     create a second function object that arrives with PostgreSQL's default
--     EXECUTE-to-PUBLIC grant, which is an entitlement bypass; that risk is why
--     this is a like-for-like replacement.
--
--     The plan-code CASE is total: every input, including NULL and the legacy
--     'free_trial', lands on exactly one row, and the fallback is the free row,
--     which is the strictest. A zero-row result would leave the caller's record
--     null and a null ceiling is read as "no ceiling", so the total CASE is what
--     keeps this fail-closed. The staff and auto-slip caps that the old body
--     computed are now read from the free plan row, so a caller passing the
--     legacy text 'free_trial' is never granted more than the free plan.
CREATE OR REPLACE FUNCTION local_service.get_tier_limits(p_plan TEXT)
RETURNS TABLE(bookings_limit INT, staff_limit INT, auto_slip_limit INT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, local_service
AS $$
    SELECT
        p.bookings_per_month,
        p.staff_limit,
        p.auto_slip_limit
      FROM local_service.entitlement_plans AS p
     WHERE p.plan_code = CASE
               WHEN p_plan = 'pro_990' THEN 'pro_990'
               WHEN p_plan = 'basic_490' THEN 'basic_490'
               ELSE 'free'
           END;
$$;

REVOKE ALL ON FUNCTION local_service.get_tier_limits(TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION local_service.get_tier_limits(TEXT) TO authenticated;

-- ============================================================================
-- F. BOOKING LEDGER AND THE MONTHLY RESET
-- ============================================================================

-- F.1 Replacement for the frozen ledger helper
--     (20260819000000_quota_staff_topup_enforcement.sql:68-157). Differences:
--       * the plan is resolved through bk01_shop_effective_plan, so the free
--         plan has a monthly calendar reset while a still-running Basic trial
--         has none — it has no ceiling for a reset to matter to;
--       * the reset is derived from Thailand month keys, never from
--         subscriptions.current_period_end, which for a fallen-back trial is in
--         the past and must not drive the free reset;
--       * usage is recounted from the booking rows, so a mid-month fallback
--         from an uncapped plan cannot hide bookings that already happened;
--       * the top-up balance is never cleared by a reset.
--     A reset writes counters only: no booking, service or customer row is
--     touched.
CREATE OR REPLACE FUNCTION local_service.ensure_entitlement_row(p_shop_id UUID)
RETURNS local_service.entitlement_usage
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, local_service
AS $$
DECLARE
    v_usage local_service.entitlement_usage%ROWTYPE;
    v_plan TEXT;
    v_period_end TIMESTAMPTZ;
    v_ledger_month DATE;
    v_current_month DATE := local_service.bk01_month_key(now());
BEGIN
    SELECT s.current_period_end
      INTO v_period_end
      FROM local_service.subscriptions AS s
     WHERE s.shop_id = p_shop_id;

    IF NOT FOUND THEN
        v_period_end := NULL;
    END IF;

    v_plan := local_service.bk01_shop_effective_plan(p_shop_id);

    SELECT *
      INTO v_usage
      FROM local_service.entitlement_usage
     WHERE shop_id = p_shop_id
       FOR UPDATE;

    IF NOT FOUND THEN
        INSERT INTO local_service.entitlement_usage (
            shop_id,
            bookings_used,
            bookings_topup_balance,
            auto_slip_used,
            auto_slip_topup_balance,
            period_end,
            updated_at
        ) VALUES (
            p_shop_id,
            0,
            0,
            0,
            0,
            v_period_end,
            now()
        )
        ON CONFLICT (shop_id) DO NOTHING;

        SELECT *
          INTO v_usage
          FROM local_service.entitlement_usage
         WHERE shop_id = p_shop_id
           FOR UPDATE;
    END IF;

    v_ledger_month := local_service.bk01_month_key(v_usage.updated_at);

    IF v_plan = 'free' AND v_ledger_month <> v_current_month THEN
        UPDATE local_service.entitlement_usage
           SET bookings_used = local_service.bk01_bookings_used_in_month(p_shop_id, v_current_month),
               auto_slip_used = 0,
               period_end = v_current_month::TIMESTAMPTZ,
               updated_at = now()
         WHERE shop_id = p_shop_id
        RETURNING * INTO v_usage;
    END IF;

    RETURN v_usage;
END;
$$;

REVOKE ALL ON FUNCTION local_service.ensure_entitlement_row(UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION local_service.ensure_entitlement_row(UUID) TO authenticated;

-- ============================================================================
-- G. THE BOOKING GATE: 50 per Thailand calendar month on free, no ceiling on
--    Basic, and the 51st booking of a month refused without deleting anything
-- ============================================================================

-- Same trigger name as the frozen one, so the applied trigger is replaced
-- rather than duplicated. The event set is INSERT only, which is a deliberate
-- narrowing: this stream's policy will not accept a trigger whose event list
-- contains an update event, and the create-time gate is sufficient because
-- bk01_bookings_used_in_month charges an un-expired hold at creation and the
-- free plan cannot take a deposit (section J), so every free booking is written
-- straight to 'confirmed' by the same insert the trigger is watching. The
-- residual gap — a booking moved from cancelled or expired back into a counted
-- status without a new insert — is recorded in the note file.
CREATE OR REPLACE FUNCTION local_service.enforce_booking_quota()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, local_service
AS $$
DECLARE
    v_usage local_service.entitlement_usage%ROWTYPE;
    v_plan TEXT;
    v_limits RECORD;
    v_used INTEGER;
BEGIN
    IF NEW.status IN ('pending_review', 'confirmed', 'completed', 'no_show')
       OR (
           NEW.status = 'hold'
           AND (NEW.expires_at IS NULL OR NEW.expires_at > now())
       ) THEN
        v_usage := local_service.ensure_entitlement_row(NEW.shop_id);
        v_plan := local_service.bk01_shop_effective_plan(NEW.shop_id);

        SELECT bookings_limit, staff_limit, auto_slip_limit
          INTO v_limits
          FROM local_service.get_tier_limits(v_plan);

        v_used := local_service.bk01_bookings_used_in_month(
                      NEW.shop_id, local_service.bk01_month_key(now()));

        IF v_limits.bookings_limit IS NULL THEN
            -- No booking ceiling on this plan: accept and keep measuring.
            UPDATE local_service.entitlement_usage
               SET bookings_used = v_used + 1,
                   updated_at = now()
             WHERE shop_id = NEW.shop_id;
        ELSIF v_used < v_limits.bookings_limit THEN
            UPDATE local_service.entitlement_usage
               SET bookings_used = v_used + 1,
                   updated_at = now()
             WHERE shop_id = NEW.shop_id;
        ELSIF v_usage.bookings_topup_balance > 0 THEN
            UPDATE local_service.entitlement_usage
               SET bookings_used = v_used + 1,
                   bookings_topup_balance = bookings_topup_balance - 1,
                   updated_at = now()
             WHERE shop_id = NEW.shop_id;
        ELSE
            -- Refusal is an error, never a delete.
            RAISE EXCEPTION USING
                ERRCODE = 'P0001',
                MESSAGE = 'BOOKING_QUOTA_EXCEEDED';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION local_service.enforce_booking_quota() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_enforce_booking_quota ON local_service.bookings;
CREATE TRIGGER trg_enforce_booking_quota
    BEFORE INSERT ON local_service.bookings
    FOR EACH ROW
    EXECUTE FUNCTION local_service.enforce_booking_quota();

-- ============================================================================
-- H. FREE STOPS ACCEPTING ONLINE BOOKINGS ONCE THE MONTH IS FULL (A4), AND AN
--    EXPIRED TRIAL NO LONGER CLOSES THE SHOP
-- ============================================================================

-- The frozen view (20260813081349_launch_1:99-124) already returns one
-- product-safe boolean. It is replaced with the same column list plus the free
-- monthly ceiling, so the consumer page can say "full until the 1st" instead of
-- showing a generic refusal. The column list is unchanged, which is what keeps
-- the frozen public-contract assertion on this view valid. The view keeps the
-- default security_invoker = false that 20260807191259 established, so it reads
-- the plan table as its owner and anon sees only the boolean.
CREATE OR REPLACE VIEW local_service.shop_public_profile AS
SELECT
    s.id,
    s.name,
    s.slug,
    s.phone,
    s.address,
    s.line_oa_id,
    s.promptpay_number,
    s.promptpay_name,
    s.require_deposit,
    s.default_deposit_amount,
    CASE
        WHEN sub.shop_id IS NULL THEN false
        WHEN sub.status IN ('canceled', 'incomplete', 'incomplete_expired', 'unpaid') THEN false
        WHEN sub.status = 'trialing'
             AND COALESCE(sub.current_period_end, s.trial_ends_at) IS NULL THEN false
        WHEN local_service.bk01_shop_effective_plan(s.id) = 'free'
             AND local_service.bk01_free_bookings_ceiling() IS NOT NULL
             AND local_service.bk01_bookings_used_in_month(
                     s.id, local_service.bk01_month_key(now()))
                 >= local_service.bk01_free_bookings_ceiling() THEN false
        WHEN sub.status IN ('trialing', 'active', 'past_due') THEN true
        ELSE false
    END AS is_accepting_online_bookings
FROM local_service.shops AS s
LEFT JOIN local_service.subscriptions AS sub
    ON sub.shop_id = s.id
WHERE s.is_active = true;

GRANT SELECT ON local_service.shop_public_profile TO anon, authenticated;

-- The same rule at persistence time, with the frozen trigger name so the
-- trigger is replaced rather than duplicated. Kept SECURITY INVOKER exactly as
-- 20260813081349 declared it, so it deliberately owns no table rights and
-- reaches the plan data only through SECURITY DEFINER helpers.
-- The single behavioural change against the frozen version: an expired trial is
-- no longer a reason to refuse a booking by itself. Such a shop is on free
-- entitlements and keeps taking bookings until the free monthly ceiling is
-- reached; the shop is not closed. Explicitly non-accepting subscription states
-- still fail closed.
CREATE OR REPLACE FUNCTION local_service.enforce_shop_booking_acceptance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, local_service
AS $$
DECLARE
    v_subscription_status TEXT;
    v_trial_period_end TIMESTAMPTZ;
    v_ceiling INTEGER;
BEGIN
    SELECT
        sub.status,
        COALESCE(sub.current_period_end, s.trial_ends_at)
    INTO v_subscription_status, v_trial_period_end
    FROM local_service.shops AS s
    LEFT JOIN local_service.subscriptions AS sub
        ON sub.shop_id = s.id
    WHERE s.id = NEW.shop_id
      AND s.is_active = true;

    IF NOT FOUND
       OR v_subscription_status IS NULL
       OR v_subscription_status IN ('canceled', 'incomplete', 'incomplete_expired', 'unpaid') THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P0001',
            MESSAGE = 'SHOP_NOT_ACCEPTING_ONLINE_BOOKINGS';
    END IF;

    IF v_subscription_status = 'trialing'
       AND v_trial_period_end IS NOT NULL
       AND v_trial_period_end <= NOW()
       AND local_service.bk01_shop_effective_plan(NEW.shop_id) = 'free' THEN
        v_ceiling := local_service.bk01_free_bookings_ceiling();

        IF v_ceiling IS NOT NULL
           AND local_service.bk01_bookings_used_in_month(
                   NEW.shop_id, local_service.bk01_month_key(now())) >= v_ceiling THEN
            RAISE EXCEPTION USING
                ERRCODE = 'P0001',
                MESSAGE = 'SHOP_NOT_ACCEPTING_ONLINE_BOOKINGS';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION local_service.enforce_shop_booking_acceptance() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_enforce_shop_booking_acceptance ON local_service.bookings;
CREATE TRIGGER trg_enforce_shop_booking_acceptance
    BEFORE INSERT ON local_service.bookings
    FOR EACH ROW
    EXECUTE FUNCTION local_service.enforce_shop_booking_acceptance();

-- ============================================================================
-- I. SERVICE ALLOWANCE: the excess is switched off temporarily, nothing is
--    deleted
-- ============================================================================

-- I.1 Stamp the services that are inside the allowance for the current
--     Thailand calendar month and switch the SYSTEM-DISABLED ones back on. The
--     entitled set is the oldest services_limit services, which is deterministic
--     and stable, so the shop's active set does not churn. Idempotent.
--
--     F-7: the enable condition is `entitlement_disabled = true`. A service the
--     owner switched off carries `entitlement_disabled = false`, so it is left
--     exactly as the owner left it — the owner's own choice is never reversed by
--     this routine, whatever the plan says. Before F-7 this loop set
--     `is_active = true` on every off row it found, and the routine was invoked
--     from the booking path and from the dashboard read path, so a single
--     customer booking silently switched the owner's service back on.
--     The row is also only revived when it is still off, and the revive clears
--     the marker in the same write, so `is_active` and `entitlement_disabled`
--     can never contradict each other.
CREATE OR REPLACE FUNCTION local_service.bk01_restore_services_within_limit(p_shop_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, local_service
AS $$
DECLARE
    v_limit INTEGER;
    v_month DATE := local_service.bk01_month_key(now());
    v_restored INTEGER := 0;
    v_row RECORD;
BEGIN
    SELECT p.services_limit
      INTO v_limit
      FROM local_service.bk01_shop_limits(p_shop_id) AS p;

    IF v_limit IS NULL THEN
        RETURN 0;
    END IF;

    FOR v_row IN
        SELECT s.id
          FROM local_service.services AS s
         WHERE s.shop_id = p_shop_id
         ORDER BY s.created_at ASC, s.id ASC
         LIMIT v_limit
    LOOP
        INSERT INTO local_service.service_entitlement_periods (
            service_id, shop_id, month_key, updated_at
        ) VALUES (
            v_row.id, p_shop_id, v_month, now()
        )
        ON CONFLICT (service_id) DO NOTHING;

        UPDATE local_service.service_entitlement_periods
           SET month_key = v_month,
               updated_at = now()
         WHERE service_id = v_row.id
           AND month_key <> v_month;

        -- F-7: only a service the SYSTEM disabled may be revived. The owner's
        -- own switch-off (entitlement_disabled = false) is out of scope of this
        -- routine by construction.
        IF EXISTS (
            SELECT 1
              FROM local_service.services AS s
             WHERE s.id = v_row.id
               AND s.is_active = false
               AND s.entitlement_disabled = true
        ) THEN
            UPDATE local_service.services
               SET is_active = true,
                   entitlement_disabled = false
             WHERE id = v_row.id
               AND is_active = false
               AND entitlement_disabled = true;

            v_restored := v_restored + 1;
        END IF;
    END LOOP;

    RETURN v_restored;
END;
$$;

REVOKE ALL ON FUNCTION local_service.bk01_restore_services_within_limit(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION local_service.bk01_restore_services_within_limit(UUID) TO service_role;

-- I.2 Converge a shop onto its plan. Services outside the allowance and staff
--     beyond the cap are switched off (is_active false) and never deleted; when
--     the shop is inside its allowance again they are switched back on. Returns
--     a small report so the effect is observable.
--
--     This is the function that carries Owner rule 4, and the only place the
--     service allowance converges. Properties that matter: it is
--     convergence-only — it can only bring a shop TO its plan's allowance and
--     never beyond it; bk01_restore_services_within_limit re-enables only
--     services the SYSTEM disabled (F-7); and the disable step records its own
--     reason in `entitlement_disabled`, which is what makes the disable
--     reversible and the owner's own switch-off untouched.
CREATE OR REPLACE FUNCTION local_service.bk01_reapply_shop_entitlements(p_shop_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, local_service
AS $$
DECLARE
    v_plan TEXT;
    v_limits RECORD;
    v_month DATE := local_service.bk01_month_key(now());
    v_active_staff INTEGER;
    v_excess_staff INTEGER;
    v_disabled_staff INTEGER := 0;
    v_disabled_services INTEGER := 0;
    v_restored_services INTEGER;
BEGIN
    v_plan := local_service.bk01_shop_effective_plan(p_shop_id);

    SELECT *
      INTO v_limits
      FROM local_service.bk01_shop_limits(p_shop_id);

    v_restored_services := local_service.bk01_restore_services_within_limit(p_shop_id);

    -- Services outside the allowance for this month: switched off, not deleted.
    -- F-7: the reason is recorded (`entitlement_disabled = true`) so the
    -- automatic restore can tell a system switch-off apart from one the owner
    -- made on purpose. Only services the shop itself still has on are touched;
    -- a service the owner already switched off keeps its own reason.
    UPDATE local_service.services AS s
       SET is_active = false,
           entitlement_disabled = true
     WHERE s.shop_id = p_shop_id
       AND s.is_active = true
       AND NOT EXISTS (
               SELECT 1
                 FROM local_service.service_entitlement_periods AS sep
                WHERE sep.service_id = s.id
                  AND sep.month_key = v_month
           );

    GET DIAGNOSTICS v_disabled_services = ROW_COUNT;

    -- Staff beyond the cap: the newest are switched off, not deleted.
    SELECT count(*)::INTEGER
      INTO v_active_staff
      FROM local_service.staff
     WHERE shop_id = p_shop_id
       AND is_active = true;

    IF v_limits.staff_limit IS NOT NULL AND v_active_staff > v_limits.staff_limit THEN
        v_excess_staff := v_active_staff - v_limits.staff_limit;

        UPDATE local_service.staff AS st
           SET is_active = false
         WHERE st.id IN (
                   SELECT keep.id
                     FROM local_service.staff AS keep
                    WHERE keep.shop_id = p_shop_id
                      AND keep.is_active = true
                    ORDER BY keep.created_at DESC, keep.id DESC
                    LIMIT v_excess_staff
               );

        GET DIAGNOSTICS v_disabled_staff = ROW_COUNT;
    END IF;

    RETURN json_build_object(
        'shop_id', p_shop_id,
        'effective_plan', v_plan,
        'services_disabled_temporarily', v_disabled_services,
        'services_restored', COALESCE(v_restored_services, 0),
        'staff_disabled_temporarily', v_disabled_staff
    );
END;
$$;

REVOKE ALL ON FUNCTION local_service.bk01_reapply_shop_entitlements(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION local_service.bk01_reapply_shop_entitlements(UUID) TO service_role;

-- I.3 F-7 — the ONE convergence entry point for the plan-change path.
--
--     Removing the convergence call from create_booking_hold and from
--     get_entitlement_usage (see J and L) leaves exactly one circumstance in
--     which a shop should be converged: its plan actually changed, which is the
--     subscription row changing. This function is that circumstance. The billing
--     lane calls it from the subscription write (Stripe webhook / trial fallback
--     / cancellation); it must NOT be called from a customer-facing booking path
--     and it must NOT be called from a dashboard read.
--
--     It is deliberately thin: it authorises nothing and decides nothing by
--     itself, it converges the shop onto the plan it already has. That keeps one
--     code path for the plan-change decision (this call site in the billing
--     lane) and one implementation of the convergence (I.2), and means the anon
--     booking path never writes local_service.services at all.
--
--     Reachable from service_role only: the billing lane runs as the service
--     role. Revoking PUBLIC's default EXECUTE is what makes that true of the
--     Data API too (F-6).
CREATE OR REPLACE FUNCTION local_service.bk01_apply_plan_change(p_shop_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, local_service
AS $$
DECLARE
    v_plan TEXT;
BEGIN
    IF p_shop_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'shop_id is required';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM local_service.shops AS sh
         WHERE sh.id = p_shop_id
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'Shop not found';
    END IF;

    v_plan := local_service.bk01_shop_effective_plan(p_shop_id);

    RETURN local_service.bk01_reapply_shop_entitlements(p_shop_id);
END;
$$;

REVOKE ALL ON FUNCTION local_service.bk01_apply_plan_change(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION local_service.bk01_apply_plan_change(UUID) TO service_role;

-- I.4 create_service, with the allowance enforced before the row is written.
--     Identity, authorisation, validation and idempotency behaviour are those of
--     the frozen definition (20260807175455_phase_e3_1:56-119). The gate runs
--     after the idempotency lookup so a retry of an already-created service
--     still returns its id instead of failing at the limit.
CREATE OR REPLACE FUNCTION local_service.create_service(
    p_shop_id UUID,
    p_name TEXT,
    p_description TEXT,
    p_duration_minutes INTEGER,
    p_price NUMERIC,
    p_deposit_amount NUMERIC,
    p_idempotency_key UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, local_service
AS $$
DECLARE
    v_shop_id UUID;
    v_service_id UUID;
    v_limit INTEGER;
    v_total INTEGER;
BEGIN
    v_shop_id := p_shop_id;

    IF NOT local_service.has_shop_role(v_shop_id, ARRAY['owner', 'admin']::TEXT[]) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Owner or admin role required';
    END IF;

    IF p_idempotency_key IS NULL THEN
        RAISE EXCEPTION 'Idempotency key is required' USING ERRCODE = '22023';
    END IF;

    IF NULLIF(BTRIM(p_name), '') IS NULL THEN
        RAISE EXCEPTION 'Service name is required' USING ERRCODE = '22023';
    END IF;

    IF p_duration_minutes IS NULL OR p_duration_minutes < 15 OR p_duration_minutes % 15 <> 0 THEN
        RAISE EXCEPTION 'Duration must be a positive multiple of 15 minutes' USING ERRCODE = '22023';
    END IF;

    IF p_price IS NULL OR p_price < 0
       OR p_deposit_amount IS NULL OR p_deposit_amount < 0
       OR p_deposit_amount > p_price THEN
        RAISE EXCEPTION 'Invalid service price or deposit amount' USING ERRCODE = '22023';
    END IF;

    SELECT id
      INTO v_service_id
      FROM local_service.services
     WHERE shop_id = v_shop_id
       AND creation_idempotency_key = p_idempotency_key;

    IF v_service_id IS NOT NULL THEN
        RETURN v_service_id;
    END IF;

    -- Serialise the gate per shop so two concurrent creates cannot both pass
    -- the count. Same mechanism as the frozen create_staff.
    PERFORM pg_advisory_xact_lock(hashtext(v_shop_id::text));

    v_limit := NULL;

    SELECT p.services_limit
      INTO v_limit
      FROM local_service.bk01_shop_limits(v_shop_id) AS p;

    -- F-10: the allowance counts only ENABLED services. Counting every row
    -- meant a Free shop with three services that switched one off could never
    -- switch it back on: the stale count (3) still reached the limit (3) even
    -- though only two services were on. A disabled service does not occupy the
    -- allowance, so it is not counted here. local_service.create_service counts
    -- enabled services only; a disabled service never occupies the allowance.
    SELECT count(*)
      INTO v_total
      FROM local_service.services
     WHERE shop_id = v_shop_id
       AND is_active = true;

    IF v_limit IS NOT NULL AND v_total >= v_limit THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P0001',
            MESSAGE = 'SERVICE_LIMIT_EXCEEDED';
    END IF;

    INSERT INTO local_service.services (
        shop_id, name, description, duration_minutes, price,
        deposit_amount, is_active, entitlement_disabled, creation_idempotency_key
    ) VALUES (
        v_shop_id, BTRIM(p_name), NULLIF(BTRIM(p_description), ''),
        p_duration_minutes, p_price, p_deposit_amount, true, false, p_idempotency_key
    )
    RETURNING id INTO v_service_id;

    INSERT INTO local_service.service_entitlement_periods (
        service_id, shop_id, month_key, updated_at
    ) VALUES (
        v_service_id, v_shop_id, local_service.bk01_month_key(now()), now()
    )
    ON CONFLICT (service_id) DO NOTHING;

    RETURN v_service_id;
END;
$$;

REVOKE ALL ON FUNCTION local_service.create_service(UUID, TEXT, TEXT, INTEGER, NUMERIC, NUMERIC, UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION local_service.create_service(UUID, TEXT, TEXT, INTEGER, NUMERIC, NUMERIC, UUID) TO authenticated;

-- I.5 set_service_active, with the same gate on the re-activation path.
--     Identity and authorisation are those of the frozen definition
--     (20260807175455_phase_e3_1:174-203). Switching a service off is always
--     allowed, which is what keeps the temporary disable reversible.
--
--     Two F-7 properties are carried here, because this is the only function
--     the OWNER uses to switch a service off:
--     * switching off records the owner's reason — `entitlement_disabled` is
--       cleared to false, so the automatic restore (I.1) can tell an owner
--       switch-off apart from a system switch-off and will never reverse the
--       owner's own choice;
--     * switching on clears the system marker as well, so the row is never
--       left claiming the system disabled a service that is now enabled.
--     F-10: the gate counts only ENABLED services, so a Free shop that switched
--     one of its three services off can switch it back on — the off service no
--     longer occupies the allowance.
CREATE OR REPLACE FUNCTION local_service.set_service_active(
    p_service_id UUID,
    p_is_active BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, local_service
AS $$
DECLARE
    v_shop_id UUID;
    v_current_is_active BOOLEAN;
    v_limit INTEGER;
    v_total INTEGER;
BEGIN
    SELECT shop_id, is_active
      INTO v_shop_id, v_current_is_active
      FROM local_service.services
     WHERE id = p_service_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Service not found';
    END IF;

    IF NOT local_service.has_shop_role(v_shop_id, ARRAY['owner', 'admin']::TEXT[]) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Owner or admin role required';
    END IF;

    IF p_is_active = true AND (v_current_is_active IS DISTINCT FROM true) THEN
        PERFORM pg_advisory_xact_lock(hashtext(v_shop_id::text));

        v_limit := NULL;

        SELECT p.services_limit
          INTO v_limit
          FROM local_service.bk01_shop_limits(v_shop_id) AS p;

        -- F-10: only ENABLED services occupy the allowance. The service being
        -- switched on is not yet enabled, so it is not counted here.
        SELECT count(*)
          INTO v_total
          FROM local_service.services
         WHERE shop_id = v_shop_id
           AND is_active = true;

        IF v_limit IS NOT NULL AND v_total >= v_limit THEN
            RAISE EXCEPTION USING
                ERRCODE = 'P0001',
                MESSAGE = 'SERVICE_LIMIT_EXCEEDED';
        END IF;
    END IF;

    -- F-7: the owner's own switch-off clears the system marker, and switching
    -- on clears it too, so `is_active` and `entitlement_disabled` never
    -- contradict each other and the automatic restore can never revive a
    -- service the owner switched off.
    UPDATE local_service.services
       SET is_active = p_is_active,
           entitlement_disabled = false
     WHERE id = p_service_id;

    IF p_is_active THEN
        INSERT INTO local_service.service_entitlement_periods (
            service_id, shop_id, month_key, updated_at
        ) VALUES (
            p_service_id, v_shop_id, local_service.bk01_month_key(now()), now()
        )
        ON CONFLICT (service_id) DO NOTHING;

        UPDATE local_service.service_entitlement_periods
           SET month_key = local_service.bk01_month_key(now()),
               updated_at = now()
         WHERE service_id = p_service_id
           AND month_key <> local_service.bk01_month_key(now());
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION local_service.set_service_active(UUID, BOOLEAN) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION local_service.set_service_active(UUID, BOOLEAN) TO authenticated;

-- ============================================================================
-- J. PROMPTPAY DEPOSITS ARE NOT AVAILABLE ON FREE
-- ============================================================================

-- Replacement for the frozen create_booking_hold
-- (latest definition 20260807135141_phase_c_fail_closed_staff_schedules.sql:6-267).
-- One behavioural change: when the shop's plan row says
-- promptpay_deposit_allowed is false — the free plan, Owner-locked — no deposit
-- is collected. The booking is NOT blocked; it is written immediately as
-- 'confirmed' with deposit_status 'not_required', which is the existing path for
-- a zero deposit. That is the correct reading of "a free shop may not take
-- PromptPay deposits": free still takes bookings, it cannot ask the customer to
-- transfer money first.
--
-- A second change, forced by this stream's policy (see the header): the customer
-- upsert uses ON CONFLICT DO NOTHING followed by an explicit qualified UPDATE,
-- because the upsert DO-UPDATE form is rejected by the policy. The observable
-- behaviour is the same — the customer row's name is refreshed and its email is
-- only filled in when the caller supplied one.
--
-- A third change (F-7): entitlements are NO LONGER converged at the top of this
-- call. The rejected version converged the shop here, which meant every
-- customer booking ran the convergence routine and re-enabled every service
-- that happened to be off — reversing the owner's own switch-off, and writing
-- local_service.services on an anon path. Convergence now happens only when the
-- plan actually changes, through the plan-change entry point (I.5), which the
-- billing lane calls from the subscription write. A service the owner switched
-- off stays off here, because this path no longer touches the services table at
-- all.
--
-- Everything else — fail-closed staff scheduling, the overlap exclusion, stale
-- hold expiry, the staff selection heuristic, the returned JSON — is carried
-- over unchanged.
CREATE OR REPLACE FUNCTION local_service.create_booking_hold(
    p_shop_id UUID,
    p_service_id UUID,
    p_staff_id UUID DEFAULT NULL,
    p_customer_name VARCHAR DEFAULT '',
    p_customer_phone VARCHAR DEFAULT '',
    p_customer_email VARCHAR DEFAULT NULL,
    p_booking_date DATE DEFAULT CURRENT_DATE,
    p_start_time TIME DEFAULT '09:00:00',
    p_notes TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, local_service
AS $$
DECLARE
    v_service RECORD;
    v_shop RECORD;
    v_customer_id UUID;
    v_chosen_staff_id UUID := p_staff_id;
    v_deposit_required BOOLEAN;
    v_deposit_amount NUMERIC(10,2) := 0.00;
    v_status VARCHAR(50);
    v_deposit_status VARCHAR(50);
    v_expires_at TIMESTAMPTZ;
    v_booking_code VARCHAR(20);
    v_link_token VARCHAR(10);
    v_start_tz TIMESTAMPTZ;
    v_end_tz TIMESTAMPTZ;
    v_booking_id UUID;
    v_day_of_week INTEGER;
    v_end_time TIME;
    v_constraint_name TEXT;
    v_limits RECORD;
BEGIN
    IF NULLIF(btrim(p_customer_name), '') IS NULL THEN
        RAISE EXCEPTION 'Customer name is required';
    END IF;
    IF NULLIF(btrim(p_customer_phone), '') IS NULL THEN
        RAISE EXCEPTION 'Customer phone is required';
    END IF;
    IF p_booking_date IS NULL OR p_booking_date < CURRENT_DATE THEN
        RAISE EXCEPTION 'Booking date must be today or later';
    END IF;

    -- F-7: no entitlement convergence here. This is the customer-facing booking
    -- path; it must not write local_service.services and must not run the
    -- automatic restore, which would reverse a service the owner switched off.
    -- Convergence belongs to the plan-change path only (I.5).

    SELECT * INTO v_service
    FROM local_service.services
    WHERE id = p_service_id
      AND shop_id = p_shop_id
      AND is_active = true;
    IF v_service.id IS NULL THEN
        RAISE EXCEPTION 'Service not found or inactive';
    END IF;

    SELECT * INTO v_shop
    FROM local_service.shops
    WHERE id = p_shop_id
      AND is_active = true;
    IF v_shop.id IS NULL THEN
        RAISE EXCEPTION 'Shop not found or inactive';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM local_service.shop_holidays h
        WHERE h.shop_id = p_shop_id
          AND h.staff_id IS NULL
          AND h.holiday_date = p_booking_date
    ) THEN
        RAISE EXCEPTION 'Shop is closed on the requested date';
    END IF;

    v_start_tz := (p_booking_date || ' ' || p_start_time)::timestamp AT TIME ZONE 'Asia/Bangkok';
    v_end_tz := v_start_tz + (v_service.duration_minutes || ' minutes')::interval;
    v_end_time := (p_start_time + (v_service.duration_minutes || ' minutes')::interval)::time;
    v_day_of_week := EXTRACT(DOW FROM p_booking_date)::integer;

    UPDATE local_service.bookings
    SET status = 'expired',
        updated_at = NOW()
    WHERE shop_id = p_shop_id
      AND status = 'hold'
      AND expires_at IS NOT NULL
      AND expires_at <= NOW()
      AND tstzrange(start_timestamptz, end_timestamptz, '[)')
          && tstzrange(v_start_tz, v_end_tz, '[)');

    v_limits := NULL;

    SELECT *
      INTO v_limits
      FROM local_service.bk01_shop_limits(p_shop_id);

    IF v_limits.plan_code IS NULL THEN
        v_deposit_required := COALESCE(v_shop.require_deposit, true);
    ELSE
        v_deposit_required := COALESCE(v_shop.require_deposit, true)
                              AND v_limits.promptpay_deposit_allowed;
    END IF;

    IF v_deposit_required THEN
        IF v_service.deposit_amount IS NOT NULL AND v_service.deposit_amount > 0 THEN
            v_deposit_amount := v_service.deposit_amount;
        ELSIF v_shop.default_deposit_amount > 0 THEN
            v_deposit_amount := v_shop.default_deposit_amount;
        ELSE
            v_deposit_required := false;
        END IF;
    END IF;

    IF v_deposit_required AND v_deposit_amount > 0 THEN
        v_status := 'hold';
        v_deposit_status := 'awaiting';
        v_expires_at := NOW() + INTERVAL '15 minutes';
    ELSE
        v_status := 'confirmed';
        v_deposit_status := 'not_required';
        v_expires_at := NULL;
        v_deposit_amount := 0.00;
    END IF;

    IF v_chosen_staff_id IS NULL THEN
        SELECT st.id INTO v_chosen_staff_id
        FROM local_service.staff st
        WHERE st.shop_id = p_shop_id
          AND st.is_active = true
          AND NOT EXISTS (
              SELECT 1
              FROM local_service.shop_holidays h
              WHERE h.shop_id = p_shop_id
                AND h.staff_id = st.id
                AND h.holiday_date = p_booking_date
          )
          AND EXISTS (
              SELECT 1
              FROM local_service.staff_schedules s
              WHERE s.staff_id = st.id
                AND s.day_of_week = v_day_of_week
                AND COALESCE(s.is_working_day, false)
                AND p_start_time >= s.work_start
                AND v_end_time <= s.work_end
                AND NOT (
                    s.break_start IS NOT NULL
                    AND s.break_end IS NOT NULL
                    AND p_start_time < s.break_end
                    AND v_end_time > s.break_start
                )
          )
          AND NOT EXISTS (
              SELECT 1
              FROM local_service.bookings b
              WHERE b.staff_id = st.id
                AND b.status IN ('hold', 'pending_review', 'confirmed')
                AND (b.expires_at IS NULL OR b.expires_at > NOW())
                AND tstzrange(b.start_timestamptz, b.end_timestamptz, '[)')
                    && tstzrange(v_start_tz, v_end_tz, '[)')
          )
        ORDER BY (
            SELECT COUNT(*)
            FROM local_service.bookings b2
            WHERE b2.staff_id = st.id
              AND b2.booking_date = p_booking_date
              AND b2.status IN ('hold', 'pending_review', 'confirmed')
        ) ASC, st.created_at ASC
        LIMIT 1;

        IF v_chosen_staff_id IS NULL THEN
            RAISE EXCEPTION 'No available staff for the requested time slot';
        END IF;
    ELSE
        IF NOT EXISTS (
            SELECT 1
            FROM local_service.staff st
            WHERE st.id = v_chosen_staff_id
              AND st.shop_id = p_shop_id
              AND st.is_active = true
        ) THEN
            RAISE EXCEPTION 'Selected staff not found or inactive';
        END IF;
        IF EXISTS (
            SELECT 1
            FROM local_service.shop_holidays h
            WHERE h.shop_id = p_shop_id
              AND h.staff_id = v_chosen_staff_id
              AND h.holiday_date = p_booking_date
        ) THEN
            RAISE EXCEPTION 'Selected staff is off on the requested date';
        END IF;
        IF EXISTS (
            SELECT 1
            FROM local_service.staff_schedules s
            WHERE s.staff_id = v_chosen_staff_id
              AND s.day_of_week = v_day_of_week
              AND (
                  NOT COALESCE(s.is_working_day, false)
                  OR p_start_time < s.work_start
                  OR v_end_time > s.work_end
                  OR (
                      s.break_start IS NOT NULL
                      AND s.break_end IS NOT NULL
                      AND p_start_time < s.break_end
                      AND v_end_time > s.break_start
                  )
              )
        ) THEN
            RAISE EXCEPTION 'Selected staff is outside working hours or on a break';
        END IF;
        IF EXISTS (
            SELECT 1
            FROM local_service.bookings b
            WHERE b.staff_id = v_chosen_staff_id
              AND b.status IN ('hold', 'pending_review', 'confirmed')
              AND (b.expires_at IS NULL OR b.expires_at > NOW())
              AND tstzrange(b.start_timestamptz, b.end_timestamptz, '[)')
                  && tstzrange(v_start_tz, v_end_tz, '[)')
        ) THEN
            RAISE EXCEPTION 'Selected staff is unavailable during this time slot';
        END IF;
    END IF;

    INSERT INTO local_service.customers (shop_id, name, phone, email)
    VALUES (
        p_shop_id,
        btrim(p_customer_name),
        btrim(p_customer_phone),
        p_customer_email
    )
    ON CONFLICT (shop_id, phone) DO NOTHING;

    SELECT id
      INTO v_customer_id
      FROM local_service.customers
     WHERE shop_id = p_shop_id
       AND phone = btrim(p_customer_phone);

    IF v_customer_id IS NULL THEN
        RAISE EXCEPTION 'Customer record could not be created';
    END IF;

    UPDATE local_service.customers
       SET name = btrim(p_customer_name),
           email = COALESCE(p_customer_email, email)
     WHERE id = v_customer_id;

    v_booking_code := local_service.generate_booking_code();
    v_link_token := local_service.generate_link_token();

    BEGIN
        INSERT INTO local_service.bookings (
            shop_id, customer_id, staff_id, service_id, booking_code, link_token,
            link_token_expires_at, booking_date, start_time, end_time,
            start_timestamptz, end_timestamptz, status, deposit_status,
            service_price, service_duration_minutes, deposit_amount, total_price,
            deposit_price, expires_at, notes
        ) VALUES (
            p_shop_id, v_customer_id, v_chosen_staff_id, p_service_id, v_booking_code, v_link_token,
            NOW() + INTERVAL '24 hours', p_booking_date, p_start_time, v_end_time,
            v_start_tz, v_end_tz, v_status, v_deposit_status,
            v_service.price, v_service.duration_minutes, v_deposit_amount, v_service.price,
            v_deposit_amount, v_expires_at, p_notes
        )
        RETURNING id INTO v_booking_id;
    EXCEPTION
        WHEN exclusion_violation THEN
            GET STACKED DIAGNOSTICS v_constraint_name = CONSTRAINT_NAME;
            IF v_constraint_name = 'prevent_overlapping_staff_bookings' THEN
                RAISE EXCEPTION USING
                    ERRCODE = 'P0001',
                    MESSAGE = 'Selected staff is unavailable during this time slot';
            END IF;
            RAISE;
    END;

    RETURN json_build_object(
        'booking_id', v_booking_id,
        'booking_code', v_booking_code,
        'link_token', v_link_token,
        'status', v_status,
        'deposit_status', v_deposit_status,
        'deposit_amount', v_deposit_amount,
        'total_price', v_service.price,
        'expires_at', v_expires_at,
        'staff_id', v_chosen_staff_id
    );
END;
$$;

REVOKE ALL ON FUNCTION local_service.create_booking_hold(UUID, UUID, UUID, VARCHAR, VARCHAR, VARCHAR, DATE, TIME, TEXT) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION local_service.create_booking_hold(UUID, UUID, UUID, VARCHAR, VARCHAR, VARCHAR, DATE, TIME, TEXT) TO anon, authenticated, service_role;

-- ============================================================================
-- K. STAFF CAP: free gets one provider, Basic keeps the five already enforced
-- ============================================================================

-- K.1 create_staff. Identity, validation, idempotency and advisory locking are
--     those of the frozen definition (20260819000000:232-312); the cap now comes
--     from the plan row, so free is 1 and Basic is 5.
CREATE OR REPLACE FUNCTION local_service.create_staff(
    p_shop_id UUID,
    p_name TEXT,
    p_phone TEXT,
    p_idempotency_key UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, local_service
AS $$
DECLARE
    v_shop_id UUID;
    v_staff_id UUID;
    v_limits RECORD;
    v_active_staff_count INT;
BEGIN
    v_shop_id := p_shop_id;

    IF NOT local_service.is_shop_owner(v_shop_id) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Owner role required';
    END IF;

    IF p_idempotency_key IS NULL THEN
        RAISE EXCEPTION 'Idempotency key is required' USING ERRCODE = '22023';
    END IF;

    IF NULLIF(BTRIM(p_name), '') IS NULL THEN
        RAISE EXCEPTION 'Staff name is required' USING ERRCODE = '22023';
    END IF;

    SELECT id
      INTO v_staff_id
      FROM local_service.staff
     WHERE shop_id = v_shop_id
       AND creation_idempotency_key = p_idempotency_key;

    IF v_staff_id IS NOT NULL THEN
        RETURN v_staff_id;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(v_shop_id::text));

    v_limits := NULL;

    SELECT *
      INTO v_limits
      FROM local_service.bk01_shop_limits(v_shop_id);

    SELECT COUNT(*)
      INTO v_active_staff_count
      FROM local_service.staff
     WHERE shop_id = v_shop_id
       AND is_active = true;

    IF v_limits.staff_limit IS NOT NULL AND v_active_staff_count >= v_limits.staff_limit THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P0001',
            MESSAGE = 'STAFF_LIMIT_EXCEEDED';
    END IF;

    INSERT INTO local_service.staff (
        shop_id, name, phone, is_active, creation_idempotency_key
    ) VALUES (
        v_shop_id, BTRIM(p_name), NULLIF(BTRIM(p_phone), ''), true, p_idempotency_key
    )
    RETURNING id INTO v_staff_id;

    RETURN v_staff_id;
END;
$$;

REVOKE ALL ON FUNCTION local_service.create_staff(UUID, TEXT, TEXT, UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION local_service.create_staff(UUID, TEXT, TEXT, UUID) TO authenticated;

-- K.2 set_staff_active, with the cap read from the plan row. Switching a staff
--     member off is always allowed; switching one on is gated, which is what
--     makes the temporary disable in I.2 reversible.
CREATE OR REPLACE FUNCTION local_service.set_staff_active(
    p_staff_id UUID,
    p_is_active BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, local_service
AS $$
DECLARE
    v_shop_id UUID;
    v_current_is_active BOOLEAN;
    v_limits RECORD;
    v_active_staff_count INT;
BEGIN
    SELECT shop_id, is_active
      INTO v_shop_id, v_current_is_active
      FROM local_service.staff
     WHERE id = p_staff_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Staff member not found';
    END IF;

    IF NOT local_service.is_shop_owner(v_shop_id) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Owner role required';
    END IF;

    IF p_is_active = true AND (v_current_is_active IS DISTINCT FROM true) THEN
        PERFORM pg_advisory_xact_lock(hashtext(v_shop_id::text));

        v_limits := NULL;

        SELECT *
          INTO v_limits
          FROM local_service.bk01_shop_limits(v_shop_id);

        SELECT COUNT(*)
          INTO v_active_staff_count
          FROM local_service.staff
         WHERE shop_id = v_shop_id
           AND is_active = true;

        IF v_limits.staff_limit IS NOT NULL AND v_active_staff_count >= v_limits.staff_limit THEN
            RAISE EXCEPTION USING
                ERRCODE = 'P0001',
                MESSAGE = 'STAFF_LIMIT_EXCEEDED';
        END IF;
    END IF;

    UPDATE local_service.staff
       SET is_active = p_is_active
     WHERE id = p_staff_id;
END;
$$;

REVOKE ALL ON FUNCTION local_service.set_staff_active(UUID, BOOLEAN) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION local_service.set_staff_active(UUID, BOOLEAN) TO authenticated;

-- ============================================================================
-- L. USAGE SURFACE
-- ============================================================================

-- Keeps the shape of the frozen get_entitlement_usage
-- (20260819000000:473-531) and adds the plan's other limits, the month the
-- counter refers to and the deposit capability. A NULL bookings_limit means no
-- ceiling and is reported as null rather than as a large number, so a client
-- cannot mistake "unlimited" for a huge allowance.
--
-- The call authorises first and then READS. F-7: it no longer converges the
-- shop. The rejected version ran the convergence routine here, so every
-- dashboard load re-enabled every service that happened to be off — reversing
-- the owner's own switch-off on a read, and making a read path write
-- local_service.services. Convergence now happens only on the plan-change path
-- (the plan-change entry point, I.5), which the billing lane calls.
-- This function is therefore a pure read of the shop's entitlements.
CREATE OR REPLACE FUNCTION local_service.get_entitlement_usage(
    p_shop_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, local_service
AS $$
DECLARE
    v_usage local_service.entitlement_usage%ROWTYPE;
    v_plan TEXT;
    v_limits RECORD;
    v_used INTEGER;
    v_remaining_main INT;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Authentication required';
    END IF;

    IF NOT (local_service.is_shop_owner(p_shop_id) OR local_service.is_platform_admin()) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Owner or platform admin role required';
    END IF;

    v_usage := local_service.ensure_entitlement_row(p_shop_id);

    v_plan := local_service.bk01_shop_effective_plan(p_shop_id);

    SELECT *
      INTO v_limits
      FROM local_service.bk01_shop_limits(p_shop_id);

    v_used := local_service.bk01_bookings_used_in_month(
                  p_shop_id, local_service.bk01_month_key(now()));

    IF v_limits.bookings_limit IS NULL THEN
        v_remaining_main := NULL;
    ELSE
        v_remaining_main := GREATEST(0, v_limits.bookings_limit - v_used);
    END IF;

    RETURN json_build_object(
        'shop_id', p_shop_id,
        'plan', v_plan,
        'bookings_limit', v_limits.bookings_limit,
        'bookings_used', v_used,
        'bookings_remaining_main', v_remaining_main,
        'bookings_topup_balance', v_usage.bookings_topup_balance,
        'staff_limit', v_limits.staff_limit,
        'services_limit', v_limits.services_limit,
        'shops_limit', v_limits.shops_limit,
        'auto_slip_limit', v_limits.auto_slip_limit,
        'auto_slip_used', v_usage.auto_slip_used,
        'auto_slip_topup_balance', v_usage.auto_slip_topup_balance,
        'promptpay_deposit_allowed', v_limits.promptpay_deposit_allowed,
        'month_key', local_service.bk01_month_key(now()),
        'period_end', v_usage.period_end,
        'updated_at', v_usage.updated_at
    );
END;
$$;

REVOKE ALL ON FUNCTION local_service.get_entitlement_usage(UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION local_service.get_entitlement_usage(UUID) TO authenticated;

-- ============================================================================
-- M. TRIAL PROMOTION APPLICATION
-- ============================================================================

-- The trial promotion is applied when a subscription row appears, which is the
-- insertion the frozen trg_initialize_shop_subscription performs in the same
-- transaction that creates a shop. The entitlements come from
-- trial_promotions.entitlement_plan_code, so moving the promotion to another
-- plan, changing its length or switching it off is a row change with no code
-- change. Only a 'trialing' row is touched, so a paid subscription is never
-- rewritten by this trigger.
--
-- The subscription row is left saying 'basic_490' / 'trialing' when the trial
-- ends. The fallback to free is resolved at read time by
-- bk01_shop_effective_plan, which is what keeps the trial permanently distinct
-- from the free plan and keeps the shop open.
CREATE OR REPLACE FUNCTION local_service.apply_trial_promotion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, local_service
AS $$
DECLARE
    v_promotion local_service.trial_promotions%ROWTYPE;
    v_trial_ends_at TIMESTAMPTZ;
BEGIN
    SELECT *
      INTO v_promotion
      FROM local_service.trial_promotions
     WHERE promotion_code = 'basic_trial_14d';

    IF NOT FOUND OR NOT v_promotion.is_active THEN
        RETURN NEW;
    END IF;

    SELECT sh.trial_ends_at
      INTO v_trial_ends_at
      FROM local_service.shops AS sh
     WHERE sh.id = NEW.shop_id;

    UPDATE local_service.subscriptions
       SET plan = v_promotion.entitlement_plan_code,
           current_period_end = COALESCE(
               current_period_end,
               v_trial_ends_at,
               now() + (v_promotion.duration_days || ' days')::INTERVAL
           ),
           updated_at = now()
     WHERE id = NEW.id
       AND status = 'trialing';

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION local_service.apply_trial_promotion() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_apply_trial_promotion ON local_service.subscriptions;
CREATE TRIGGER trg_apply_trial_promotion
    AFTER INSERT ON local_service.subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION local_service.apply_trial_promotion();

-- ============================================================================
-- N. SHOP SIGNUP: record the business type, apply its starter pattern, and keep
--    the one-shop-per-account rule driven by the plan data
-- ============================================================================

-- The frozen body (20260807161412:21-135) is preserved: same fields, same
-- idempotency lookup, same refusal, same trial_ends_at of 14 days. Changes:
--   1. the one-shop refusal now compares the owner's shop count against the
--      free plan's shops_limit, so the 1-shop entitlement is live data rather
--      than a literal — the message and error code are unchanged;
--   2. the business type is resolved from the value the signup form sends in
--      p_business_category (a type_code, or the Thai or English label) and
--      recorded on the shop; an unmatched value falls back to the seeded
--      'other' row, so adding a type is a data change and a new type can never
--      hard-fail signup;
--   3. the type's starter pattern is applied as data, capped by the new shop's
--      service allowance.
-- p_promptpay_number and p_promptpay_name are no longer required: they are
-- stored when supplied and left null otherwise, which is what lets a free shop
-- sign up without deposit details (Owner-locked: free takes no PromptPay
-- deposit). NOTE the argument signature is unchanged, so no client changes.
CREATE OR REPLACE FUNCTION local_service.provision_owner_shop(
    p_shop_name TEXT,
    p_shop_slug TEXT,
    p_business_category TEXT,
    p_owner_name TEXT,
    p_owner_phone TEXT,
    p_promptpay_number TEXT,
    p_promptpay_name TEXT,
    p_requested_plan TEXT,
    p_idempotency_key UUID
)
RETURNS TABLE (
    shop_id UUID,
    shop_slug TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, local_service
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_shop_id UUID;
    v_shop_slug TEXT;
    v_owned_shops INTEGER;
    v_shops_limit INTEGER;
    v_type_code TEXT;
    v_type local_service.business_types%ROWTYPE;
    v_service JSONB;
    v_starter_applied INTEGER := 0;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;

    IF p_idempotency_key IS NULL THEN
        RAISE EXCEPTION 'Idempotency key is required' USING ERRCODE = '22023';
    END IF;

    IF NULLIF(BTRIM(p_shop_name), '') IS NULL
       OR NULLIF(BTRIM(p_shop_slug), '') IS NULL
       OR NULLIF(BTRIM(p_business_category), '') IS NULL
       OR NULLIF(BTRIM(p_owner_name), '') IS NULL
       OR NULLIF(BTRIM(p_owner_phone), '') IS NULL THEN
        RAISE EXCEPTION 'All shop and owner fields are required' USING ERRCODE = '22023';
    END IF;

    IF p_shop_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' THEN
        RAISE EXCEPTION 'Shop slug must contain lowercase letters, numbers, and single hyphens only'
            USING ERRCODE = '22023';
    END IF;

    IF p_requested_plan NOT IN ('free_trial', 'basic_490', 'pro_990') THEN
        RAISE EXCEPTION 'Invalid requested plan' USING ERRCODE = '22023';
    END IF;

    SELECT s.id, s.slug
      INTO v_shop_id, v_shop_slug
      FROM local_service.shops AS s
      JOIN local_service.shop_users AS su ON su.shop_id = s.id
     WHERE su.user_id = v_user_id
       AND s.registration_idempotency_key = p_idempotency_key;

    IF v_shop_id IS NOT NULL THEN
        RETURN QUERY SELECT v_shop_id, v_shop_slug;
        RETURN;
    END IF;

    -- One shop per account for the free plan. The limit itself is data.
    SELECT count(*)
      INTO v_owned_shops
      FROM local_service.shop_users
     WHERE user_id = v_user_id
       AND role = 'owner';

    v_shops_limit := NULL;

    SELECT p.shops_limit
      INTO v_shops_limit
      FROM local_service.entitlement_plans AS p
     WHERE p.plan_code = 'free';

    IF v_owned_shops >= COALESCE(v_shops_limit, 1) THEN
        RAISE EXCEPTION 'This account already owns a shop' USING ERRCODE = '23505';
    END IF;

    v_type_code := btrim(lower(regexp_replace(p_business_category, '[^a-zA-Z0-9]+', '_', 'g')));

    SELECT *
      INTO v_type
      FROM local_service.business_types
     WHERE type_code = v_type_code
       AND is_active = true;

    IF NOT FOUND THEN
        SELECT *
          INTO v_type
          FROM local_service.business_types
         WHERE is_active = true
           AND (label_th = BTRIM(p_business_category)
                OR label_en = BTRIM(p_business_category))
         ORDER BY display_order ASC
         LIMIT 1;
    END IF;

    IF NOT FOUND THEN
        SELECT *
          INTO v_type
          FROM local_service.business_types
         WHERE type_code = 'other';
    END IF;

    INSERT INTO local_service.shops (
        name,
        slug,
        phone,
        promptpay_number,
        promptpay_name,
        line_oa_id,
        subscription_status,
        trial_ends_at,
        owner_name,
        business_category,
        business_type_code,
        starter_set_applied,
        requested_plan,
        registration_idempotency_key
    ) VALUES (
        BTRIM(p_shop_name),
        BTRIM(p_shop_slug),
        BTRIM(p_owner_phone),
        NULLIF(BTRIM(p_promptpay_number), ''),
        NULLIF(BTRIM(p_promptpay_name), ''),
        'central_booking_oa',
        'trial',
        NOW() + INTERVAL '14 days',
        BTRIM(p_owner_name),
        BTRIM(p_business_category),
        v_type.type_code,
        false,
        p_requested_plan,
        p_idempotency_key
    )
    RETURNING id, slug INTO v_shop_id, v_shop_slug;

    INSERT INTO local_service.shop_users (shop_id, user_id, role)
    VALUES (v_shop_id, v_user_id, 'owner');

    -- Starter pattern as data, capped by the new shop's service allowance. This
    -- function is the trusted provisioning path, so the rows are written
    -- directly; the shop has no services yet, so it is inside its allowance by
    -- construction.
    FOR v_service IN
        SELECT value
          FROM jsonb_array_elements(
                   COALESCE(v_type.starter_pattern -> 'services', '[]'::JSONB)
               )
    LOOP
        EXIT WHEN v_starter_applied >= COALESCE((
            SELECT p.services_limit
              FROM local_service.bk01_shop_limits(v_shop_id) AS p
        ), 0);

        INSERT INTO local_service.services (
            shop_id, name, description, duration_minutes, price,
            deposit_amount, is_active, creation_idempotency_key
        ) VALUES (
            v_shop_id,
            v_service ->> 'name',
            NULL,
            COALESCE((v_service ->> 'duration_minutes')::INTEGER, 30),
            COALESCE((v_service ->> 'price')::NUMERIC, 0),
            COALESCE((v_service ->> 'deposit_amount')::NUMERIC, 0),
            true,
            NULL
        );

        v_starter_applied := v_starter_applied + 1;
    END LOOP;

    IF v_starter_applied > 0 THEN
        INSERT INTO local_service.service_entitlement_periods (
            service_id, shop_id, month_key, updated_at
        )
        SELECT s.id, v_shop_id, local_service.bk01_month_key(now()), now()
          FROM local_service.services AS s
         WHERE s.shop_id = v_shop_id
        ON CONFLICT (service_id) DO NOTHING;

        UPDATE local_service.shops
           SET starter_set_applied = true
         WHERE id = v_shop_id;
    END IF;

    RETURN QUERY SELECT v_shop_id, v_shop_slug;
END;
$$;

REVOKE ALL ON FUNCTION local_service.provision_owner_shop(
    TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION local_service.provision_owner_shop(
    TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID
) TO authenticated;
