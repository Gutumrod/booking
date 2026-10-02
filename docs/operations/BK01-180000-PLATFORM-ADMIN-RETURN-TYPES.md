# BK01180000 — preserve platform-admin RPC contract

Owner authorized 2026-10-02; offline only, Claude holds claim/commit/push.

## Source-of-Truth References

- Parent RC3 `c750d4a83ccfa57356dd64334418fe98d3e01bc1`.
- Frozen `supabase/migrations/20260813092245_platform_admin_authorization.sql`:
  existing platform_admin_shop_row fields11/12 are TEXT; subscriptions.plan/status
  are VARCHAR(20) from `20260809002422_phase_e4_1_subscriptions_schema.sql`.
- Real PG17.11 bootstrap+15 and RC3 ledger14 reproduction:42804 column11,
  `structure of query does not match function result type`; external evidence
  `HOUSE-BK01-RC3-OFFLINE/20261002T152409890Z/platform-admin-chain-reproduction.json`.
- House design `docs/platform/shared-runtime/BK01-RC3-MANIFEST-PHASE12-2026-10-02.md`
  on `codex/platform-bk01-rc3-manifest-20261002`.

Reuse Gate N/A: narrow remediation of an existing RPC; no new backend capability.
Only SELECT expressions change: sub.plan::text and sub.status::text. Keeping only
plan cast would leave column12 incompatible; test both. Composite type/signature,
OID/owner, SECURITY DEFINER/search_path, authorization and ACL remain unchanged.
REVOKE ALL FROM PUBLIC repeats the existing denied privilege to satisfy the
product migration policy; assert raw ACL delta[] and runtime exact21. Do not edit
legacy SQL or add GRANT. Rollback restores the exact prior body/ACL and known red
behavior; local proof is not LAB rollback authority. Product ledger becomes15.

Acceptance: authorized rows and NULL-subscription LEFT JOIN return correctly;
non-admin/anon/runtime denial preserved; red-before/green-after, column12 probe,
rollback/reapply and no-op pass on disposable real PG. Publish/re-pin a new full
product SHA through controller before requesting review/GO; old RC3 stays pinned.
