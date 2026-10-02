// Fresh owned PG17 fixture only. No target URL/config accepted; no hosted calls.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync,spawnSync} from 'node:child_process';
import postgres from 'postgres';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
assert.deepEqual(Object.keys(config).sort(),['pgBin','runtimeRoleSql','evidenceRoot'].sort());
for(const value of Object.values(config))assert.ok(path.isAbsolute(value));
const BASE='38ca440964e09657c32715a2205ff1d85f07e240';
const name170='20261002170000_bk01_g10_line_binding_audit_truncate.sql';
const name180='20261002180000_bk01_platform_admin_return_types.sql';
const rollback170='supabase/rollback/'+name170.replace('.sql','.rollback.sql');
const git=(...args)=>execFileSync('git',['-C',root,...args],{windowsHide:true});
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const forward=fs.readFileSync(path.join(root,'supabase/bk01-migrations',name170));
assert.ok(forward.equals(git('show',BASE+':supabase/bk01-migrations/'+name170)),'Frozen forward170000 drift');
const envBase=Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|APPDATA|LOCALAPPDATA|USERPROFILE|PROGRAMFILES|SYSTEMDRIVE)$/i.test(k)));
const evidence=path.join(config.evidenceRoot,new Date().toISOString().replace(/[-:.]/g,''));fs.mkdirSync(evidence,{recursive:true});
const data=path.join(evidence,'data'),results=[];
const json=(name,value)=>fs.writeFileSync(path.join(evidence,name),JSON.stringify(value,null,2));
const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
function command(label,program,args,extra={},expected=0){
  const r=spawnSync(program,args,{cwd:root,env:{...envBase,...extra},windowsHide:true,encoding:'utf8',timeout:300000,maxBuffer:20*1024*1024,stdio:path.basename(program)==='pg_ctl.exe'?'ignore':['ignore','pipe','pipe']});
  fs.writeFileSync(path.join(evidence,label+'.stdout.log'),r.stdout||'');fs.writeFileSync(path.join(evidence,label+'.stderr.log'),r.stderr||'');
  json(label+'.exit.json',{exit:r.status,error:r.error?.code||null});if(expected!==null)assert.equal(r.status,expected,label+' failed');return r;
}
const pg=(label,exe,args,expected=0)=>command(label,path.join(config.pgBin,exe+'.exe'),args,exe==='psql'?{PGOPTIONS:'-c search_path=public,extensions'}:{},expected);
const psql=(label,user,db,args,expected=0)=>pg(label,'psql',['-h','127.0.0.1','-p',String(port),'-U',user,'-d',db,'-v','ON_ERROR_STOP=1',...args],expected);
const connect=(user='fixture_admin',database='postgres')=>postgres(`postgresql://${user}@127.0.0.1:${port}/${database}`,{max:1,prepare:false,onnotice:()=>{}});
async function catalog(db,oids=false){
  const queries={
    functions:await db`select p.oid::text oid,p.oid::regprocedure::text identity,pg_get_userbyid(p.proowner) owner,p.proacl::text acl,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('local_service','local_service_internal') order by 2`,
    constraints:await db`select k.oid::text oid,k.conrelid::regclass::text relation,k.conname,pg_get_constraintdef(k.oid) definition,k.convalidated from pg_constraint k join pg_namespace n on n.oid=k.connamespace where n.nspname in ('local_service','local_service_internal') order by 2,3`,
    triggers:await db`select t.oid::text oid,t.tgrelid::regclass::text relation,t.tgname,pg_get_triggerdef(t.oid) definition,t.tgenabled from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname in ('local_service','local_service_internal') order by 2,3`,
    relations:await db`select c.oid::text oid,c.oid::regclass::text identity,pg_get_userbyid(c.relowner) owner,c.relacl::text acl,c.relrowsecurity,c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('local_service','local_service_internal') order by 2`,
    columns:await db`select table_schema,table_name,column_name,data_type,is_nullable,column_default,ordinal_position from information_schema.columns where table_schema in ('local_service','local_service_internal') order by 1,2,7`,
    columnAcl:await db`select c.oid::regclass::text relation,a.attname,a.attacl::text acl from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('local_service','local_service_internal') and a.attnum>0 and not a.attisdropped order by 1,2`,
    policies:await db`select * from pg_policies where schemaname in ('local_service','local_service_internal') order by schemaname,tablename,policyname`,
    namespaces:await db`select nspname,pg_get_userbyid(nspowner) owner,nspacl::text acl from pg_namespace where nspname in ('local_service','local_service_internal') order by 1`,
  };
  if(!oids)for(const key of ['functions','constraints','triggers','relations'])queries[key]=queries[key].map(({oid,...row})=>row);
  return queries;
}
async function auditData(db){return {
  audit:await db`select * from local_service_internal.line_binding_audit order by id`,
  lineUsers:await db`select * from local_service.line_users order by id`,
  customers:await db`select * from local_service.customers order by id`,
  ledger:await db`select * from local_service_internal.schema_migrations order by migration_id`,
};}
const dump=label=>pg(label,'pg_dump',['--schema-only','--schema=local_service','--schema=local_service_internal','-h','127.0.0.1','-p',String(port),'-U','fixture_admin','-d','postgres']).stdout.replace(/^\\(?:un)?restrict [^\r\n]+\r?\n/gm,'');
const rec=(name,detail={})=>{results.push({name,status:'PASS',...detail});console.log('PASS '+name);};
const summary={status:'FAIL',scope:'OFFLINE_SIMULATION',sourceHead:git('rev-parse','HEAD').toString().trim(),sourceStatus:git('status','--porcelain=v1').toString().trim()?'UNCOMMITTED':'PINNED',baseSha:BASE,forward170000Sha256:hash(forward),labConnectionAttempted:false};
const clients=[];const open=(...args)=>{const db=connect(...args);clients.push(db);return db;};let running=false;
try{
  pg('initdb','initdb',['-D',data,'-U','fixture_admin','-E','UTF8','--locale=C','--auth=trust']);
  fs.appendFileSync(path.join(data,'postgresql.conf'),`\nport=${port}\nlisten_addresses='127.0.0.1'\ntimezone='UTC'\n`);
  pg('start','pg_ctl',['-D',data,'-l',path.join(evidence,'postgres.log'),'-w','start']);running=true;
  psql('creator','fixture_admin','postgres',['-c','CREATE ROLE postgres LOGIN SUPERUSER; ALTER DATABASE postgres OWNER TO postgres;']);
  const fixture=fs.readFileSync(path.join(root,'scripts/proofs/bk01-g10-line-audit-replay.mjs'),'utf8').match(/const fixture=`([\s\S]*?)`;/)?.[1];assert.ok(fixture);
  fs.writeFileSync(path.join(evidence,'fixture.sql'),fixture);psql('fixture','postgres','postgres',['-1','-f',path.join(evidence,'fixture.sql')]);
  for(const file of fs.readdirSync(path.join(root,'supabase/migrations')).filter(x=>x.endsWith('.sql')).sort())psql('legacy-'+file,'postgres','postgres',['-1','-f',path.join(root,'supabase/migrations',file)],0);
  psql('non-superuser','postgres','postgres',['-c','REVOKE ALL ON SCHEMA extensions FROM PUBLIC; ALTER ROLE postgres NOSUPERUSER CREATEROLE BYPASSRLS;']);
  psql('runtime-role','postgres','postgres',['-1','-f',config.runtimeRoleSql]);psql('bootstrap','postgres','postgres',['-1','-f',path.join(root,'supabase/shared-runtime/bk01-platform-bootstrap.sql')]);
  psql('operator','fixture_admin','postgres',['-c','CREATE ROLE operator LOGIN CREATEROLE BYPASSRLS; GRANT bk01_migrator TO operator WITH INHERIT FALSE,SET TRUE;']);
  psql('service-role-grant-only','fixture_admin','postgres',['-c','GRANT service_role TO operator WITH INHERIT FALSE,SET TRUE;']);
  psql('house-schema-fixture','postgres','postgres',['-c','CREATE SCHEMA wstera_platform_internal AUTHORIZATION postgres;']);
  psql('storage-fixture','postgres','postgres',['-f',path.join(root,'scripts/proofs/lane-b/fixtures/house_storage_upload_grants.sql')]);
  const env={BK01_PLATFORM_DATABASE_URL:`postgresql://operator@127.0.0.1:${port}/postgres`,BK01_OPERATOR_LOGINS:'operator',BK01_SHARED_RUNTIME_ENV:'local',BK01_RELEASE_ID:'BK01-RC5-ROLLBACK-PROOF'};
  const apply=(label,filename)=>command(label,process.execPath,['scripts/bk01-migrate.mjs','apply','--through',filename],env);
  apply('through160000','20261002160000_bk01_g10_line_binding_audit.sql');
  let db=open();const [guard]=await db`select current_setting('data_directory') data`;assert.equal(path.resolve(guard.data),path.resolve(data));
  await db`insert into auth.users(id,email) values('99170000-0000-4000-8000-000000000001','rollback-actor@example.test')`;
  await db`insert into local_service.shops(id,name,slug) values('99170000-0000-4000-8000-000000000010','Rollback Fixture','rollback-170000')`;
  await db`insert into local_service.customers(id,shop_id,name,phone) values('99170000-0000-4000-8000-000000000011','99170000-0000-4000-8000-000000000010','Rollback Customer','0890000170')`;
  await db`insert into local_service.line_users(id,shop_id,customer_id,line_user_id) values('99170000-0000-4000-8000-000000000012','99170000-0000-4000-8000-000000000010','99170000-0000-4000-8000-000000000011',${'U'+'d'.repeat(32)})`;
  const before160=await catalog(db),dump160=dump('schema160000');json('before160000.json',before160);
  apply('apply170000',name170);await db.end();
  for(const name of ['legacy_red','blocked_green'])pg('clone-'+name,'createdb',['-h','127.0.0.1','-p',String(port),'-U','fixture_admin','-T','postgres',name]);
  const repaired=fs.readFileSync(path.join(root,rollback170),'utf8').replace(/\r\n/g,'\n');
  for(const name of ['legacy_red','blocked_green']){
    const observer=open('fixture_admin',name),operator=open('operator',name);
    await operator.begin(async tx=>{await tx.unsafe('SET LOCAL ROLE service_role');await tx`select set_config('request.jwt.claim.sub','99170000-0000-4000-8000-000000000001',true)`;await tx`truncate local_service.line_users`;});
    const before=await catalog(observer,true),beforeData=await auditData(observer);assert.equal(beforeData.audit.filter(x=>x.operation==='TRUNCATE').length,1);
    json(name+'-before-catalog.json',before);json(name+'-before-data.json',beforeData);
    if(name==='legacy_red'){
      const oldFile=path.join(evidence,'original170000.rollback.sql');fs.writeFileSync(oldFile,git('show',BASE+':'+rollback170));
      const rejected=psql('legacy-red-rollback','operator',name,['-c','SET ROLE bk01_migrator;','-f',oldFile],null);
      assert.notEqual(rejected.status,0);assert.ok(rejected.stderr.includes('is violated by some row'));
      const after=await catalog(observer,true);assert.notDeepEqual(after,before);
      assert.ok(!after.constraints.some(x=>x.conname==='line_binding_audit_operation_check'));
      assert.equal(after.triggers.filter(x=>x.tgname.startsWith('bk01_line_binding_audit')||x.tgname.startsWith('bk01_customer_line_binding_audit')).length,0);
      json('legacy-red-after-catalog.json',after);rec('RED original standalone rollback leaves partial catalog',{expectedFailure:true});
    }else{
      await operator.unsafe('SET ROLE bk01_migrator');let error;
      try{await operator.unsafe(repaired);}catch(e){error={code:e.code,message:e.message,hint:e.hint};}
      await operator.unsafe('RESET ROLE');assert.equal(error?.code,'55000');assert.match(error.message,/TRUNCATE/);assert.match(error.hint,/export|retain/i);
      const after=await catalog(observer,true),afterData=await auditData(observer);assert.deepEqual(after,before);assert.deepEqual(afterData,beforeData);
      json('blocked-green-after-catalog.json',after);json('blocked-green-after-data.json',afterData);json('blocked-green-error.json',error);
      rec('GREEN TRUNCATE guard preserves all catalog OIDs, ACLs, constraints, triggers and audit rows',{catalogDiff:[],dataDiff:[],error});
    }
    await operator.end();await observer.end();
  }
  db=open();const op=open('operator');
  assert.equal((await db`select count(*)::int count from local_service_internal.line_binding_audit where operation='TRUNCATE'`)[0].count,0);
  await op.begin(async tx=>{await tx.unsafe('SET LOCAL ROLE bk01_migrator');await tx.unsafe(repaired);await tx`delete from local_service_internal.schema_migrations where filename=${name170}`;});
  assert.deepEqual(await catalog(db),before160);assert.equal(dump('schema-after170000-rollback'),dump160);rec('Clean170000 rollback raw catalog/schema diff=[]');
  apply('reapply170000',name170);rec('Reapply170000 succeeds');
  const before180=await catalog(db);
  const {platformAdminSnapshot,assertAdminRepairDelta,provePlatformAdmin}=await import(pathToFileURL(path.join(root,'scripts/proofs/bk01-platform-admin-return-types.mjs')));
  const adminBefore=await platformAdminSnapshot(db);apply('apply180000',name180);assertAdminRepairDelta(adminBefore,await platformAdminSnapshot(db));await provePlatformAdmin(db,{repaired:true});
  await op.begin(async tx=>{await tx.unsafe('SET LOCAL ROLE bk01_migrator');await tx.unsafe(fs.readFileSync(path.join(root,'supabase/rollback/'+name180.replace('.sql','.rollback.sql')),'utf8').replace(/\r\n/g,'\n'));await tx`delete from local_service_internal.schema_migrations where filename=${name180}`;});
  assert.deepEqual(await catalog(db),before180);await provePlatformAdmin(db);rec('180000 rollback on corrected170000 raw catalog diff=[]');
  apply('reapply180000',name180);await provePlatformAdmin(db,{repaired:true});
  const {validateBk01RuntimeEffectiveExecuteSet}=await import(pathToFileURL(path.join(root,'scripts/lib/bk01-runtime-allowlist.mjs')));
  const identities=(await db`select p.oid::regprocedure::text identity from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='local_service' and has_function_privilege('bk01_runtime',p.oid,'EXECUTE') order by 1`).map(x=>x.identity);validateBk01RuntimeEffectiveExecuteSet(identities);assert.equal(identities.length,21);
  assert.equal((await db`select count(*)::int count from local_service_internal.schema_migrations`)[0].count,15);rec('Final ledger15/exact runtime21,180000 reapply green');
  summary.status='PASS';summary.rollback170000Sha256=hash(Buffer.from(repaired));summary.ledgerCount=15;summary.effectiveExecuteCount=21;
}catch(error){summary.error=error.message;process.exitCode=1;}
finally{
  await Promise.all(clients.map(db=>db.end()));
  if(running){pg('stop','pg_ctl',['-D',data,'-m','fast','-w','stop']);summary.clusterStopped=true;}
  json('results.json',results);json('summary.json',summary);console.log(JSON.stringify({evidence,...summary}));
}
