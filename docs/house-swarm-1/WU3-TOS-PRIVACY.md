# WU3 — Terms of Service & Privacy Policy (BK01) — Draft Note

**Work unit:** `H1-WU3-R2-NOTE` (record for the drafted content built under `H1-WU3-LEGAL-DRAFT`)
**Correlation id:** `house-swarm-1-wu3-r2-20260926`
**Worktree:** `D:/AI-Workspace/runtime/worktrees/house-swarm-1-wu3-legal`
**Revision at start:** `37053d35cd7392419c341eeae03a9c1193ed41b7`
**Branch:** `feature/house-swarm-1-wu3-legal`

**STATUS: UNREVIEWED DRAFT — NOT FINAL — awaits Owner input and qualified legal review.**

This note is the WU-3 record. It is filled in from commands that were actually run
in this worktree. Drafted content and Owner inputs are kept in separate sections so
nothing in the drafts is mistaken for an approved legal or commercial term.

No legal text, no page and no test was rewritten while producing this note. The note
records what is already present in this worktree.

---

## 1. Deliverables — what was drafted and where

Two documents, each in Thai and English, drafted from this product's own repository
documentation (`docs/01_PRD.md`, `docs/03_DATA_SECURITY_TENANCY.md`,
`docs/05_BOOKING_DOMAIN_RULES.md`, `docs/04_PRICING_ENTITLEMENTS.md`,
`docs/operations/LEGAL_PRIVACY_CHECKLIST.md`, `docs/operations/SUPPORT_RUNBOOK.md`)
and checked against `docs/audit/CURRENT_TRUTH_AND_CONTRADICTIONS.md`.

The copy lives in two places that cannot drift apart. The message files are the
source of truth; the readable Markdown is generated from them by
`tests/legal-docs-generate.mjs`, and `tests/legal-draft.test.ts` fails if any
generated file stops matching its message source.

| Deliverable | Path | Lines |
| --- | --- | --- |
| Terms of Service (EN) | `docs/legal/TERMS-OF-SERVICE-EN.md` | 103 |
| Terms of Service (TH) | `docs/legal/TERMS-OF-SERVICE-TH.md` | 103 |
| Privacy Policy (EN) | `docs/legal/PRIVACY-POLICY-EN.md` | 114 |
| Privacy Policy (TH) | `docs/legal/PRIVACY-POLICY-TH.md` | 114 |
| Message source (EN) | `apps/booking-consumer/messages/en.json` — `legal` namespace | +143 lines |
| Message source (TH) | `apps/booking-consumer/messages/th.json` — `legal` namespace | +143 lines |
| Renderer + draft notice + link component | `apps/booking-consumer/src/components/legal-document.tsx` | 178 |
| Generator (messages → `docs/legal/`) | `tests/legal-docs-generate.mjs` | 74 |
| Guard test | `tests/legal-draft.test.ts` | 301 |

Terms of Service carries 14 sections: whoWeAre, acceptance, theService,
merchantRelationship, accounts, bookingAndDeposits, subscriptionAndBilling,
cancellationPolicy, availability, acceptableUse, intellectualProperty, liability,
governingLaw, contact.

Privacy Policy carries 14 sections: controllerAndRoles, whatWeHold, purposes,
lawfulBasis, cookies, subprocessors, crossBorder, retention, dataSubjectRights,
security, breach, age, changes, contact.

Section order is declared in `LEGAL_SECTION_ORDER` in
`apps/booking-consumer/src/components/legal-document.tsx`, not taken from object
iteration order, so a section cannot silently disappear from a rendered page.

What the drafts describe is limited to what the Service actually does in its current
state: a public mobile booking page with no customer account; customer name plus Thai
mobile number; a 15-minute slot hold while the customer pays the shop's own
PromptPay recipient; deposit-slip upload (JPEG/PNG/WebP, up to 5 MB) held in private
storage with manual review for Basic and automatic verification treated as a Pro
capability not yet available; LINE confirmation plus at least one pre-appointment
reminder; server-enforced cancellation and rescheduling windows; Stripe monthly
subscription billing with no annual option. The drafts state explicitly that they
promise no uptime level, no attendance or revenue outcome, no refund automation, and
no response-time commitment.

## 2. Routes that expose each document

| Document | Route | Page file | Renders |
| --- | --- | --- | --- |
| Terms of Service | `/legal/terms` | `apps/booking-consumer/src/app/legal/terms/page.tsx` | `<LegalDocument documentKey="terms" />` |
| Privacy Policy | `/legal/privacy` | `apps/booking-consumer/src/app/legal/privacy/page.tsx` | `<LegalDocument documentKey="privacy" />` |

The route strings are held in the message files as
`legal.meta.termsRoute = "/legal/terms"` and `legal.meta.privacyRoute = "/legal/privacy"`
in both locales, and the in-document navigation links are built from those values.

