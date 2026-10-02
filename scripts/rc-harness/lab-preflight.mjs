// Default: emits a checklist only. --read-only is for a separately authorized GO
// window. This task does not invoke it against LAB.
import fs from 'node:fs';
import crypto from 'node:crypto';
import postgres from 'postgres';
import {validateHistory} from './evidence-history.mjs';
export const catalogQueries={
 posture:"SELECT current_database() database, current_user, current_setting('server_version_num') version, current_setting('timezone') timezone, current_setting('transaction_read_only') read_only",
 roles:"SELECT rolname,rolsuper,rolinherit,rolcanlogin,rolbypassrls,rolcreaterole FROM pg_catalog.pg_roles WHERE rolname IN ('postgres','authenticator','bk01_runtime','bk01_migrator') OR rolname LIKE '%issuer%' ORDER BY rolname",
 membership:"SELECT r.rolname role,m.rolname member,a.admin_option,a.inherit_option,a.set_option FROM pg_catalog.pg_auth_members a JOIN pg_catalog.pg_roles r ON r.oid=a.roleid JOIN pg_catalog.pg_roles m ON m.oid=a.member WHERE r.rolname IN ('bk01_runtime','bk01_migrator') OR r.rolname LIKE '%issuer%' ORDER BY 1,2",
 objects:"SELECT to_regclass('local_service_internal.schema_migrations') product_ledger,to_regclass('wstera_platform_internal.runtime_issuer_clients') issuer_clients,to_regclass('wstera_platform_internal.runtime_issuer_audit') issuer_audit,to_regclass('wstera_platform_internal.storage_upload_grants') storage_grants,to_regprocedure('wstera_platform_internal.consume_runtime_issuer_rate_limit(text,integer,integer,timestamptz)') issuer_limiter",
 catalog:"SELECT n.nspname,p.oid::regprocedure::text identity,pg_get_userbyid(p.proowner) owner,p.proacl::text acl,pg_get_functiondef(p.oid) definition FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('local_service','local_service_internal','wstera_platform_internal') ORDER BY 1,2",
 relations:"SELECT n.nspname,c.relname,c.relkind,c.relrowsecurity,c.relforcerowsecurity,pg_get_userbyid(c.relowner) owner,c.relacl::text acl FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('local_service','local_service_internal','wstera_platform_internal') ORDER BY 1,2",
 nulls:"SELECT c.table_schema,c.table_name,c.column_name,c.is_nullable,c.data_type FROM information_schema.columns c WHERE c.table_schema='local_service' ORDER BY 1,2,c.ordinal_position",
 legacyNullCounts:"SELECT count(*) FILTER (WHERE status IS NULL OR deposit_status IS NULL) status_nulls,count(*) FILTER (WHERE start_timestamptz IS NULL OR end_timestamptz IS NULL) timing_nulls FROM local_service.bookings",
};
const checklist={status:'PREPARED_NOT_RUN',connectionAttempted:false,queries:catalogQueries,requiredChecks:[
 'Offline tool/ validation PASS with manifest-pinned byte hashes and exact 5<10<15 UTC history BEFORE connecting.',
 'Pin expected LAB host and projectRef from separately reviewed target contract; TLS sslmode=verify-full. Never auto-detect from .env.',
 'PG17 / UTC; bk01_runtime and issuer NOSUPERUSER/NOLOGIN/NOINHERIT/NOBYPASSRLS; creator postgres ADMIN membership.',
 'Bootstrap/order15 object and hash readback; product ledger empty; do not reapply bootstrap or order15.',
 'Reviewed order20 pin matches missing Storage surface; capture exact catalog/roles/ACL before mutation.',
 'Count legacy NULL timing/status rows read-only; stop on conflict; do not fix data under preflight.',
 'pg_dump custom --no-owner --no-acl + SHA256; local restore/schema/ledger/count/constraint/smoke/replay drill before GO.',
 'Portable dump excludes ACL/owner reconstruction: capture and review the actual recovery recipe; no PITR assumption.',
 'Owner/Claude fresh GO required for any LAB mutation. Forward-only; no legacy group67 rollback.',
]};
if(!process.argv.includes('--read-only'))console.log(JSON.stringify(checklist,null,2));
else {
 let db;
 try{
  const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
  if(!config.issuerOwnerRole||!/^\w+$/.test(config.issuerOwnerRole))throw Error('REVIEWED_ISSUER_OWNER_ROLE_REQUIRED');
  const history=validateHistory(config.toolDirectory,JSON.parse(fs.readFileSync(config.manifest,'utf8')));
  if(history.mutations.some(x=>x.projectRef!==config.projectRef))throw Error('TARGET_PROVENANCE_MISMATCH');
  const value=process.env.BK01_PREFLIGHT_DATABASE_URL;if(!value)throw Error('BK01_PREFLIGHT_DATABASE_URL required');
  const url=new URL(value);
  if(!config.expectedHost||url.hostname!==config.expectedHost||url.searchParams.get('sslmode')!=='verify-full')throw Error('READ_ONLY_TARGET_OR_TLS_REJECTED');
  const options={max:1,prepare:false,connect_timeout:10,onnotice:()=>{},ssl:{rejectUnauthorized:true},connection:{default_transaction_read_only:'on',statement_timeout:'10000',lock_timeout:'2000',application_name:'bk01-select-only-preflight'}};
  if(config.caFile)options.ssl.ca=fs.readFileSync(config.caFile,'utf8');
  db=postgres(value,options);const report=await db.begin('READ ONLY',async tx=>{
   const output={};for(const [name,sql] of Object.entries(catalogQueries))output[name]=await tx.unsafe(sql);
   if(output.posture[0].read_only!=='on')throw Error('READ_ONLY_NOT_ENFORCED');
   if(output.objects[0].product_ledger){output.productLedger=await tx.unsafe('SELECT migration_id,filename,source_sha256 FROM local_service_internal.schema_migrations ORDER BY migration_id');if(output.productLedger.length!==0)throw Error('PRODUCT_LEDGER_NOT_EMPTY');}
   for(const name of ['bk01_runtime',config.issuerOwnerRole]){const r=output.roles.find(x=>x.rolname===name);if(!r||r.rolsuper||r.rolcanlogin||r.rolinherit||r.rolbypassrls)throw Error(`ROLE_POSTURE_FAILED:${name}`);}
   if(output.legacyNullCounts[0].status_nulls||output.legacyNullCounts[0].timing_nulls)throw Error('LEGACY_NULL_CONFLICT');
   if(!output.membership.some(x=>x.role==='bk01_runtime'&&x.member==='postgres'&&x.admin_option))throw Error('CREATOR_ADMIN_MEMBERSHIP_MISSING');
   output.historyInventory=history.inventory;output.catalogSha256=crypto.createHash('sha256').update(JSON.stringify(output.catalog)).digest('hex');return output;
  });
  // No connection URL, password, or issuer-client rows are written.
  fs.writeFileSync(config.output,JSON.stringify({status:'READ_ONLY_CAPTURED_REVIEW_REQUIRED',connectionAttempted:true,report},null,2));console.log('Read-only capture saved; controller review and fresh GO still required');
 }catch(e){console.error(e.code&&/^[0-9A-Z]{5}$/.test(e.code)?`PREFLIGHT_FAILED:${e.code}`:'PREFLIGHT_FAILED: target/history/catalog check failed; no mutations attempted');process.exitCode=1;}
 finally{if(db)await db.end();}
}
