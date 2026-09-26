# WUC-UI-TRUTH — admin plan copy and comments now tell the truth

Work unit: `H1-WUC-UI-TRUTH` · correlation id `house-swarm-1-wuc-ui-20260926`
Worktree: `D:/AI-Workspace/runtime/worktrees/house-swarm-1-wua1`
Branch: `feature/house-swarm-1-wua1-plans` · base revision `2ef04601054ac8c498516035908a24cdc549e9ab`
Author: swarm-builder (Hermes Native Swarm worker, role class implementation)

Status of this note: COMPLETE. Created as a heading-only skeleton before any correction was made,
then appended as each correction landed.
Nothing in this note is self-approved; the commander verifies.

## 0. Why this exists

Independent review round 2 (`REVIEW-SWARM-1-R2-CLAUDE-2026-09-26.md`, finding **F-1**) and the
decisions in Addendum C split the plan work into a UI side and a DB side:

- the plan limits are evaluated **only in TypeScript**; the database does **not** enforce them;
- the database still caps Basic at **100** bookings, still caps Free at 50 bookings for the whole
  **lifetime** instead of per calendar month, has **no** shop or service limit at all, and the shop
  row still defaults to a **14-day** trial expiry that can close booking;
- a new migration has been written separately and has **NOT been applied**.

This work unit therefore does **not** add enforcement. It stops the admin app from claiming more
than the system does today.

## 1. Enforcement gaps observed in this worktree (evidence, not assertion)

| Fact | Where it was observed | What it means |
|---|---|---|
| The only plan limit error code that exists in SQL is `BOOKING_QUOTA_EXCEEDED` | `grep -rn "SERVICE_LIMIT_EXCEEDED\|SHOP_LIMIT_EXCEEDED\|BOOKING_QUOTA_EXCEEDED" supabase/migrations` → only `20260819000000_quota_staff_topup_enforcement.sql:212` | `SHOP_LIMIT_EXCEEDED` and `SERVICE_LIMIT_EXCEEDED` do **not exist**; the shop and service limits are not enforced at all |
| Basic is still blocked at 100 bookings | `20260819000000_quota_staff_topup_enforcement.sql:45-49` → `WHEN 'basic_490' THEN 100` | The "no ceiling" contract value is not live |
| Free is a **lifetime** 50, not per month | same file, lines 126-128 → monthly reset only runs `IF v_plan IN ('basic_490', 'pro_990')` | The Free monthly reset is not implemented |
| No shop or service limit | no such code or check in any file under `supabase/migrations/` | Both limits exist only in TypeScript |
| 14-day trial expiry can close booking | `20260813081349_launch_1_billing_truth_and_booking_gate.sql:21,62` still special-case `requested_plan IN ('basic_490','pro_990')` | A Free shop's booking gate still reads the legacy trial-expiry truth |
| The only caller of the limit function cannot enforce anything | `apps/booking-admin/src/app/register/page.tsx:174-175` passes a hard-coded usage of `0` | `evaluatePlanLimit` never sees real data |

`supabase/` was **read only** for this evidence. No database connection, no migration, no CLI.

## 2. Claims that were false or unsupported (file, line, replacement)

Line numbers are the pre-change lines at base revision `2ef0460`.