Both documents are linked from two surfaces, and both are reachable before any
payment step:

- Landing page `apps/booking-consumer/src/app/page.tsx` — `<LegalLinks />` renders next
  to the primary call to action (unconditional).
- Booking page `apps/booking-consumer/src/app/book/[slug]/page.tsx` — `<LegalLinks />`
  renders inside the always-present `<footer>`, which sits outside the step container
  (`<main>`). The guard test asserts the footer's legal links are not gated on a
  booking step, so they are present on step 1, step 2 and step 3, i.e. before any
  deposit is requested.

The draft marker itself is rendered twice on every page — once above the section list
and once after it — by `LegalDraftNotice` in `legal-document.tsx`, which uses
`role="note"` and an `aria-label` taken from the badge text, and carries no `hidden`
class at any breakpoint.

## 3. Key-set parity result (real numbers)

Computed from the message files by the guard test and confirmed by direct extraction:

- Leaf key paths under `legal` — Thai: **75**, English: **75**. Keys present in Thai
  but missing from English: **0**. Keys present in English but missing from Thai: **0**.
- Section keys for `legal.terms` — Thai: **14**, English: **14**, identical: **yes**.
- Section keys for `legal.privacy` — Thai: **14**, English: **14**, identical: **yes**.
- Every section has a non-empty heading and a non-empty body in both locales, and the
  `retention` and `subprocessors` sections name every class and party the checklist
  requires.
- Thai sections were confirmed to contain Thai script (`[\u0E00-\u0E7F]`) and English
  sections to contain Latin script, so no one language was left in place of the other.

## 4. Owner inputs still missing (blank placeholders in the drafts)

These are the values the drafts deliberately leave blank. The count below was taken
from the placeholders actually present in the files, not from a list written by hand.

Counting rule used: an occurrence of `[[OWNER INPUT: ...]]` in a section body.
The literal example `[[OWNER INPUT: ...]]` inside `legal.meta.ownerInputLegend`
is a legend that explains the convention and is not a missing value, so it is
excluded. The Thai and English files contain the same placeholder set, so the counts
below apply to both locales and to both language versions of each document.

**Occurrence counts per locale (`en.json` and `th.json`): 42 real placeholders.**
Breakdown: 1 in `legal.meta`, 19 in `legal.terms`, 22 in `legal.privacy`.
**Distinct placeholder strings: 40.** Two strings account for the two extra
occurrences, each appearing twice: "privacy request channel for customers, staff and
merchants" (Privacy sections 9 and 14) and "published support hours" (Terms section 14
and Privacy section 14). Per document: `legal.meta` 1, `legal.terms` 19,
`legal.privacy` 22.

### 4.1 Shared with every document (1)

- `legal.meta.lastUpdatedValue` — **effective date and version number of the approved
  document**. Shown by the draft notice on both pages and in all four generated
  Markdown files: "Draft version and date: [[OWNER INPUT: effective date and version
  number of the approved document]]".

### 4.2 Terms of Service — 19 placeholder occurrences

| Section | Missing Owner value |
| --- | --- |
| 1. whoWeAre | registered legal entity name of the operator |
| 1. whoWeAre | company registration number of the operator |
| 1. whoWeAre | registered address of the operator |
| 1. whoWeAre | address for legal notices |
| 2. acceptance | effective date and version number of the approved Terms of Service |
| 4. merchantRelationship | approved default merchant deposit, refund and cancellation policy wording to publish |
| 7. subscriptionAndBilling | approved final public monthly price for Basic |
| 7. subscriptionAndBilling | approved final public monthly price for Pro |
| 7. subscriptionAndBilling | approved Pro automatic slip-verification monthly allowance and top-up price |
| 7. subscriptionAndBilling | approved shop-owned LINE OA managed add-on price |
| 7. subscriptionAndBilling | VAT treatment of the subscription price |
| 7. subscriptionAndBilling | approved subscription fee refund policy |
| 8. cancellationPolicy | approved default cancellation window and reschedule window to publish |
| 9. availability | approved availability commitment, if any |
| 9. availability | approved notice period and method for changes to these Terms |
| 12. liability | approved liability cap and liability exclusions |
| 13. governingLaw | approved governing law, jurisdiction and dispute-resolution process |
| 14. contact | support contact channel shown to customers and merchants |
| 14. contact | published support hours |

Section 7 also states the pilot reference points ฿490/month (Basic) and ฿990/month
(Pro) explicitly as "not final" and "pilot reference points only", so those figures
are not approved public prices.

### 4.3 Privacy Policy — 22 placeholder occurrences

