import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import postgres from 'postgres';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
if(!process.argv[2])throw Error('Usage: node scripts/rc-harness/run.mjs CONFIG_JSON');
const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const npmCli=config.npmCli??path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
const required = ['sqlSha','appSha','pgBin','runtimeRoleSql','postgrest','evidenceRoot'];
for (const key of required) if (!config[key]) throw Error(`Missing configuration: ${key}`);
for (const key of ['sqlSha','appSha']) if (!/^[a-f0-9]{40}$/.test(config[key])) throw Error('Full immutable SHA required');
const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding:'utf8', windowsHide:true }).trim();
for (const key of ['sqlSha','appSha']) if (git('rev-parse',`${config[key]}^{commit}`) !== config[key]) throw Error('Unknown pin');
const auditFile='20261002160000_bk01_g10_line_binding_audit.sql';
if(config.auditSqlSha && !config.rcWorktree){
 if(!/^[a-f0-9]{40}$/.test(config.auditSqlSha)||git('rev-parse',`${config.auditSqlSha}^{commit}`)!==config.auditSqlSha)throw Error('Unknown immutable audit pin');
 const allowed=new Set([`supabase/bk01-migrations/${auditFile}`,'supabase/rollback/20261002160000_bk01_g10_line_binding_audit.rollback.sql']);
 const changed=git('diff','--name-only',config.sqlSha,config.auditSqlSha,'--','supabase').split('\n').filter(Boolean);
 if(changed.length!==2||changed.some(x=>!allowed.has(x)))throw Error('Audit pin changes the pinned SQL surface beyond the two new 160000 files');
}
const truncateChangedFiles = [
 'supabase/bk01-migrations/20261002170000_bk01_g10_line_binding_audit_truncate.sql',
 'supabase/rollback/20261002170000_bk01_g10_line_binding_audit_truncate.rollback.sql',
 'scripts/proofs/bk01-g10-truncate-pg17.mjs',
 'scripts/proofs/bk01-g10-line-audit-replay.mjs',
 'tests/bk01-entitlement-boundary.test.ts',
 'tests/bk01-g10-truncate-migration.test.ts',
];
const truncateTipFiles=truncateChangedFiles.filter(p=>p!=='tests/bk01-entitlement-boundary.test.ts');
if(config.g10TruncateWorktree){
 if(!config.auditSqlSha)throw Error('g10TruncateWorktree requires immutable auditSqlSha');
 const source=path.resolve(config.g10TruncateWorktree);
 const sourceGit=(...args)=>execFileSync('git',['-C',source,...args],{encoding:'utf8',windowsHide:true}).trim();
 if(sourceGit('rev-parse','HEAD')!==config.auditSqlSha)throw Error('G10 truncate worktree must be based exactly on auditSqlSha');
 const tracked=sourceGit('diff','--name-only','HEAD').split('\n').filter(Boolean);
 const untracked=sourceGit('ls-files','--others','--exclude-standard').split('\n').filter(Boolean);
 const changed=[...tracked,...untracked].sort();
 if(JSON.stringify(changed)!==JSON.stringify([...truncateChangedFiles].sort()))throw Error(`Unexpected uncommitted G10 truncate tip files: ${changed.join(', ')}`);
 config.g10TruncateWorktree=source;
}
const now = new Date().toISOString().replace(/[-:.]/g,'');
const evidence = path.resolve(config.evidenceRoot, now);
fs.mkdirSync(evidence,{recursive:true});
const rc = config.rcWorktree ? path.resolve(config.rcWorktree) : path.join(evidence,'rc');
if(config.rcWorktree && (rc!==root || git('rev-parse','HEAD')!==config.appSha || git('branch','--show-current')!==config.rcBranch)) throw Error('Exact RC worktree, base HEAD and branch required');
if(!config.rcWorktree){
git('worktree','add','--detach',rc,config.appSha);
execFileSync('git',['-C',rc,'restore',`--source=${config.sqlSha}`,'--','supabase'],{windowsHide:true});
const sqlScripts=git('ls-tree','-r','--name-only',config.sqlSha,'--','scripts').split('\n').filter(Boolean);
execFileSync('git',['-C',rc,'restore',`--source=${config.sqlSha}`,'--',...sqlScripts],{windowsHide:true});
if(config.auditSqlSha){
 const auditPaths=git('ls-tree','-r','--name-only',config.auditSqlSha,'--','supabase/bk01-migrations','supabase/rollback','scripts/proofs').split('\n').filter(p=>p.includes('20261002160000_')||/^scripts\/proofs\/bk01-g10-line-audit[^/]*\.mjs$/.test(p));
 execFileSync('git',['-C',rc,'restore',`--source=${config.auditSqlSha}`,'--',...auditPaths],{windowsHide:true});
}
if(config.g10TruncateWorktree){
 for(const file of truncateTipFiles)fs.copyFileSync(path.join(config.g10TruncateWorktree,file),path.join(rc,file));
}
// Copies are exact git objects. App sources are never patched or committed by the harness.
fs.mkdirSync(path.join(rc,'scripts/rc-harness'),{recursive:true});
fs.cpSync(path.join(root,'scripts/rc-harness'),path.join(rc,'scripts/rc-harness'),{recursive:true,filter:source=>path.basename(source)!=='node_modules'});
}
const hash = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const candidateFiles = config.rcWorktree ? [...new Set([...git('ls-files').split('\n'),...git('ls-files','--others','--exclude-standard').split('\n')])].filter(p=>p && !p.endsWith('w1-replay.generated.mjs') && fs.existsSync(path.join(rc,p))).sort().map(p=>({path:p,sha256:hash(path.join(rc,p))})) : [];
const files = ['supabase/bk01-migrations','supabase/migrations','supabase/shared-runtime','supabase/rollback'];
const manifest = {rcBranch:config.rcBranch??null,rcWorktree:config.rcWorktree??null,candidateFiles,at:new Date().toISOString(),sqlSha:config.sqlSha,appSha:config.appSha,
  auditSqlSha:config.auditSqlSha??null,
  g10TruncateBaseSha:config.g10TruncateWorktree?config.auditSqlSha:null,
  g10TruncateWorktree:config.g10TruncateWorktree??null,
  g10TruncateFiles:config.g10TruncateWorktree?truncateChangedFiles.map(p=>({path:p,sha256:hash(path.join(config.g10TruncateWorktree,p)),copied:truncateTipFiles.includes(p)})):[],
  appLockSha256:hash(path.join(rc,'package-lock.json')),harnessLockSha256:hash(path.join(root,'scripts/rc-harness/package-lock.json')),
  runtimeRoleSqlSha256:hash(config.runtimeRoleSql),postgrestSha256:hash(config.postgrest),files:[]};