| # | File | Line (before) | False or unsupported claim | Replacement |
|---|---|---|---|---|
| 1 | `apps/booking-admin/src/lib/commercial-contract.ts` | 32 | `Stable error codes. These mirror the codes raised by the server-side SQL.` — untrue for 2 of the 3 codes | Rewritten: only `BOOKING_QUOTA_EXCEEDED` is raised by SQL today (`…enforcement.sql:212`); the other two `do NOT exist in any migration`, so they name a limit the database does not enforce yet |
| 2 | `apps/booking-admin/src/lib/commercial-contract.ts` | 36 | `` `null` = no customer-facing booking wall (fair-use protected server-side) `` — claims live server-side protection | `` `null` = no customer-facing booking wall is intended (fair use) `` + "nothing in the database removes the retired Basic 100-bookings wall yet … PENDING DATABASE ENFORCEMENT — migration written, not applied" |
| 3 | `apps/booking-admin/src/lib/commercial-contract.ts` | 171-172 | metric names "mirror the SQL error payloads" | "were intended to match SQL error payloads (only `BOOKING_QUOTA_EXCEEDED` exists server-side today)" |
| 4 | `apps/booking-admin/src/lib/commercial-contract.ts` | 182 | `Pure mirror of the entitlement gate` — there is no gate to mirror | `The intended entitlement boundary, computed without a database` |
| 5 | `apps/booking-admin/src/lib/commercial-contract.ts` | 187-190 | `the authoritative gate stays server-side … must stay in sync with the SQL described in docs/…/WUA1-PLAN-CODE.md` — claims an authoritative gate that does not exist for these metrics | `THIS IS NOT ENFORCEMENT AND NOTHING CALLS IT TO ENFORCE ANYTHING… the "authoritative gate server-side" that earlier revisions of this comment referred to does not exist for these metrics` |
| 6 | `apps/booking-admin/src/lib/commercial-contract.ts` | 24 | `Fixed by a CHECK constraint.` — silent about the legacy identifiers it still permits | Expanded to name the legacy values and that renaming needs an unapplied migration |
| 7 | `apps/booking-admin/src/lib/commercial-contract.ts` | 2-22 | File header described the limits with no statement that they are unenforced | Added `ENFORCEMENT STATUS` block naming all four live gaps (Basic 100, Free lifetime 50, no shop/service limit, 14-day trial expiry) and that the migration `has NOT been applied` |
| 8 | `apps/booking-admin/src/app/register/page.tsx` | 171-173 | "the Free plan is allowed only while those two approved limits still hold" — implies an operating check | `Intended-contract check only, NOT enforcement … the usage passed below is hard-coded 0, so it never sees real data` |
| 9 | `apps/booking-admin/src/app/register/page.tsx` | 436 | `FREE TIER — the Owner-approved default and entry plan` (no note that the card promises unenforced limits) | Note added that the card states intended entitlements the database does not enforce yet |
| 10 | `apps/booking-admin/src/app/register/page.tsx` | 461 | `BASIC TIER` (no note about the live 100-bookings wall) | Note added: ฿390 is locked; the "no booking cap" line is intent until the pending migration |
| 11 | `apps/booking-admin/src/app/platform-admin/page.tsx` | 21-26 | Plan-label comment silent about the DB still keying entitlement on the legacy ids | Comment added: labels are display only; the same id still maps to the retired 50-lifetime / 100 / 500 walls and 5/5/10 staff cap; DB enforcement PENDING |
| 12 | `apps/booking-admin/src/app/platform-admin/page.tsx` | 297-300 | `Pro is listed for truthful display…` — no note that assigning a plan does not make the DB grant what the label says | Note added to the same comment |
| 13 | `apps/booking-admin/messages/th.json` | 17 `landing.featureFreeTrial` | states "50 คิว/เดือน · 1 ร้าน · 3 บริการ" as if live | `… — สิทธิ์ตามสัญญา ยังไม่ถูกบังคับในฐานข้อมูล` |
| 14 | `apps/booking-admin/messages/th.json` | 65 `auth.pilotReferenceNotice` | same | `สิทธิ์แพ็กฟรีตามสัญญา: … (ยังไม่ถูกบังคับในฐานข้อมูล)` |
| 15 | `apps/booking-admin/messages/th.json` | 68 `auth.planFreeDesc` | "ใช้ได้ตลอดไปตามโควตาด้านล่าง" | "ตั้งใจให้ใช้ได้ตลอดไปตามสิทธิ์ด้านล่าง · *สิทธิ์ชุดนี้ยังไม่ถูกบังคับในฐานข้อมูล (รอ migration)" |
| 16 | `apps/booking-admin/messages/th.json` | 69-71 `auth.planFreeQ1..Q3` | states 50/1/3 as live limits | Each now names the intended value plus the actual DB behaviour (`DB ยังนับ 50 คิวตลอดอายุ`, `DB ยังไม่บังคับ — รอ migration`) |
| 17 | `apps/booking-admin/messages/th.json` | 72 `auth.planFreeExcluded` | "เกินโควตานี้ต้องอัปเกรด…" stated as a live consequence | "เมื่อระบบบังคับครบแล้ว … (ตอนนี้ยังไม่มีส่วนใดบังคับ)" |
| 18 | `apps/booking-admin/messages/th.json` | 75-77 `auth.planBasicDesc/Q1/Q2` | "ไม่ติดโควตา 50 คิว/เดือน" as fact; "พนักงานสูงสุด 5 คน" as settled | "ตั้งใจให้ไม่ติดโควตา … DB ยังมีเพดานคิวเดิมอยู่ รอ migration"; staff → "พนักงานสูงสุด 5 คน\* (รอ Owner ยืนยัน · DB ยังไม่บังคับ)" |
| 19 | `apps/booking-admin/messages/th.json` | 82 `auth.planProNote` | Pro price treated as a closed "no approved price" | Adds that the Pro price is an Owner-unanswered value = placeholder |
| 20 | `apps/booking-admin/messages/th.json` | 294 `dashboard.planBasicDesc` | same as #18 | Same treatment, plus "สิทธิ์ชุดนี้ยังไม่ถูกบังคับในฐานข้อมูล (รอ migration)" |
| 21 | `apps/booking-admin/messages/th.json` | 299-302 `dashboard.usageLimit*` | "โควตาของแพ็กฟรีเต็มแล้ว" / "ลูกค้าจองเพิ่มจะไม่สำเร็จ" / "อัปเกรด…เพื่อจองได้ต่อ" — all promise behaviour no component can currently deliver | Prefixed `*` and rewritten as conditional ("เมื่อ DB บังคับครบแล้ว … ตอนนี้ยังไม่มีส่วนใดบังคับในฐานข้อมูล") |
| 22 | `apps/booking-admin/messages/th.json` | 311 `dashboard.planLabelFree` | 50/1/3 as live | "… — ตามสัญญา ยังไม่ถูกบังคับใน DB" |
| 23 | `apps/booking-admin/messages/en.json` | 17, 65, 68-72, 75-77, 82, 294, 299-302, 311 | the same thirteen English strings in the same order as rows 13-22 | Same corrections, mirrored wording (`contract terms; not enforced by the database yet`, `migration pending`, `*` prefixes) |
| 24 | `apps/booking-admin/src/app/dashboard/page.tsx` | 1871 (Basic plan card) | no note that "no cap" is intent | Comment added naming the live 100-bookings wall and the unapplied migration |