| Section | Missing Owner value |
| --- | --- |
| 1. controllerAndRoles | approved PDPA role allocation between WSTERA and the merchant for shop-owner, staff and booking-customer personal data |
| 4. lawfulBasis | approved lawful basis for each processing purpose |
| 6. subprocessors | automatic slip-verification provider name and processing details |
| 6. subprocessors | confirmed data location or region for each subprocessor |
| 6. subprocessors | named owner of vendor privacy and security review |
| 7. crossBorder | approved cross-border transfer assessment and any required transfer mechanism |
| 8. retention | retention period for customer and booking records |
| 8. retention | retention period for deposit-slip images |
| 8. retention | retention period for LINE notification and binding logs |
| 8. retention | retention period for authentication and account data |
| 8. retention | retention period for Stripe and billing records |
| 8. retention | retention period for support tickets and attachments |
| 8. retention | retention period for security and audit logs |
| 8. retention | retention period for backups after account closure |
| 9. dataSubjectRights | approved identity-verification steps and response deadline for data-subject requests |
| 9. dataSubjectRights | privacy request channel for customers, staff and merchants |
| 11. breach | approved breach notification duties and timelines |
| 12. age | approved minimum age statement for the Service |
| 13. changes | approved notice period and method for changes to this Privacy Policy |
| 13. changes | effective date and version number of the approved Privacy Policy |
| 14. contact | privacy request channel for customers, staff and merchants |
| 14. contact | published support hours |

The eight retention entries are exactly the eight classes the legal and privacy
checklist requires a decision for. Section 8 states no number, because engineering
documentation cannot determine a retention period.

### 4.4 Placeholder discipline

- Every `[[OWNER INPUT: ...]]` is closed; open and close counts are equal in every
  section, and no `[[` marker other than `[[OWNER INPUT:` appears in any body.
- No placeholder appears inside a section heading, where it would read as final text.
- The guard test also proves the drafts invent no company identity, contact address or
  commercial term: no e-mail address, no 13-digit registration/tax number, no "100%"
  security or outcome claim, no guaranteed-no-show-rate wording, and none of the
  retired ฿4,900 / ฿9,900 annual pricing.

## 5. Status statement

**The text in `docs/legal/` and the pages at `/legal/terms` and `/legal/privacy` is an
unreviewed draft. It has not been approved by the Owner of the Service and it has not
been reviewed by a qualified lawyer. It is not legal advice and it is not the contract
that will apply at launch.**

On screen this is stated in both languages on both documents: the badge reads
"PRE-LAUNCH DRAFT — NOT FINAL" (TH: a Thai draft wording), the body states that the
text is an unreviewed pre-launch draft requiring approval by the Owner of the Service
and review by a qualified lawyer, and the footer reads "Awaiting approval — Owner of
the Service: PENDING. Qualified legal review: PENDING. Do not rely on this text."
The test asserts the marker names the Owner, names legal review, says the text is not
final, and stays visible (no `hidden` class).

This is consistent with locked rules L-14 and L-15: the legal documents exist before
selling, but they remain pre-launch drafts pending Owner approval and legal review, and
nothing in them may be treated as an approved commercial or legal term.

## 6. Commands run and exit codes

All commands were run in this worktree at revision
`37053d35cd7392419c341eeae03a9c1193ed41b7`. Raw results are recorded as observed.

