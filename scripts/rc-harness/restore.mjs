// Disposable local dump/restore drill. This is not a G33 purge implementation.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import postgres from 'postgres';
const env=process.env,dir=path.join(env.RC_EVIDENCE,'restore');
if(env.BK01_SHARED_RUNTIME_ENV!=='local'||new URL(env.BK01_P0_LOCAL_URL).hostname!=='127.0.0.1')throw Error('local-only restore guard');
fs.mkdirSync(dir,{recursive:true});
const connect=name=>postgres(`postgresql://fixture_admin@127.0.0.1:${env.RC_PG_PORT}/${name}`,{max:1,prepare:false,onnotice:()=>{}});
const source=connect('postgres');let target;
const run=(exe,args)=>execFileSync(path.join(env.RC_PGBIN,`${exe}.exe`),['-h','127.0.0.1','-p',env.RC_PG_PORT,'-U','fixture_admin',...args],{encoding:'utf8',windowsHide:true,env:{...env,PGOPTIONS:'-c search_path=public,extensions'}});
const fingerprint=async db=>{
 const tables=await db`select n.nspname schema,c.relname name from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('local_service','local_service_internal','auth','storage','wstera_platform_internal') and c.relkind in ('r','p') order by 1,2`;
 const rows=[];for(const t of tables){const [r]=await db.unsafe(`select count(*)::text count,md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' order by to_jsonb(t)::text),'')) hash from "${t.schema}"."${t.name}" t`);rows.push({...t,...r});}
 const constraints=await db`select n.nspname schema,c.relname relation,k.conname,pg_get_constraintdef(k.oid) definition,k.convalidated from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('local_service','local_service_internal','auth','storage','wstera_platform_internal') order by 1,2,3`;
 const columns=await db`select table_schema,table_name,column_name,data_type,is_nullable,column_default,ordinal_position from information_schema.columns where table_schema in ('local_service','local_service_internal','auth','storage','wstera_platform_internal') order by 1,2,7`;
 const functions=await db`select n.nspname schema,p.proname,p.oid::regprocedure::text identity,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('local_service','local_service_internal','auth','wstera_platform_internal') order by 1,3`;
 const triggers=await db`select n.nspname schema,c.relname relation,t.tgname,pg_get_triggerdef(t.oid) definition from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname in ('local_service','local_service_internal','storage') order by 1,2,3`;
 return {rows,constraints,columns,functions,triggers};
};
// PostgreSQL dump deparses varchar-array::text[] as element-wise text casts on
// reparse. Only this exact constant-array equivalence is normalized; raw diffs
// remain evidence and every other schema/data difference still fails the drill.
const canonicalConstraint=definition=>definition.replace(/ARRAY\[((?:\('[^']*'::character varying\)::text)(?:, \('[^']*'::character varying\)::text)*)\]/g,
  (_,items)=>`(ARRAY[${items.replace(/\('([^']*)'::character varying\)::text/g,"'$1'::character varying")}])::text[]`);
function compare(expected,actual){
 const rawConstraintDiff=actual.constraints.filter((x,i)=>x.definition!==expected.constraints[i]?.definition);
 const canonical=x=>({...x,constraints:x.constraints.map(c=>({...c,definition:canonicalConstraint(c.definition)}))});
 assert.deepEqual(canonical(actual),canonical(expected));return {rawConstraintDiff,canonicalDiff:[]};
}
export async function replayDeletionLog(db,records) {
 if(!Array.isArray(records)||records.length===0)throw Error('DELETION_LOG_INVALID: nonempty approved log required');
 const seen=new Set();let previous=-Infinity;
 for(const r of records){if(!r||r.version!==1||r.action!=='anonymize_customer'||r.legalHold!==false||r.authority!=='local-drill-only'
   ||!/^\d{4}-\d\d-\d\dT.*Z$/.test(r.at)||!Number.isFinite(Date.parse(r.at))||Date.parse(r.at)<=previous
   ||!/^[-a-f0-9]{36}$/.test(r.customerId)||!/^[-a-f0-9]{36}$/.test(r.shopId)||seen.has(r.eventId))throw Error('DELETION_LOG_INVALID: unsupported, unapproved, held or unordered record');
  previous=Date.parse(r.at);seen.add(r.eventId);
 }
  return db.begin(async tx=>{let count=0;for(const r of records){const rows=await tx`update local_service.customers set name='[deleted]',phone=${'del:'+crypto.createHash('sha256').update(r.customerId).digest('hex').slice(0,16)},email=null,line_user_id=null where id=${r.customerId}::uuid and shop_id=${r.shopId}::uuid returning id`;assert.equal(rows.length,1,'missing deletion target');count++;}return {replayed:count};});
}
const result={status:'FAIL',limitations:['Archive uses --no-owner --no-acl; owner/ACL reconstruction is a separate GO gate, not proven by this portable restore.',
 'Deletion replay is a local customer-anonymization drill only. Production G33 tombstone store, Legal Hold, and booking/financial retention workflow do not exist and remain HOLD.']};
