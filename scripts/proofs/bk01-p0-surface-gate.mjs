import fs from 'node:fs';import postgres from 'postgres';import {validateBk01RuntimeEffectiveExecuteSet} from '../lib/bk01-runtime-allowlist.mjs';
if(process.env.BK01_SHARED_RUNTIME_ENV!=='local'||!process.env.BK01_P0_LOCAL_URL||new URL(process.env.BK01_P0_LOCAL_URL).hostname!=='127.0.0.1')throw Error('local-only surface gate');
const db=postgres(process.env.BK01_P0_LOCAL_URL,{max:1,prepare:false});const expected=JSON.parse(fs.readFileSync('supabase/shared-runtime/bk01-p0-app-execute-allowlist.json','utf8'));
try{
 const probe=postgres(process.env.BK01_P0_LOCAL_URL.replace(/\/\/[^@]+@/,'//fixture_admin@'),{max:1});
 try{const [guard]=await probe`select current_setting('data_directory') data`;if(!process.env.BK01_P0_DATA_DIR||guard.data.replaceAll('\\','/')!==process.env.BK01_P0_DATA_DIR.replaceAll('\\','/'))throw Error('exact disposable data directory mismatch');}finally{await probe.end();}
await db.begin(async tx=>{await tx.unsafe('SET LOCAL ROLE bk01_migrator');
 for(const role of ['anon','authenticated','bk01_runtime']){
 const rows=await tx`select p.oid::regprocedure::text identity from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='local_service' and has_function_privilege(${role},p.oid,'EXECUTE') order by 1`;
 if(role==='bk01_runtime')validateBk01RuntimeEffectiveExecuteSet(rows.map(x=>x.identity));else if(JSON.stringify(rows.map(x=>x.identity))!==JSON.stringify(expected[role]))throw Error(role+' executable function surface differs from exact list');console.log('PASS exact executable surface '+role+' '+rows.length);
 }
 const writes=await tx`select c.oid::regclass::text tbl,r.role,p.privilege from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join(values('anon'),('authenticated')) r(role) cross join(values('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) p(privilege) where n.nspname='local_service' and c.relkind in ('r','p','v','m') and (has_table_privilege(r.role,c.oid,p.privilege) or (p.privilege in ('INSERT','UPDATE','REFERENCES') and has_any_column_privilege(r.role,c.oid,p.privilege))) and not(r.role='authenticated' and c.relname='tickets' and p.privilege='DELETE')`;
 if(writes.length)throw Error('write matrix violations '+JSON.stringify(writes));console.log('PASS exact table/column write privilege matrix');
 const policies=await tx`select policyname,cmd from pg_policies where schemaname='local_service' and tablename='booking_status_history'`;
 if(policies.some(p=>p.cmd!=='SELECT'))throw Error('history policy still writable');console.log('PASS history policies SELECT only');
});}finally{await db.end();}
