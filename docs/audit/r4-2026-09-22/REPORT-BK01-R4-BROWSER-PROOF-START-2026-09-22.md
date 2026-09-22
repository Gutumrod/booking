# REPORT — BK01 R4 Browser/Mobile Proof Start

Date: 2026-09-22 (Asia/Bangkok)
Browser-proof source revision at discovery:
`7349c54390370a075a7dda78ca9e5c3f781b59ef`

Target:
- exact canonical BK01 source running locally;
- KMO-owned Supabase public runtime;
- no Cloudflare deploy/cutover;
- no KMO database mutation;
- desktop Chrome viewport 1440x1000;
- mobile Chrome viewport 390x844.

## Setup

Canonical worktree:
`D:\AI-Workspace\runtime\worktrees\bk01-r4-r5-20260922`

Local targets:
- Consumer `http://127.0.0.1:3100`
- Admin `http://127.0.0.1:3101`

KMO environment values were injected into process memory only.
No KMO secret value was written into canonical source/env files or evidence.
Public URLs were overridden to localhost for the proof target.

Playwright tooling was installed outside all product repos under:
`D:\AI-Workspace\runtime\browser-tools`

No package/lockfile in BK01 or KMO was changed.

## Actual browser observation

Route:
`/book/kmo-rackbarcustom`

Desktop and mobile both reached the KMO public shop identity but entered truthful LOAD_ERROR state.

Visible page result was a booking-load failure rather than a blank/false-success page.

Network/console evidence showed HTTP 401 / PostgreSQL 42501 permission failures on public resource reads:
- services query;
- staff query;
- staff_schedules query;
- shop_holidays query.

At discovery revision, services and staff requests included browser-side
`is_active = true` filters.

## Classification

### NEW-F18 — GENERIC_BK01_DEFECT

Canonical public consumer filtered services/staff by `is_active` even though:
- active-row visibility is already an RLS concern; and
- KMO's reviewed least-privilege public contract intentionally does not grant anonymous SELECT of `is_active`.

Historical KMO independent review from 2026-09-09 had already runtime-reproduced this exact 42501 class and classified the query behavior as a generic BK01 defect.

This finding was discovered by real browser proof after source-review PASS at `7349c54`.

### Separate unresolved KMO runtime evidence

The same browser run also returned 401 for `staff_schedules` and `shop_holidays`.

KMO baseline source declares approved anonymous SELECT projections for both tables, so these failures are not explained by NEW-F18.

Current classification:
`KMO_RUNTIME_GRANT_OR_BASELINE_DRIFT — VERIFY AFTER F18 SOURCE PASS`

Do not broaden grants or mutate KMO DB from this observation alone.

## Consequence

Browser/mobile acceptance is NOT PASS.

The prior source verdict at `7349c54` was valid for that exact source revision but browser proof discovered a new source defect. After remediation changed canonical source, fresh independent source review is required before browser proof resumes.

No R4 CLOSE claim is authorized.

No Junction A/shared-runtime/runtime-R7/Order/Claim work occurred.