for(const dir of files) for(const name of fs.readdirSync(path.join(rc,dir)).sort()) {
  const f=path.join(rc,dir,name);if(fs.statSync(f).isFile())manifest.files.push({path:`${dir}/${name}`,sha256:hash(f)});
}
fs.writeFileSync(path.join(evidence,'pins.json'),JSON.stringify(manifest,null,2));
const freePort = () => new Promise((resolve,reject)=>{const s=net.createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
const ports={pg:await freePort(),rest:await freePort(),gateway:await freePort(),consumer:await freePort(),admin:await freePort()};
const children=[];
// Do not inherit developer .env, provider keys, or arbitrary production configuration.
const cleanEnv=Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|APPDATA|LOCALAPPDATA|USERPROFILE|PROGRAMFILES|PROGRAMFILES\(X86\)|SYSTEMDRIVE|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE)$/i.test(k)));
const baseEnv={...cleanEnv,NEXT_TELEMETRY_DISABLED:'1',PGCLIENTENCODING:'UTF8'};
async function run(name,program,args,env=baseEnv,cwd=rc,timeout=600000) {
  const out=fs.openSync(path.join(evidence,`${name}.stdout.log`),'w'),err=fs.openSync(path.join(evidence,`${name}.stderr.log`),'w');
  const child=spawn(program,args,{cwd,env,windowsHide:true,stdio:['ignore',out,err]});
  const code=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();reject(Error(`${name} timed out`));},timeout);child.on('error',reject);child.on('exit',c=>{clearTimeout(timer);resolve(c);});});
  fs.closeSync(out);fs.closeSync(err);fs.writeFileSync(path.join(evidence,`${name}.exit.json`),JSON.stringify({exit:code}));
  if(code!==0)throw Error(`${name}: exit ${code}; see operator logs`);
}
function start(name,program,args,env,cwd=rc) {
  const out=fs.openSync(path.join(evidence,`${name}.log`),'w');
  const p=spawn(program,args,{cwd,env,windowsHide:true,stdio:['ignore',out,out]});
  p.on('error',()=>{});children.push({p,out});return p;
}
const data=path.join(evidence,'w1/data');
const localEnv={...baseEnv,RC_EXPECTED_LEDGER:String(manifest.files.filter(x=>x.path.startsWith('supabase/bk01-migrations/')&&x.path.endsWith('.sql')).length),BK01_P0_PGBIN:config.pgBin,BK01_P0_EVIDENCE_DIR:path.join(evidence,'w1'),BK01_P0_RUNTIME_ROLE_SQL:config.runtimeRoleSql,
 BK01_P0_LOCAL_PORT:String(ports.pg),BK01_P0_LOCAL_URL:`postgresql://operator@127.0.0.1:${ports.pg}/postgres`,BK01_P0_DATA_DIR:data.replaceAll('\\','/'),BK01_SHARED_RUNTIME_ENV:'local'};
