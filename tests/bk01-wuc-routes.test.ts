import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const routes = [
  'apps/booking-consumer/src/app/api/line/webhook/route.ts',
  'apps/booking-consumer/src/app/api/notifications/dispatch/route.ts',
  'apps/booking-consumer/src/app/api/deposit-slips/upload-intent/route.ts',
  'apps/booking-admin/src/app/api/webhooks/stripe/route.ts',
];

test('BK01 server routes contain no service-role helper, key, direct table access, or Storage admin access', () => {
  for (const route of routes) {
    const source = fs.readFileSync(route, 'utf8');
    assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY|getSupabaseAdmin|supabase-admin/);
    assert.doesNotMatch(source, /\.from\s*\(\s*['"](?:bookings|shops|customers|subscriptions|line_users|line_notification_logs|stripe_webhook_events)['"]/);
  }
});

test('all server apps expose the House runtime issuer settings without values', () => {
  const source = fs.readFileSync('.env.example', 'utf8');
  for (const name of [
    'HOUSE_RUNTIME_ISSUER_URL',
    'HOUSE_RUNTIME_AUDIENCE',
    'HOUSE_RUNTIME_CLIENT_ID',
    'HOUSE_RUNTIME_CLIENT_SECRET',
  ]) assert.match(source, new RegExp(`^${name}=$`, 'm'));
});

test('the service-role secret name is absent from apps, docs, and the shared env example', () => {
  const scan = (directory: string): string[] => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return ['node_modules', '.next', '.open-next'].includes(entry.name) ? [] : scan(path);
    if (!/\.(?:ts|tsx|js|mjs|md|example|json)$/.test(entry.name)) return [];
    return fs.readFileSync(path, 'utf8').includes('SUPABASE_SERVICE_ROLE_KEY') ? [path] : [];
  });
  const matches = [...scan('apps'), ...scan('docs')];
  if (fs.readFileSync('.env.example', 'utf8').includes('SUPABASE_SERVICE_ROLE_KEY')) matches.push('.env.example');
  assert.deepEqual(matches, []);
});

test('service-role client modules are removed and route integration uses only the approved RPC identities', () => {
  for (const route of routes) {
    const source = fs.readFileSync(route, 'utf8');
    assert.match(source, /getBk01RuntimeClient/);
    assert.doesNotMatch(source, /\.rpc\s*\(\s*['"](?!authorize_booking_recovery_attempt|claim_due_line_notifications|claim_stripe_webhook_event|complete_line_notification|sync_subscription_state_bk_a|authorize_deposit_slip_upload|bk01_finish_line_webhook_delivery|bk01_line_bind_booking|finish_stripe_webhook_event|get_line_notification_delivery_context)/);
  }
  const uploadRoute = fs.readFileSync(routes[2], 'utf8');
  assert.match(uploadRoute, /\.storage\.from\(['"]deposit-slips['"]\)\.createSignedUploadUrl/);
  assert.doesNotMatch(uploadRoute, /SUPABASE_SERVICE_ROLE_KEY|getSupabaseAdmin/);
  for (const path of ['apps/booking-consumer/src/lib/supabase-admin.ts', 'apps/booking-admin/src/lib/supabase-admin.ts']) {
    assert.equal(fs.existsSync(path), false, `${path} must be removed`);
  }
});

test('webhook signatures and dispatch secret are checked before acquiring a runtime client', () => {
  const line = fs.readFileSync(routes[0], 'utf8');
  assert.ok(line.indexOf('verifySignature(rawBody') < line.indexOf('runtimeProvider()'));
  const stripe = fs.readFileSync(routes[3], 'utf8');
  assert.ok(stripe.indexOf('constructEvent(') < stripe.indexOf('const duplicate = await isDuplicateEvent('));
  const dispatch = fs.readFileSync(routes[1], 'utf8');
  assert.ok(dispatch.indexOf("req.headers.get('authorization')") < dispatch.indexOf('runtimeProvider()'));
});

test('runtime adapters use anon API keys and runtime bearer only, with bounded token caching and single flight', () => {
  for (const app of ['booking-consumer', 'booking-admin']) {
    const source = fs.readFileSync(`apps/${app}/src/lib/bk01-runtime.ts`, 'utf8');
    assert.match(source, /NEXT_PUBLIC_SUPABASE_ANON_KEY/);
    assert.match(source, /Authorization:\s*`Bearer \$\{token\.value\}`/);
    assert.match(source, /TOKEN_REFRESH_SKEW_SECONDS\s*=\s*30/);
    assert.match(source, /MAX_TOKEN_TTL_SECONDS\s*=\s*15 \* 60/);
    assert.match(source, /if \(!tokenRequest\)/);
    assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY/);
    assert.doesNotMatch(source, /console\.(?:log|error).*token/i);
  }
  assert.equal(
    fs.readFileSync('apps/booking-consumer/src/lib/bk01-runtime.ts', 'utf8'),
    fs.readFileSync('apps/booking-admin/src/lib/bk01-runtime.ts', 'utf8'),
  );
});
