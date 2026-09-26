# WUC-LEGAL-TRUTH — BK01 legal drafts vs the locked packs

Work unit: `H1-WUC-LEGAL-TRUTH` · Correlation id: `house-swarm-1-wuc-legal-20260926`
Worktree: `D:/AI-Workspace/runtime/worktrees/house-swarm-1-wu3-legal` (branch `feature/house-swarm-1-wu3-legal`, base commit `037b0de`)
Date: 2026-09-26 · Executor: Hermes Native Swarm worker (implementation role) · Profile `swarm-builder`

Finishing pass: work unit `H1-WUC-LEGAL-TRUTH-R2` · Correlation id `house-swarm-1-wuc-legal-r2-20260926`.
The substantive corrections below were made by the earlier worker in this same worktree. This
pass **verified** them rather than redoing them, completed this note, and produced the gate
evidence. The verification is recorded in §5 and §6; no correction was reverted.

Closing pass: work unit `H1-WUC-LEGAL-TRUTH-R3` · Correlation id `house-swarm-1-wuc-legal-r3-20260926`.
A third pass re-ran every declared gate (legal draft test, full suite, lint, type generation,
typecheck) in this worktree, re-measured the §3 placeholder census, the legal key-set parity and
the §5 pre-correction regression count, and filled in the note digest at the end of this file.
**Nothing recorded here had to be corrected:** every result and every `file:line` reference this
pass re-measured reproduced exactly. The only exception is §6 row 1 (the typecheck *before* type
generation), which this pass did not re-run because type generation had already been executed
here; that row remains an R2 observation. The R3 measurements are in §6.1.

## Status at creation of this note

Note created before any correction was made, so that the deliverable exists while the work is in progress.

- No legal review of these drafts has occurred, by a lawyer or by anyone else.
- The drafts are a pre-launch draft and must not be presented as final. The pre-launch draft marker stays on every page.
- No database connection was attempted. No Postgres or Supabase connection was opened, no migration was run, no `supabase` CLI was invoked, no deploy was performed.
- No `.env` file was read, edited or created.
- No commit and no push was performed in this work unit.

## Results

### 1. Stale statements found, with file, line and the replacement

The stale commercial model was carried in four places per statement: the Thai and English
subscription/billing copy in the consumer message catalogues, and the two generated Terms of
Service drafts that are produced from that copy.

- `apps/booking-consumer/messages/{th,en}.json:196` — the single JSON string holding
  `legal.terms.sections.subscriptionAndBilling.b`. Pre-correction and post-correction line
  numbers are the same (196) because the value was replaced in place; this was confirmed with
  `sed -n '196p'` and with the diff hunk header `@@ -193,7 +193,7 @@`.
- `docs/legal/TERMS-OF-SERVICE-EN.md:62-70` and `docs/legal/TERMS-OF-SERVICE-TH.md:62-70` —
  the generated §7 lines. Pre-correction line numbers were taken from
  `git show HEAD:<path> | cat -n`; post-correction numbers from `cat -n <path>`.

