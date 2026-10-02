import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import postgres from 'postgres';
import {chromium} from 'playwright';
import {build} from 'esbuild';
import {validateBk01RuntimeEffectiveExecuteSet} from '../lib/bk01-runtime-allowlist.mjs';
const env=process.env,dir=env.RC_EVIDENCE;
if(env.BK01_SHARED_RUNTIME_ENV!=='local'||!dir||new URL(env.BK01_P0_LOCAL_URL).hostname!=='127.0.0.1')throw Error('local-only');
const urls={gateway:`http://127.0.0.1:${env.RC_GATEWAY_PORT}`,consumer:`http://127.0.0.1:${env.RC_CONSUMER_PORT}`,admin:`http://127.0.0.1:${env.RC_ADMIN_PORT}`};
const db=postgres(`postgresql://fixture_admin@127.0.0.1:${env.RC_PG_PORT}/postgres`,{max:2,prepare:false,onnotice:()=>{}});
const results=[];
const check=async(name,layer,fn)=>{try{const detail=await fn();results.push({name,layer,status:'PASS',detail:detail??''});console.log(`PASS ${name}`);return true;}catch(e){results.push({name,layer,status:'FAIL',detail:e.message});console.log(`FAIL ${name}: ${e.message}`);return false;}};
const skip=(name,why)=>results.push({name,layer:'unmeasured',status:'SKIP',detail:why});
const shop='90000000-0000-4000-8000-000000000010',service='90000000-0000-4000-8000-000000000011',staff='90000000-0000-4000-8000-000000000012';
async function ready(url){const end=Date.now()+120000;while(Date.now()<end){try{const r=await fetch(url,{signal:AbortSignal.timeout(3000)});if(r.ok)return;}catch{}await new Promise(r=>setTimeout(r,500));}throw Error(`not ready: ${new URL(url).pathname}`);}
async function rpc(name,args,token=env.RC_RUNTIME_TOKEN,allowError=false){const r=await fetch(`${urls.gateway}/rest/v1/rpc/${name}`,{method:'POST',headers:{'Content-Type':'application/json','Content-Profile':'local_service',Authorization:`Bearer ${token}`},body:JSON.stringify(args)});const body=await r.json();if(!r.ok&&!allowError)throw Error(`${name}: ${body.code} ${body.message}`);return {status:r.status,body};}
let serial=0;
async function hold(phone){serial++;const day=new Date(Date.now()+(130+serial)*86400000).toISOString().slice(0,10);const r=await fetch(`${urls.consumer}/api/bookings/hold`,{method:'POST',signal:AbortSignal.timeout(20000),headers:{'Content-Type':'application/json','CF-Connecting-IP':`192.0.2.${serial}`},body:JSON.stringify({shop_id:shop,service_id:service,staff_id:staff,customer_name:'RC customer',customer_phone:phone??`086${String(serial).padStart(7,'0')}`,booking_date:day,start_time:'10:00',turnstileToken:'XXXX.DUMMY.TOKEN.XXXX'})});const body=await r.json();if(!r.ok)throw Error(`hold HTTP ${r.status}: ${body.error}`);assert.ok(body.hold?.booking_id);return body.hold;}
async function state(b){return (await db`select status,deposit_status,refund_reference,customer_id from local_service.bookings where id=${b.booking_id}::uuid`)[0];}
async function upload(b){const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6VEAAAAAASUVORK5CYII=','base64');
  const r=await fetch(`${urls.consumer}/api/deposit-slips/upload-intent`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({bookingId:b.booking_id,recoveryToken:b.link_token,contentType:'image/png',size:bytes.length})});const intent=await r.json();if(!r.ok)throw Error(`upload intent HTTP ${r.status}: ${intent.error}`);assert.ok(intent.token);
  const out=await fetch(`${urls.gateway}/storage/v1/object/upload/sign/deposit-slips/${intent.objectPath}?token=${intent.token}`,{method:'PUT',headers:{'Content-Type':'image/png'},body:bytes});if(!out.ok)throw Error(`storage fixture ${out.status}: ${(await out.json()).error}`);
  await rpc('submit_deposit_slip',{p_booking_id:b.booking_id,p_recovery_token:b.link_token,p_slip_url:intent.objectPath,p_trans_ref:`RC-${serial}`},env.RC_ANON_TOKEN);
  assert.equal((await state(b)).deposit_status,'submitted');return intent.objectPath;
}
let browser,adminPage,servicePage,adminReady=false,appAdmin;
const msg=JSON.parse(fs.readFileSync('apps/booking-admin/messages/th.json','utf8')).dashboard;
try {
 await ready(`${urls.gateway}/health`);await ready(`${urls.gateway}/rest/v1/shop_public_profile?select=id`);await ready(`${urls.consumer}/book/p0-proof`);await ready(`${urls.admin}/login`);
 browser=await chromium.launch({headless:true,...(env.RC_CHROMIUM?{executablePath:env.RC_CHROMIUM}:{})});
 const ctx=await browser.newContext();ctx.setDefaultTimeout(20000);ctx.setDefaultNavigationTimeout(45000);const page=await ctx.newPage();
 const alertShops=[crypto.randomUUID(),crypto.randomUUID()];
 for(const [i,id] of alertShops.entries())await db`insert into local_service.shops(id,name,slug,phone) values(${id}::uuid,${'RC alert '+i},${'rc-alert-'+i},'0812345678')`;
 await check('W-1 PG17 UTC, operator/runtime non-superuser','catalog',async()=>{
  const [row]=await db`select current_setting('server_version_num') v,current_setting('timezone') tz,current_setting('data_directory') data`;
  assert.equal(row.v,'170011');assert.equal(row.tz,'UTC');assert.equal(path.resolve(row.data),path.resolve(env.BK01_P0_DATA_DIR));
  const roles=await db`select rolname,rolsuper from pg_roles where rolname in ('operator','bk01_migrator','bk01_runtime','authenticator')`;assert.equal(roles.length,4);assert.ok(roles.every(x=>!x.rolsuper));return 'PG17.11 / UTC / all four roles NOSUPERUSER';
 });
 await check('Every seeded slug /book/[slug] + exact public projection','browser+PostgREST',async()=>{
  const slugs=await db`select slug,name from local_service.shops order by slug`;assert.ok(slugs.length>0);
  const failures=[];page.on('response',r=>{if(r.url().includes('/rest/v1/')&&r.status()>=400)failures.push({status:r.status(),path:new URL(r.url()).pathname});});
  const columns='id,name,slug,phone,address,promptpay_number,promptpay_name,require_deposit,is_accepting_online_bookings';
  for(const {slug,name} of slugs){const r=await fetch(`${urls.gateway}/rest/v1/shop_public_profile?select=${columns}&slug=eq.${slug}`,{headers:{Authorization:`Bearer ${env.RC_ANON_TOKEN}`,'Accept-Profile':'local_service'}});assert.equal(r.status,200);assert.equal((await r.json()).length,1);
    await page.goto(`${urls.consumer}/book/${slug}`);await page.waitForResponse(r=>r.url().includes('staff_schedules')&&r.status()===200,{timeout:30000}).catch(()=>{});
    await page.waitForFunction(()=>!document.body.innerText.includes('กำลังโหลด'),{timeout:30000});assert.equal(await page.getByText('โหลดหน้าจองไม่สำเร็จ',{exact:true}).count(),0);
    await page.locator('header h1').waitFor();assert.equal(await page.locator('header h1').textContent(),name,`Expected shop ${slug}`);}
  assert.deepEqual(failures,[]);return `${slugs.length} slugs; exact 10-column select against actual view`;
 });
 await check('Admin app service session + real dashboard/RLS projection','app-service+PostgREST',async()=>{
  // Run the real browser module in a browser. No replacement Supabase client,
  // no mocked RPC results, and no app source edits to bypass the dashboard defect.
  const bundled=await build({stdin:{contents:"import * as admin from './apps/booking-admin/src/lib/admin-service.ts'; import {supabase} from './apps/booking-admin/src/lib/supabase.ts'; window.rcAdmin={...admin,supabase};",resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'browser',format:'iife',write:false,
    define:{'process.env.NEXT_PUBLIC_SUPABASE_URL':JSON.stringify(urls.gateway),'process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY':JSON.stringify(env.RC_ANON_TOKEN)},logLevel:'silent'});
  servicePage=await ctx.newPage();await servicePage.goto(`${urls.admin}/login`);await servicePage.addScriptTag({content:bundled.outputFiles[0].text});
  const error=await servicePage.evaluate(async()=>{const {error}=await window.rcAdmin.supabase.auth.signInWithPassword({email:'owner@example.test',password:'fixture-only'});return error?.message??null;});assert.equal(error,null);
  appAdmin=new Proxy({},{get:(_,name)=>(...args)=>servicePage.evaluate(async({name,args})=>window.rcAdmin[name](...args),{name,args})});
  const data=await appAdmin.fetchAdminDashboardData();assert.ok(data.bookings);return 'Actual pinned admin-service.ts, local Auth fixture, real authenticated RLS data';
 });
 adminReady=await check('Admin browser dashboard loads','browser+PostgREST',async()=>{
  adminPage=await ctx.newPage();adminPage.on('pageerror',error=>fs.appendFileSync(path.join(dir,'admin-page-errors.log'),error.message+'\n'));await adminPage.goto(`${urls.admin}/login`);await adminPage.locator('input[type=email]').fill('owner@example.test');await adminPage.locator('input[type=password]').fill('fixture-only');
  await adminPage.locator('button[type=submit],form button').click();await adminPage.waitForURL('**/dashboard',{timeout:45000});await adminPage.getByText('P0 Shop',{exact:true}).first().waitFor({timeout:45000});return 'Local Auth fixture; real authenticated RLS/data';
 });
 let approved,rejected,cancelled;
 if(!adminReady)skip('Admin DOM approve/reject/refund/outcome buttons','Dashboard failed; service/DB flow measured independently. Do not count DOM as PASS.');
 await check('Hold server route → upload bytes → submit → approve','HTTP+app-service+DB',async()=>{
  approved=await hold();await upload(approved);
  if(adminReady){await adminPage.reload();const row=adminPage.locator('tr').filter({hasText:approved.booking_code});await row.getByRole('button',{name:msg.viewSlip,exact:true}).click();await adminPage.getByRole('button',{name:msg.approveConfirm,exact:true}).click();}
  else await appAdmin.approveBookingDeposit(approved.booking_id);
  await poll(async()=>assert.equal((await state(approved)).status,'confirmed'));return `Actual hold route (official Turnstile test key), DB grant trigger, approve via ${adminReady?'UI':'actual admin service; DOM skipped'}`;
 });
 await check('Reject slip → cancel → refund reference required → append-only event','HTTP+app-service+DB',async()=>{
  rejected=await hold();await upload(rejected);
  if(adminReady){await adminPage.reload();const row=adminPage.locator('tr').filter({hasText:rejected.booking_code});await row.getByRole('button',{name:msg.viewSlip,exact:true}).click();await adminPage.getByRole('button',{name:msg.rejectSlip,exact:true}).click();}
  else await appAdmin.rejectBookingDeposit(rejected.booking_id,'RC rejected slip');
  await poll(async()=>assert.equal((await state(rejected)).deposit_status,'rejected'));
  const noRef=await rpc('record_deposit_refund',{p_booking_id:rejected.booking_id,p_refund_reference:'',p_note:null},env.RC_OWNER_TOKEN,true);assert.equal(noRef.body.code,'22023');
  await appAdmin.cancelBooking(rejected.booking_id,'release rejected queue for refund');
  if(adminReady){await adminPage.reload();const row=adminPage.locator('tr').filter({hasText:rejected.booking_code});await row.getByRole('button',{name:msg.refundAction,exact:true}).click();assert.equal(await adminPage.getByRole('button',{name:msg.refundConfirm,exact:true}).isEnabled(),false);await adminPage.locator('#refund-reference').fill('RC-REFUND-REFERENCE');await adminPage.getByRole('button',{name:msg.refundConfirm,exact:true}).click();}
  else {await assert.rejects(()=>appAdmin.recordBookingDepositRefund(rejected.booking_id,''),/Refund reference/);await appAdmin.recordBookingDepositRefund(rejected.booking_id,'RC-REFUND-REFERENCE');}
  await poll(async()=>assert.equal((await state(rejected)).deposit_status,'refunded'));
  const events=await db`select event_type,reference from local_service.deposit_money_events where booking_id=${rejected.booking_id}::uuid and event_type='refund_recorded'`;assert.equal(events.length,1);assert.equal(events[0].reference,'RC-REFUND-REFERENCE');return `Rejected money remains refund-eligible after queue release; blank ref rejected in DB/app service; DOM ${adminReady?'tested':'skipped'}`;
 });
 await check('Customer cancel + owner/admin vs staff authorization','HTTP+DB',async()=>{
  cancelled=await hold();const bad=await rpc('customer_cancel_booking',{p_booking_id:cancelled.booking_id,p_recovery_token:'wrong',p_reason:'customer cancel'},env.RC_ANON_TOKEN,true);assert.ok(bad.status>=400||bad.body?.ok===false);
  await rpc('customer_cancel_booking',{p_booking_id:cancelled.booking_id,p_recovery_token:cancelled.link_token,p_reason:'customer cancel'},env.RC_ANON_TOKEN);assert.equal((await state(cancelled)).status,'cancelled');
  const b=await hold();const denied=await rpc('cancel_booking',{p_booking_id:b.booking_id,p_reason:'staff forbidden'},env.RC_STAFF_TOKEN,true);assert.equal(denied.body.code,'42501');
  await rpc('cancel_booking',{p_booking_id:b.booking_id,p_reason:'owner allowed'},env.RC_OWNER_TOKEN);assert.equal((await state(b)).status,'cancelled');
  const adminB=await hold();await rpc('cancel_booking',{p_booking_id:adminB.booking_id,p_reason:'admin allowed'},env.RC_ADMIN_TOKEN);assert.equal((await state(adminB)).status,'cancelled');return 'Customer token, owner and admin pass; staff denied';
 });
 await check('G09 >5 wrong tokens, valid always passes, 20/24h budget','HTTP+DB',async()=>{
  const b=await hold();for(let i=0;i<8;i++)assert.equal((await rpc('authorize_booking_recovery_attempt',{p_booking_id:b.booking_id,p_recovery_token:'wrong'})).body,false);
  const [before]=await db`select failed_attempts,blocked_until from local_service.booking_recovery_attempts where booking_id=${b.booking_id}::uuid`;assert.equal(before.failed_attempts,6);assert.ok(before.blocked_until);
  assert.equal((await rpc('authorize_booking_recovery_attempt',{p_booking_id:b.booking_id,p_recovery_token:b.link_token})).body,true);
  const calls=await Promise.all(Array.from({length:24},()=>rpc('authorize_deposit_slip_upload',{p_booking_id:b.booking_id,p_recovery_token:b.link_token,p_content_type:'image/png',p_size_bytes:68},env.RC_RUNTIME_TOKEN,true)));
  assert.equal(calls.filter(x=>x.status===200).length,20);assert.equal(calls.filter(x=>x.body.code==='P0001'&&x.body.message==='UPLOAD_INTENT_LIMIT').length,4);
  const [after]=await db`select failed_attempts from local_service.booking_recovery_attempts where booking_id=${b.booking_id}::uuid`;assert.equal(after.failed_attempts,before.failed_attempts);return '8 bad → counter 6; correct token true; concurrent accepted 20/rejected 4; failed evidence retained';
 });
 await check('G09 intent-limit app error copy','actual route',async()=>{
  const b=await hold();await Promise.all(Array.from({length:20},()=>rpc('authorize_deposit_slip_upload',{p_booking_id:b.booking_id,p_recovery_token:b.link_token,p_content_type:'image/png',p_size_bytes:68})));
  const r=await fetch(`${urls.consumer}/api/deposit-slips/upload-intent`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({bookingId:b.booking_id,recoveryToken:b.link_token,contentType:'image/png',size:68})});const body=await r.json();
  assert.ok(JSON.stringify(body).includes('ติดต่อร้าน'),`Expected ติดต่อร้าน; HTTP ${r.status}, body=${JSON.stringify(body)}`);
 });
 await check('G10 shared phone cannot rebind; recipient matches booking','HTTP+DB',async()=>{
  const a=await hold('0898000001'),b=await hold('0898000001'),line='U'+'a'.repeat(32),other='U'+'b'.repeat(32);
  await db`update local_service.shops set line_oa_id=null where id=${shop}::uuid`;
  const bind=(x,event,id)=>rpc('bk01_line_bind_booking_trial',{p_webhook_event_id:event,p_booking_code:x.booking_code,p_link_token:x.link_token,p_line_user_id:id});
  assert.equal((await bind(a,'RC-bind-a',line)).body[0].claimed,true);assert.equal((await bind(b,'RC-bind-b',other)).body[0].claimed,false);
  const id=crypto.randomUUID();await db`insert into local_service.line_notification_logs(id,shop_id,booking_id,event_type,recipient_type,status,attempt_count,scheduled_for,idempotency_key) values(${id}::uuid,${shop}::uuid,${a.booking_id}::uuid,'booking_created','customer','pending',1,now(),${'RC:'+id})`;
  const context=(await rpc('get_line_notification_delivery_context',{p_id:id,p_attempt_count:1})).body;assert.equal(context.length,1);assert.equal(context[0].booking_id,a.booking_id);assert.equal(context[0].line_user_id,line);return 'No silent rebind; real delivery-context RPC returns booking-bound recipient';
 });
 await check('G10 actual webhook signature → bind → fake reply → DB finish','app-handler+HTTP+DB',async()=>{
  const b=await hold();const {handleLineWebhook}=await import('../../apps/booking-consumer/src/lib/line-webhook.ts');
  const {resolveLineChannelConfig}=await import('../../apps/booking-consumer/src/lib/line-channel-config.ts');
  const {createClient}=await import('@supabase/supabase-js');const runtime=createClient(urls.gateway,env.RC_ANON_TOKEN,{db:{schema:'local_service'},auth:{autoRefreshToken:false,persistSession:false},global:{headers:{Authorization:`Bearer ${env.RC_RUNTIME_TOKEN}`}}});
  const channelSecret=crypto.randomBytes(32).toString('hex');const config=resolveLineChannelConfig({mode:'trial',centralSecret:channelSecret,centralAccessToken:'local-fixture-never-sent'});
  const eventId='RC-webhook-'+crypto.randomUUID();const line='U'+'c'.repeat(32);
  const raw=JSON.stringify({events:[{type:'message',webhookEventId:eventId,replyToken:'fixture',message:{type:'text',text:`ผูกคิว ${b.booking_code} ${b.link_token}`},source:{userId:line}}]});
  let acquired=0,sends=0;const provider=async()=>{acquired++;return runtime;};const transport=async()=>{sends++;return new Response('{}',{status:200,headers:{'Content-Type':'application/json'}});};
  const bad=await handleLineWebhook(new Request('http://localhost/webhook',{method:'POST',body:raw,headers:{'x-line-signature':'bad'}}),config,undefined,provider,transport);assert.equal(bad.status,401);assert.equal(acquired,0);
  const signature=crypto.createHmac('sha256',channelSecret).update(raw).digest('base64');const good=await handleLineWebhook(new Request('http://localhost/webhook',{method:'POST',body:raw,headers:{'x-line-signature':signature}}),config,undefined,provider,transport);
  assert.equal(good.status,200);const result=await good.json();assert.equal(result.success,true);assert.equal(sends,1);assert.equal(acquired,1);
  const [customer]=await db`select c.line_user_id from local_service.customers c join local_service.bookings b on b.customer_id=c.id where b.id=${b.booking_id}::uuid`;assert.equal(customer.line_user_id,line);return 'Unchanged app handler; invalid signature before runtime; valid signed event binds and finishes via real RPCs; LINE transport fake';
 });
 await check('Alert app claim → fake send → ack + dedupe/failure','app+HTTP+DB',async()=>{
  const {createPushAlertSink,sendOpsAlert,bangkokDayKey}=await import('../../apps/booking-consumer/src/lib/notification-oa-breaker.ts');
  const calls=[];const sink=createPushAlertSink({rpc:async(name,args)=>{calls.push(args.p_delivered?'ack':'claim');const r=await rpc(name,args,env.RC_RUNTIME_TOKEN,true);return r.status===200?{data:r.body,error:null}:{data:null,error:r.body};}});
  const day=bangkokDayKey(new Date());const input={env:{OPS_ALERT_EMAIL:'ops@example.test'},subject:'fixture',text:'fixture',sink,kind:'cap_unverified',dedupeKey:`push_cap_unverified:${alertShops[0]}:${day}`,transport:{send:async()=>{calls.push('send');return {ok:true,status:200};}}};
  assert.equal((await sendOpsAlert(input)).sent,true);assert.deepEqual(calls,['claim','send','ack']);assert.equal((await sendOpsAlert(input)).sent,false);assert.equal(calls.filter(x=>x==='send').length,1);
  const failedCalls=[];const failedSink=createPushAlertSink({rpc:async(n,a)=>{failedCalls.push(a.p_delivered?'ack':'claim');const r=await rpc(n,a);return {data:r.body,error:null};}});
  const failed={...input,sink:failedSink,dedupeKey:`push_cap_unverified:${alertShops[1]}:${day}`,transport:{send:async()=>{failedCalls.push('send');return {ok:false,status:503};}}};
  assert.equal((await sendOpsAlert(failed)).sent,false);assert.deepEqual(failedCalls,['claim','send']);return 'App sends only after DB claim; acknowledges successful fake send; failed send no ack';
 });
 await check('Outcome completed/no-show opens at appointment START','app-gate+HTTP+DB',async()=>{
  const {canOfferOutcomeActions}=await import('../../apps/booking-admin/src/lib/booking-outcome-gate.ts');
  for(const outcome of ['completed','no_show']){
   const b=await hold();await upload(b);await rpc('approve_booking_deposit',{p_booking_id:b.booking_id},env.RC_OWNER_TOKEN);
   const early=await rpc('set_booking_outcome',{p_booking_id:b.booking_id,p_outcome:outcome},env.RC_OWNER_TOKEN,true);assert.ok(early.status>=400);
   const before=await appAdmin.fetchAdminDashboardData();assert.equal(canOfferOutcomeActions(before.bookings.find(x=>x.id===b.booking_id)),false);
   await db`update local_service.bookings set staff_id=null,start_timestamptz=now()-interval '1 minute',end_timestamptz=now()+interval '29 minutes' where id=${b.booking_id}::uuid`;
   const data=await appAdmin.fetchAdminDashboardData();const mapped=data.bookings.find(x=>x.id===b.booking_id);assert.ok(mapped);assert.equal(canOfferOutcomeActions(mapped),true);
   if(adminReady){await adminPage.reload();const row=adminPage.locator('tr').filter({hasText:b.booking_code});const label=outcome==='completed'?msg.markCompleted:msg.markNoShow;await row.getByRole('button',{name:label,exact:true}).click();}else await appAdmin.setBookingOutcome(b.booking_id,outcome);
   await poll(async()=>assert.equal((await state(b)).status,outcome));
  }return `Future denied; start ≤ now < end: app gate + both SQL outcomes succeed; DOM ${adminReady?'tested':'skipped'}`;
 });
 await check('Runtime exact allowlist 21; ACL anon14/auth54/runtime21','catalog',async()=>{
  const expected=JSON.parse(fs.readFileSync('supabase/shared-runtime/bk01-p0-app-execute-allowlist.json','utf8'));
  const counts={};for(const role of ['anon','authenticated','bk01_runtime']){const rows=await db`select p.oid::regprocedure::text identity from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='local_service' and has_function_privilege(${role},p.oid,'EXECUTE') order by 1`;counts[role]=rows.length;
    if(role==='bk01_runtime')validateBk01RuntimeEffectiveExecuteSet(rows.map(x=>x.identity));else assert.deepEqual(rows.map(x=>x.identity),expected[role]);}assert.deepEqual(counts,{anon:14,authenticated:54,bk01_runtime:21});return JSON.stringify(counts);
 });
 skip('Hosted Auth confirmation, real LINE/Resend/Storage/Turnstile hostname','Offline scope: local Auth/Storage/issuer fixtures; Turnstile official test key; fake alert transport; no LAB/provider production credentials');
 skip('LAB preflight / apply / production / merge','Explicitly prohibited; SELECT-only preflight prepared separately and not invoked');
}catch(error){results.push({name:'E2E infrastructure',layer:'harness',status:'FAIL',detail:error.message});}
finally{if(servicePage)await servicePage.evaluate(()=>window.rcAdmin?.supabase.auth.signOut({scope:'local'})).catch(()=>{});if(browser)await browser.close();await db.end();fs.writeFileSync(path.join(dir,'e2e-results.json'),JSON.stringify(results,null,2));
 const md=['| Case | Layer | Result | Evidence / reason |','|---|---|---|---|',...results.map(x=>`| ${x.name} | ${x.layer} | ${x.status} | ${String(x.detail).replaceAll('|','/').replaceAll('\n',' ')} |`)];fs.writeFileSync(path.join(dir,'e2e-results.md'),md.join('\n')+'\n');}
// Keep independent offline restore work running even when a candidate defect is red.
console.log(JSON.stringify({pass:results.filter(x=>x.status==='PASS').length,fail:results.filter(x=>x.status==='FAIL').length,skip:results.filter(x=>x.status==='SKIP').length}));
async function poll(fn){let error;for(let i=0;i<30;i++){try{return await fn();}catch(e){error=e;}await new Promise(r=>setTimeout(r,250));}throw error;}
