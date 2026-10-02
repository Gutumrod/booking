import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  BK01_RUNTIME_FUNCTIONS,
  BK01_RUNTIME_EFFECTIVE_FUNCTIONS,
  validateBk01RuntimeEffectiveExecuteSet,
} from '../scripts/lib/bk01-runtime-allowlist.mjs';

const identity = 'local_service.bk01_line_bind_booking_trial(text,text,text,text)';
const migration = 'supabase/bk01-migrations/20260927130000_bk01_trial_line_bind.sql';

test('trial LINE route uses the no-shop-id RPC only for the central OA after signature verification', () => {
  // The webhook handler lives in a library module now (a route module may export
  // only HTTP methods — Next 16.3.6 / TS2344); this is the code that holds the
  // trial RPC name and the signature check.
  const source = fs.readFileSync('apps/booking-consumer/src/lib/line-webhook.ts', 'utf8');
  assert.match(source, /config\.mode\s*===\s*'central'\s*\?\s*'bk01_line_bind_booking_trial'/);
  assert.match(source, /verifySignature\(rawBody/);
  assert.ok(source.indexOf('verifySignature(rawBody') < source.indexOf('runtimeProvider()'));
  assert.match(source, /p_webhook_event_id:\s*event\.webhookEventId/);
  assert.match(source, /p_line_user_id:\s*lineUserId/);
  assert.doesNotMatch(source, /trial booking binding is unavailable pending/);
});

test('trial binding migration adds the exact runtime identity and one-time token state', () => {
  const sql = fs.readFileSync(migration, 'utf8');
  assert.match(sql, /CREATE FUNCTION local_service\.bk01_line_bind_booking_trial\s*\(\s*p_webhook_event_id text,\s*p_booking_code text,\s*p_link_token text,\s*p_line_user_id text/s);
  assert.match(sql, /line_binding_token_used_at timestamptz/i);
  assert.match(sql, /line_binding_webhook_event_id text/i);
  assert.match(sql, /authorize_booking_recovery_attempt[\s\S]*link_token_expires_at/i);
  assert.match(sql, /v_booking\.status\s*=\s*'hold'[\s\S]*v_booking\.expires_at\s*<=\s*now\(\)/i);
  assert.match(sql, /b\.booking_code\s*=\s*upper\(trim\(p_booking_code\)\)/i);
  assert.match(sql, /authorize_booking_recovery_attempt\(v_booking\.id,\s*p_link_token\)/i);
  assert.match(sql, /nullif\(btrim\(s\.line_oa_id\),\s*''\)\s+IS NULL/i);
  assert.match(sql, /line_binding_token_used_at/);
  assert.match(sql, /line_binding_webhook_event_id\s+IS DISTINCT FROM\s+p_webhook_event_id/i);
  assert.match(sql, /p_line_user_id\s*!~\s*'\^U\[0-9a-f\]\{32\}\$'/i);
  assert.match(sql, /ON CONFLICT\s*\(webhook_event_id\)\s+DO NOTHING/i);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION local_service\.bk01_line_bind_booking_trial\(text,text,text,text\) TO bk01_runtime/i);
  assert.doesNotMatch(sql, /GRANT EXECUTE ON FUNCTION local_service\.bk01_line_bind_booking_trial[^;]*TO (?:PUBLIC|anon|authenticated|service_role)/i);
});

test('runtime exact allowlist includes trial binding and rejects the fourteenth explicit RPC', () => {
  assert.ok(BK01_RUNTIME_FUNCTIONS.includes(identity));
  assert.equal(BK01_RUNTIME_FUNCTIONS.length, 13);
  assert.equal(BK01_RUNTIME_EFFECTIVE_FUNCTIONS.length, 21);
  assert.throws(() => validateBk01RuntimeEffectiveExecuteSet([
    ...BK01_RUNTIME_EFFECTIVE_FUNCTIONS,
    'local_service.fourteenth_probe()',
  ]));
});