| # | Where (pre-correction, `HEAD`) | Stale statement | What it now says (at the same location) |
| --- | --- | --- | --- |
| S1 | `apps/booking-consumer/messages/en.json:196`, `apps/booking-consumer/messages/th.json:196`, `docs/legal/TERMS-OF-SERVICE-EN.md:62`, `docs/legal/TERMS-OF-SERVICE-TH.md:62` | "Annual billing is not offered." / "ไม่มีแพ็กเกจรายปี" — states a settled commercial fact, but annual billing is only *undecided* (Owner lock sheet C3: still not open until monthly sells). | "Shop subscriptions are billed monthly through Stripe. Annual billing is not open: no annual price has been approved." / "แพ็กเกจของร้านค้าคิดค่าบริการรายเดือนผ่าน Stripe เท่านั้น การเรียกเก็บเงินรายปียังไม่เปิดให้บริการ เนื่องจากยังไม่มีราคารายปีที่อนุมัติ" |
| S2 | same four locations (JSON line 196; drafts EN:63, TH:63) | "The trial starts when a shop is provisioned and runs for 14 days, with an evaluation capacity of 50 bookings and at most 5 active providers." / "ช่วงทดลองเริ่มเมื่อสร้างร้านสำเร็จและมีระยะเวลา 14 วัน มีความจุสำหรับทดลอง 50 คิว และผู้ให้บริการที่ใช้งานอยู่ไม่เกิน 5 คน" — reads as the free plan being a 14-day trial, and invents a 5-provider entitlement. Addendum A-2 locks Free as "Free ตลอดไป · 50 คิว/เดือน · 1 ร้าน · 3 บริการ", and A-3 keeps the 14-day trial as a Basic promotion only, separate from Free. Providers per plan are **not** locked (Owner lock sheet A1/A2 unanswered; STATUS-House A-3 lists A1–A5 as not answered). | "The shop plan is Free. Free is free forever at ฿0 / $0, with 50 bookings per calendar month, 1 shop and 3 services; a Free shop takes no PromptPay deposit." and "The 14-day offer is a Basic trial promotion and is separate from Free. The trial starts when a shop is provisioned, and it does not convert into a paid plan unless a Stripe checkout or subscription event completes. If it ends without payment, the shop falls back to Free entitlements and is not closed; anything above the Free entitlement, such as more than 3 services, is temporarily disabled instead of deleted. The number of active providers on each plan is not locked yet: [[OWNER INPUT: approved number of active providers on the Free plan]], [[OWNER INPUT: approved number of active providers on the Basic plan]]." (TH: "แพ็กเกจของร้านคือแพ็กฟรี ใช้ฟรีตลอดไปในราคา ฿0 / $0 โดยมี 50 คิวต่อเดือน (เดือนปฏิทิน) 1 ร้าน และ 3 บริการ ร้านที่ใช้แพ็กฟรีไม่มีมัดจำ PromptPay" and "ข้อเสนอ 14 วันคือโปรโมชันทดลองใช้แพ็ก Basic และแยกจากแพ็กฟรี … จำนวนผู้ให้บริการที่ใช้งานอยู่ของแต่ละแพ็กยังไม่ล็อก: [[OWNER INPUT: …]]") |
| S3 | same four locations (JSON line 196; drafts EN:64, TH:64) | "Basic and Pro prices are not final. The figures ฿490 per month for Basic and ฿990 per month for Pro are pilot reference points only and are not approved public prices: [[OWNER INPUT: …]]" / "ราคาแพ็กเกจ Basic และ Pro ยังไม่ใช่ราคาสุดท้าย ตัวเลข ฿490 ต่อเดือนสำหรับ Basic และ ฿990 ต่อเดือนสำหรับ Pro เป็นเพียงราคาอ้างอิงช่วงนำร่อง …" — carries the **retired prices** ฿490/฿990 after Addendum A-2 replaced them (Basic ฿390 / $11, "แทน ฿490/$14") and left Pro unpriced and off sale. | "Basic is ฿390 or $11 per month and has no booking ceiling for a normal shop; a fair-use guard may still be applied for abuse or platform protection. Pro is not on sale: it is offered only once automatic slip verification is actually available, and no Pro price has been approved: [[OWNER INPUT: approved Pro monthly price]]." / "แพ็ก Basic ราคา ฿390 หรือ $11 ต่อเดือน และไม่มีเพดานจำนวนคิวสำหรับร้านค้าปกติ … แพ็ก Pro ยังไม่เปิดขาย จะเปิดให้บริการเมื่อการตรวจสลิปอัตโนมัติใช้งานได้จริง และยังไม่มีราคา Pro ที่อนุมัติ: [[OWNER INPUT: approved Pro monthly price]]" |
| S4 | same four locations (JSON line 196; drafts EN:65, TH:65) | "A paid plan does not stop a normal shop at 100 or 500 bookings per month; … Basic and Pro allow at most 5 and at most 10 active providers respectively." / "แพ็กเกจชำระเงินจะไม่ตัดร้านค้าปกติที่ 100 หรือ 500 คิวต่อเดือน … แพ็กเกจ Basic และ Pro รองรับผู้ให้บริการที่ใช้งานอยู่ไม่เกิน 5 และ 10 คนตามลำดับ" — the 100/500 booking wall and the 5/10 provider entitlements were **not** locked values. Owner O-1 locks Basic as having no booking ceiling (fair use), and A-2/A-3 do not lock provider counts at all. The reviewer's F-1 also recorded that the database still blocked `basic_490` at 100 bookings, so the old sentence contradicted the database it described. | The wall and the 5/10 figures are gone; Basic "has no booking ceiling for a normal shop; a fair-use guard may still be applied" ("ไม่มีเพดานจำนวนคิวสำหรับร้านค้าปกติ ระบบอาจมีเพดานกันการใช้งานผิดวัตถุประสงค์…ได้"), and provider counts became Owner-input placeholders (see S2). |
| S5 | same four locations (JSON line 196; drafts EN:67, TH:67) | "The WSTERA central LINE account is the standard notification path for Trial, Basic and Pro." / "บัญชี LINE กลางของ WSTERA เป็นช่องทางแจ้งเตือนมาตรฐานสำหรับ Trial, Basic และ Pro" — claims a notification path for Pro, which is not on sale, and uses the retired "Trial" plan name. | "The WSTERA central LINE account is the standard notification path for the Basic trial and for Basic." / "บัญชี LINE กลางของ WSTERA เป็นช่องทางแจ้งเตือนมาตรฐานสำหรับช่วงทดลองของ Basic และแพ็ก Basic" |
| S6 | same four locations (JSON line 196; drafts EN:70, TH:70) | "A cancellation scheduled for the end of a period keeps the paid entitlement until that period ends; after it ends, new online bookings are blocked while historical data remains available according to the account retention policy." / "การยกเลิกที่มีผลเมื่อสิ้นรอบจะคงสิทธิ์ที่ชำระแล้วจนสิ้นรอบนั้น หลังสิ้นรอบจะรับคิวออนไลน์ใหม่ไม่ได้ …" — states a settled cancellation/entitlement rule. Owner lock sheet B4 ("ยกเลิก Basic") is **not answered** (the Owner reply recorded on that sheet covers B2 only), and STATUS-House A-3 lists B1, B3–B5 as still unanswered. | "What happens to a paid plan when it is cancelled, or when its paid period ends, is not decided: [[OWNER INPUT: approved treatment of a paid plan when it is cancelled or its paid period ends]]." / "สิ่งที่เกิดขึ้นกับแพ็กชำระเงินเมื่อยกเลิก หรือเมื่อสิ้นรอบที่ชำระแล้ว ยังไม่ได้รับการตัดสิน: [[OWNER INPUT: approved treatment of a paid plan when it is cancelled or its paid period ends]]" |

