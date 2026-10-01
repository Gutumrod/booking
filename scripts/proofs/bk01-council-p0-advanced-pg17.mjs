import fs from 'node:fs';import crypto from 'node:crypto';import postgres from 'postgres';
const url=process.env.BK01_P0_LOCAL_URL,dir=process.env.BK01_P0_EVIDENCE_DIR,data=process.env.BK01_P0_DATA_DIR;
if(process.env.BK01_SHARED_RUNTIME_ENV!=='local'||!url||new URL(url).hostname!=='127.0.0.1'||!dir||!data)throw Error('isolated loopback environment required');
const mk=u=>postgres(url.replace(/\/\/[^@]+@/,`//${u}@`),{max:4,prepare:false,onnotice:()=>{}});const op=mk('operator'),adm=mk('fixture_admin'),rt=mk('runtime_probe'),an=mk('anon_probe'),au=mk('auth_probe');const results=[];
const shop='90000000-0000-4000-8000-000000000010',svc='90000000-0000-4000-8000-000000000011',staff='90000000-0000-4000-8000-000000000012',customer='90000000-0000-4000-8000-000000000013',owner='90000000-0000-4000-8000-000000000001';
const record=(name,ok,detail='')=>{results.push({name,ok,detail});console.log(`${ok?'PASS':'FAIL'} ${name} ${detail}`);if(!ok)throw Error(name);};
const role=(db,r,fn)=>db.begin(async tx=>{await tx.unsafe(`SET LOCAL ROLE ${r}`);await tx`select set_config('request.jwt.claims',${JSON.stringify({sub:owner,email:'owner@example.test',is_anonymous:false})},true),set_config('request.jwt.claim.sub',${owner},true)`;return fn(tx);});const mig=fn=>role(op,'bk01_migrator',fn),runtime=fn=>role(rt,'bk01_runtime',fn),auth=fn=>role(au,'authenticated',fn);
async function reject(name,fn,rx=/.+/){try{await fn();record(name,false,'unexpected success');}catch(e){if(e.message===name)throw e;record(name,rx.test(e.message),e.message);}}
async function patch(identity,transform,fn){const [r]=await mig(tx=>tx`select pg_get_functiondef(${identity}::regprocedure) def`);await mig(tx=>tx.unsafe(transform(r.def)+';'));try{return await fn();}finally{await mig(tx=>tx.unsafe(r.def+';'));}}
const hold=(tx,date,time,phone)=>tx`select local_service.create_booking_hold(${shop},${svc},${staff},'Test',${phone},null,${date}::date,${time}::time,null) result`;
const thaiDay=d=>new Date(Date.now()+7*3600000+d*86400000).toISOString().slice(0,10);
async function makeBooking({status='confirmed',deposit='verified',hours=96,start=null,end=null,staffId=null}={}){const id=crypto.randomUUID();await mig(tx=>tx`insert into local_service.bookings(id,shop_id,customer_id,service_id,staff_id,booking_code,link_token,link_token_expires_at,booking_date,start_time,end_time,start_timestamptz,end_timestamptz,status,deposit_status,deposit_amount,service_price,service_duration_minutes,expires_at) values(${id},${shop},${customer},${svc},${staffId},${('T'+id.slice(0,10)).toUpperCase()},'ABCDEF1234',now()+interval '30 days',coalesce(${start}::timestamptz,now()+make_interval(hours=>${hours})) at time zone 'Asia/Bangkok',time '09:00',time '09:30',coalesce(${start}::timestamptz,now()+make_interval(hours=>${hours})),coalesce(${end}::timestamptz,now()+make_interval(hours=>${hours})+interval '30 minutes'),${status},${deposit},100,200,30,case when ${status}='pending_review' then now()+make_interval(hours=>${hours})+interval '30 minutes' else null end)`);return id;}
try{
 const [guard]=await adm`select current_setting('data_directory') data`;record('advanced proof exact data guard',guard.data.replaceAll('\\','/')===data.replaceAll('\\','/'));
 // Recipient channels and context: due rows with valid booking survive identical real RPC requests.
 const b=await makeBooking({deposit:'not_required'});const line=crypto.randomUUID(),email=crypto.randomUUID();await mig(async tx=>{await tx`update local_service.customers set line_user_id=${'U'+'1'.repeat(32)} where id=${customer}`;await tx`insert into local_service.line_notification_logs(id,shop_id,booking_id,event_type,recipient_type,status,scheduled_for,idempotency_key) values(${line},${shop},${b},'booking_cancelled','customer','pending',now()-interval '1 minute',${'line:'+line}),(${email},${shop},${b},'shop_email_slip','shop_owner','pending',now()-interval '1 minute',${'email:'+email})`;});
 const claimed=await runtime(tx=>tx`select * from local_service.claim_due_line_notifications(p_limit=>100)`);record('LINE claims customers only',claimed.some(x=>x.id===line)&&claimed.every(x=>x.recipient_type==='customer')&&!claimed.some(x=>x.id===email));
 const ctx=await runtime(tx=>tx`select * from local_service.get_line_notification_delivery_context(p_id=>${email},p_attempt_count=>0)`);record('noncustomer context LINE recipient NULL',ctx.length===1&&ctx[0].line_user_id===null);
 const pending=await makeBooking({status:'pending_review',deposit:'submitted',hours:96});
 const summary='2030-01-02';for(const clock of ['09:00:30','09:07:00','17:00:00','22:00:00','07:59:00']){
  await patch('local_service.claim_due_shop_email_notifications(integer,local_service.bk01_ops_alert_kind,text,boolean)',def=>def.replace(/now\(\)/g,`timestamptz '${summary} ${clock}+07'`),async()=>{
   const rows=await runtime(tx=>tx`select * from local_service.claim_due_shop_email_notifications(p_limit=>100)`);
   if(['22:00:00','07:59:00'].includes(clock)){record('quiet window '+clock,rows.length===0);return;}
   const slots=await mig(tx=>tx`select idempotency_key from local_service.line_notification_logs where shop_id=${shop} and event_type='shop_email_slip_summary' and idempotency_key like ${'%:'+summary+':%'}`);
   record('digest clock '+clock,slots.length===(clock==='17:00:00'?2:1));record('shop email no booking/customer fields '+clock,rows.every(x=>!('booking_id' in x)&&!('customer_name' in x)&&x.email==='owner@example.test'));
  });
 }
 // Cron missed exact minute on another date, creates 09 slot at 09:07 and both at 17:00.
 await patch('local_service.claim_due_shop_email_notifications(integer,local_service.bk01_ops_alert_kind,text,boolean)',def=>def.replace(/now\(\)/g,"timestamptz '2030-01-03 09:07:00+07'"),async()=>{await runtime(tx=>tx`select * from local_service.claim_due_shop_email_notifications(100)`);const [r]=await mig(tx=>tx`select count(*)::int n from local_service.line_notification_logs where shop_id=${shop} and idempotency_key=${'shop-slip-summary:'+shop+':2030-01-03:09'}`);record('missed cron catches up 09 slot',r.n===1);});
 // Real two-session phone-cap race, two existing holds + two contenders -> one.
 const phone='0833333333';await runtime(tx=>hold(tx,thaiDay(3),'09:00',phone));await runtime(tx=>hold(tx,thaiDay(3),'10:00',phone));
 const race=await Promise.allSettled([runtime(tx=>hold(tx,thaiDay(3),'11:00',phone)),runtime(tx=>hold(tx,thaiDay(3),'12:00',phone))]);record('phone-cap concurrent race one winner',race.filter(x=>x.status==='fulfilled').length===1&&race.some(x=>x.status==='rejected'&&/BOOKING_PENDING_LIMIT/.test(x.reason.message)));
 // Single slot race protects exclusion (different phone prevents admission-cap interference).
 const slotRace=await Promise.allSettled([runtime(tx=>hold(tx,thaiDay(3),'15:00','0844444444')),runtime(tx=>hold(tx,thaiDay(3),'15:00','0855555555'))]);record('single slot race one winner',slotRace.filter(x=>x.status==='fulfilled').length===1&&slotRace.some(x=>x.status==='rejected'&&/unavailable/.test(x.reason.message)));
 // Rejected slip with future appointment extends token; approve and confirmation do too.
 const rejection=await makeBooking({status:'pending_review',deposit:'submitted',hours:120});await auth(tx=>tx`select local_service.reject_deposit_slip(${rejection},'bad slip')`);
 const approval=await makeBooking({status:'pending_review',deposit:'submitted',hours:144});await auth(tx=>tx`select local_service.approve_booking_deposit(${approval})`);
 const [exp]=await mig(tx=>tx`select bool_and(link_token_expires_at=end_timestamptz+interval '7 days') ok from local_service.bookings where id in (${rejection},${approval})`);record('approve and future rejection expiry appointment plus seven days',exp.ok);
 // Runtime cannot read bookings; code must be supplied by customer from actual creation context, so fetch fixture only as migrator.
 const [bk]=await mig(tx=>tx`select booking_code from local_service.bookings where id=${approval}`);
 const legacy=await runtime(tx=>tx`select * from local_service.bk01_line_bind_booking_trial('p0-bind-legacy-valid',${bk.booking_code},'ABCDEF1234',${'U'+'1'.repeat(32)})`);record('legacy 10-char trial token remains accepted',legacy.length===1&&legacy[0].claimed);
 const fresh=await runtime(tx=>hold(tx,thaiDay(4),'09:00','0866666666'));const v=fresh[0].result;const modern=await runtime(tx=>tx`select * from local_service.bk01_line_bind_booking_trial('p0-bind-128',${v.booking_code},${v.link_token},${'U'+'3'.repeat(32)})`);record('new 32-char trial token accepted',modern.length===1&&modern[0].claimed);

 // Destination-month quota race uses real customer reschedule RPC, two existing tokens and 49/50 destination bookings.
 const free=crypto.randomUUID(),freeSvc=crypto.randomUUID(),freeStaff=crypto.randomUUID(),freeCust=crypto.randomUUID();
 const sourceDate=new Date(Date.UTC(new Date().getUTCFullYear(),new Date().getUTCMonth()+1,15)).toISOString().slice(0,10);
 const destDate=new Date(Date.UTC(new Date().getUTCFullYear(),new Date().getUTCMonth()+2,15)).toISOString().slice(0,10);
 await mig(async tx=>{
  await tx`insert into local_service.shops(id,name,slug,require_deposit) values(${free},'Quota proof',${'p0-quota-'+free},false)`;
  await tx`insert into local_service.subscriptions(shop_id,plan,status,current_period_end) values(${free},'basic_490','trialing',now()-interval '1 day') ON CONFLICT(shop_id) DO UPDATE SET plan='basic_490',status='trialing',current_period_end=now()-interval '1 day'`;
  await tx`insert into local_service.services(id,shop_id,name,duration_minutes,price) values(${freeSvc},${free},'Quota service',30,200)`;
  await tx`insert into local_service.staff(id,shop_id,name) values(${freeStaff},${free},'Quota staff')`;
  await tx`insert into local_service.staff_schedules(shop_id,staff_id,day_of_week,is_working_day,work_start,work_end) select ${free}::uuid,${freeStaff}::uuid,d,true,time '00:00',time '23:59' from generate_series(0,6) d`;
  await tx`insert into local_service.customers(id,shop_id,name,phone) values(${freeCust},${free},'Quota customer','0800000000')`;
 });
 async function qbooking(date,time,staffId=null){const id=crypto.randomUUID();await mig(tx=>tx`insert into local_service.bookings(id,shop_id,customer_id,service_id,staff_id,booking_code,link_token,link_token_expires_at,booking_date,start_time,end_time,start_timestamptz,end_timestamptz,status,deposit_status,deposit_amount,service_price,service_duration_minutes) values(${id},${free},${freeCust},${freeSvc},${staffId},${('Q'+id.slice(0,10)).toUpperCase()},'ABCDEF1234',now()+interval '1 year',${date}::date,${time}::time,${time}::time+interval '30 minutes',(${date}||' '||${time})::timestamp at time zone 'Asia/Bangkok',(${date}||' '||${time})::timestamp at time zone 'Asia/Bangkok'+interval '30 minutes','confirmed','not_required',0,200,30)`);return id;}
 for(let i=0;i<49;i++)await qbooking(destDate,'08:00');
 const q1=await qbooking(sourceDate,'09:00',freeStaff),q2=await qbooking(sourceDate,'10:00',freeStaff);
 const reschedule=(id,time)=>role(an,'anon',tx=>tx`select local_service.customer_reschedule_booking(p_booking_id=>${id}::uuid,p_recovery_token=>'ABCDEF1234',p_booking_date=>${destDate}::date,p_start_time=>${time}::time,p_reason=>'quota race') result`);
 const qr=await Promise.allSettled([reschedule(q1,'11:00'),reschedule(q2,'14:00')]);record('destination month 49/50 race exactly one reschedule',qr.filter(x=>x.status==='fulfilled').length===1&&qr.some(x=>x.status==='rejected'&&/BOOKING_QUOTA_EXCEEDED/.test(x.reason.message)),qr.map(x=>x.status==='rejected'?x.reason.message:x.status).join(';'));

 const loser=qr[0].status==='rejected'?q1:q2,loserTime=qr[0].status==='rejected'?'11:00':'14:00';
 await patch('local_service.enforce_booking_quota()',def=>def.replace('BEGIN\n',"BEGIN\n    IF TG_OP='UPDATE' THEN RETURN NEW; END IF;\n"),async()=>{const r=await reschedule(loser,loserTime);record('quota guard mutation turns destination-cap test red',r[0].result.status==='confirmed');});
 await patch('local_service.create_booking_hold(uuid,uuid,uuid,character varying,character varying,character varying,date,time without time zone,text)',def=>def.replace('>=3 THEN','>=999 THEN'),async()=>{const r=await runtime(tx=>hold(tx,thaiDay(3),'16:00',phone));record('phone guard mutation turns admission-cap test red',r[0].result.status==='hold');});
 const past=new Date(Date.now()-3600000+7*3600000).toISOString();await reject('same Thai day past hold rejected',()=>runtime(tx=>hold(tx,past.slice(0,10),past.slice(11,19),'0888888888')),/today or later|future/);
 // A legacy NULL interval must not shadow the whole staff calendar; new NULLs fail CHECK.
 const nullId=crypto.randomUUID();await mig(async tx=>{
  await tx.unsafe('ALTER TABLE local_service.bookings DROP CONSTRAINT bk01_booking_times_present');
  await tx`insert into local_service.bookings(id,shop_id,customer_id,service_id,staff_id,booking_code,link_token,link_token_expires_at,booking_date,start_time,end_time,status,deposit_status,service_price,service_duration_minutes) values(${nullId},${shop},${customer},${svc},${staff},${('N'+nullId.slice(0,10)).toUpperCase()},'ABCDEF1234',now()+interval '30 days',${thaiDay(6)}::date,time '09:00',time '09:30','confirmed','not_required',200,30)`;
  await tx.unsafe('ALTER TABLE local_service.bookings ADD CONSTRAINT bk01_booking_times_present CHECK(start_timestamptz IS NOT NULL AND end_timestamptz IS NOT NULL) NOT VALID');
 });
 const nullAvailable=await runtime(tx=>hold(tx,thaiDay(6),'09:00','0877777777'));record('legacy NULL interval does not block availability',nullAvailable[0].result.status==='hold');
 await reject('new NULL interval CHECK rejects',()=>mig(tx=>tx`update local_service.bookings set start_timestamptz=null where id=${nullAvailable[0].result.booking_id}`),/bk01_booking_times_present/);
 await reject('NULL start completed fails closed',()=>auth(tx=>tx`select local_service.set_booking_outcome(${nullId},'completed',null)`),/not started/);
 await reject('NULL start customer reschedule fails closed',()=>role(an,'anon',tx=>tx`select local_service.customer_reschedule_booking(${nullId},'ABCDEF1234',${thaiDay(7)}::date,time '09:00','reason')`),/policy window|appointment time|token/);
 // Remove the fixture NULL row before independent rollback rehearsals.
 await mig(tx=>tx`delete from local_service.bookings where id=${nullId}`);
 // Mutation: remove completed clock guard. The same must-reject request becomes a success, proving sensitivity.
 const future=await makeBooking({hours:192});
 await patch('local_service.set_booking_outcome(uuid,text,text)',def=>def.replace("IF v_booking.start_timestamptz IS NULL OR v_booking.start_timestamptz>now() THEN RAISE EXCEPTION 'Appointment has not started'; END IF;",''),async()=>{const r=await auth(tx=>tx`select local_service.set_booking_outcome(${future},'completed',null) result`);record('completed guard mutation turns acceptance test red',r[0].result.status==='completed');});
 // Mutation: remove customer channel guard -> email row is now claimed by LINE.
 const wrong=crypto.randomUUID();await mig(tx=>tx`insert into local_service.line_notification_logs(id,shop_id,booking_id,event_type,recipient_type,status,scheduled_for,idempotency_key) values(${wrong},${shop},${b},'shop_email_slip','shop_owner','pending',now()-interval '1 minute',${'email:'+wrong})`);
 await patch('local_service.claim_due_line_notifications(integer)',def=>def.replace("l.recipient_type='customer' AND ",''),async()=>{const r=await runtime(tx=>tx`select * from local_service.claim_due_line_notifications(100)`);record('channel guard mutation turns isolation test red',r.some(x=>x.id===wrong));});
 // Mutation: contact anonymity guard removed -> anonymous JWT passes, correct body restored afterward.
 await patch('local_service.set_shop_notification_contact(uuid)',def=>def.replace("v_claims->>'is_anonymous' IS DISTINCT FROM 'false'\n       OR ",''),async()=>{const r=await auth(async tx=>{await tx`select set_config('request.jwt.claims',${JSON.stringify({sub:owner,email:'owner@example.test',is_anonymous:true})},true)`;return tx`select * from local_service.set_shop_notification_contact(${shop})`;});record('contact guard mutation turns JWT test red',r.length===1);});
}finally{fs.writeFileSync(dir+'/advanced-results.json',JSON.stringify(results,null,2));await Promise.all([op,adm,rt,an,au].map(x=>x.end()));}
