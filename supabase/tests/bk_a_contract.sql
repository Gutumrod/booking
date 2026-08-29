begin;
select plan(19);

select ok(
  (select not public from storage.buckets where id = 'deposit-slips'),
  'deposit slips bucket is private'
);
select has_column('local_service', 'staff', 'user_id', 'staff is linked to auth user');
select ok(not has_column_privilege('anon', 'local_service.staff', 'user_id', 'SELECT'), 'anon cannot read staff auth user mapping');
select ok(not has_column_privilege('authenticated', 'local_service.staff', 'user_id', 'SELECT'), 'merchant clients cannot read raw staff auth user mapping');
select ok(has_column_privilege('anon', 'local_service.staff', 'name', 'SELECT'), 'anon can read public staff display name');
select ok(not has_column_privilege('anon', 'local_service.services', 'creation_idempotency_key', 'SELECT'), 'anon cannot read service idempotency metadata');
select has_column('local_service', 'shops', 'customer_cancel_before_hours', 'cancel policy is explicit');
select has_column('local_service', 'shops', 'customer_reschedule_before_hours', 'reschedule policy is explicit');
select has_table('local_service', 'auto_slip_attempts', 'auto slip attempts are audited');
select has_table('local_service', 'account_closure_requests', 'closure requests are durable');
select has_table('local_service', 'audit_events', 'cross-cutting audit events are durable');
select has_function('local_service', 'customer_cancel_booking', array['uuid','text','text'], 'customer cancellation RPC exists');
select has_function('local_service', 'customer_reschedule_booking', array['uuid','text','date','time without time zone'], 'atomic customer reschedule RPC exists');
select has_function('local_service', 'set_booking_outcome', array['uuid','text','text'], 'booking outcome RPC exists');
select ok(not has_function_privilege('anon', 'local_service.set_booking_outcome(uuid,text,text)', 'EXECUTE'), 'anon cannot set merchant outcomes');
select ok(not has_function_privilege('anon', 'local_service.export_core_business_data(uuid)', 'EXECUTE'), 'anon cannot export shop data');
select ok(not has_function_privilege('anon', 'local_service.submit_deposit_slip(uuid,text,text)', 'EXECUTE'), 'legacy identifier-only slip submit is denied');
select ok(has_function_privilege('anon', 'local_service.submit_deposit_slip(uuid,text,text,text)', 'EXECUTE'), 'capability-bound slip submit is available');
select ok(not has_function_privilege('anon', 'local_service.authorize_booking_recovery_attempt(uuid,text)', 'EXECUTE'), 'recovery-attempt authority remains server-only');

select * from finish();
rollback;