Stale statements found and corrected: **6** (S1–S6), each carried in **4** locations
(2 message catalogues + 2 generated drafts), i.e. 24 stale statement instances.

Wording alignment also made in the same value, which is **not** a stale-statement correction
and is recorded so the diff is fully accounted for:

- Drafts EN:66 / TH:66 — "Pro automatic slip verification is required before Pro is sold publicly"
  → "Pro automatic slip verification is a precondition for selling Pro publicly"
  ("เงื่อนไขบังคับก่อนขาย Pro สู่สาธารณะ"). This is wording alignment with the new
  "Pro is not on sale" sentence; the obligation itself is unchanged and matches Addendum A-2
  ("เปิดเมื่อตรวจสลิปอัตโนมัติใช้ได้จริง"). No Owner value is involved.

### 2. Pre-launch draft marker (unchanged and still present)

Both regenerated drafts still open with their marker, verified by reading the files:

- `docs/legal/TERMS-OF-SERVICE-EN.md` line 1: `# Terms of Service (BK01) — pre-launch draft`;
  line 3: `> PRE-LAUNCH DRAFT — NOT FINAL`; then the body stating the text "still requires
  approval by the Owner of the Service and review by a qualified lawyer" and the footer
  "Awaiting approval — Owner of the Service: PENDING. Qualified legal review: PENDING."