| # | Command | Exit code | Observed result |
| --- | --- | --- | --- |
| 1 | `node --no-warnings --test --experimental-test-isolation=none tests/legal-draft.test.ts` | **0** | `tests 14 / pass 14 / fail 0 / cancelled 0 / skipped 0 / todo 0`, duration 47.3439 ms. All 14 named subtests passed. |
| 2 | `npx tsc --noEmit -p apps/booking-consumer/tsconfig.json` | **0** | No diagnostics emitted. No missing generated layout type was reported, so the Next type-generation step was **not** required and was not run. |
| 3 | `npx tsc --version` | **0** | `Version 5.9.3` |
| 4 | `npx tsc --noEmit -p apps/booking-consumer/tsconfig.json --extendedDiagnostics` | **0** | Program time 2.01 s, total time 2.29 s, `Lines of JSON: 586`, `Identifiers: 426686`, `Types: 89`, `Instantiations: 0` — confirms the compiler actually parsed and checked the project and was not a silent no-op. |
| 5 | `npm --workspace apps/booking-consumer run lint` | **0** | `✖ 6 problems (0 errors, 6 warnings)` — all 6 warnings are pre-existing in `apps/booking-consumer/src/app/book/[slug]/page.tsx` (5 unused icon imports and 1 `no-img-element`). **0 errors.** |
| 6 | `npm test` | **0** | `tests 132 / suites 0 / pass 132 / fail 0 / cancelled 0 / skipped 0 / todo 0`, duration 252.5342 ms. The legal-draft file's 14 tests are included in this 132. |
| 7 | `grep -o '\[\[OWNER INPUT:[^]]*\]\]' apps/booking-consumer/messages/{en,th}.json \| wc -l` | 0 | 43 raw matches per locale; 42 after excluding the legend example. |
| 8 | `grep -o … \| sort -u \| wc -l` | 0 | 40 distinct placeholder strings per locale. |
| 9 | `grep -o … docs/legal/*.md` | 0 | TERMS-OF-SERVICE-EN 20, TERMS-OF-SERVICE-TH 20, PRIVACY-POLICY-EN 23, PRIVACY-POLICY-TH 23 (each = its document's section placeholders + the shared draft-version placeholder in the banner). |

Typecheck note, stated explicitly as required: **the typecheck did not report a missing
generated layout type**. It exited 0 with no output on the first run, so no type
generation step was needed and no false failure was reported.

## 7. Changed files and reasons (whole change, not only this note)

Modified (tracked):

| Path | Reason |
| --- | --- |
| `apps/booking-consumer/messages/en.json` | Added the `legal` namespace (meta + terms + privacy) in English. |
| `apps/booking-consumer/messages/th.json` | Added the same `legal` namespace in Thai, key-for-key. |
| `apps/booking-consumer/src/app/page.tsx` | Imports and renders `<LegalLinks />` on the landing page so both documents are reachable before booking. |
| `apps/booking-consumer/src/app/book/[slug]/page.tsx` | Imports `<LegalLinks />`, wraps the footer text in a `<p>` and renders the links inside the always-present footer so they show on every step, before any deposit. |

Added (new files):

| Path | Reason |
| --- | --- |
| `apps/booking-consumer/src/app/legal/terms/page.tsx` | Route `/legal/terms`; renders `<LegalDocument documentKey="terms" />` with a draft metadata title/description. |
| `apps/booking-consumer/src/app/legal/privacy/page.tsx` | Route `/legal/privacy`; renders `<LegalDocument documentKey="privacy" />` with a draft metadata title/description. |
| `apps/booking-consumer/src/components/legal-document.tsx` | Shared renderer, the visible `LegalDraftNotice` marker, declared section order, and the `LegalLinks` component used by the landing and booking pages. |
| `docs/legal/TERMS-OF-SERVICE-EN.md` | Readable English Terms of Service draft (generated from `en.json`). |
| `docs/legal/TERMS-OF-SERVICE-TH.md` | Readable Thai Terms of Service draft (generated from `th.json`). |
| `docs/legal/PRIVACY-POLICY-EN.md` | Readable English Privacy Policy draft (generated from `en.json`). |
| `docs/legal/PRIVACY-POLICY-TH.md` | Readable Thai Privacy Policy draft (generated from `th.json`). |
| `tests/legal-draft.test.ts` | Static guard: locale key-set parity, section completeness, draft marker, route reachability, links before any payment step, checklist coverage, placeholder discipline, no invented identity. Reads JSON and source text only. |
| `tests/legal-docs-generate.mjs` | Generates `docs/legal/*.md` from the message files so the readable copies and the in-app pages cannot drift. |
| `docs/house-swarm-1/WU3-TOS-PRIVACY.md` | This note. |

`git status --short` at the time of writing:

```
 M apps/booking-consumer/messages/en.json
 M apps/booking-consumer/messages/th.json
 M apps/booking-consumer/src/app/book/[slug]/page.tsx
 M apps/booking-consumer/src/app/page.tsx
?? apps/booking-consumer/src/app/legal/
?? apps/booking-consumer/src/components/legal-document.tsx
?? docs/house-swarm-1/
?? docs/legal/
?? tests/legal-docs-generate.mjs
?? tests/legal-draft.test.ts
```

## 8. Safety statement

- **No database connection was attempted.** No Postgres connection, no Supabase
  connection, no `supabase` CLI call, no migration and no deploy was run at any point
  during this work unit. The guard test is static: it reads JSON and source text only.
- **No `.env` file was touched.** No `.env`, `.env.local`, `.env.staging.local` or
  `.secrets` file was read, created, modified or deleted.
- **No commit or push occurred.** No `git add`, `git commit`, `git push` or history
  rewrite was performed. All changes remain uncommitted in this worktree.
- The only file written during this work unit is this note,
  `docs/house-swarm-1/WU3-TOS-PRIVACY.md`. The legal documents, the pages, the
  component and the test were not rewritten.

## 9. sha256 of this note file

The digest below is computed over this file's content with the digest line itself
masked out, so it stays valid after the value is written on it and can be re-checked
by anyone with the same command. `sha256sum` prints the digest followed by two spaces
and `*-` for piped input; the digest is the first field.

```
grep -v '^NOTE-SHA256: ' docs/house-swarm-1/WU3-TOS-PRIVACY.md | sha256sum
```

NOTE-SHA256: c304f4b3d5cf0a757bc6c354289dd817a1581d85f46dfe1daaa7f37cefb068ea
