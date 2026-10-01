import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  classifyQueueLockCounterError,
  fetchPendingPastAppointmentCount,
  QUEUE_LOCK_COUNTER_ARG,
  QUEUE_LOCK_COUNTER_RPC,
} from '../apps/booking-admin/src/lib/queue-lock-counter.ts';

/**
 * The queue-lock counter contract (brief 23 section 2, item (4)).
 *
 * `local_service.bk01_pending_past_appointment_count(shop_id)` does not exist yet
 * -- the queue-lock branch is on the remote but carries no commit for it. The
 * whole point of this module is that shipping before the function is SAFE: the
 * badge and the e-mail keep working and say "not available", and neither invents
 * a number. `tests/` pins that, because a fabricated 0 is the failure mode with
 * real consequences (the shop stops looking).
 */

const okResult = (data: unknown) => async () => ({ data, error: null });

test('the counter is read through exactly one RPC name', () => {
  assert.equal(QUEUE_LOCK_COUNTER_RPC, 'bk01_pending_past_appointment_count');
  const source = readFileSync('apps/booking-admin/src/lib/queue-lock-counter.ts', 'utf8');
  const callSites = source.split('rpc(QUEUE_LOCK_COUNTER_RPC').length - 1;
  assert.equal(callSites, 1, 'there must be a single call site');
});

test('a present function returns its count', async () => {
  assert.deepEqual(await fetchPendingPastAppointmentCount(okResult(3), 'shop-1'), { available: true, count: 3, status: 'ok' });
  // PostgREST returns a set for a scalar-returning function, and the value may
  // arrive under the function's own name.
  assert.deepEqual(await fetchPendingPastAppointmentCount(okResult([5]), 'shop-1'), { available: true, count: 5, status: 'ok' });
  assert.deepEqual(
    await fetchPendingPastAppointmentCount(okResult([{ count: 7 }]), 'shop-1'),
    { available: true, count: 7, status: 'ok' },
  );
  // A real zero from the database is a legitimate answer and must survive.
  assert.deepEqual(await fetchPendingPastAppointmentCount(okResult(0), 'shop-1'), { available: true, count: 0, status: 'ok' });
});

test('a missing function is "not deployed", and the count stays null rather than becoming 0', async () => {
  // The real shape PostgREST returns for a routine that is not in the schema cache.
  const notDeployed = async () => ({
    data: null,
    error: { code: 'PGRST202', message: "Could not find the function public.bk01_pending_past_appointment_count(shop_id) in the schema cache" },
  });
  const result = await fetchPendingPastAppointmentCount(notDeployed, 'shop-1');
  assert.deepEqual(result, { available: false, count: null, status: 'not_deployed' });
  assert.equal(result.count, null, 'a null count is the whole point: 0 would be a lie');

  // The PostgreSQL-level equivalent.
  assert.equal(classifyQueueLockCounterError({ code: '42883', message: 'function ... does not exist' }), 'not_deployed');
  assert.equal(classifyQueueLockCounterError({ message: 'function local_service.x does not exist' }), 'not_deployed');
});

test('any other failure is reported as a call failure, not as "not deployed"', async () => {
  // Telling an operator "not deployed yet" when the real problem is a revoked
  // grant would send them looking in the wrong place.
  const denied = async () => ({ data: null, error: { code: '42501', message: 'permission denied for function' } });
  assert.deepEqual(await fetchPendingPastAppointmentCount(denied, 'shop-1'), { available: false, count: null, status: 'call_failed' });

  const thrown = async () => { throw new Error('network down'); };
  assert.deepEqual(await fetchPendingPastAppointmentCount(thrown, 'shop-1'), { available: false, count: null, status: 'call_failed' });

  assert.equal(classifyQueueLockCounterError({ code: '42501', message: 'permission denied' }), 'call_failed');
  assert.equal(classifyQueueLockCounterError({ message: 'connection reset' }), 'call_failed');
});

test('a response that yields no usable number is unavailable, never zero', async () => {
  for (const data of [null, undefined, {}, [], 'not-a-number', -1, 1.5, Number.NaN, Infinity]) {
    const result = await fetchPendingPastAppointmentCount(okResult(data), 'shop-1');
    assert.equal(result.available, false, `data=${JSON.stringify(data)} must not be presented as a count`);
    assert.equal(result.count, null, `data=${JSON.stringify(data)} must not become 0`);
  }
});

test('an empty shop id is refused without calling the database', async () => {
  let called = false;
  const rpc = async () => { called = true; return { data: 0, error: null }; };
  assert.deepEqual(await fetchPendingPastAppointmentCount(rpc, ''), { available: false, count: null, status: 'call_failed' });
  assert.equal(called, false, 'no cross-tenant read may be attempted with no shop id');
});

test('the shop id is passed under the parameter name the function declares', async () => {
  // The queue-lock migration declares `p_shop_id`, not `shop_id`. PostgREST
  // resolves named arguments, so the wrong key is a 404 call failure, not a
  // harmless typo -- this is what stops the adapter drifting from the contract.
  assert.equal(QUEUE_LOCK_COUNTER_ARG, 'p_shop_id');
  const seen: Array<{ name: string; args: Record<string, unknown> }> = [];
  await fetchPendingPastAppointmentCount(async (name, args) => { seen.push({ name, args }); return { data: 2, error: null }; }, 'shop-9');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].name, 'bk01_pending_past_appointment_count');
  assert.deepEqual(seen[0].args, { p_shop_id: 'shop-9' });
  assert.deepEqual(Object.keys(seen[0].args), ['p_shop_id'], 'no extra argument may be invented');
});

test('the contract is recorded against the queue-lock migration it came from', () => {
  // A reviewer must be able to check this module against the migration without
  // re-deriving it; the pin is in the source next to the constant.
  const source = readFileSync('apps/booking-admin/src/lib/queue-lock-counter.ts', 'utf8');
  assert.match(source, /20261001023000_bk01_queue_release\.sql:112/);
  assert.match(source, /0daf558e8/);
  assert.match(source, /bk01_runtime/);
  assert.match(source, /authenticated/);
});