- `docs/legal/TERMS-OF-SERVICE-TH.md` line 1: `# ข้อกำหนดการให้บริการ (BK01) — ร่างก่อนเปิดให้บริการ`;
  line 3: `> ร่างก่อนเปิดให้บริการ — ยังไม่เป็นฉบับสุดท้าย`.

### 3. Unsupplied Owner values are placeholders, not invented numbers

Every value the Owner has not supplied is an explicit `[[OWNER INPUT: …]]` marker. Counted
from the files, section bodies plus the real (non-legend) `legal.meta` placeholder:

| Locale | Placeholder occurrences | Distinct strings | terms bodies | privacy bodies | `legal.meta` (real) |
| --- | --- | --- | --- | --- | --- |
| `th.json` | 44 | 42 | 21 | 22 | 1 |
| `en.json` | 44 | 42 | 21 | 22 | 1 |

Raw `[[OWNER INPUT:` matches in the whole `legal` namespace: **45** per locale. The single
extra match is the literal example inside `legal.meta.ownerInputLegend`, which explains the
convention and is not a missing value; it is excluded above. No placeholder sits in a
section heading, and no non-`OWNER INPUT` placeholder form exists (both enforced by the test).

New placeholders introduced by this correction, all for values the Owner has not answered:
`approved number of active providers on the Free plan`, `approved number of active providers
on the Basic plan`, `approved Pro monthly price`, `approved treatment of a paid plan when it
is cancelled or its paid period ends`. The retired placeholders `approved final public
monthly price for Basic` and `approved final public monthly price for Pro` were removed with
the statements that carried the retired prices — Basic now has a locked price, and Pro's
placeholder was narrowed to `approved Pro monthly price`.

### 4. Files created or modified, with a one-line reason

Modified (tracked) — all four substantive edits were made by the earlier worker in this
worktree and were verified, not redone, by this pass:

| Path | Reason |
| --- | --- |
| `apps/booking-consumer/messages/en.json` | Replaced the English `legal.terms.sections.subscriptionAndBilling.b` value: retired ฿490/฿990 and the free-as-14-day-trial / 5-10-provider / 100-500-booking statements replaced by the locked packs (Free forever 50/1/3, Basic ฿390/$11 no ceiling, Pro not on sale, annual not open) and Owner-input placeholders. |
| `apps/booking-consumer/messages/th.json` | The same replacement in Thai, key-for-key identical structure. |
| `docs/legal/TERMS-OF-SERVICE-EN.md` | Regenerated from `en.json` so the readable English draft carries the same corrected §7 (verified byte-identical by re-running the generator). |
| `docs/legal/TERMS-OF-SERVICE-TH.md` | Regenerated from `th.json` for the same reason in Thai. |
| `tests/legal-draft.test.ts` | Strengthened: asserts the retired ฿490/฿990/100-500 statements are absent and that every locked pack phrase is present in both locales, replacing the old check that merely required the words "not final"/"pilot reference". |
| `docs/house-swarm-1/WUC-LEGAL-TRUTH.md` | This note — created by the earlier worker, completed in the R2 pass (findings, evidence, safety statement, digest) and closed out by the R3 pass (§6.1 re-run record and the digest value on the last line). |

