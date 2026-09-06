import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(path, 'utf8');

test('current public surfaces contain no annual checkout or remote PromptPay QR path', () => {
  const surfaces = [
    read('apps/booking-admin/src/app/register/page.tsx'),
    read('apps/booking-admin/src/app/api/billing/checkout/route.ts'),
    read('apps/booking-consumer/src/app/book/[slug]/page.tsx'),
  ].join('\n');

  assert.doesNotMatch(surfaces, /promptpay\.io/i);
  assert.doesNotMatch(surfaces, /annual|yearly|4900|9900/i);
});

test('current package copy states provisional pricing and no paid booking wall', () => {
  for (const path of ['apps/booking-admin/messages/th.json', 'apps/booking-admin/messages/en.json']) {
    const messages = JSON.parse(read(path));
    const dashboard = JSON.stringify(messages.dashboard);
    assert.match(dashboard, /pilot|นำร่อง/i);
    assert.doesNotMatch(dashboard, /100%|guaranteed/i);
    assert.doesNotMatch(dashboard, /100 bookings|500 bookings|100 คิว|500 คิว/i);
  }
});

test('merchant LINE credentials remain server-only', () => {
  const envTemplate = read('.env.example');
  assert.match(envTemplate, /LINE_MERCHANT_CHANNELS_JSON/);
  assert.doesNotMatch(envTemplate, /NEXT_PUBLIC_LINE_MERCHANT/);
});
test('public booking reads only approved service and staff columns', () => {
  const service = read('apps/booking-consumer/src/lib/booking-service.ts');
  assert.doesNotMatch(service, /\.from\('services'\)[\s\S]{0,80}\.select\('\*'\)/);
  assert.doesNotMatch(service, /\.from\('staff'\)[\s\S]{0,80}\.select\('\*'\)/);
  assert.match(service, /\.select\('id, shop_id, name, nickname'\)/);
});

test('staff auth mapping is not client-readable', () => {
  const migration = read('supabase/migrations/20260829105155_bk_a_v1_contract_remediation.sql');
  assert.match(migration, /DROP POLICY IF EXISTS "Public staff viewable by everyone"/);
  assert.match(migration, /GRANT SELECT \(id, shop_id, name, nickname, is_active\) ON local_service\.staff TO anon/);
  assert.doesNotMatch(migration, /GRANT SELECT \([^)]*user_id[^)]*\) ON local_service\.staff TO (?:anon|authenticated)/i);
  assert.doesNotMatch(migration, /GRANT SELECT \([^)]*creation_idempotency_key[^)]*\) ON local_service\.staff TO (?:anon|authenticated)/i);
});
test('consumer Worker has an actual reminder schedule', () => {
  const config = JSON.parse(read('apps/booking-consumer/wrangler.jsonc'));
  const worker = read('apps/booking-consumer/custom-worker.ts');
  assert.equal(config.main, 'custom-worker.ts');
  assert.deepEqual(config.triggers?.crons, ['*/5 * * * *']);
  assert.match(worker, /async scheduled/);
  assert.match(worker, /\/api\/notifications\/dispatch/);
  assert.match(worker, /NOTIFICATION_DISPATCH_SECRET/);
});

test('staging Workers are isolated and staging notifications are not scheduled', () => {
  const consumer = JSON.parse(read('apps/booking-consumer/wrangler.jsonc'));
  const admin = JSON.parse(read('apps/booking-admin/wrangler.jsonc'));
  assert.equal(consumer.env?.staging?.services?.[0]?.service, 'wstera-consumer-staging');
  assert.deepEqual(consumer.env?.staging?.triggers?.crons, []);
  assert.equal(admin.env?.staging?.services?.[0]?.service, 'wstera-admin-staging');
  assert.notEqual(consumer.env.staging.services[0].service, consumer.name);
  assert.notEqual(admin.env.staging.services[0].service, admin.name);
});