# BK01 Deployment Runbook

**Status:** LOCKED PROCEDURE — no deployment authorized by BK-0

## Environments
- **Local:** developer machine + local/test Supabase; never production secrets/data.
- **Staging:** production-like two-Worker deployment and non-production provider credentials/data.
- **Production:** canonical `bk01.wstera.com` routing, production Supabase/Stripe/LINE configuration and approved release artifact only.

## Release artifact
Deploy only a reviewed commit that passed `09_TEST_RELEASE_GATES.md`. Record commit SHA, migration set, app build outputs, environment, reviewer and owner authorization.

## Order
1. verify clean approved commit and environment target;
2. backup/recovery readiness check before destructive/high-risk migration;
3. apply reviewed Supabase migrations in repository order;
4. run DB/RLS/security verification;
5. build/deploy consumer Worker;
6. build/deploy admin Worker;
7. configure/verify canonical routing under `bk01.wstera.com`;
8. verify Supabase Auth redirect URLs;
9. verify Stripe monthly price IDs + signed webhook endpoint/events;
10. verify LINE callback/webhook for approved central/merchant OA mode;
11. smoke customer booking, owner auth/dashboard, deposit flow, notification and billing state;
12. archive evidence.

## Secret ownership
Production secrets are managed in approved provider/runtime secret stores. Never commit, paste into docs or expose in `NEXT_PUBLIC_*`. Merchant LINE credentials follow dedicated server-side secret handling.

## Rollback / forward-fix
Database migrations are treated as forward-fix by default unless a tested reversible path exists. Worker artifact may roll back only when compatible with current DB schema. Never restore old app code across incompatible schema blindly.