try {
 const [guard]=await source`select current_setting('data_directory') data`;assert.equal(path.resolve(guard.data),path.resolve(env.BK01_P0_DATA_DIR));
 const before=await fingerprint(source);fs.writeFileSync(path.join(dir,'before.json'),JSON.stringify(before,null,2));
 const dump=path.join(dir,'backup.dump');run('pg_dump',['-d','postgres','--format=custom','--no-owner','--no-acl','-f',dump]);
 result.dumpSha256=crypto.createHash('sha256').update(fs.readFileSync(dump)).digest('hex');
 const name=`rc_restore_${crypto.randomBytes(5).toString('hex')}`;await source.unsafe(`CREATE DATABASE ${name} OWNER operator TEMPLATE template0`);
 const restoreArgs=['-h','127.0.0.1','-p',env.RC_PG_PORT,'-U','operator','-d',name,'--no-owner','--no-acl','--exit-on-error',dump];
 execFileSync(path.join(env.RC_PGBIN,'pg_restore.exe'),restoreArgs,{windowsHide:true,encoding:'utf8',env:{...env,PGOPTIONS:'-c search_path=public,extensions'}});
 target=connect(name);const restored=await fingerprint(target);result.restoreComparison=compare(before,restored);
 fs.writeFileSync(path.join(dir,'restored.json'),JSON.stringify(restored,null,2));
 const smoke=postgres(`postgresql://operator@127.0.0.1:${env.RC_PG_PORT}/${name}`,{max:1,prepare:false});
 try{const [posture]=await smoke`select rolsuper from pg_roles where rolname=current_user`;assert.equal(posture.rolsuper,false);
  const profile=await smoke`select id,name,slug,phone,address,promptpay_number,promptpay_name,require_deposit,is_accepting_online_bookings from local_service.shop_public_profile where slug='p0-proof'`;assert.equal(profile.length,1);
  const ledger=await smoke`select count(*)::integer n from local_service_internal.schema_migrations`;const expectedLedger=Number(env.RC_EXPECTED_LEDGER);assert.ok(Number.isInteger(expectedLedger)&&expectedLedger>0);assert.equal(ledger[0].n,expectedLedger);result.smoke=`non-superuser restored owner, public-profile projection and exact ${expectedLedger}-entry ledger`;
 }finally{await smoke.end();}
 const [customer]=await source`select id,shop_id,name from local_service.customers where name<>'[deleted]' order by id limit 1`;assert.ok(customer);
 const log=[{version:1,eventId:crypto.randomUUID(),at:new Date().toISOString(),action:'anonymize_customer',customerId:customer.id,shopId:customer.shop_id,legalHold:false,authority:'local-drill-only'}];
 fs.writeFileSync(path.join(dir,'deletion-log.json'),JSON.stringify(log,null,2));
 await replayDeletionLog(source,log);
 const [resurrected]=await target`select name from local_service.customers where id=${customer.id}::uuid`;assert.notEqual(resurrected.name,'[deleted]');
 result.deletionReplay=await replayDeletionLog(target,JSON.parse(fs.readFileSync(path.join(dir,'deletion-log.json'),'utf8')));
 await replayDeletionLog(target,log);const [erased]=await target`select name,phone,email,line_user_id from local_service.customers where id=${customer.id}::uuid`;assert.equal(erased.name,'[deleted]');assert.equal(erased.email,null);assert.equal(erased.line_user_id,null);
 const afterSource=await fingerprint(source),afterTarget=await fingerprint(target);result.afterReplayComparison=compare(afterSource,afterTarget);
 result.deletionReplay.idempotent=true;result.deletionReplay.resurrectionPrevented=true;result.status='PASS';
}catch(e){result.error=e.message;process.exitCode=1;}
finally{await Promise.all([source.end(),target?.end()]);fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));}
