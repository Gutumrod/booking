import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import postgres from 'postgres';
const mode=process.argv[2]??'after',url=process.env.BK01_P0_LOCAL_URL,dir=process.env.BK01_P0_EVIDENCE_DIR,data=process.env.BK01_P0_DATA_DIR;
if(!['baseline','rollback','after'].includes(mode)||process.env.BK01_SHARED_RUNTIME_ENV!=='local'||!url||new URL(url).hostname!=='127.0.0.1'||!dir||!data)throw Error('isolated loopback environment required');
const mk=u=>postgres(url.replace(/\/\/[^@]+@/,`//${u}@`),{max:4,prepare:false,onnotice:()=>{}});const op=mk('operator'),adm=mk('fixture_admin'),rt=mk('runtime_probe'),an=mk('anon_probe'),au=mk('auth_probe');const results=[];
const record=(n,ok,d='')=>{results.push({name:n,ok,detail:d});console.log(`${ok?'PASS':'FAIL'} ${n} ${d}`);if(!ok)throw Error(n);};
const role=(db,r,fn)=>db.begin(async tx=>{await tx.unsafe(`SET LOCAL ROLE ${r}`);return fn(tx);});const mig=fn=>role(op,'bk01_migrator',fn),runtime=fn=>role(rt,'bk01_runtime',fn);
async function reject(n,fn,rx=/.+/){try{await fn();record(n,false,'unexpected success');}catch(e){if(e.message===n)throw e;record(n,rx.test(e.message),e.message);}}
const identity='local_service.claim_due_shop_email_notifications(integer,local_service.bk01_ops_alert_kind,text,boolean)';
const alert=(kind,key,delivered=false)=>runtime(tx=>tx`select * from local_service.claim_due_shop_email_notifications(p_alert_kind=>${kind}::local_service.bk01_ops_alert_kind,p_alert_key=>${key},p_delivered=>${delivered})`);
async function patch(transform,fn){const [r]=await mig(tx=>tx`select pg_get_functiondef(${identity}::regprocedure) def`);await mig(tx=>tx.unsafe(transform(r.def)+';'));try{return await fn();}finally{await mig(tx=>tx.unsafe(r.def+';'));}}
const snapFile=path.join(dir,'catalog-before-controller-followup.json');
async function snapshot(){return mig(async tx=>({
 types:await tx`select n.nspname||'.'||t.typname identity,t.typtype,pg_get_userbyid(t.typowner) owner,t.typacl::text acl,(select json_agg(e.enumlabel order by e.enumsortorder) from pg_enum e where e.enumtypid=t.oid) labels from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname in ('local_service','local_service_internal') order by 1`,
 functions:await tx`select p.oid::regprocedure::text identity,pg_get_functiondef(p.oid) definition,pg_get_userbyid(p.proowner) owner,p.proacl::text acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('local_service','local_service_internal') order by 1`,
 relations:await tx`select n.nspname||'.'||c.relname identity,c.relkind,pg_get_userbyid(c.relowner) owner,c.relacl::text acl,c.relrowsecurity,c.relforcerowsecurity,case when c.relkind='v' then pg_get_viewdef(c.oid,true) else null end definition from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('local_service','local_service_internal') order by 1`,
 columns:await tx`select table_schema,table_name,column_name,data_type,udt_name,character_maximum_length,is_nullable,column_default,ordinal_position from information_schema.columns where table_schema in ('local_service','local_service_internal') order by table_schema,table_name,ordinal_position`,
 policies:await tx`select * from pg_policies where schemaname in ('local_service','local_service_internal') order by schemaname,tablename,policyname`,
 constraints:await tx`select conrelid::regclass::text tbl,conname,pg_get_constraintdef(oid) definition,convalidated from pg_constraint where connamespace in ('local_service'::regnamespace,'local_service_internal'::regnamespace) order by 1,2`,
 triggers:await tx`select tgrelid::regclass::text tbl,tgname,pg_get_triggerdef(oid) definition from pg_trigger where not tgisinternal and tgrelid in (select c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('local_service','local_service_internal')) order by 1,2`,
 acl:await tx`select c.oid::regclass::text identity,case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end grantee,a.privilege_type,a.is_grantable from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join lateral aclexplode(c.relacl) a where n.nspname='local_service' order by c.oid::regclass::text,grantee,privilege_type`
}));}

