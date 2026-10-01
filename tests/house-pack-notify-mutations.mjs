#!/usr/bin/env node
// Non-vacuity harness for HOUSE-BK01-PACK-NOTIFY-APP (brief 25, units 6 + 7).
// Each mutation removes one behaviour the unit claims; the named test file must
// fail while the mutation is in place, and pass again once it is reverted.
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const MUTATIONS = [
  {
    id: 'm1-reminder-event-back-to-24h',
    file: 'apps/booking-consumer/src/lib/customer-reminder-text.ts',
    from: "export const REMINDER_EVENT_TYPE = 'reminder_3h';",
    to: "export const REMINDER_EVENT_TYPE = 'reminder_24h';",
    test: 'tests/house-remind-3h.test.ts',
  },
  {
    id: 'm2-reminder-drops-queue-code',
    file: 'apps/booking-consumer/src/lib/customer-reminder-text.ts',
    from: 'รหัสคิว ${code}`,\n    `Reminder: ${shopName} on ${date} at ${time}, queue ${code}`',
    to: 'รหัสคิว ${code}`,\n    `Reminder: ${shopName} on ${date} at ${time}`',
    test: 'tests/house-remind-3h.test.ts',
  },
  {
    id: 'm3-free-loses-reminder-push',
    file: 'apps/booking-consumer/src/lib/notification-entitlement.ts',
    from: '  free: {\n    customer_reminder_push: true,',
    to: '  free: {\n    customer_reminder_push: false,',
    test: 'tests/house-pack-entitle.test.ts',
  },
  {
    id: 'm4-cap-boundary-off-by-one',
    file: 'apps/booking-consumer/src/lib/notification-push-budget.ts',
    from: '  return safeUsed < safeCap',
    to: '  return safeUsed <= safeCap',
    test: 'tests/house-pack-entitle.test.ts',
  },
  {
    id: 'm5-cap-unreadable-suppresses',
    file: 'apps/booking-consumer/src/lib/notification-push-budget.ts',
    from: "    return { allowed: true, unverified: true, reason: 'push_cap_unverified' };",
    to: "    return { allowed: false, unverified: false, reason: 'push_cap_reached' };",
    test: 'tests/house-pack-entitle.test.ts',
  },
  {
    id: 'm6-breach-threshold-removed',
    file: 'apps/booking-consumer/src/lib/notification-oa-breaker.ts',
    from: "  if (ratio > OA_QUOTA_BREAKER_THRESHOLD) {",
    to: "  if (ratio > 1.5) {",
    test: 'tests/house-pack-breaker-reply.test.ts',
  },
  {
    id: 'm7-breaker-mutes-every-plan',
    file: 'apps/booking-consumer/src/lib/notification-oa-breaker.ts',
    from: "  return effectivePlan === 'free';",
    to: "  return true;",
    test: 'tests/house-pack-breaker-reply.test.ts',
  },
  {
    id: 'm8-quota-urls-guessed-wrong',
    file: 'apps/booking-consumer/src/lib/notification-oa-breaker.ts',
    from: "export const CENTRAL_OA_CONSUMPTION_URL = 'https://api.line.me/v2/bot/message/quota/consumption';",
    to: "export const CENTRAL_OA_CONSUMPTION_URL = 'https://api.line.me/v2/bot/message/quota/usage';",
    test: 'tests/house-pack-breaker-reply.test.ts',
  },
  {
    id: 'm9-reply-failure-fails-the-binding',
    file: 'apps/booking-consumer/src/app/api/line/webhook/route.ts',
    from: "        console.error('LINE binding reply could not be delivered', { eventIndex, code: 'REPLY_NOT_DELIVERED', reason: messageOf(replyError) });",
    to: "        throw replyError;",
    test: 'tests/house-pack-breaker-reply.test.ts',
  },
  {
    id: 'm10-flex-card-loses-queue-code',
    file: 'apps/booking-consumer/src/lib/line-flex-templates.ts',
    from: '          { type: \'text\', text: `รหัสคิว: ${details.bookingCode}`, color: \'#38BDF8\', size: \'sm\', weight: \'bold\', wrap: true },',
    to: '',
    test: 'tests/house-remind-3h.test.ts',
  },
  {
    id: 'm11-free-services-contract-back-to-3',
    file: 'apps/booking-admin/src/lib/commercial-contract.ts',
    from: 'export const FREE_PLAN_SERVICES = 5;',
    to: 'export const FREE_PLAN_SERVICES = 3;',
    test: 'tests/ui-truth.test.ts',
  },
  {
    id: 'm12-plan-copy-back-to-3-services',
    file: 'apps/booking-admin/messages/th.json',
    from: '"planFreeQ3": "✓ 5 บริการ',
    to: '"planFreeQ3": "✓ 3 บริการ',
    test: 'tests/bk01-i18n.test.ts',
  },
];

const original = new Map();
let failures = 0;

for (const mutation of MUTATIONS) {
  const before = readFileSync(mutation.file, 'utf8');
  original.set(mutation.file, before);
  if (!before.includes(mutation.from)) {
    console.log(`✖ ${mutation.id}: mutation anchor not found in ${mutation.file}`);
    failures += 1;
    continue;
  }
  writeFileSync(mutation.file, before.replace(mutation.from, mutation.to));

  const run = spawnSync(process.execPath, [
    '--no-warnings', '--import', './tests/register-ts-loader.mjs',
    '--test', '--experimental-test-isolation=none', mutation.test,
  ], { encoding: 'utf8' });
  const red = run.status !== 0;

  writeFileSync(mutation.file, before);

  const rerun = spawnSync(process.execPath, [
    '--no-warnings', '--import', './tests/register-ts-loader.mjs',
    '--test', '--experimental-test-isolation=none', mutation.test,
  ], { encoding: 'utf8' });
  const green = rerun.status === 0;

  const ok = red && green;
  if (!ok) failures += 1;
  console.log(`${ok ? '✔' : '✖'} ${mutation.id}: mutation ${red ? 'RED' : 'GREEN(!)'} -> revert ${green ? 'GREEN' : 'RED(!)'} [${mutation.test}]`);
}

console.log(`\nmutations proven: ${MUTATIONS.length - failures}/${MUTATIONS.length}`);
process.exit(failures === 0 ? 0 : 1);
