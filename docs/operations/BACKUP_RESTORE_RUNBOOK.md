# BK01 Backup & Restore Runbook

**Status:** LOCKED PROCEDURE / RECOVERY TARGETS PROPOSED — 2026-08-28
**Public-launch dependency:** provider capability verification + explicit operations/owner approval of recovery targets.

## Ownership
- **Accountable role:** Platform Operations Owner.
- **Execution role:** authorized production operator designated by the Platform Operations Owner.
- **Review role:** independent release/security reviewer for restore-rehearsal evidence.
- Provider-managed backup does not remove WSTERA ownership of restore verification.

## Proposed V1 recovery baseline
These are BK-0 operating proposals, not claims about currently configured provider capability:
- authoritative Postgres backup/checkpoint: at least daily;
- minimum recoverable backup retention: 7 days;
- restore rehearsal: before public launch, then at least quarterly and after material backup architecture changes;
- proposed **RPO ≤ 24 hours** for catastrophic database recovery;
- proposed **RTO ≤ 8 hours** for catastrophic database recovery;
- Stripe remains external billing truth and must be reconciled after database restoration;
- critical private Storage objects must have a verified recovery/retention path consistent with the final slip-retention policy.

If the selected Supabase/Storage plan cannot meet these targets, public launch is blocked until the architecture or targets are explicitly changed and approved.

## Backup scope
- authoritative Postgres application data and schema/migration history;
- private Storage objects still within approved retention window;
- release/configuration metadata necessary to reconstruct Workers and provider callbacks, excluding secret values from documentation/backups that are not designed as secret stores;
- audit/evidence needed to reconcile Stripe and external-provider state.

## Retention interaction
Backup retention never overrides legal/privacy deletion rules. Final record/slip/audit retention policy is governed by legal/privacy approval; backups must have a documented expiry/deletion behavior consistent with that policy.
## Pre-release verification
1. Verify actual Supabase backup/PITR capability and Storage recovery behavior for the selected production plan.
2. Record configured frequency/retention and compare with the proposed targets above.
3. Perform an isolated restore rehearsal using representative tenant, booking, subscription, audit and private-slip references.
4. Measure observed recovery-point loss and restore duration rather than assuming provider SLA equals BK01 result.
5. Obtain explicit approval for the measured recovery target before public launch.

## Restore procedure
1. Declare incident and freeze risky writes if necessary.
2. Identify recovery point and expected data-loss window.
3. Restore into an isolated verification target first where feasible.
4. Replay/validate schema and tenant invariants.
5. Verify representative shops, bookings, subscriptions, audits and private Storage references.
6. Reconcile external Stripe/provider state after DB recovery.
7. Authorize cutover.
8. Run production smoke tests and record observed loss/deviation.

## Migration failure
Do not delete migration history to force success. Stop release, preserve error/evidence, determine forward-fix or a tested rollback compatible with existing data, rehearse on a copy/staging environment, then proceed through the deployment gate.
