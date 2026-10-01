import crypto from 'node:crypto';
import postgres from 'postgres';

const mode = process.argv[2];
if (!['baseline', 'final'].includes(mode)) throw new Error('Usage: node scripts/proofs/bk01-queue-lock-pg17.mjs baseline|final');
if (process.env.BK01_SHARED_RUNTIME_ENV !== 'local') throw new Error('Refusing non-local database environment');
const url = process.env.BK01_QUEUE_LOCK_DATABASE_URL;
if (!url) throw new Error('BK01_QUEUE_LOCK_DATABASE_URL is required');
const parsed = new URL(url);
if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || !parsed.pathname.slice(1).startsWith('booking')) {
  throw new Error('Refusing database outside the local booking* PG17 scaffold');
}

const db = postgres(url, { max: 4, prepare: false, connect_timeout: 5, application_name: `bk01-queue-${mode}` });
const checks = [];
const record = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) throw new Error(`Proof failed: ${name}`);
};
const parsedJson = (value) => typeof value === 'string' ? JSON.parse(value) : value;
const callAs = async (role, fn) => db.begin(async (tx) => {
  await tx.unsafe(`SET LOCAL ROLE ${role}`);
  return fn(tx);
});

const shop = crypto.randomUUID();
const otherShop = crypto.randomUUID();
const owner = crypto.randomUUID();
const service = crypto.randomUUID();
const staff = crypto.randomUUID();
const secondStaff = crypto.randomUUID();
const prefix = `queue-lock-${crypto.randomUUID()}`;
let slipBooking;
const storagePaths = [];

