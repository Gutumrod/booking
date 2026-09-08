# BK01 Product-Local Migration Stream

This directory is the active forward migration stream for BK01 inside a multi-product shared Supabase project.

Rules:

- Historical `supabase/migrations/*.sql` files are frozen evidence and must not be edited or extended for shared-runtime deployment.
- New files use `YYYYMMDDHHMMSS_snake_case.sql`.
- Every mutation target must be explicitly schema-qualified under `local_service` or `local_service_internal`.
- Product migrations cannot create/alter roles, schemas, databases, extensions, global configuration, or managed Supabase schemas.
- No direct writes to `auth`, `storage`, `cron`, `net`, `public`, `extensions`, `ps01`, `ps01_internal`, or `supabase_migrations`.
- Shared managed-surface changes go through the WSTERA platform-global lane.
- The runner owns the transaction and advisory lock; migration files must not issue transaction control.
- Applied files are immutable: changing an applied checksum fails closed.

Commands:

- `npm run db:bk01:generate`
- `npm run db:bk01:verify`
- `npm run db:bk01:plan`
- `npm run db:bk01:apply`

Required runtime secrets/config are documented in `.env.example`. Never commit a migrator password or database URL.
