// Reproducible W-1: fresh PG17.11 fixture, pinned legacy, reviewed platform role/bootstrap,
// actual non-superuser product runner, fail-before, rollback raw diff, reapply and real-role proofs.
import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';import postgres from 'postgres';
const root=process.cwd(),bin=process.env.BK01_P0_PGBIN,dir=process.env.BK01_P0_EVIDENCE_DIR,roleSql=process.env.BK01_P0_RUNTIME_ROLE_SQL;
const port=Number(process.env.BK01_P0_LOCAL_PORT);if(!bin||!dir||!roleSql||!Number.isInteger(port)||port<1024||port>65535)throw Error('PGBIN, fresh evidence dir, reviewed runtime role SQL and local port required');
const data=path.join(dir,'data');if(fs.existsSync(data))throw Error('fresh data directory required; never reset existing cluster');fs.mkdirSync(dir,{recursive:true});
const run=(program,args,env=process.env)=>execFileSync(program,args,{cwd:root,encoding:'utf8',windowsHide:true,env,stdio:path.basename(program)==='pg_ctl.exe'?'ignore':['ignore','pipe','pipe']});
if(!run(path.join(bin,'postgres.exe'),['--version']).includes('17.11'))throw Error('PG17.11 required');
const psql=(user,args)=>run(path.join(bin,'psql.exe'),['-h','127.0.0.1','-p',String(port),'-U',user,'-d','postgres','-v','ON_ERROR_STOP=1','-q',...args],{...process.env,PGCLIENTENCODING:'UTF8',PGOPTIONS:'-c search_path=public,extensions'});
const step=(name,args,env)=>{const output=run(process.execPath,args,env);fs.writeFileSync(path.join(dir,name+'.log'),output);console.log(output.trim());};
run(path.join(bin,'initdb.exe'),['-D',data,'-U','fixture_admin','-E','UTF8','--locale=C','--auth=trust']);fs.appendFileSync(path.join(data,'postgresql.conf'),`\nport=${port}\nlisten_addresses='127.0.0.1'\ntimezone='UTC'\n`);
run(path.join(bin,'pg_ctl.exe'),['-D',data,'-l',path.join(dir,'postgres.log'),'-w','start']);
try{
 psql('fixture_admin',['-c','CREATE ROLE postgres LOGIN SUPERUSER; ALTER DATABASE postgres OWNER TO postgres;']);
 const fixture=`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS; CREATE ROLE authenticator NOLOGIN NOINHERIT;
 CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,raw_app_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,email_confirmed_at timestamptz);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean DEFAULT false,file_size_limit bigint,allowed_mime_types text[]);
 CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text,PRIMARY KEY(bucket_id,name));
 CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array($1,'/') $$;
 CREATE SCHEMA ps01; CREATE SCHEMA ps01_internal; CREATE SCHEMA extensions;
 CREATE EXTENSION btree_gist WITH SCHEMA extensions; CREATE EXTENSION pgcrypto WITH SCHEMA extensions; CREATE EXTENSION "uuid-ossp" WITH SCHEMA extensions;
 CREATE PUBLICATION supabase_realtime;`;
 fs.writeFileSync(path.join(dir,'managed-fixture.sql'),fixture);psql('postgres',['-1','-f',path.join(dir,'managed-fixture.sql')]);
 for(const f of fs.readdirSync('supabase/migrations').filter(x=>x.endsWith('.sql')).sort())psql('postgres',['-1','-f',path.resolve('supabase/migrations',f)]);
 psql('postgres',['-c','REVOKE ALL ON SCHEMA extensions FROM PUBLIC; ALTER ROLE postgres NOSUPERUSER CREATEROLE BYPASSRLS;']);
 // Neither product role is pre-created; platform scripts create them under real non-superuser authority.
 psql('postgres',['-1','-f',roleSql]);psql('postgres',['-1','-f',path.resolve('supabase/shared-runtime/bk01-platform-bootstrap.sql')]);
 psql('fixture_admin',['-c',`CREATE ROLE operator LOGIN CREATEROLE BYPASSRLS; GRANT bk01_migrator TO operator WITH INHERIT FALSE,SET TRUE;
 CREATE ROLE runtime_probe LOGIN NOINHERIT; GRANT bk01_runtime TO runtime_probe WITH INHERIT FALSE,SET TRUE;
 CREATE ROLE anon_probe LOGIN NOINHERIT; GRANT anon TO anon_probe WITH INHERIT FALSE,SET TRUE;
 CREATE ROLE auth_probe LOGIN NOINHERIT; GRANT authenticated TO auth_probe WITH INHERIT FALSE,SET TRUE;
 REVOKE CREATE ON DATABASE postgres FROM PUBLIC; REVOKE CREATE ON SCHEMA public FROM PUBLIC;`]);
 const url=`postgresql://operator@127.0.0.1:${port}/postgres`,env={...process.env,BK01_PLATFORM_DATABASE_URL:url,BK01_OPERATOR_LOGINS:'operator',BK01_SHARED_RUNTIME_ENV:'local',BK01_RELEASE_ID:'HOUSE-BK01-P0-SQL',BK01_P0_LOCAL_URL:url,BK01_P0_DATA_DIR:data,BK01_P0_EVIDENCE_DIR:dir};
 step('base-apply',['scripts/bk01-migrate.mjs','apply','--through','20261001140000_bk01_pack_notify_group67.sql'],env);
 step('baseline',['scripts/proofs/bk01-council-p0-pg17.mjs','baseline'],env);
 step('p0-apply',['scripts/bk01-migrate.mjs','apply','--through','20261002120000_bk01_council_p0.sql'],env);
 step('followup-baseline',['scripts/proofs/bk01-p0-alert-context-f2-pg17.mjs','baseline'],env);
 step('pre-review-apply',['scripts/bk01-migrate.mjs','apply','--through','20261002130000_bk01_p0_alert_context.sql'],env);
 step('review-baseline',['scripts/proofs/bk01-p0-review-f1-f2-pg17.mjs','baseline'],env);
 step('apply',['scripts/bk01-migrate.mjs','apply','--through','20261002140000_bk01_review_f1_f2.sql'],env);
 step('review-after',['scripts/proofs/bk01-p0-review-f1-f2-pg17.mjs','after'],env);
 // Review-only rollback returns exactly to f5fedb8 before existing P0 rollback.
 const reviewRollback=postgres(url,{max:1,prepare:false,onnotice:()=>{}});
 try{await reviewRollback.begin(async tx=>{await tx.unsafe('SET LOCAL ROLE bk01_migrator');await tx.unsafe(fs.readFileSync('supabase/rollback/20261002140000_bk01_review_f1_f2.rollback.sql','utf8').replace(/\r\n/g,'\n'));await tx.unsafe("DELETE FROM local_service_internal.schema_migrations WHERE migration_id='20261002140000_bk01_review_f1_f2'");});}finally{await reviewRollback.end();}
 step('review-rollback',['scripts/proofs/bk01-p0-review-f1-f2-pg17.mjs','rollback'],env);
 // Windows psql rewrites LF inside function bodies. Use the same normalized SQL transport as product runner for this runner-origin snapshot.
 const rollbackDb=postgres(url,{max:1,prepare:false,onnotice:()=>{}});
 try{await rollbackDb.begin(async tx=>{await tx.unsafe('SET LOCAL ROLE bk01_migrator');await tx.unsafe(fs.readFileSync('supabase/rollback/20261002130000_bk01_p0_alert_context.rollback.sql','utf8').replace(/\r\n/g,'\n'));await tx.unsafe("DELETE FROM local_service_internal.schema_migrations WHERE migration_id='20261002130000_bk01_p0_alert_context'");});}finally{await rollbackDb.end();}
 step('followup-rollback',['scripts/proofs/bk01-p0-alert-context-f2-pg17.mjs','rollback'],env);
 psql('operator',['-1','-c','SET LOCAL ROLE bk01_migrator;','-f',path.resolve('supabase/rollback/20261002120000_bk01_council_p0.rollback.sql'),'-c',"DELETE FROM local_service_internal.schema_migrations WHERE migration_id='20261002120000_bk01_council_p0';"]);
 step('rollback',['scripts/proofs/bk01-council-p0-pg17.mjs','rollback'],env);
 step('reapply',['scripts/bk01-migrate.mjs','apply','--through','20261002140000_bk01_review_f1_f2.sql'],env);
 step('after',['scripts/proofs/bk01-council-p0-pg17.mjs','after'],env);
 step('advanced',['scripts/proofs/bk01-council-p0-advanced-pg17.mjs'],env);
 step('followup',['scripts/proofs/bk01-p0-alert-context-f2-pg17.mjs'],env);
 step('surface',['scripts/proofs/bk01-p0-surface-gate.mjs'],env);
 step('rpc-arity',['scripts/proofs/bk01-app-rpc-catalog-gate.mjs'],env);
 step('runner-mutation',['scripts/proofs/bk01-p0-runner-hash-mutation.mjs'],env);
  // The existing House fixture is applied only inside disposable W-1 for the real BK01 upload wrapper.
  psql('postgres',['-c','CREATE SCHEMA wstera_platform_internal AUTHORIZATION postgres']);
  psql('postgres',['-f',path.resolve('scripts/proofs/lane-b/fixtures/house_storage_upload_grants.sql')]);
 step('p1-g09-g10-red',['scripts/proofs/bk01-p1-g09-g10-pg17.mjs','baseline'],env);
 step('p1-g09-g10-apply',['scripts/bk01-migrate.mjs','apply'],env);
 step('p1-g09-g10-green',['scripts/proofs/bk01-p1-g09-g10-pg17.mjs','after'],env);
 const p1Rollback=postgres(url,{max:1,prepare:false,onnotice:()=>{}});
 try{await p1Rollback.begin(async tx=>{await tx.unsafe('SET LOCAL ROLE bk01_migrator');await tx.unsafe(fs.readFileSync('supabase/rollback/20261002150000_bk01_p1_g09_g10.rollback.sql','utf8').replace(/\r\n/g,'\n'));await tx.unsafe("DELETE FROM local_service_internal.schema_migrations WHERE migration_id='20261002150000_bk01_p1_g09_g10'");});}finally{await p1Rollback.end();}
 step('p1-g09-g10-rollback',['scripts/proofs/bk01-p1-g09-g10-pg17.mjs','rollback'],env);
 step('p1-g09-g10-reapply',['scripts/bk01-migrate.mjs','apply'],env);
 step('p1-g09-g10-reapply-green',['scripts/proofs/bk01-p1-g09-g10-pg17.mjs','after'],env);
 console.log('PASS fresh W-1 full replay; cluster stops below');
}finally{run(path.join(bin,'pg_ctl.exe'),['-D',data,'-m','fast','-w','stop']);}