Created: none. Deleted: none. No file outside the allowed scope was touched; in particular
`apps/booking-admin/**`, `apps/booking-consumer/src/app/book/**`, `supabase/**` and every
`.env*` file are untouched.

Two temporary measurement helpers were written under `tests/` for this pass and deleted
again before the final state (`tests/tmp-legal-parity.mjs`, `tests/tmp-pre-copy-check.mjs`);
`git status --porcelain` after deletion shows only the six paths above.

### 5. Verification that the existing corrections are correct (not reverted)

Neither the retired prices nor the retired entitlements survive anywhere the customer can see
them, and the corrections do not contradict the locked values:

- Retired patterns in `JSON.stringify(legal)` for both locales: `฿490` **absent**,
  `฿990` **absent**, `100 or 500` **absent**.
- `grep -c "490\|990"` → `0` in both message catalogues and in all four `docs/legal/*.md` drafts.
- Locked phrases present in the §7 body: Thai **14/14**, English **14/14**.
- Drafts contain no "14-day trial" reading of the free plan; the free plan is stated as
  free forever with 50 bookings per calendar month, 1 shop, 3 services and no PromptPay deposit.
- The strengthened test would still catch a regression: applying its retired-pattern and
  locked-phrase assertions to the **pre-correction** copy (read from `git show HEAD:…`,
  nothing reverted, no file rewritten) produces **33 assertion failures** — the three retired
  patterns fail in both locales (6) and the locked phrases fail 13/14 in Thai and 14/14 in
  English (27). The superseded check passed on that same copy, so the strengthening is real.

### 6. Gate commands, exit codes and counts (all observed in this worktree)

Type generation and typecheck (consumer app), then lint, then the tests:

| # | Command (working directory) | Exit code | Observed result |
| --- | --- | --- | --- |
| 1 | `npx tsc --noEmit` (`apps/booking-consumer`) — before typegen | **0** | No diagnostics, empty output. `apps/booking-consumer/.next/types/{cache-life,root-params,routes,validator}.d.ts` were already present in this worktree, so the known `LayoutProps` precondition did not reproduce here; the step below was still run in the required order before the recorded typecheck. |
| 2 | `npx next typegen` (`apps/booking-consumer`) | **0** | `Generating route types...` / `✓ Types generated successfully` |
| 3 | `npx tsc --noEmit` (`apps/booking-consumer`) — after typegen | **0** | No diagnostics, empty output. This is the reported consumer typecheck. |
| 4 | `npx tsc --version` | **0** | `Version 5.9.3` (node v24.19.0, npm 11.11.1) |
| 5 | `npm --workspace apps/booking-consumer run lint` | **0** | `✖ 6 problems (0 errors, 6 warnings)`; all 6 warnings pre-existing in `apps/booking-consumer/src/app/book/[slug]/page.tsx` (5 unused icon imports, 1 `no-img-element`). **0 errors.** |
| 6 | `node --no-warnings --test --experimental-test-isolation=none tests/legal-draft.test.ts` | **0** | `tests 14 / suites 0 / pass 14 / fail 0 / cancelled 0 / skipped 0 / todo 0`, duration 52.7037 ms. The strengthened test `no invented company identity, contact address or commercial term appears` is among the 14 passing. |
| 7 | `npm test` (full suite, repo root) | **0** | `tests 132 / suites 0 / pass 132 / fail 0 / cancelled 0 / skipped 0 / todo 0`, duration 127.0305 ms. |
| 8 | `node tests/legal-docs-generate.mjs` | **0** | Wrote all four `docs/legal/*.md`; sha256 unchanged before/after for every file, so the drafts are in byte-exact sync with the corrected copy: EN terms `a058dbd9…`, TH terms `d5b78585…`, EN privacy `d314df51…`, TH privacy `3402fe15…`. |
| 9 | `git status --porcelain` (final) | **0** | Exactly the six paths in §4; no `.env*`, no `supabase/`, nothing staged, HEAD still `037b0de`. |

