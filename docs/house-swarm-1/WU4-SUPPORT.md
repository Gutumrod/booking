# WU4-SUPPORT — BK01 customer-visible written support channel (L-13)

Status: DELIVERED — pending commander verification (worker does not self-approve)
Work unit: `H1-WU4-SUPPORT` · correlation id `house-swarm-1-wu4-20260926` · role class: implementation
Worktree: `D:/AI-Workspace/runtime/worktrees/house-swarm-1-wu4-support`
Branch: `feature/house-swarm-1-wu4-support` · base revision `37053d35cd7392419c341eeae03a9c1193ed41b7`

## 1. What the channel is

A customer-visible **written-only** support surface for BK01 at the route **`/support`** in
`apps/booking-consumer` (port 3000 app).

- Shape chosen: **configuration-driven written contact list** — an e-mail channel and a LINE
  Official Account channel, both rendered from configuration, plus written "what to include"
  guidance.
- Scope limit enforced in customer copy: **there is no live call and no telephone support**.
  The Thai and English copy both say so explicitly (`support.noLiveCall`).
- No form endpoint was added: a form would need a submission endpoint the Owner has not
  supplied, so the delivery shape is a configured contact value the customer writes to.
  This keeps the work inside the authorized scope without inventing an endpoint.

## 2. Where the customer finds it (normal journey)

The entry point is in the customer journey in three places, not only on a deep page:

| Surface | File | Entry |
|---|---|---|
| Landing page (`/`) | `apps/booking-consumer/src/app/page.tsx` | "Support & contact" link under the demo CTA |
| Booking page (`/book/[slug]`) | `apps/booking-consumer/src/app/book/[slug]/page.tsx` | same link in the page footer |
| Manage booking (`/manage-booking`) | `apps/booking-consumer/src/app/manage-booking/page.tsx` | same link below the action area |

All three carry `data-testid="support-entry-link"` and `href="/support"`.

## 3. Files and routes of the support surface

- Route: **`/support`** → `apps/booking-consumer/src/app/support/page.tsx`
- Component: `apps/booking-consumer/src/components/support-contact.tsx` (`SupportContact`)
- Resolution logic: `apps/booking-consumer/src/lib/support-channel.ts`

## 4. Placeholder values awaiting an Owner input (COMPLETE LIST)

The channel is delivered with **no contact value invented**. Both values are read from
configuration, and while unset the surface renders a marked placeholder
`[[OWNER_INPUT_REQUIRED: <ENV KEY>]]` and the message "Not configured yet" / "ยังไม่ได้ตั้งค่า".

| # | Configuration key | What the Owner must supply | Marked placeholder shown in the product |
|---|---|---|---|
| 1 | `NEXT_PUBLIC_SUPPORT_EMAIL` | the real support e-mail address | `[[OWNER_INPUT_REQUIRED: NEXT_PUBLIC_SUPPORT_EMAIL]]` |
| 2 | `NEXT_PUBLIC_SUPPORT_LINE_OA_ID` | the real LINE Official Account identifier | `[[OWNER_INPUT_REQUIRED: NEXT_PUBLIC_SUPPORT_LINE_OA_ID]]` |

Exactly two placeholders exist; the list above is the whole set.

Notes for the Owner:
- Neither key is set anywhere in this repository. The environment files are git-ignored and
  were **not read, created or edited** by this work unit.
- At least one of the two must be supplied before launch, otherwise the customer sees only the
  placeholder rows. The parity test asserts this unresolved state is a marked placeholder and
  never a fabricated value.
- The Owner may decide that only one of the two channels is offered; the surface degrades
  correctly with either one configured.

## 5. Alignment with the internal runbook — with NO published promise

Read: `docs/operations/SUPPORT_RUNBOOK.md` (42 lines, read in full).

Aligned to the runbook:
- Runbook §"Access principle" / §"Support intake": the customer is told to send a **written**
  message including booking code, shop name and the problem — so the intake fields the runbook
  needs arrive with the customer's first message.
- Runbook §"Prohibited actions" (no obtaining passwords/raw provider secrets): customer copy
  tells the customer not to send passwords, card numbers or full slip images.
- Runbook §"Escalation": SEV-0/1 → `docs/operations/INCIDENT_RUNBOOK.md`; Stripe/billing truth,
  privacy/data requests, suspected security incidents and deposit/refund disputes are routed to
  the owner/operator/legal review path rather than improvised in support.
- Runbook §"Response expectations" states in its own words that its targets are **internal
  operating targets, not a public contractual SLA**, and that public support hours / any
  customer-facing SLA need explicit Owner approval before launch.

**Deliberately NOT published:** no acknowledgement time, no update cadence, no business-day
target, no "guaranteed" wording, no 24/7 claim. No response-time or service-level commitment
appears anywhere in this change. This is enforced by a test
(`support copy makes no response-time or service-level promise`) and was re-checked by grep.

