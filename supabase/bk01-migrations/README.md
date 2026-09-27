# BK01 Product-Local Migration Stream

This directory is the active forward migration stream for BK01 inside a multi-product shared Supabase project.

Rules:

- Historical `supabase/migrations/*.sql` files are **frozen evidence** and must not be edited or extended for shared-runtime deployment.
- New files use `YYYYMMDDHHMMSS_snake_case.sql`.
- Every mutation target must be explicitly schema-qualified under `local_service` or `local_service_internal`.
- Product migrations cannot create/alter roles, schemas, databases, extensions, global configuration, or managed Supabase schemas.
- **No dependency on schema `auth`.** `bk01_migrator` owns only `local_service` and `local_service_internal` and holds no `USAGE` on `auth`, so a function that reaches into `auth.*` fails at runtime once ownership moves off `postgres` (the Junction A regression, `42501 permission denied for schema auth`).
  - Use `local_service_internal.request_user_id()` instead of `auth.uid()`. The bootstrap emits it with the same expression Supabase's `auth.uid()` uses, so behaviour is identical.
  - Do **not** read `auth.users` from a product migration at all. If a capability genuinely needs it, that is a shared-surface exception: it must be declared, owned by `postgres`, and reviewed as an ownership exception — not solved by a helper.
  - `scripts/lib/bk01-migration-policy.mjs` enforces this and rejects any `auth.uid()` use that is not declared for a named function:
    `-- BK01-ALLOW-AUTH-UID: <function_name>`
    A declaration is per file and per function; an undeclared function in a declared file still fails closed. Prefer `local_service_internal.request_user_id()` — a declaration is a recorded debt, not a solution.
- No direct writes to `auth`, `storage`, `cron`, `net`, `public`, `extensions`, `ps01`, `ps01_internal`, or `supabase_migrations`.
- Shared managed-surface changes go through the WSTERA platform-global lane.
- The runner owns the transaction and advisory lock; migration files must not issue transaction control.
- Applied files are immutable: changing an applied checksum fails closed.

## Who runs a migration

There is **no BK01 product database LOGIN**. The platform operator runs the stream:

1. the operator connects with their own platform credential (`BK01_PLATFORM_DATABASE_URL`, login must be in `BK01_OPERATOR_LOGINS`, default `postgres`);
2. the runner executes `SET LOCAL ROLE bk01_migrator` inside the transaction, then verifies `current_user = bk01_migrator`, `session_user` = the operator, and that `bk01_migrator` has no reach into `ps01`, `ps01_internal`, `storage`, `auth`, `public` or database-wide `CREATE`;
3. it applies the pending files and writes `local_service_internal.schema_migrations`.

If the boundary check fails the run stops before any migration is applied.

Commands:

- `npm run db:bk01:generate` — regenerate the bootstrap/rollback from the frozen chain
- `npm run db:bk01:verify` — verify the generated artifacts and the policy contracts
- `npm run db:bk01:plan` — read-only plan (no mutation)
- `npm run db:bk01:apply` — apply pending migrations

Never commit a database URL or a credential. See `.env.example` for the variable names.