## 3. Locked commercial facts (kept exactly as locked — no invented numbers)

Source: `OWNER-LOCK-BK01-PACKS-2026-09-26.md` header, `STATUS-HOUSE.md` Addendum A-2 and A-3,
Addendum C. These are byte-for-byte unchanged by this work unit and are asserted by
`tests/ui-truth.test.ts`:

| Fact | Value | Status |
|---|---|---|
| Free price | ฿0, free forever | locked (A-2) |
| Free bookings | 50 per **calendar** month | locked (A-2 / O-A5) |
| Free shops | 1 | locked (A-2) |
| Free services | 3 | locked (A-2) |
| Free PromptPay deposit | no deposit | locked (Owner, Addendum A-3) |
| Basic price | ฿390 / $11 per month | locked (A-2) |
| Basic booking ceiling | none (fair use) | locked (O-1) |
| Pro | not on sale, no approved price | locked (A-2) |
| Annual billing | not open | locked (C3) |

## 4. `*` placeholders — values the Owner has NOT answered

Marked `*` in admin copy and comments so no reader mistakes them for settled numbers. Per
`OWNER-LOCK-BK01-PACKS-2026-09-26.md` (only **B2** and, via A-3, **O-1/O-2** and the Free-deposit
line are answered):

| Owner item | Subject | Where it appears as `*` |
|---|---|---|
| O-A1 | Free provider (staff) count | `docs/04_PRICING_ENTITLEMENTS.md` (still `PENDING`), contract comment |
| O-A2 | Basic provider (staff) count — "up to 5" | `messages/th.json:77`, `messages/en.json:77`, `dashboard.planBasicDesc` (both), `platform-admin/page.tsx` comment |
| O-A3 | Free LINE OA central notifications | `docs/04_PRICING_ENTITLEMENTS.md` |
| O-A4 | What happens at 50 Free bookings | `usageLimit*` strings, now explicitly conditional |
| O-A5 | Definition of "month" | calendar month = the locked reading; residual uncertainty noted in contract comment |
| O-B1 | What the 14-day trial grants | `docs/04_PRICING_ENTITLEMENTS.md` (B1 unanswered) |
| O-B3..B5 | Repeat trial, cancellation, refunds | `docs/04_PRICING_ENTITLEMENTS.md` |
| O-C1 | VAT wording | `docs/04_PRICING_ENTITLEMENTS.md` |
| O-C2 | Pro price (proposal ฿790/$23 **not approved**) | `planProNote` (both locales), contract comment |
| O-C3 | Annual pricing (proposal ฿3,890/$111) | `docs/04_PRICING_ENTITLEMENTS.md` |
| O-C4 | Merchant LINE OA add-on price | `docs/04_PRICING_ENTITLEMENTS.md` |
| O-D1..D3 | Legal entity, support email / LINE OA ID, LINE Login channel | `docs/04_PRICING_ENTITLEMENTS.md` |