## 6. Escalation path (internal — not shown to customers)

1. Customer writes in on the configured written channel (e-mail or LINE OA).
2. Support records the case per runbook §"Support intake".
3. SEV-0/SEV-1 → `docs/operations/INCIDENT_RUNBOOK.md`.
4. Billing/Stripe truth, privacy/data request, suspected security incident, or merchant
   deposit/refund dispute → owner/operator/legal review path (runbook §"Escalation").
5. Merchant-facing product faults → BK01 engineering triage.

The customer sees none of the severity targets or routing above.

## 7. Merchant-facing support section — where it should live

**No customer/merchant manual exists in this repository yet.** Checked:
`apps/booking-consumer/README.md` and `apps/booking-admin/README.md` are still unmodified
`create-next-app` boilerplate; there is no manual, guide, handbook or FAQ document anywhere
under `docs/` (only `docs/operations/*` runbooks, which are internal).

Therefore, recorded here rather than invented:

- The merchant-facing support section **should live in the merchant manual material that
  WU-2 / WU-5 are expected to create** — specifically a TH/EN merchant help document for the
  BK01 owner/admin app (`apps/booking-admin`), which is where a shop owner would look.
- Suggested location when it exists: `docs/operations/MERCHANT_HELP_TH.md` and
  `docs/operations/MERCHANT_HELP_EN.md`, or a `/help` route in `apps/booking-admin`.
- Required content: how the shop owner contacts WSTERA support (written channel only, no live
  call), what to include in the first message, and the escalation expectation without any
  response-time promise.
- Until that document exists, the authoritative merchant-facing support statement remains this
  note plus the runbook. Do not create the merchant manual under this work unit — it is outside
  H1-WU4-SUPPORT's objective.

## 8. Thai and English copy with a matching key set

Added in `apps/booking-consumer/messages/th.json` and `.../en.json` with an identical key set:

`support.title`, `support.subtitle`, `support.writtenOnlyTitle`, `support.writtenOnlyBody`,
`support.noLiveCall`, `support.emailLabel`, `support.lineLabel`, `support.valuePending`,
`support.ownerInputNote`, `support.whatToInclude`, `support.includeBookingCode`,
`support.privacyNote` — 12 keys in each language.
Plus one shared entry-point key in `common`: `common.supportLink` (both languages).

## 9. Commands run, with exit codes (raw)

| # | Command | Exit |
|---|---|---|
| 1 | `node --no-warnings --test --experimental-test-isolation=none tests/support-channel-parity.test.ts` | 0 — 11 tests, 11 pass, 0 fail |
| 2 | `npm run test` | 0 — 129 tests, 129 pass, 0 fail |
| 3 | `npx tsc --noEmit -p apps/booking-consumer/tsconfig.json` | 0 |
| 4 | `npm run build --workspace apps/booking-consumer` | 0 — route list includes `ƒ /support` |
| 5 | `npm run lint --workspace apps/booking-consumer` | 0 — 0 errors, 6 pre-existing warnings |
| 6 | `npx next dev -p 3111` + `curl http://127.0.0.1:3111/support` | HTTP 200 |

Notes on two commands I deliberately did **not** run:
- `npm run build` at the repo root was **not** used: its `prebuild` hook runs
  `npm run sync-env`, which **writes `apps/*/.env.local`** — a prohibited file. The
  workspace-scoped `npm run build --workspace apps/booking-consumer` has no `prebuild` hook and
  was used instead.
- `npx tsc --noEmit -p apps/booking-consumer/tsconfig.json` returned
  `error TS2304: Cannot find name 'LayoutProps'` on the **first** run because Next's generated
  route types (`.next/types`) did not exist yet; `layout.tsx` was not touched by this unit.
  After command 4 generated those types, the same command returned exit 0.

## 10. Observed evidence

Test run (command 1):
```
✔ support copy key sets match between Thai and English
✔ the whole consumer message key set matches between Thai and English
✔ every support message has a non-empty value in both languages
✔ support copy makes no response-time or service-level promise
✔ support copy states that live call support is not available
✔ the support entry point is reachable from the normal customer journey
✔ unconfigured support channels render a marked owner-input placeholder
✔ blank or whitespace configuration is treated as unconfigured, not as a value
✔ configured support channels resolve to real links with no placeholder
✔ LINE identifier normalization always yields an @handle link
✔ support surface source contains no hard-coded contact value
ℹ tests 11 · pass 11 · fail 0
```

Build (command 4) route list:
```
ƒ /
ƒ /_not-found
ƒ /api/deposit-slips/upload-intent
ƒ /api/line/webhook
ƒ /api/line/webhook/merchant/[shopId]
ƒ /api/notifications/dispatch
ƒ /book/[slug]
ƒ /manage-booking
ƒ /support
```