try{
 const [g]=await adm`select current_setting('data_directory') data`;record('follow-up exact disposable path guard',g.data.replaceAll('\\','/')===data.replaceAll('\\','/'));
 if(mode==='baseline'){
  fs.writeFileSync(snapFile,JSON.stringify(await snapshot(),null,2));
  await reject('before slip context column absent',()=>runtime(tx=>tx`select deposit_status from local_service.get_line_notification_delivery_context(p_id=>null,p_attempt_count=>0)`),/does not exist/);
  await reject('before alert RPC named args unavailable',()=>runtime(tx=>tx`select * from local_service.claim_due_shop_email_notifications(p_alert_kind=>'quota_unreadable',p_alert_key=>'quota_unreadable:2030-01-01',p_delivered=>false)`),/does not exist/);
 }else if(mode==='rollback'){
  const before=JSON.parse(fs.readFileSync(snapFile)),after=await snapshot(),diffs=[];
  for(const key of Object.keys(before))if(JSON.stringify(before[key])!==JSON.stringify(after[key])){diffs.push(key);fs.writeFileSync(path.join(dir,'followup-rollback-'+key+'.json'),JSON.stringify({before:before[key],after:after[key]},null,2));}
  record('follow-up raw catalog rollback diff=e0800ee zero',diffs.length===0,JSON.stringify(diffs));
 }else{
  const before=JSON.parse(fs.readFileSync(snapFile)),after=await snapshot();
  const context='local_service.get_line_notification_delivery_context(uuid,integer)',old=before.functions.find(x=>x.identity===context),current=after.functions.find(x=>x.identity===context);
  record('context owner and EXECUTE ACL unchanged',old.owner===current.owner&&old.acl===current.acl);
  const changed=after.functions.filter(x=>{const b=before.functions.find(y=>y.identity===x.identity);return b&&(b.owner!==x.owner||b.acl!==x.acl);});record('all surviving function owner/ACL unchanged on follow-up',changed.length===0);
  record('single email catalog identity no overload',after.functions.filter(x=>x.identity.startsWith('local_service.claim_due_shop_email_notifications(')).length===1);
  const [t]=await mig(tx=>tx`select relrowsecurity,relforcerowsecurity from pg_class where oid='local_service.ops_alert_delivery_ledger'::regclass`);record('OPS ledger FORCE RLS',t.relrowsecurity&&t.relforcerowsecurity);
  for(const [db,r] of [[an,'anon'],[au,'authenticated'],[rt,'bk01_runtime']]){
   await reject(r+' direct OPS ledger SELECT denied',()=>role(db,r,tx=>tx`select * from local_service.ops_alert_delivery_ledger`),/permission denied/);
   await reject(r+' direct OPS ledger INSERT denied',()=>role(db,r,tx=>tx`insert into local_service.ops_alert_delivery_ledger(kind,dedupe_key,thai_day,claimed_at,lease_until) values('quota_unreadable','x',current_date,now(),now())`),/permission denied/);
  }
  for(const [db,r] of [[an,'anon'],[au,'authenticated']])await reject(r+' alert RPC denied',()=>role(db,r,tx=>tx`select * from local_service.claim_due_shop_email_notifications(p_limit=>25)`),/permission denied/);
  await reject('unknown alert kind enum rejected',()=>alert('invented','x'),/invalid input value for enum/);
  await reject('partial alert input rejected',()=>runtime(tx=>tx`select * from local_service.claim_due_shop_email_notifications(p_alert_kind=>'quota_unreadable')`),/must be supplied together/);
  const [day]=await mig(tx=>tx`select (now() at time zone 'Asia/Bangkok')::date::text d`);const key='quota_unreadable:'+day.d;
  await reject('stale date key rejected',()=>alert('quota_unreadable','quota_unreadable:2000-01-01'),/Invalid current Thai day/);
  await reject('kind and key prefix mismatch rejected',()=>alert('breaker_open',key),/Invalid current Thai day/);
  await reject('delivery acknowledgement without claim rejected',()=>alert('quota_unreadable',key,true),/claimed before/);
  const race=await Promise.all([alert('quota_unreadable',key),alert('quota_unreadable',key)]);record('concurrent alert claim one winner',race.flat().filter(x=>x.alert_claimed).length===1);
  record('alert response contains no shop/customer/email payload',race.flat().every(x=>x.notification_id===null&&x.shop_id===null&&x.email===null&&x.attempt_count===null&&x.pending_slip_count===null&&!('customer_name' in x)&&x.event_type==='ops_alert'));
  const repeat=await alert('quota_unreadable',key);record('active lease blocks repeat',repeat[0].alert_claimed===false);
  await mig(tx=>tx`update local_service.ops_alert_delivery_ledger set lease_until=now()-interval '1 second' where dedupe_key=${key}`);
  record('undelivered expired lease permits retry',(await alert('quota_unreadable',key))[0].alert_claimed===true);
  const ack=await alert('quota_unreadable',key,true);record('successful delivery acknowledgement never claims',ack[0].alert_delivered===true&&ack[0].alert_claimed===false);
  await mig(tx=>tx`update local_service.ops_alert_delivery_ledger set lease_until=now()-interval '1 second' where dedupe_key=${key}`);
  record('delivered key cannot reclaim after lease expiry',(await alert('quota_unreadable',key))[0].alert_claimed===false);
  record('repeat acknowledgement idempotent',(await alert('quota_unreadable',key,true))[0].alert_delivered===true);
  await patch(def=>def.replace('v_alert.delivered_at IS NULL AND v_alert.lease_until<=now()','v_alert.lease_until<=now()'),async()=>{
   record('delivered guard mutation turns dedupe expectation red',(await alert('quota_unreadable',key))[0].alert_claimed===true);
  });
  const cap='push_cap_unverified:90000000-0000-4000-8000-000000000010:'+day.d;
  record('cap enum canonical shop key accepted',(await alert('cap_unverified',cap))[0].alert_claimed===true);
  record('breaker enum canonical global key accepted',(await alert('breaker_open','breaker_open:'+day.d))[0].alert_claimed===true);
  await patch(def=>def.replace(/now\(\)/g,"timestamptz '2035-01-02 22:30:00+07'"),async()=>{
   record('OPS alert bypasses shop quiet window',(await alert('quota_unreadable','quota_unreadable:2035-01-02'))[0].alert_claimed===true);
   record('Thai date comes from SQL not UTC',(await alert('breaker_open','breaker_open:2035-01-02'))[0].alert_claimed===true);
   record('next Thai day has independent key',(await alert('cap_unverified','push_cap_unverified:-:2035-01-02'))[0].alert_claimed===true);
  });
  const [b]=await mig(tx=>tx`select id,deposit_status from local_service.bookings where shop_id='90000000-0000-4000-8000-000000000010' order by id limit 1`);const log=crypto.randomUUID();
  await mig(tx=>tx`insert into local_service.line_notification_logs(id,shop_id,booking_id,event_type,recipient_type,status,attempt_count,scheduled_for,idempotency_key) values(${log},'90000000-0000-4000-8000-000000000010',${b.id},'deposit_slip_decision','customer','pending',1,now(),${'followup:'+log})`);
  for(const deposit of ['verified','rejected']){await mig(tx=>tx`update local_service.bookings set deposit_status=${deposit} where id=${b.id}`);const rows=await runtime(tx=>tx`select event_type,deposit_status from local_service.get_line_notification_delivery_context(p_id=>${log},p_attempt_count=>1)`);record('slip decision context '+deposit,rows.length===1&&rows[0].event_type==='deposit_slip_decision'&&rows[0].deposit_status===deposit);}
  await mig(tx=>tx`update local_service.bookings set deposit_status=${b.deposit_status} where id=${b.id}`);
 }
}finally{fs.writeFileSync(path.join(dir,'followup-'+mode+'-results.json'),JSON.stringify(results,null,2));await Promise.all([op,adm,rt,an,au].map(x=>x.end()));}