No number was invented, changed, or removed. The retired ฿490 / ฿990 pilot points and the
unapproved Pro proposals (฿790 / $23 / ฿3,890 / $111) appear nowhere in the admin catalogue or
admin source; the only `490` / `990` occurrences are the legacy storage identifiers, which are
stripped before that check runs (`tests/commercial-contract.test.ts`).

## 5. Database enforcement is UNAPPLIED and BLOCKED

- The migration that would make the database match the contract was written **separately**, and
  this work unit did **not** apply it, deploy it, or connect to any database.
- Applying it is **BLOCKED on Lane B** (Addendum C §1: `BLOCKED_ON_LANE_B`).
- Every plan value in the admin app is therefore stated as the **intended contract**, and every
  string that states a limit now also says enforcement is pending, or is prefixed `*`.
- `supabase/` was read (grep/read only) to collect the evidence in §1. It was **not** modified.

## 6. Gates re-run in this worktree (real observed results)

| # | Command | Exit code | Observed result |
|---|---|---|---|
| 1 | `npx next typegen` (cwd `apps/booking-admin`) | **0** | `✓ Types generated successfully` |
| 2 | `npx tsc --noEmit -p apps/booking-admin/tsconfig.json` (after typegen) | **0** | no diagnostics |
| 3 | `npm run lint` | **0** | consumer 6 warnings / 0 errors; admin 6 warnings / 0 errors; `✖ 6 problems (0 errors, 6 warnings)` each |
| 4 | `npm run test` | **0** | `ℹ tests 136 · ℹ pass 136 · ℹ fail 0 · ℹ cancelled 0 · ℹ skipped 0 · ℹ todo 0` |

Lint warnings are pre-existing and unrelated (unused imports, `<img>` usage, and `planLabel` in
`platform-admin/page.tsx` which was already unused at base revision `2ef0460`). `npm run test`
grew from 130 to 136 tests because this unit adds `tests/ui-truth.test.ts` (6 tests).

## 7. Files changed by this work unit

| File | One-line reason |
|---|---|
| `docs/house-swarm-1/WUC-UI-TRUTH.md` | This note: the claim table, the locked facts, the `*` placeholders and the gate evidence. |
| `apps/booking-admin/src/lib/commercial-contract.ts` | Header now states the real DB behaviour; dropped the "mirror the SQL" / "authoritative gate server-side" claims; error codes split into exists / does not exist. |
| `apps/booking-admin/src/app/register/page.tsx` | The limit check is labelled a non-enforcing intent check with hard-coded usage 0; Free/Basic card comments state the limits are intended, not enforced. |
| `apps/booking-admin/src/app/dashboard/page.tsx` | Basic plan card comment states the live 100-bookings wall and the unapplied migration. |
| `apps/booking-admin/src/app/platform-admin/page.tsx` | Plan labels documented as display-only, with the DB still keying entitlement on the legacy ids; `*` placeholder rule recorded. |
| `apps/booking-admin/messages/th.json` | Thirteen customer-visible plan/limit strings no longer promise enforcement that does not exist; unanswered values marked `*`. |
| `apps/booking-admin/messages/en.json` | The same thirteen strings in English, in parity. |
| `docs/04_PRICING_ENTITLEMENTS.md` | Added the "not applied / not what the DB enforces" status block and corrected the two sentences that implied live server-side enforcement. |
| `tests/ui-truth.test.ts` | New regression guard: no "mirror SQL" / "enforced server-side" claim, every plan string marks enforcement pending, locked values unchanged, note requirements. |

No file was created or modified outside `apps/booking-admin/src/`, `apps/booking-admin/messages/`,
`tests/` and `docs/`.

## 8. Evidence statements

- **No database connection was attempted.** No Postgres, Supabase, `psql` or `supabase` CLI
  command was run in this work unit; no migration was applied and no deploy occurred.
- **No `.env` file was touched** — none was read, created or modified.
- **No commit or push occurred.** The worktree is left dirty on
  `feature/house-swarm-1-wua1-plans` for the committer (Relay) per Addendum C §3.
- **Database enforcement is unapplied and blocked** (Lane B) — see §5.
- Nothing in this note is a self-approval; the commander verifies.

Sha256 of this note file is reported in the work-unit result, computed after the final write.