Live browser check over `http://localhost:3111/support` (Thai, then switched to English with the
product's own language toggle) — extracted from the delivered screenshots in this folder:

Thai: `ช่วยเหลือและติดต่อ` · `ช่วยเหลือแบบข้อความเท่านั้น` ·
`ระบบนี้ไม่มีช่องทางช่วยเหลือแบบโทรสดหรือโทรศัพท์` ·
`[[OWNER_INPUT_REQUIRED: NEXT_PUBLIC_SUPPORT_EMAIL]]` ·
`[[OWNER_INPUT_REQUIRED: NEXT_PUBLIC_SUPPORT_LINE_OA_ID]]`

English: `Support & contact` · `Written support only` ·
`Live call and telephone support are not available for this product.` ·
`[[OWNER_INPUT_REQUIRED: NEXT_PUBLIC_SUPPORT_EMAIL]]` ·
`[[OWNER_INPUT_REQUIRED: NEXT_PUBLIC_SUPPORT_LINE_OA_ID]]`

Booking-page footer, in a real browser after the shop load settled:
`Powered by Local Service Booking SaaS` + `ช่วยเหลือและติดต่อ`, one
`a[data-testid="support-entry-link"][href="/support"]`.

Screenshots in this folder:
- `evidence-wu4-support-th.png` — `/support` in Thai (`html lang="th"`)
- `evidence-wu4-support-en.png` — `/support` in English (`html lang="en"`)
- `evidence-wu4-support-landing-entry.png` — entry link on `/`
- `evidence-wu4-support-book-footer.png` — entry link in the booking-page footer

## 11. Every changed file, with reason

New:
| File | Reason |
|---|---|
| `docs/house-swarm-1/WU4-SUPPORT.md` | this note (the required deliverable) |
| `apps/booking-consumer/src/app/support/page.tsx` | the `/support` route — the customer-visible support surface |
| `apps/booking-consumer/src/components/support-contact.tsx` | renders written-only channel copy + configuration-driven contact rows |
| `apps/booking-consumer/src/lib/support-channel.ts` | resolves contact values from configuration and yields the marked placeholder when unset |
| `tests/support-channel-parity.test.ts` | proves the Thai/English key sets match, plus no-SLA, written-only and placeholder assertions |
| `docs/house-swarm-1/evidence-wu4-support-th.png` | observed evidence: Thai surface |
| `docs/house-swarm-1/evidence-wu4-support-en.png` | observed evidence: English surface |
| `docs/house-swarm-1/evidence-wu4-support-landing-entry.png` | observed evidence: entry link on landing |
| `docs/house-swarm-1/evidence-wu4-support-book-footer.png` | observed evidence: entry link in booking footer |

Modified:
| File | Reason |
|---|---|
| `apps/booking-consumer/messages/th.json` | added `common.supportLink` and the 12 `support.*` Thai keys |
| `apps/booking-consumer/messages/en.json` | added `common.supportLink` and the 12 `support.*` English keys (same key set) |
| `apps/booking-consumer/src/app/page.tsx` | added the support entry link to the landing journey |
| `apps/booking-consumer/src/app/book/[slug]/page.tsx` | added the support entry link to the booking-page footer |
| `apps/booking-consumer/src/app/manage-booking/page.tsx` | added the support entry link to the manage-booking surface |

Nothing outside the allowed scope was touched. No `.env*`, no `.git`, no `node_modules`, no
`relay`, no `supabase`, no migration, no deploy.

## 12. Database, commit and push statement

- **No database connection was attempted.** No Postgres, Supabase or `supabase` CLI command was
  run. No migration was run or created. No deploy was run.
- **No `.env*` file was read, created or edited.** (The `sync-env` script that would write
  `.env.local` was deliberately avoided by using the workspace-scoped build.)
- **No commit and no push were made.** All work is uncommitted in the worktree.

## 13. Work-unit self-check against the acceptance checks

| Acceptance check | State |
|---|---|
| note exists and describes channel, escalation path and where the manual lives | met (§1, §6, §7) |
| reachable customer-visible support surface exists | met (`/support`, HTTP 200 observed) |
| surface is written-contact only and says there is no live call | met (both languages, observed) |
| Thai and English copy with matching key set, parity check run | met (commands 1 and 2, exit 0) |
| no response-time or service-level promise anywhere | met (test + grep, §5) |
| every contact value needing the Owner is a marked placeholder and listed | met (§4, exactly 2) |
| every changed file listed with a one-line reason | met (§11) |
| note states no DB connection and no commit/push | met (§12) |

This is a worker self-check, not an approval. The commander verifies the unit.