Legal key-set parity check (run separately from the test, because the acceptance check asks
for its own result). Measured by a temporary helper under `tests/`, since inline interpreter
one-liners are blocked in this environment; the helper was deleted afterwards and only read
JSON:

| Measurement | Result |
| --- | --- |
| Leaf key paths under `legal` | Thai **75**, English **75** |
| Keys in Thai missing from English | **0** |
| Keys in English missing from Thai | **0** |
| Key sets identical | **true** |
| `legal.terms` section keys | Thai **14**, English **14**, identical **true** |
| `legal.privacy` section keys | Thai **14**, English **14**, identical **true** |

### 6.1 Closing-pass (R3) re-run — what this pass actually observed

Re-run 2026-09-26 in this worktree (`037b0de`). Every value below is this pass's own observation,
not a copy of §6. Raw command → exit code → what it printed:

| # | Command (working directory) | Exit | Observed result |
| --- | --- | --- | --- |
| R1 | `node --no-warnings --test --experimental-test-isolation=none tests/legal-draft.test.ts` (root) | **0** | `tests 14 / suites 0 / pass 14 / fail 0 / cancelled 0 / skipped 0 / todo 0`, `duration_ms 60.0182`. The strengthened test `no invented company identity, contact address or commercial term appears` passes. |
| R2 | `npm test` (root) | **0** | `tests 132 / suites 0 / pass 132 / fail 0 / cancelled 0 / skipped 0 / todo 0`, `duration_ms 140.1146`. |
| R3 | `npm --workspace apps/booking-consumer run lint` (root) | **0** | `✖ 6 problems (0 errors, 6 warnings)`, all 6 in `apps/booking-consumer/src/app/book/[slug]/page.tsx` — pre-existing, unrelated to this work. **0 errors.** |
| R4 | `npx next typegen` (`apps/booking-consumer`) | **0** | `Generating route types...` / `✓ Types generated successfully` |
| R5 | `npx tsc --noEmit` (`apps/booking-consumer`) — after typegen | **0** | No diagnostics, empty output. This is the reported consumer typecheck. |
| R6 | `npx tsc --version` | **0** | `Version 5.9.3` (node v24.19.0, npm 11.11.1) |
| R7 | `node tests/legal-docs-generate.mjs` (root) | **0** | `generated 4 draft document(s)`. sha256 **identical before and after** every file: EN terms `a058dbd9d1cb67479d7f899b16822194035ac9a28e1df1349a1544a865a74067`, TH terms `d5b785855a792ed7e5a8f92f0ad257c94a53bb7edc6bbf381c0d388125032651`, EN privacy `d314df513368759884b6b3255d33c5a49346a8fec1d42b1498ea8fbabc2f502f`, TH privacy `3402fe15003960987bec0a8fd0da2befa0440209ae02868533091f240b5f8b53`. The generator is byte-idempotent on this copy. |
| R8 | `grep -c "490\|990"` over both message catalogues and all four `docs/legal/*.md` | **1** | `0` in every one of the six files (grep exits 1 when a file has no match at all), i.e. the retired prices are absent everywhere. |
| R9 | `git status --porcelain` (final) | **0** | Exactly the six paths in §4; nothing staged; `HEAD` still `037b0ded3215ac9b584ec53282fb5368b737189b`. |

Re-measured supporting numbers, same commands as §5/§3:

- Legal key-set parity: leaf key paths under `legal` **75 / 75**; missing in either direction **0**;
  key sets identical **true**; `legal.terms` sections **14/14** identical **true**;
  `legal.privacy` sections **14/14** identical **true**.
- Placeholder census (re-measured): both locales **44** real placeholder occurrences
  (terms bodies **21**, privacy bodies **22**, `legal.meta` **1**), **42** distinct strings after
  excluding the legend's example, **0** in any section heading, **1** legend example, **45** raw
  `[[OWNER INPUT:` matches. This matches the §3 table exactly.
