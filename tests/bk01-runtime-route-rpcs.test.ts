import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  BK01_RUNTIME_EFFECTIVE_FUNCTIONS,
  BK01_RUNTIME_FUNCTIONS,
  validateBk01RuntimeEffectiveExecuteSet,
} from '../scripts/lib/bk01-runtime-allowlist.mjs';

const migrationPath = 'supabase/bk01-migrations/20260927120000_bk01_runtime_route_rpcs.sql';
const routeFunctions = [
  'local_service.authorize_deposit_slip_upload(uuid,text,text,bigint)',
  'local_service.bk01_finish_line_webhook_delivery(text,uuid,text,text)',
  'local_service.bk01_line_bind_booking(text,text,text,uuid,text)',
  'local_service.finish_stripe_webhook_event(text,text,text)',
  'local_service.get_line_notification_delivery_context(uuid,integer)',
];
const trialRouteFunction = 'local_service.bk01_line_bind_booking_trial(text,text,text,text)';

test('BK01 runtime allowlist is the exact 11 identities plus 8 legacy PUBLIC exceptions', () => {
  assert.deepEqual(BK01_RUNTIME_FUNCTIONS, [
    'local_service.authorize_booking_recovery_attempt(uuid,text)',
    'local_service.claim_due_line_notifications(integer)',
    'local_service.claim_stripe_webhook_event(text,text,timestamp with time zone)',
    'local_service.complete_line_notification(uuid,integer,text,timestamp with time zone,timestamp with time zone,text)',
    'local_service.sync_subscription_state_bk_a(text,bigint,uuid,text,text,text,text,bigint,boolean)',
    ...routeFunctions,
    trialRouteFunction,
  ].sort());
  assert.equal(BK01_RUNTIME_EFFECTIVE_FUNCTIONS.length, 19);
  assert.throws(() => validateBk01RuntimeEffectiveExecuteSet([
    ...BK01_RUNTIME_EFFECTIVE_FUNCTIONS,
    'local_service.eleventh_probe()'
  ]));
});

test('generated bootstrap accepts only exact pre and post route-migration privilege states', () => {
  const bootstrap = fs.readFileSync('supabase/shared-runtime/bk01-platform-bootstrap.sql', 'utf8');
  assert.match(bootstrap, /route_function_count NOT IN \(0, 5, 6\)/);
  assert.match(bootstrap, /v_route_function_count = 5 AND to_regprocedure\('local_service\.bk01_line_bind_booking_trial\(text,text,text,text\)'\) IS NOT NULL/);
  assert.match(bootstrap, /WHEN 0 THEN 13\s+WHEN 5 THEN 18\s+ELSE 19 END/);
  assert.match(bootstrap, /effective EXECUTE set differs from an exact approved migration phase/);
});

test('new route RPC migration pins security and scopes each function grant', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');
  for (const identity of routeFunctions) {
    const name = identity.slice('local_service.'.length).split('(')[0];
    assert.match(sql, new RegExp(`CREATE FUNCTION local_service\\.${name}\\(`, 'i'));
    assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION ${identity.replace(/[()]/g, '\\$&')} FROM PUBLIC`, 'i'));
    assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION ${identity.replace(/[()]/g, '\\$&')} TO bk01_runtime`, 'i'));
    assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION ${identity.replace(/[()]/g, '\\$&')} FROM anon, authenticated`, 'i'));
  }
  assert.equal((sql.match(/SECURITY DEFINER/gi) ?? []).length, 5);
  assert.equal((sql.match(/SET search_path\s*=\s*pg_catalog,\s*local_service/gi) ?? []).length, 5);
  assert.doesNotMatch(sql, /\bEXECUTE\s+(?:format|immediate)\b/i);
  assert.doesNotMatch(sql, /auth\s*\.\s*uid\s*\(|GRANT\s+[^;]+\s+TO\s+(?:anon|authenticated|PUBLIC)\b/i);
});

test('trial LINE RPC is a separately appended, one-time, shared-OA binding with a runtime-only grant', () => {
  const identity = 'local_service.bk01_line_bind_booking_trial(text,text,text,text)';
  const sql = fs.readFileSync('supabase/bk01-migrations/20260927130000_bk01_trial_line_bind.sql', 'utf8');
  assert.match(sql, /ALTER TABLE local_service\.bookings[\s\S]*line_binding_token_used_at[\s\S]*line_binding_webhook_event_id/i);
  assert.match(sql, /p_line_user_id\s*!~\s*'\^U\[0-9a-f\]\{32\}\$'/i);
  assert.match(sql, /authorize_booking_recovery_attempt\(v_booking\.id,\s*p_link_token\)/i);
  assert.match(sql, /nullif\(btrim\(s\.line_oa_id\),\s*''\)\s+IS NULL/i);
  assert.match(sql, /line_binding_token_used_at\s+IS NOT NULL[\s\S]*line_binding_webhook_event_id\s+IS DISTINCT FROM\s+p_webhook_event_id/i);
  assert.match(sql, /ON CONFLICT\s*\(webhook_event_id\)\s+DO NOTHING/i);
  assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION ${identity.replace(/[()]/g, '\\$&')} FROM PUBLIC`, 'i'));
  assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION ${identity.replace(/[()]/g, '\\$&')} TO bk01_runtime`, 'i'));
  assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION ${identity.replace(/[()]/g, '\\$&')} FROM anon, authenticated, service_role`, 'i'));
  assert.equal((sql.match(/SECURITY DEFINER/gi) ?? []).length, 1);
  assert.equal((sql.match(/SET search_path\s*=\s*pg_catalog,\s*local_service/gi) ?? []).length, 1);
  assert.doesNotMatch(sql, /auth\s*\.\s*uid\s*\(|\bEXECUTE\s+(?:format|immediate)\b/i);
});

test('LINE inbound replay is event-idempotent and binds only a valid LINE user identity', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');
  assert.match(sql, /line_webhook_events[\s\S]*?webhook_event_id\s+TEXT\s+PRIMARY KEY/i);
  assert.match(sql, /p_line_user_id\s*!~\s*'\^U\[0-9a-f\]\{32\}\$'/i);
  assert.match(sql, /ON CONFLICT\s*\(webhook_event_id\)\s+DO NOTHING/i);
  assert.match(sql, /processing_started_at\s*<\s*now\(\)\s*-\s*interval\s+'5 minutes'/i);
});

test('notification delivery context includes the subscription plan used to resolve the LINE channel', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');
  assert.match(sql, /subscription_plan\s+text/i);
  assert.match(sql, /LEFT JOIN local_service\.subscriptions sub ON sub\.shop_id=l\.shop_id/i);
  assert.match(sql, /sub\.plan/);
});

test('upload RPC validates type, size and derived exact path with a five-minute grant expiry', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');
  assert.match(sql, /image\/(?:jpeg|png|webp)/i);
  assert.match(sql, /p_size_bytes\s*>\s*5242880/i);
  assert.match(sql, /v_path\s*:=\s*v_booking\.id::text\s*\|\|\s*'\/'/i);
  assert.match(sql, /now\(\)\s*\+\s*interval\s+'5 minutes'/i);
  assert.doesNotMatch(sql, /consum(?:e|ed_at).*grant/i);
});

test('Stripe finalizer only transitions processing rows and redacts capped errors', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');
  assert.match(sql, /p_status\s+NOT IN\s*\('processed',\s*'failed'\)/i);
  assert.match(sql, /processing_status\s*=\s*'processing'/i);
  assert.match(sql, /left\([\s\S]{0,500}500\)/i);
  assert.match(sql, /last_error\s*=\s*NULL/i);
});