const pg=(exe,args)=>execFileSync(path.join(config.pgBin,`${exe}.exe`),args,{env:baseEnv,windowsHide:true,stdio:'ignore'});
let pgRunning=false;
try {
  await run('harness-dependencies',process.execPath,[npmCli,'ci','--no-audit','--no-fund'],baseEnv,path.join(root,'scripts/rc-harness'));
  if(!config.rcWorktree) fs.symlinkSync(path.join(root,'scripts/rc-harness/node_modules'),path.join(rc,'scripts/rc-harness/node_modules'),'junction');
  await run('app-dependencies',process.execPath,[npmCli,'ci','--no-audit','--no-fund'],baseEnv,rc);
  await run('history-selftest',process.execPath,['--test','scripts/rc-harness/evidence-history.test.mjs']);
  // Reuse the reviewed W-1 replay. Only the managed auth scaffold is selected from
  // the existing Supabase-compatible fixture, to support PostgREST's JSON claims.
  let replay=fs.readFileSync(path.join(rc,'scripts/proofs/bk01-p1-g09-g10-replay.mjs'),'utf8');
  // Preserve the original P1 rollback baseline; append F1 only after its full replay.
  replay=replay.replaceAll("['scripts/bk01-migrate.mjs','apply'],env);","['scripts/bk01-migrate.mjs','apply','--through','20261002150000_bk01_p1_g09_g10.sql'],env);");
  const operatorGrant='GRANT bk01_migrator TO operator WITH INHERIT FALSE,SET TRUE;';
  if(!replay.includes(operatorGrant))throw Error('Reviewed W-1 operator grant anchor changed');
  replay=replay.replace(operatorGrant,`${operatorGrant} GRANT service_role TO operator WITH INHERIT FALSE,SET TRUE;`);
  const authBody=fs.readFileSync(path.join(rc,'scripts/proofs/lane-b/wu1_e2e.mjs'),'utf8').match(/const AUTH_UID_BODY = `([\s\S]*?)`;/)?.[1];
  if(!authBody)throw Error('Canonical managed auth fixture unavailable');
  replay=replay.replace("SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid",authBody);
  const managed=fs.readFileSync(path.join(rc,'scripts/proofs/lane-b/wu1_e2e.mjs'),'utf8');
  const storageTable=managed.match(/create table if not exists storage\.objects\([\s\S]*?;/)?.[0];
  if(!storageTable)throw Error('Canonical Storage scaffold unavailable');
  replay=replay.replace(/CREATE TABLE storage\.objects\([\s\S]*?;/,storageTable+'\n  alter table storage.objects enable row level security;');
  const replayPath=path.join(rc,'scripts/rc-harness/w1-replay.generated.mjs');fs.writeFileSync(replayPath,replay);
  await run('w1-replay',process.execPath,[replayPath],localEnv);
  pg('pg_ctl',['-D',data,'-l',path.join(evidence,'w1/postgres.log'),'-w','start']);pgRunning=true;
  if(config.auditSqlSha){
   const auditEnv={...localEnv,BK01_P0_EVIDENCE_DIR:path.join(evidence,'f1'),BK01_PLATFORM_DATABASE_URL:localEnv.BK01_P0_LOCAL_URL,BK01_OPERATOR_LOGINS:'operator',BK01_RELEASE_ID:'HOUSE-BK01-RC-HARNESS-F1'};
   let expectedRed=false;
   try{await run('f1-audit-baseline',process.execPath,['scripts/proofs/bk01-g10-line-audit-pg17.mjs','baseline'],auditEnv);}
   catch(error){const rows=JSON.parse(fs.readFileSync(path.join(evidence,'f1/g10-line-audit-baseline-results.json'),'utf8'));const receipt=JSON.parse(fs.readFileSync(path.join(evidence,'f1-audit-baseline.exit.json'),'utf8'));
    if(receipt.exit!==1||rows.length!==1||rows[0].ok||!rows[0].detail.includes('table=absent; triggers=none'))throw error;expectedRed=true;}
   if(!expectedRed)throw Error('F1 baseline must be red before migration');
   await run('f1-audit-apply',process.execPath,['scripts/bk01-migrate.mjs','apply','--through',auditFile],auditEnv);
   await run('f1-audit-proof',process.execPath,['scripts/proofs/bk01-g10-line-audit-pg17.mjs','after'],auditEnv);
  }
  if(config.g10TruncateWorktree || config.rcWorktree){
   const truncEnv={...localEnv,BK01_P0_EVIDENCE_DIR:path.join(evidence,'g10-truncate'),BK01_PLATFORM_DATABASE_URL:localEnv.BK01_P0_LOCAL_URL,BK01_OPERATOR_LOGINS:'operator',BK01_RELEASE_ID:'HOUSE-BK01-RC-HARNESS-G10-TRUNCATE'};
   let expectedRed=false;
   try{await run('g10-truncate-baseline',process.execPath,['scripts/proofs/bk01-g10-truncate-pg17.mjs','baseline'],truncEnv);}
   catch(error){const rows=JSON.parse(fs.readFileSync(path.join(evidence,'g10-truncate/g10-truncate-baseline-results.json'),'utf8'));const receipt=JSON.parse(fs.readFileSync(path.join(evidence,'g10-truncate-baseline.exit.json'),'utf8'));
    const required=['line_users no-op UPDATE writes no audit row','service_role TRUNCATE is recorded once per deleted LINE binding with actor and pre-image','customers INSERT and DELETE with line_user_id write audit rows'];
    if(receipt.exit!==1||required.some(name=>!rows.some(row=>row.name===name&&!row.ok)))throw error;expectedRed=true;}
   if(!expectedRed)throw Error('G10 truncate baseline must be red before 170000');
   await run('g10-truncate-apply',process.execPath,['scripts/bk01-migrate.mjs','apply','--through','20261002170000_bk01_g10_line_binding_audit_truncate.sql'],truncEnv);
   await run('g10-truncate-proof',process.execPath,['scripts/proofs/bk01-g10-truncate-pg17.mjs','after'],truncEnv);
   const rows=JSON.parse(fs.readFileSync(path.join(evidence,'g10-truncate/g10-truncate-after-results.json'),'utf8'));
   if(rows.some(row=>!row.ok))throw Error('G10 truncate tip proof has failed assertions');
  }
  await run('rpc-arity',process.execPath,['scripts/proofs/bk01-app-rpc-catalog-gate.mjs'],localEnv);
  const db=postgres(`postgresql://fixture_admin@127.0.0.1:${ports.pg}/postgres`,{max:1,prepare:false,onnotice:()=>{}});
  try {
    // Local gateway identity only; membership does not change callable ACLs.
    await db.unsafe("ALTER ROLE authenticator LOGIN; GRANT anon,authenticated TO authenticator; ALTER ROLE authenticator SET request.jwt.claim.role = 'bk01_runtime'");
    await db.unsafe("UPDATE auth.users SET email_confirmed_at=now() WHERE id='90000000-0000-4000-8000-000000000001'");
    await db.unsafe("INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('90000000-0000-4000-8000-000000000004','admin@example.test',now()); INSERT INTO local_service.shop_users(shop_id,user_id,role) VALUES('90000000-0000-4000-8000-000000000010','90000000-0000-4000-8000-000000000004','admin')");
  } finally {await db.end();}
  const secret=crypto.randomBytes(48).toString('hex');
  const token = claims=>{const header=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');const body=Buffer.from(JSON.stringify({aud:'authenticated',exp:Math.floor(Date.now()/1000)+600,...claims})).toString('base64url');return `${header}.${body}.${crypto.createHmac('sha256',secret).update(`${header}.${body}`).digest('base64url')}`;};
  const env={...localEnv,RC_PG_PORT:String(ports.pg),RC_REST_PORT:String(ports.rest),RC_GATEWAY_PORT:String(ports.gateway),RC_CONSUMER_PORT:String(ports.consumer),RC_ADMIN_PORT:String(ports.admin),RC_EVIDENCE:evidence,RC_JWT_SECRET:secret,
    RC_ANON_TOKEN:token({role:'anon'}),RC_OWNER_TOKEN:token({role:'authenticated',sub:'90000000-0000-4000-8000-000000000001',email:'owner@example.test',is_anonymous:false}),
    RC_STAFF_TOKEN:token({role:'authenticated',sub:'90000000-0000-4000-8000-000000000003',email:'staff@example.test',is_anonymous:false}),
    RC_ADMIN_TOKEN:token({role:'authenticated',sub:'90000000-0000-4000-8000-000000000004',email:'admin@example.test',is_anonymous:false}),
    RC_RUNTIME_TOKEN:token({role:'bk01_runtime'}),NEXT_PUBLIC_SUPABASE_URL:`http://127.0.0.1:${ports.gateway}`,NEXT_PUBLIC_SUPABASE_ANON_KEY:token({role:'anon'}),
    HOUSE_RUNTIME_ISSUER_URL:`http://localhost:${ports.gateway}/issuer`,HOUSE_RUNTIME_AUDIENCE:'authenticated',HOUSE_RUNTIME_CLIENT_ID:'rc-local',HOUSE_RUNTIME_CLIENT_SECRET:crypto.randomBytes(32).toString('hex'),
    TURNSTILE_SECRET_KEY:'1x0000000000000000000000000000000AA',NEXT_PUBLIC_TURNSTILE_SITEKEY:'1x00000000000000000000AA',RC_CHROMIUM:config.chromium ?? ''};
  start('postgrest',config.postgrest,['+RTS','-N2','-RTS'],{...baseEnv,PATH:config.pgBin+';'+baseEnv.PATH,PGRST_DB_URI:`postgresql://authenticator@127.0.0.1:${ports.pg}/postgres?connect_timeout=10`,PGRST_DB_POOL:'4',PGRST_DB_SCHEMAS:'local_service',PGRST_DB_ANON_ROLE:'anon',PGRST_JWT_SECRET:secret,PGRST_JWT_AUD:'authenticated',PGRST_SERVER_HOST:'127.0.0.1',PGRST_SERVER_PORT:String(ports.rest),PGRST_DB_EXTRA_SEARCH_PATH:'public,extensions',PGRST_DB_CONFIG:'false'});
  start('gateway',process.execPath,['scripts/rc-harness/gateway.mjs'],env);
  for(const app of ['consumer','admin'])start(`${app}-app`,process.execPath,[path.join(rc,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port',String(ports[app])],env,path.join(rc,`apps/booking-${app}`));
  await run('e2e',process.execPath,['--import','./scripts/rc-harness/register.mjs','scripts/rc-harness/e2e.mjs'],env,rc,600000);
  await run('restore-rehearsal',process.execPath,['scripts/rc-harness/restore.mjs'],{...env,RC_PGBIN:config.pgBin},rc);
  for(const {p} of children.filter(x=>x.p.spawnargs.includes('dev')))if(p.exitCode===null)p.kill();
  const sourceResults=[];
  async function sourceCheck(name,args,cwd=rc){try{await run(name,process.execPath,args,env,cwd);sourceResults.push({name,status:'PASS'});}catch(error){sourceResults.push({name,status:'FAIL',detail:error.message});}}
  await sourceCheck('route-exports',['scripts/check-route-exports-all.mjs']);
  await sourceCheck('app-tests',['--no-warnings','--import','./tests/register-ts-loader.mjs','--test','--experimental-test-isolation=none',...fs.readdirSync(path.join(rc,'tests')).filter(x=>x.endsWith('.test.ts')).map(x=>'tests/'+x)]);
  for(const app of ['consumer','admin']){
   const cwd=path.join(rc,`apps/booking-${app}`);
   await sourceCheck(`${app}-build`,[path.join(rc,'node_modules/next/dist/bin/next'),'build','--webpack'],cwd);
   await sourceCheck(`${app}-typecheck`,[path.join(rc,'node_modules/typescript/bin/tsc'),'--noEmit'],cwd);
   await sourceCheck(`${app}-lint`,[path.join(rc,'node_modules/eslint/bin/eslint.js')],cwd);
  }
  fs.writeFileSync(path.join(evidence,'source-checks.json'),JSON.stringify(sourceResults,null,2));
} catch(error) {
  fs.writeFileSync(path.join(evidence,'runner-error.json'),JSON.stringify({status:'FAIL',message:error.message},null,2));
  console.error(error.message);process.exitCode=1;
} finally {
  for(const {p,out} of children.reverse()) {if(p.exitCode===null)p.kill();fs.closeSync(out);}
  if(pgRunning)pg('pg_ctl',['-D',data,'-m','fast','-w','stop']);
  const drift=manifest.files.filter(x=>hash(path.join(rc,x.path))!==x.sha256);
  const candidateDrift=candidateFiles.filter(x=>!fs.existsSync(path.join(rc,x.path))||hash(path.join(rc,x.path))!==x.sha256);
  fs.writeFileSync(path.join(evidence,'candidate-integrity.json'),JSON.stringify({status:candidateDrift.length?'FAIL':'PASS',candidateDrift},null,2));
  const truncateTipDrift=manifest.g10TruncateFiles.filter(x=>hash(path.join(x.copied?rc:manifest.g10TruncateWorktree,x.path))!==x.sha256);
  fs.writeFileSync(path.join(evidence,'pinned-sql-integrity.json'),JSON.stringify({status:drift.length||truncateTipDrift.length?'FAIL':'PASS',drift,truncateTipDrift},null,2));
  const appDiff=execFileSync('git',['-C',rc,'diff',config.appSha,'--','apps'],{encoding:'utf8',windowsHide:true});
  fs.writeFileSync(path.join(evidence,'pinned-app-integrity.json'),JSON.stringify({status:appDiff?'FAIL':'PASS',diffBytes:Buffer.byteLength(appDiff)},null,2));
  const e2ePath=path.join(evidence,'e2e-results.json');
  const e2e=fs.existsSync(e2ePath)?JSON.parse(fs.readFileSync(e2ePath,'utf8')):[];
  const oldStaticFailures=(fs.existsSync(path.join(evidence,'rpc-arity-result.json'))?1:0)+(fs.existsSync(path.join(evidence,'w1/p1-g09-g10-green-legacy-static-fail.json'))?1:0);
  const sourceFile=path.join(evidence,'source-checks.json');const sourceFailures=fs.existsSync(sourceFile)?JSON.parse(fs.readFileSync(sourceFile,'utf8')).filter(x=>x.status==='FAIL').length:0;
  const summary={status:process.exitCode||candidateDrift.length||drift.length||truncateTipDrift.length||appDiff||e2e.some(x=>x.status==='FAIL')||oldStaticFailures||sourceFailures?'HOLD':'LOCAL_ONLY',sqlSha:config.sqlSha,appSha:config.appSha,auditSqlSha:config.auditSqlSha??null,g10TruncateBaseSha:manifest.g10TruncateBaseSha,g10TruncateFiles:manifest.g10TruncateFiles,pass:e2e.filter(x=>x.status==='PASS').length,fail:e2e.filter(x=>x.status==='FAIL').length,skip:e2e.filter(x=>x.status==='SKIP').length,staticToolFailures:oldStaticFailures,sourceFailures};
  fs.writeFileSync(path.join(evidence,'summary.json'),JSON.stringify(summary,null,2));if(summary.status==='HOLD')process.exitCode=1;
  console.log(`Evidence: ${evidence}`);
}