- Strengthened-test regression evidence re-measured against the pre-correction copy read out of
  `git show HEAD:` (nothing reverted, no tracked file rewritten — the copies went to `tests/`
  and were deleted): **33** assertion failures = **6** retired-pattern failures (3 patterns × 2
  locales) + **27** locked-phrase failures (Thai **13/14**, English **14/14**). §5's figure
  reproduces exactly.
- Draft §7 line references re-checked in the corrected files: EN `62, 63, 64, 65, 66, 67, 70` and
  TH `62, 63, 64, 65, 66, 67, 70` carry the corrected sentences; the corresponding
  pre-correction lines `62–67, 70` in `git show HEAD:` carry the stale ones. The §1 table's
  convention (pre-correction numbers) is therefore accurate as written.
- Pre-launch draft marker re-read in both drafts (EN lines 1–11, TH lines 1–11): badge, footer
  and the `[[OWNER INPUT: effective date and version number of the approved document]]` line are
  all still present and unweakened.

Three temporary measurement helpers were written under `tests/` for this closing pass and deleted
again before the final state (`tests/tmp-legal-parity-r3.mjs`, `tests/tmp-pre-copy-check-r3.mjs`,
`tests/tmp-census-r3.mjs`, plus the two `tests/tmp-pre-*.json` dumps from `git show HEAD:`);
`git status --porcelain` after deletion shows only the six paths in §4, as row R9 records.

## 7. Safety statement

- **No legal review has occurred.** No lawyer and no other qualified reviewer has reviewed
  these documents. They are an unreviewed pre-launch draft written by a model from this
  repository's own documentation. They must not be presented as final, and nothing in them
  may be treated as an approved legal or commercial term.
- **The documents remain a pre-launch draft and must not be presented as final.** The
  pre-launch draft marker is on every page and on both readable drafts, and it was not
  weakened by this change.
- **Database enforcement is unapplied and blocked pending the shared-runtime closure.**
  Nothing in this change makes the database enforce what the copy now states. Addendum C
  requires a new migration for the Free quotas and the removal of the 100-booking Basic wall,
  and that work is `BLOCKED_ON_LANE_B` for *apply*; the database was not and could not be
  made to match this copy in this work unit.
- **No database connection was attempted.** No Postgres connection, no Supabase connection,
  no connection string was used, no migration was run, no `supabase` CLI was invoked and no
  deploy was performed. Every check in §5 and §6 is static: it reads JSON and source text,
  runs the project's own typegen/typecheck/lint/test, or reads the pre-correction copy out of
  `git show`.
- **No `.env` file was read or altered.** No `.env`, `.env.local`, `.env.staging.local` or
  `.secrets` file was read, created, modified or deleted, and no secret value was printed.
- **No commit and no push occurred.** No `git add`, `git commit`, `git push` or history
  rewrite was performed. All changes remain uncommitted in this worktree at `037b0de`, and
  the commander/reviewer owns any commit.

## 8. sha256 of this note file

The digest below is computed over this file's content **with the digest line itself
excluded**, so it stays valid after the value is written on the line and can be re-checked by
anyone with the same command:

```
head -n -1 docs/house-swarm-1/WUC-LEGAL-TRUTH.md | sha256sum
```

The digest of the finished file *including* this line is different by construction and is
reported to the commander; recompute it at any time with
`sha256sum docs/house-swarm-1/WUC-LEGAL-TRUTH.md`.

The value on the last line below was computed and written by the closing (R3) pass on
2026-09-26, after every edit to this note was finished. `head -n -1` excludes exactly that one
line, because `NOTE-SHA256:` is the last line of the file and the file ends with a single
newline.

NOTE-SHA256: a0c33504541fd04008fa6d60e8362cee4f0b6e8e3db0899b17d0902d25959492