try {
  const preflight = await db`
    select current_setting('server_version_num')::int as version_num,
           r.rolsuper, r.rolcreaterole, r.rolbypassrls,
           has_schema_privilege('bk01_migrator','extensions','USAGE') as migrator_extensions_usage,
           has_schema_privilege('public','extensions','USAGE') as public_extensions_usage
      from pg_roles r where r.rolname='operator'`;
  record('PG17 non-superuser CREATEROLE+BYPASSRLS actor; no PUBLIC/migrator extensions USAGE',
    preflight[0]?.version_num >= 170000 && preflight[0]?.version_num < 180000
      && preflight[0].rolsuper === false && preflight[0].rolcreaterole === true
      && preflight[0].rolbypassrls === true && preflight[0].migrator_extensions_usage === false
      && preflight[0].public_extensions_usage === false,
    JSON.stringify(preflight[0]));

  const ext = await db`select extname,n.nspname from pg_extension e join pg_namespace n on n.oid=e.extnamespace where extname='btree_gist'`;
  record('btree_gist is installed in extensions without granting schema access', ext.length === 1 && ext[0].nspname === 'extensions');

  const hasQueue = await db`select exists(select 1 from information_schema.columns where table_schema='local_service' and table_name='bookings' and column_name='queue_released_at') as present`;
  record(mode === 'baseline' ? 'baseline has no queue release column' : 'final schema has queue release column',
    hasQueue[0].present === (mode === 'final'));

  const day = await db`select current_date::text as today,
    to_char((localtime - interval '3 hours')::time,'HH24:MI:SS') as past_time,
    (localtime >= time '04:00') as past_slot_ends_before_now`;
  record('today slot is an appointment window that ends in the past', day[0].past_slot_ends_before_now === true, day[0].today + ' ' + day[0].past_time);

  await db`insert into auth.users(id,email) values (${owner},'queue-owner@example.invalid')`;
  await db`insert into local_service.shops(id,name,slug,require_deposit,default_deposit_amount,is_active)
    values (${shop},'Queue proof',${prefix},true,100,true)`;
  await db`insert into local_service.shops(id,name,slug,require_deposit,default_deposit_amount,is_active)
    values (${otherShop},'Other tenant',${`${prefix}-other`},true,100,true)`;
  await db`insert into local_service.shop_users(shop_id,user_id,role) values (${shop},${owner},'owner')`;
  await db`insert into local_service.services(id,shop_id,name,duration_minutes,price,deposit_amount,is_active)
    values (${service},${shop},'Queue test',60,500,100,true)`;
  await db`insert into local_service.staff(id,shop_id,name,is_active) values (${staff},${shop},'Queue staff',true)`;
  await db`insert into local_service.staff(id,shop_id,name,is_active) values (${secondStaff},${shop},'Second Queue staff',true)`;
  await db`insert into local_service.staff_schedules(shop_id,staff_id,day_of_week,work_start,work_end,is_working_day)
    select ${shop},u.staff_id,d,'00:00','23:59',true from unnest(array[${staff}::uuid,${secondStaff}::uuid]) u(staff_id)
    cross join generate_series(0,6) d`;
  await db`insert into storage.buckets(id,name,public) values ('deposit-slips','Deposit slips',false) on conflict(id) do nothing`;

  const hold = await callAs('anon', async (tx) => tx`
    select local_service.create_booking_hold(${shop},${service},${staff},'Queue Customer','0800000101',null,
      ${day[0].today}::date,${day[0].past_time}::time,null)::text as result`);
  const holdResult = parsedJson(hold[0].result);
  slipBooking = holdResult.booking_id;
  const slipPath = `${slipBooking}/${crypto.randomUUID()}.jpg`;
  storagePaths.push(slipPath);
  await db`insert into storage.objects(bucket_id,name) values ('deposit-slips',${slipPath})`;
  const slip = await callAs('anon', async (tx) => tx`
    select local_service.submit_deposit_slip(${slipBooking},${holdResult.link_token},${slipPath},null)::text as result`);
  record('real anon hold and slip submission function calls succeeded', Boolean(slip[0]?.result));

  const beforeRelease = await db`select b.status,b.deposit_status,b.expires_at,b.end_timestamptz,
    b.expires_at=b.end_timestamptz as expiry_matches_end
    from local_service.bookings b where id=${slipBooking}`;
  if (mode === 'baseline') {
    record('baseline reproduces 15-minute slip expiry mismatch', beforeRelease[0].status === 'pending_review'
      && beforeRelease[0].deposit_status === 'submitted' && beforeRelease[0].expiry_matches_end === false);
    await db`update local_service.bookings set
      start_timestamptz=(booking_date+start_time) at time zone 'Asia/Bangkok',
      end_timestamptz=((booking_date+start_time) at time zone 'Asia/Bangkok')+interval '60 minutes',
      expires_at=now()-interval '1 minute' where id=${slipBooking}`;
    let rejected = false;
    try {
      await callAs('anon', async (tx) => tx`
        select local_service.create_booking_hold(${shop},${service},${staff},'Overlap Customer','0800000102',null,
          ${day[0].today}::date,${day[0].past_time}::time,null)`);
    } catch (error) {
      rejected = /unavailable during this time slot/i.test(error.message);
      if (!rejected) throw error;
    }
    record('baseline exclusion guard keeps pending queue occupied after appointment end', rejected);
  } else {
    record('real slip trigger sets expiry to appointment end', beforeRelease[0].status === 'pending_review'
      && beforeRelease[0].deposit_status === 'submitted' && beforeRelease[0].expiry_matches_end === true);
    await db`update local_service.bookings set
      start_timestamptz=(booking_date+start_time) at time zone 'Asia/Bangkok',
      end_timestamptz=((booking_date+start_time) at time zone 'Asia/Bangkok')+interval '60 minutes',
      expires_at=((booking_date+start_time) at time zone 'Asia/Bangkok')+interval '60 minutes'
      where id=${slipBooking}`;
    const overdueBeforeLazySweep = await callAs('authenticated', async (tx) => {
      await tx`select set_config('request.jwt.claim.sub',${owner},true)`;
      return tx`select local_service.bk01_pending_past_appointment_count(${shop}) as count`;
    });
    const unreleased = await db`select queue_released_at is null as unreleased
      from local_service.bookings where id=${slipBooking}`;
    record('shop count calculates overdue pending review live before lazy release',
      Number(overdueBeforeLazySweep[0].count) === 1 && unreleased[0].unreleased === true);
    const preRebook = await db`select b.end_timestamptz <= now() as ended,b.expires_at <= now() as expired,
      tstzrange(b.start_timestamptz,b.end_timestamptz,'[)') && tstzrange(
        (${day[0].today}::date+${day[0].past_time}::time) at time zone 'Asia/Bangkok',
        ((${day[0].today}::date+${day[0].past_time}::time) at time zone 'Asia/Bangkok')+interval '60 minutes','[)') as overlaps
      from local_service.bookings b where b.id=${slipBooking}`;
    record('overdue fixture is expired and overlaps the requested slot',preRebook[0].ended && preRebook[0].expired && preRebook[0].overlaps,
      JSON.stringify(preRebook[0]));
    const rebook = await callAs('anon', async (tx) => tx`
      select local_service.create_booking_hold(${shop},${service},${staff},'Rebook Customer','0800000103',null,
        ${day[0].today}::date,${day[0].past_time}::time,null)::text as result`);
    const rebookResult = parsedJson(rebook[0].result);
    const released = await db`select status,queue_released_at is not null as released
      from local_service.bookings where id=${slipBooking}`;
    record('lazy sweep releases overdue pending review and permits overlap rebooking',
      released[0].status === 'pending_review' && released[0].released === true && Boolean(rebookResult.booking_id));

    const count = await callAs('authenticated', async (tx) => {
      await tx`select set_config('request.jwt.claim.sub',${owner},true)`;
      return tx`select local_service.bk01_pending_past_appointment_count(${shop}) as count`;
    });
    record('shop owner count remains correct after lazy release', Number(count[0].count) === 1);

    let crossShopDenied = false;
    try {
      await callAs('authenticated', async (tx) => {
        await tx`select set_config('request.jwt.claim.sub',${owner},true)`;
        return tx`select local_service.bk01_pending_past_appointment_count(${otherShop})`;
      });
    } catch (error) {
      crossShopDenied = error.code === '42501';
      if (!crossShopDenied) throw error;
    }
    record('count function rejects a shop outside the caller membership', crossShopDenied);

    let approvalDenied = false;
    try {
      await callAs('authenticated', async (tx) => {
        await tx`select set_config('request.jwt.claim.sub',${owner},true)`;
        return tx`select local_service.approve_booking_deposit(${slipBooking})`;
      });
    } catch (error) {
      approvalDenied = /slot was released; confirmation is unavailable/i.test(error.message);
      if (!approvalDenied) throw error;
    }
    record('released row cannot be confirmed after another booking overlaps it', approvalDenied);

    const operatorUrl = new URL(url);
    operatorUrl.username = 'operator';
    const mutationNotices = [];
    const operator = postgres(operatorUrl.toString(), { max: 1, prepare: false, connect_timeout: 5,
      onnotice: (notice) => mutationNotices.push(notice.message) });
    let mutationRejected = false;
    try {
      await operator.begin(async (tx) => {
        await tx`set local role bk01_migrator`;
        await tx.unsafe(`DO $mutation$
        BEGIN
          BEGIN
            ALTER TABLE local_service.bookings DROP CONSTRAINT prevent_overlapping_staff_bookings;
            ALTER TABLE local_service.bookings ADD CONSTRAINT prevent_overlapping_staff_bookings
              EXCLUDE USING gist (staff_id WITH =, booking_range WITH &&)
              WHERE (status IN ('hold','pending_review','confirmed'));
          EXCEPTION WHEN exclusion_violation THEN
            RAISE NOTICE 'EXPECTED_EXCLUSION_VIOLATION';
            RETURN;
          END;
          RAISE EXCEPTION 'queue predicate mutation unexpectedly succeeded';
        END;
        $mutation$`);
      });
    } catch (error) {
      if (!/queue predicate mutation unexpectedly succeeded/i.test(error.message)) throw error;
    } finally {
      await operator.end();
    }
    mutationRejected = mutationNotices.some((notice) => notice.includes('EXPECTED_EXCLUSION_VIOLATION'));
    record('mutation removing queue_released_at from GiST predicate is rejected', mutationRejected,
      'operator SET ROLE bk01_migrator; released pending row overlaps its successor');

    let releasedExtendDenied = false;
    try {
      await callAs('authenticated', async (tx) => {
        await tx`select set_config('request.jwt.claim.sub',${owner},true)`;
        return tx`select local_service.extend_booking_hold(${slipBooking})`;
      });
    } catch (error) {
      releasedExtendDenied = /Only hold bookings can be extended/i.test(error.message);
      if (!releasedExtendDenied) throw error;
    }
    record('hold extension cannot reactivate a released pending row', releasedExtendDenied);

    const rejection = await callAs('authenticated', async (tx) => {
      await tx`select set_config('request.jwt.claim.sub',${owner},true)`;
      return tx`select local_service.reject_deposit_slip(${slipBooking},'H1 released rejection proof')::text as result`;
    });
    const rejectionResult = parsedJson(rejection[0].result);
    const afterReject = await db`select status,deposit_status,expires_at,end_timestamptz,queue_released_at,
      slip_url, exists(select 1 from local_service.booking_status_history h where h.booking_id=b.id
        and h.new_status='cancelled' and h.reason ilike '%H1 released rejection proof%') as reason_saved
      from local_service.bookings b where id=${slipBooking}`;
    const overlapPairs = await db`select count(*)::int as n
      from local_service.bookings a join local_service.bookings b
        on b.staff_id=a.staff_id and b.id>a.id
       and tstzrange(b.start_timestamptz,b.end_timestamptz,'[)')
           && tstzrange(a.start_timestamptz,a.end_timestamptz,'[)')
     where a.staff_id is not null
       and a.status in ('hold','pending_review','confirmed')
       and b.status in ('hold','pending_review','confirmed')`;
    record('H1 released rejection closes terminally and catalog overlap pair scan is zero',
      rejectionResult.status === 'cancelled' && afterReject[0].status === 'cancelled'
        && afterReject[0].deposit_status === 'rejected' && afterReject[0].queue_released_at !== null
        && afterReject[0].expires_at.getTime() === afterReject[0].end_timestamptz.getTime()
        && afterReject[0].slip_url === slipPath && afterReject[0].reason_saved === true
        && overlapPairs[0].n === 0,
      `status=${afterReject[0].status}/${afterReject[0].deposit_status}; active_overlap_pairs=${overlapPairs[0].n}`);

    let uploadGrantDenied = false;
    try {
      await callAs('bk01_runtime', async (tx) => tx`
        select * from local_service.authorize_deposit_slip_upload(
          ${slipBooking},${holdResult.link_token},'image/jpeg',1024)`);
    } catch (error) {
      uploadGrantDenied = /Booking is not authorized for deposit upload/i.test(error.message);
      if (!uploadGrantDenied) throw error;
    }
    record('terminal released rejection cannot issue another upload grant', uploadGrantDenied);

    const noSuccessorHold = await callAs('anon', async (tx) => tx`
      select local_service.create_booking_hold(${shop},${service},${secondStaff},'No Successor','0800000111',null,
        ${day[0].today}::date,${day[0].past_time}::time,null)::text as result`);
    const noSuccessorResult = parsedJson(noSuccessorHold[0].result);
    const noSuccessorPath = `${noSuccessorResult.booking_id}/${crypto.randomUUID()}.jpg`;
    storagePaths.push(noSuccessorPath);
    await db`insert into storage.objects(bucket_id,name) values ('deposit-slips',${noSuccessorPath})`;
    await callAs('anon', async (tx) => tx`
      select local_service.submit_deposit_slip(${noSuccessorResult.booking_id},${noSuccessorResult.link_token},${noSuccessorPath},null)`);
    await db`update local_service.bookings set end_timestamptz=now()-interval '1 minute',
      expires_at=now()-interval '1 minute',queue_released_at=now() where id=${noSuccessorResult.booking_id}`;
    await callAs('authenticated', async (tx) => {
      await tx`select set_config('request.jwt.claim.sub',${owner},true)`;
      return tx`select local_service.reject_deposit_slip(${noSuccessorResult.booking_id},'H1 no successor proof')`;
    });
    const noSuccessorState = await db`select status,deposit_status,slip_url from local_service.bookings where id=${noSuccessorResult.booking_id}`;
    record('released rejection is terminal even when no successor exists',
      noSuccessorState[0].status === 'cancelled' && noSuccessorState[0].deposit_status === 'rejected'
        && noSuccessorState[0].slip_url === noSuccessorPath);

    const futureDate = await db`select (current_date+2)::text as d`;
    const futureHold = await callAs('anon', async (tx) => tx`
      select local_service.create_booking_hold(${shop},${service},${secondStaff},'Future Reject','0800000112',null,
        ${futureDate[0].d}::date,'14:00'::time,null)::text as result`);
    const futureResult = parsedJson(futureHold[0].result);
    const futurePath = `${futureResult.booking_id}/${crypto.randomUUID()}.jpg`;
    storagePaths.push(futurePath);
    await db`insert into storage.objects(bucket_id,name) values ('deposit-slips',${futurePath})`;
    await callAs('anon', async (tx) => tx`
      select local_service.submit_deposit_slip(${futureResult.booking_id},${futureResult.link_token},${futurePath},null)`);
    await callAs('authenticated', async (tx) => {
      await tx`select set_config('request.jwt.claim.sub',${owner},true)`;
      return tx`select local_service.reject_deposit_slip(${futureResult.booking_id},'Future rejection proof')`;
    });
    const futureState = await db`select status,deposit_status,queue_released_at,slip_url,
      expires_at between now()+interval '14 minutes' and now()+interval '16 minutes' as fifteen_minutes
      from local_service.bookings where id=${futureResult.booking_id}`;
    record('future rejection keeps the original 15-minute hold behavior',
      futureState[0].status === 'hold' && futureState[0].deposit_status === 'rejected'
        && futureState[0].queue_released_at === null && futureState[0].slip_url === futurePath
        && futureState[0].fifteen_minutes === true);

    const raceA = postgres(url, { max: 1, prepare: false, connect_timeout: 5, application_name: 'bk01-queue-race-a' });
    const raceB = postgres(url, { max: 1, prepare: false, connect_timeout: 5, application_name: 'bk01-queue-race-b' });
    const gateDb = postgres(url, { max: 1, prepare: false, connect_timeout: 5, application_name: 'bk01-queue-race-gate' });
    try {
      await raceA`SET ROLE anon`;
      await raceB`SET ROLE anon`;
      for (let round = 1; round <= 20; round += 1) {
        const raceDate = (await db`select (current_date+${round}::int)::text as d`)[0].d;
        let signalReady;
        const ready = new Promise((resolve) => { signalReady = resolve; });
        let signalRelease;
        const release = new Promise((resolve) => { signalRelease = resolve; });
        const barrier = gateDb.begin(async (tx) => {
          await tx`lock table local_service.bookings in share mode`;
          signalReady();
          await release;
        });
        await ready;
        const run = (conn, name, phone) => conn`
          select local_service.create_booking_hold(${shop},${service},${staff},${name},${phone},null,
            ${raceDate}::date,'14:00'::time,null)::text as result`;
        const pendingPair = Promise.allSettled([
          run(raceA,`Race ${round} A`,`081${String(round).padStart(7,'0')}`),
          run(raceB,`Race ${round} B`,`082${String(round).padStart(7,'0')}`),
        ]);
        const deadline = Date.now() + 5000;
        let waiters = 0;
        while (Date.now() < deadline) {
          const rows = await db`select count(*)::int as n from pg_stat_activity
            where datname=current_database() and wait_event_type='Lock'
              and query ilike '%create_booking_hold%'`;
          waiters = rows[0].n;
          if (waiters === 2) break;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        signalRelease();
        await barrier;
        if (waiters !== 2) throw new Error(`race ${round}: barrier observed ${waiters}, expected two lock waiters`);
        const results = await pendingPair;
        const passed = results.filter((item) => item.status === 'fulfilled').length;
        const failures = results.filter((item) => item.status === 'rejected');
        if (passed !== 1 || failures.length !== 1
            || !/unavailable during this time slot/i.test(failures[0].reason.message)) {
          throw new Error(`race ${round}: expected one hold and one overlap rejection`);
        }
      }
    } finally {
      await Promise.all([raceA.end(),raceB.end(),gateDb.end()]);
    }
    record('20 simultaneous two-connection races: one hold accepted, one overlap rejected each round', true, '20/20; barrier observed two waiters per round');

    const mutation = await db`select pg_get_constraintdef(oid) as def from pg_constraint
      where conname='prevent_overlapping_staff_bookings' and conrelid='local_service.bookings'::regclass`;
    const detectsMissingFlag = !/queue_released_at/i.test(mutation[0]?.def ?? '');
    record('constraint catalog exposes queue_released_at guard for mutation assertion', !detectsMissingFlag, mutation[0]?.def ?? 'missing');
  }
} finally {
  for (const path of storagePaths) await db`delete from storage.objects where name=${path}`;
  await db`delete from local_service.subscriptions where shop_id in (${shop},${otherShop})`;
  await db`delete from local_service.entitlement_usage where shop_id in (${shop},${otherShop})`;
  await db`delete from local_service.shops where id in (${shop},${otherShop})`;
  await db`delete from auth.users where id=${owner}`;
  await db.end({ timeout: 5 });
}

console.log(`RESULT ${checks.filter((c) => c.ok).length}/${checks.length} PASS mode=${mode}`);
