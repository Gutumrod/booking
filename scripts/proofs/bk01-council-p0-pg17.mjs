import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import postgres from 'postgres';
import {BK01_RUNTIME_EFFECTIVE_FUNCTIONS,validateBk01RuntimeEffectiveExecuteSet} from '../lib/bk01-runtime-allowlist.mjs';
const mode=process.argv[2];
if(!['baseline','after','rollback','mutation'].includes(mode)) throw Error('baseline|after|rollback|mutation');
if(process.env.BK01_SHARED_RUNTIME_ENV!=='local') throw Error('local-only proof');
const url=process.env.BK01_P0_LOCAL_URL;
if(!url || new URL(url).hostname!=='127.0.0.1')throw Error('explicit loopback URL required');
const dir=process.env.BK01_P0_EVIDENCE_DIR;
const data=process.env.BK01_P0_DATA_DIR?.replaceAll('\\','/');
if(!dir||!data)throw Error('data and evidence dirs required');
const mk=user=>postgres(url.replace(/\/\/[^@]+@/,`//${user}@`),{max:4,prepare:false,onnotice:()=>{}});
const op=mk('operator'),admin=mk('fixture_admin'),rt=mk('runtime_probe'),an=mk('anon_probe'),au=mk('auth_probe');
const clients=[op,admin,rt,an,au],results=[];
async function role(db,r,fn,uid){return db.begin(async tx=>{await tx.unsafe(`SET LOCAL ROLE ${r}`);if(uid){await tx`select set_config('request.jwt.claims',${JSON.stringify({sub:uid,email:'owner@example.test',is_anonymous:false})},true),set_config('request.jwt.claim.sub',${uid},true)`;}return fn(tx);});}
const mig=fn=>role(op,'bk01_migrator',fn);
const owner='90000000-0000-4000-8000-000000000001', outsider='90000000-0000-4000-8000-000000000002',staffUser='90000000-0000-4000-8000-000000000003';
const shop='90000000-0000-4000-8000-000000000010',service='90000000-0000-4000-8000-000000000011',staff='90000000-0000-4000-8000-000000000012',customer='90000000-0000-4000-8000-000000000013';
const record=(n,ok,d='')=>{results.push({name:n,ok,detail:d});console.log(`${ok?'PASS':'FAIL'} ${n} ${d}`);if(!ok)throw Error(n);};
async function reject(n,fn,rx=/.+/){try{await fn();record(n,false,'unexpected success');}catch(e){if(e.message===n)throw e;record(n,rx.test(e.message),e.message);}}
async function snapshot(){return mig(async tx=>({
 functions:await tx`select p.oid::regprocedure::text identity,pg_get_functiondef(p.oid) definition,pg_get_userbyid(p.proowner) owner,p.proacl::text acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('local_service','local_service_internal') order by 1`,
 relations:await tx`select n.nspname||'.'||c.relname identity,c.relkind,pg_get_userbyid(c.relowner) owner,c.relacl::text acl,c.relrowsecurity,c.relforcerowsecurity,case when c.relkind='v' then pg_get_viewdef(c.oid,true) else null end definition from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('local_service','local_service_internal') order by 1`,
 columns:await tx`select table_schema,table_name,column_name,data_type,udt_name,character_maximum_length,is_nullable,column_default,ordinal_position from information_schema.columns where table_schema in ('local_service','local_service_internal') order by table_schema,table_name,ordinal_position`,
 policies:await tx`select * from pg_policies where schemaname in ('local_service','local_service_internal') order by schemaname,tablename,policyname`,
 constraints:await tx`select conrelid::regclass::text tbl,conname,pg_get_constraintdef(oid) definition,convalidated from pg_constraint where connamespace in ('local_service'::regnamespace,'local_service_internal'::regnamespace) order by 1,2`,
 triggers:await tx`select tgrelid::regclass::text tbl,tgname,pg_get_triggerdef(oid) definition from pg_trigger where not tgisinternal and tgrelid in (select c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('local_service','local_service_internal')) order by 1,2`,
 acl:await tx`select c.oid::regclass::text identity,case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end grantee,a.privilege_type,a.is_grantable from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join lateral aclexplode(c.relacl) a where n.nspname='local_service' order by c.oid::regclass::text,grantee,privilege_type`
}));}
const basePath=path.join(dir,'catalog-base.json');
async function seed(){
 await admin`insert into auth.users(id,email) values(${owner},'owner@example.test'),(${outsider},'other@example.test'),(${staffUser},'staff@example.test') on conflict do nothing`;
 await mig(async tx=>{
 await tx`insert into local_service.shops(id,name,slug,phone,promptpay_number,promptpay_name,require_deposit,default_deposit_amount) values(${shop},'P0 Shop','p0-proof','0812345678','0812345678','Owner',true,100) on conflict do nothing`;
 await tx`insert into local_service.shop_users(shop_id,user_id,role) values(${shop},${owner},'owner'),(${shop},${staffUser},'staff') on conflict do nothing`;
 await tx`insert into local_service.subscriptions(shop_id,plan,status,current_period_end) values(${shop},'basic_490','active',now()+interval '60 days') on conflict(shop_id) do nothing`;
 await tx`insert into local_service.services(id,shop_id,name,duration_minutes,price,deposit_amount) values(${service},${shop},'P0 service',30,200,100) on conflict do nothing`;
 await tx`insert into local_service.staff(id,shop_id,name) values(${staff},${shop},'P0 staff') on conflict do nothing`;
 await tx`insert into local_service.staff_schedules(shop_id,staff_id,day_of_week,is_working_day,work_start,work_end) select ${shop}::uuid,${staff}::uuid,d,true,time '00:00',time '23:59' from generate_series(0,6) d on conflict do nothing`;
 await tx`insert into local_service.customers(id,shop_id,name,phone) values(${customer},${shop},'P0 customer','0811111111') on conflict do nothing`;
 });
}
const profileQuery=tx=>tx`select id,name,slug,phone,address,promptpay_number,promptpay_name,require_deposit,is_accepting_online_bookings from local_service.shop_public_profile where slug='p0-proof'`;
const entQuery=tx=>tx`select shop_id,item_kind,item_id,item_name,is_active,plan_entitled,state,system_disabled,created_at from local_service.bk01_shop_entitlement_status where shop_id=${shop} order by item_kind,created_at`;
const settings=tx=>tx`select local_service.update_shop_settings(p_shop_id=>${shop}::uuid,p_name=>'P0 Shop',p_phone=>'0812345678',p_address=>'A',p_promptpay_number=>'0812345678',p_promptpay_name=>'Owner',p_line_oa_id=>null)`;
const hold=(tx,day,time,phone='0822222222')=>tx`select local_service.create_booking_hold(p_shop_id=>${shop}::uuid,p_service_id=>${service}::uuid,p_staff_id=>${staff}::uuid,p_customer_name=>'P0 customer',p_customer_phone=>${phone}::varchar,p_customer_email=>null,p_booking_date=>${day}::date,p_start_time=>${time}::time,p_notes=>null) result`;
const day=d=>new Date(Date.now()+d*86400000+7*3600000).toISOString().slice(0,10);
async function booking({id=crypto.randomUUID(),status='confirmed',deposit='verified',hours=96,token='ABCDEF1234',phone=customer}={}){await mig(tx=>tx`insert into local_service.bookings(id,shop_id,customer_id,service_id,staff_id,booking_code,link_token,link_token_expires_at,booking_date,start_time,end_time,start_timestamptz,end_timestamptz,status,deposit_status,deposit_amount,service_price,service_duration_minutes,expires_at) values(${id},${shop},${phone},${service},null,${'P'+id.slice(0,10)},${token},now()+interval '30 days',(now()+make_interval(hours=>${hours})) at time zone 'Asia/Bangkok',time '09:00',time '09:30',now()+make_interval(hours=>${hours}),now()+make_interval(hours=>${hours})+interval '30 minutes',${status},${deposit},100,200,30,case when ${status}='pending_review' then now()+make_interval(hours=>${hours})+interval '30 minutes' else null end)`);return id;}
try{
 const guard=await admin`select current_setting('data_directory') data,current_setting('server_version_num') v,current_setting('timezone') tz`;
 record('fresh W-1 path PG17.11 UTC',guard[0].data.replaceAll('\\','/')===data&&guard[0].v==='170011'&&guard[0].tz==='UTC');
 const posture=await op`select current_user,r.rolsuper,has_schema_privilege('bk01_migrator','extensions','USAGE') ext,has_schema_privilege('public','extensions','USAGE') pub from pg_roles r where r.rolname=current_user`;
 record('operator non-superuser, extensions closed',!posture[0].rolsuper&&!posture[0].ext&&!posture[0].pub,JSON.stringify(posture[0]));
 if(mode==='baseline'){
  await seed();const base=await snapshot();fs.writeFileSync(basePath,JSON.stringify(base,null,2));
  await reject('before exact consumer projection fails',()=>role(an,'anon',profileQuery),/permission denied for function/);
  await reject('before exact admin projection fails',()=>role(au,'authenticated',entQuery,owner),/permission denied for function/);
  await role(au,'authenticated',tx=>tx`insert into local_service.customers(shop_id,name,phone) values(${shop},'injected','0899999999')`,outsider);record('before no-RETURNING customer injection reproduced',true);
  await reject('before settings seven args fail',()=>role(au,'authenticated',settings,owner),/does not exist/);
  const future=await booking();await role(au,'authenticated',tx=>tx`select local_service.set_booking_outcome(${future},'completed',null)`,owner);record('before future completed reproduced',true);
  await mig(tx=>tx`delete from local_service.bookings where id=${future}`);
  const granted=await mig(tx=>tx`select has_table_privilege('anon','local_service.shop_users','TRUNCATE') ok`);record('before anon TRUNCATE authority exists',granted[0].ok);
 }else if(mode==='rollback'){
  const base=JSON.parse(fs.readFileSync(basePath));const after=await snapshot(); const diffs=[];
  for(const key of Object.keys(base))if(JSON.stringify(base[key])!==JSON.stringify(after[key])){diffs.push(key);fs.writeFileSync(path.join(dir,`rollback-${key}.json`),JSON.stringify({before:base[key],after:after[key]},null,2));}
  record('raw catalog rollback diff=base',diffs.length===0,JSON.stringify(diffs));
 }else{
  const base=JSON.parse(fs.readFileSync(basePath));const after=await snapshot();fs.writeFileSync(path.join(dir,'catalog-after.json'),JSON.stringify(after,null,2));

  const changedAcl=after.functions.filter(f=>{const b=base.functions.find(x=>x.identity===f.identity);return b&&(b.owner!==f.owner||b.acl!==f.acl);});
  record('function ACL/owner delta only intended hold executor',changedAcl.length===1&&changedAcl[0].identity.startsWith('local_service.create_booking_hold('),JSON.stringify(changedAcl.map(x=>({identity:x.identity,owner:x.owner,acl:x.acl}))));
  const helpers=await mig(tx=>tx`select p.oid::regprocedure::text identity from pg_proc p where p.oid in ('local_service.bk01_shop_effective_plan(uuid)'::regprocedure,'local_service.bk01_free_bookings_ceiling()'::regprocedure,'local_service.bk01_bookings_used_in_month(uuid,date)'::regprocedure,'local_service.bk01_month_key(timestamptz)'::regprocedure,'local_service.bk01_entitled_service_ids(uuid)'::regprocedure,'local_service.bk01_entitled_staff_ids(uuid)'::regprocedure) and (has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE'))`);
  record('six private helpers never granted to app roles',helpers.length===0);
  const owners=await mig(tx=>tx`select p.oid::regprocedure::text identity from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='local_service' and pg_get_userbyid(p.proowner)<>'bk01_migrator'`);record('new functions migrator-owned; frozen ownership exceptions unchanged',after.functions.every(f=>{const b=base.functions.find(x=>x.identity===f.identity);return b?f.owner===b.owner:f.owner==='bk01_migrator';}));
  const rls=await mig(tx=>tx`select relrowsecurity,relforcerowsecurity from pg_class where oid='local_service.deposit_money_events'::regclass`);record('money ledger FORCE RLS',rls[0].relrowsecurity&&rls[0].relforcerowsecurity);
  await reject('outsider money ledger direct SELECT denied',()=>role(au,'authenticated',tx=>tx`select * from local_service.deposit_money_events`,outsider),/permission denied/);
  const runtime=await mig(tx=>tx`select p.oid::regprocedure::text identity from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='local_service' and has_function_privilege('bk01_runtime',p.oid,'EXECUTE') order by 1`);
  record('runtime exact 21 identities',validateBk01RuntimeEffectiveExecuteSet(runtime.map(x=>x.identity))&&runtime.length===21);
  const anon=await role(an,'anon',profileQuery);record('anon consumer exact projection',anon.length===1&&anon[0].is_accepting_online_bookings===true);
  const authenticated=await role(au,'authenticated',profileQuery,outsider);record('authenticated consumer projection',authenticated.length===1);
  const ent=await role(au,'authenticated',entQuery,owner);record('owner admin exact projection',ent.length===2&&ent.every(x=>x.plan_entitled));
  await reject('public OA column absent',()=>role(an,'anon',tx=>tx`select line_oa_id from local_service.shop_public_profile`),/does not exist/);
  const leaks=await role(au,'authenticated',tx=>tx`select id,owner_name,phone,requested_plan from local_service.shops where id=${shop}`,outsider);record('outsider private shops empty',leaks.length===0);
  for(const returning of [false,true])await reject(`customers insert rejected returning=${returning}`,()=>role(au,'authenticated',tx=>tx.unsafe(`insert into local_service.customers(shop_id,name,phone) values('${shop}','injected','0898888888')${returning?' returning id':''}`),outsider),/permission denied/);
  await reject('anon hold revoked',()=>role(an,'anon',tx=>hold(tx,day(2),'09:00')),/permission denied/);
  await reject('authenticated hold revoked',()=>role(au,'authenticated',tx=>hold(tx,day(2),'09:00'),owner),/permission denied/);
  await role(au,'authenticated',settings,owner);record('settings seven named args works',true);
  await role(au,'authenticated',tx=>tx`select local_service.update_shop_settings(${shop},'P0 Shop','0812345678','A','0812345678','Owner',null,30,18)`,owner);
  await role(au,'authenticated',settings,owner);const pol=await mig(tx=>tx`select customer_cancel_before_hours c,customer_reschedule_before_hours r from local_service.shops where id=${shop}`);record('settings nine args then seven preserves under lock',pol[0].c===30&&pol[0].r===18);
  await role(au,'authenticated',tx=>tx`select * from local_service.set_shop_notification_contact(${shop})`,owner);record('real Auth JWT shape accepted without email_verified',true);
  await reject('anonymous JWT email rejected',()=>role(au,'authenticated',async tx=>{await tx`select set_config('request.jwt.claims',${JSON.stringify({sub:owner,email:'owner@example.test',is_anonymous:true})},true)`;return tx`select * from local_service.set_shop_notification_contact(${shop})`;},owner),/non-anonymous/);
  await reject('outsider email RPC rejected',()=>role(au,'authenticated',tx=>tx`select * from local_service.get_shop_notification_contact(${shop})`,outsider),/Owner or admin/);
  await reject('outsider direct contacts denied',()=>role(au,'authenticated',tx=>tx`select email from local_service.shop_notification_contacts`,outsider),/permission denied/);
  const extra=await mig(tx=>tx`select c.oid::regclass::text tbl,r.role,p.privilege from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join(values('anon'),('authenticated')) r(role) cross join(values('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) p(privilege) where n.nspname='local_service' and c.relkind in ('r','p') and has_table_privilege(r.role,c.oid,p.privilege) and not(r.role='authenticated' and c.relname='tickets' and p.privilege='DELETE')`);
  record('table write privilege matrix exact',extra.length===0,JSON.stringify(extra));
  await reject('anon actual TRUNCATE denied',()=>role(an,'anon',tx=>tx`truncate local_service.shop_users`),/permission denied/);
  await reject('owner topup rejected',()=>role(au,'authenticated',tx=>tx`select local_service.apply_topup(${shop},1,0)`,owner),/platform admin/);
  await reject('runtime past hold rejected Bangkok',()=>role(rt,'bk01_runtime',tx=>hold(tx,day(-1),'09:00')),/today or later|future/);
  await reject('runtime null time rejected',()=>role(rt,'bk01_runtime',tx=>hold(tx,day(2),null)),/future/);
  const h=await role(rt,'bk01_runtime',tx=>hold(tx,day(2),'09:00'));record('runtime nine named args creates hold 128-bit token',h[0].result.link_token.length===32,JSON.stringify({status:h[0].result.status,length:h[0].result.link_token.length}));
  await role(rt,'bk01_runtime',tx=>hold(tx,day(2),'10:00'));await role(rt,'bk01_runtime',tx=>hold(tx,day(2),'11:00'));
  await reject('phone cap fourth hold rejected',()=>role(rt,'bk01_runtime',tx=>hold(tx,day(2),'12:00')),/BOOKING_PENDING_LIMIT/);
  const future=await booking();await reject('future completed rejected',()=>role(au,'authenticated',tx=>tx`select local_service.set_booking_outcome(${future},'completed',null)`,owner),/not started/);
  await reject('staff cancellation rejected',()=>role(au,'authenticated',tx=>tx`select local_service.cancel_booking(${future},'reason')`,staffUser),/Not authorized/);
  await role(au,'authenticated',tx=>tx`select local_service.cancel_booking(${future},'reason')`,owner);record('owner cancellation succeeds',true);
  const rejected=await booking({status:'cancelled',deposit:'rejected',hours:-2});
  await reject('refund textual evidence mandatory',()=>role(au,'authenticated',tx=>tx`select local_service.record_deposit_refund(${rejected},' ',null)`,owner),/reference is required/);
  await role(au,'authenticated',tx=>tx`select local_service.record_deposit_refund(${rejected},'bank transfer evidence P0','note')`,owner);const hist=await role(au,'authenticated',tx=>tx`select * from local_service.get_deposit_refund_history(${rejected})`,owner);record('rejected slip refund creates immutable fact',hist.length===1&&hist[0].reference==='bank transfer evidence P0');
  await reject('migrator cannot UPDATE immutable money fact',()=>mig(tx=>tx`update local_service.deposit_money_events set reference='tampered' where booking_id=${rejected}`),/append-only|row-level/);
  await reject('migrator cannot DELETE immutable money fact',()=>mig(tx=>tx`delete from local_service.deposit_money_events where booking_id=${rejected}`),/append-only|row-level/);
  await reject('migrator cannot TRUNCATE immutable money facts',()=>mig(tx=>tx`truncate local_service.deposit_money_events`),/append-only/);
 }
}finally{
 fs.writeFileSync(path.join(dir,`${mode}-results.json`),JSON.stringify(results,null,2));await Promise.all(clients.map(x=>x.end()));
}
