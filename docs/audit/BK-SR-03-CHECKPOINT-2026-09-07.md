# BK-SR-03 Checkpoint â€” 2026-09-07

**Mode:** BUILD-TO-SELL / staging external rehearsal
**Branch:** `feature/bk-a-v1-contract-remediation`
**Checkpoint base:** `dba74bd` (`fix(booking): suppress overdue line reminders`)
**BK-SR-03:** ACTIVE â€” LINE staging slice PASS; ticket not closed

## Verified PASS

- Queueeasy used only as `WSTERA Shared LINE OA Test Fixture`.
- `wstera-consumer-staging` deployed on Cloudflare; production Worker names were not used.
- LINE webhook provider test PASS and real Owner binding PASS.
- Customer LINE UID persisted in `customers` and `line_users`; Flex confirmation delivery reached `sent`.
- Persisted UID reuse proved server-side push without repeating binding.
- Duplicate-like delivery root cause identified as simultaneous confirmation + overdue `reminder_24h`, not duplicate idempotency delivery.
- Migration `20260907181500_skip_overdue_line_reminders.sql` applied only to `wstera-lab`.
- Fresh <24h booking `BK-J24DX2` generated exactly one notification job and dispatch returned `CLAIMED=1 / SENT=1 / FAILED=0`.
- Owner externally confirmed receipt of exactly one new LINE message for `BK-J24DX2` after the remediation.
- Regression gate: tests 21/21 PASS; lint 0 errors (13 pre-existing warnings); diff-check PASS.

## Remaining BK-SR-03 work

- Queueeasy fixture testing was resumed by Owner on 2026-09-08; canonical shared-fixture state is `TESTING:BK01`. Final release still requires `Use webhook` OFF and provider verification `active=false`.
- Complete staging rollback/redeploy proof and capture Cloudflare version evidence.
- Complete approved Stripe test/webhook rehearsal; do not substitute production credentials.
- Reconcile final BK-SR-03 evidence and obtain independent closure review before marking CLOSED.
- Order V1 runtime testing is not available: Order contract is locked but implementation remains `BUILD AUTHORIZATION: NO`.


## 2026-09-08 resumed LINE notification matrix

Owner resumed the bounded BK01 Queueeasy test before fixture reset.

- >24h new booking `BK-9V8ZYT` created two idempotent jobs: immediate `booking_created` plus future `reminder_24h`; its new customer had no LINE UID, so confirmation failed safely with `Customer has not linked LINE` and no wrong-recipient delivery occurred. The fixture-only pending jobs were closed after this intentional negative case.
- Returning-customer booking `BK-UKKMBG` reused the persisted LINE UID without another bind. It created immediate confirmation plus a future 24h reminder; immediate dispatch returned `CLAIMED=1 / SENT=1 / FAILED=0`.
- Rescheduling `BK-UKKMBG` from 2026-09-15 17:00 to 2026-09-22 17:00 marked the old reminder `failed / Superseded by customer reschedule`, created a replacement reminder for 2026-09-21 17:00, and queued one `booking_rescheduled` event.
- Reschedule dispatch returned `CLAIMED=1 / SENT=1 / FAILED=0`; an immediate second dispatcher call returned `CLAIMED=0`, proving no duplicate due delivery.
- Customer cancellation then marked the replacement reminder `failed / Booking cancelled before delivery`, queued one `booking_cancelled` event, and dispatch returned `CLAIMED=1 / SENT=1 / FAILED=0`.
- A second dispatcher call after cancellation again returned `CLAIMED=0`.
- Fixture shop cancellation/reschedule windows were explicitly set to 6 hours for this staging-only test because the fixture had null policy values and correctly failed closed before configuration.

No production target, Order runtime, or Queueeasy ownership model was changed by this matrix.

## 2026-09-08 extended LINE notification matrix

Owner-visible acceptance screenshot confirmed three distinct deliveries for `BK-UKKMBG`: confirmation, reschedule to 2026-09-22 17:00, and cancellation, with no duplicate delivery visible between them.

Additional live staging checks:
- `reminder_24h` time-compressed rehearsal on `BK-QXLJSJ`: confirmation dispatch `1/1/0`, reminder dispatch `1/1/0`, immediate repeated dispatch `0/0/0`.
- New customer without a LINE UID fails closed with `Customer has not linked LINE`; booking truth remains authoritative.
- Invalid provider recipient rehearsal returned LINE HTTP 400; attempts 1-4 stayed `pending` with retry scheduled.
- Attempt 5 transitioned the notification to `failed` with no further retry, while booking truth remained `confirmed`.
- Temporary invalid-recipient/customer fixtures were deleted after evidence capture.

LINE matrix result: confirmation, persisted UID reuse, >24h scheduling, <24h suppression, reminder delivery, reschedule, cancellation, no-recipient failure, provider failure/backoff, retry cap, and repeated-dispatch idempotency are all staging-proven.

## 2026-09-08 Cloudflare rollback / recovery proof

Consumer staging rollback rehearsal completed without touching production Worker names.

- Baseline active version: `cf65c2f7-b81b-427a-8fd3-139a8437df65`.
- Rehearsal candidate uploaded from the same BK01 code/config baseline: `a26e94ed-d24b-4a4b-86b6-1fe7031b4615`.
- Candidate deployed at 100%; smoke PASS: root HTTP 200, unsigned LINE webhook POST HTTP 401.
- Rolled back to `cf65c2f7-b81b-427a-8fd3-139a8437df65`; smoke PASS: 200 / 401.
- Redeployed candidate `a26e94ed-d24b-4a4b-86b6-1fe7031b4615` at 100%; smoke PASS: 200 / 401.
- Final active staging version after recovery proof: `a26e94ed-d24b-4a4b-86b6-1fe7031b4615`.

This closes the Cloudflare rollback/redeploy portion of BK-SR-03. Remaining external rehearsal is Stripe test/webhook plus final closure review.
