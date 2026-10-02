// Identical pre-auth route probe on fresh immutable worktrees; no app patches.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import {spawn,execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
if(!process.argv[2])throw Error('Usage: node triage-admin.mjs CONFIG_JSON');
const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const pins=['62e93ec7f2491a0fa4be8556b6d69a9be2a32ddb','9f452d453d9ab299e7a054d32720e117837a8144','6efec0ca7275b583076deb4eec1aa953f0bd9354'];
const git=(cwd,...args)=>execFileSync('git',['-C',cwd,...args],{encoding:'utf8',windowsHide:true}).trim();
const shared=path.resolve(config.triageDependencies);
const lock=fs.readFileSync(path.join(shared,'package-lock.json'));
for(const sha of pins){if(git(root,'rev-parse',sha+'^{commit}')!==sha)throw Error('Unknown immutable pin');
 const expected=execFileSync('git',['-C',root,'show',sha+':package-lock.json'],{windowsHide:true});if(!expected.equals(lock))throw Error('Dependency lock differs');}
if(!fs.existsSync(path.join(shared,'node_modules/next/dist/bin/next')))throw Error('Exact-lock dependency install unavailable');
const out=path.join(path.resolve(config.evidenceRoot),'admin-triage-'+new Date().toISOString().replace(/[-:.]/g,''));fs.mkdirSync(out,{recursive:true});
const allowed=/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|APPDATA|LOCALAPPDATA|USERPROFILE|PROGRAMFILES|PROGRAMFILES\(X86\)|SYSTEMDRIVE|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE)$/i;
const env={...Object.fromEntries(Object.entries(process.env).filter(([k])=>allowed.test(k))),NEXT_TELEMETRY_DISABLED:'1',NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:9',NEXT_PUBLIC_SUPABASE_ANON_KEY:'rc-triage-public-placeholder'};
// Empty cookies: getClaims makes no remote Auth request. The layout's getLocale
// executes before its Auth check. This isolates configuration, not authorization.
const results=[];let browser;
const freePort=()=>new Promise((resolve,reject)=>{const s=net.createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
async function exec(name,args,cwd,timeout=600000){const stdout=fs.openSync(path.join(out,name+'.stdout.log'),'w'),stderr=fs.openSync(path.join(out,name+'.stderr.log'),'w');
 const child=spawn(process.execPath,args,{cwd,env,windowsHide:true,stdio:['ignore',stdout,stderr]});
 try{return await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();reject(Error('Timeout '+name));},timeout);child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('exit',code=>{clearTimeout(timer);resolve(code);});});}
 finally{fs.closeSync(stdout);fs.closeSync(stderr);}}
async function probe(rc,sha,mode){const port=await freePort(),log=path.join(out,sha.slice(0,7)+'-'+mode+'.log'),fd=fs.openSync(log,'w');
 const app=path.join(rc,'apps/booking-admin');const args=[path.join(rc,'node_modules/next/dist/bin/next'),mode==='dev'?'dev':'start',...(mode==='dev'?['--webpack']:[]),'--hostname','127.0.0.1','--port',String(port)];
 const child=spawn(process.execPath,args,{cwd:app,env,windowsHide:true,stdio:['ignore',fd,fd]});let spawnError;child.once('error',e=>{spawnError=e;});
 const row={sha,mode,probe:'dashboard-before-auth-with-empty-cookies',status:'UNVERIFIED'};
 try{const until=Date.now()+120000;let ready=false;while(Date.now()<until){if(spawnError)throw spawnError;if(child.exitCode!==null)throw Error('Server exited '+child.exitCode);
  try{const r=await fetch(`http://127.0.0.1:${port}/login`,{signal:AbortSignal.timeout(3000)});if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}if(!ready)throw Error('Server readiness timeout');
  const ctx=await browser.newContext(),page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{const response=await page.goto(`http://127.0.0.1:${port}/dashboard`,{waitUntil:'networkidle',timeout:60000});row.httpStatus=response?.status();row.finalPath=new URL(page.url()).pathname;
   const body=await page.locator('body').innerText();fs.writeFileSync(path.join(out,sha.slice(0,7)+'-'+mode+'-body.txt'),body);
   row.errors=errors;row.missingConfigInBody=body.includes("Couldn't find next-intl config file");
   const server=fs.readFileSync(log,'utf8');row.missingConfigInServer=server.includes("Couldn't find next-intl config file");
   row.status=row.missingConfigInBody||row.missingConfigInServer||errors.some(e=>e.includes("Couldn't find next-intl config file"))?'APP_I18N_FAILURE':'OTHER_RESULT';
  }finally{await ctx.close();}
 }catch(e){row.status='INFRA_FAILURE';row.error=e.message;}
 finally{if(child.exitCode===null){await new Promise(resolve=>{child.once('exit',resolve);child.kill();});}fs.closeSync(fd);}
 results.push(row);console.log(JSON.stringify(row));}
try{browser=await chromium.launch({headless:true,executablePath:config.chromium});
 for(const sha of pins){const rc=path.join(out,sha.slice(0,7));git(root,'worktree','add','--detach',rc,sha);
  fs.symlinkSync(path.join(shared,'node_modules'),path.join(rc,'node_modules'),'junction');
  const names=git(rc,'ls-tree','-r','--name-only','HEAD','--','apps/booking-admin').split('\n');
  const sources=['apps/booking-admin/next.config.ts','apps/booking-admin/open-next.config.ts','apps/booking-admin/src/app/dashboard/layout.tsx','apps/booking-admin/src/app/layout.tsx'];
  const evidence={sha,packageLockSha256:crypto.createHash('sha256').update(lock).digest('hex'),sourceFiles:sources.map(p=>({path:p,gitBlob:git(rc,'rev-parse','HEAD:'+p),sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(rc,p))).digest('hex')})),requestConfigCandidates:names.filter(p=>/i18n.*request|next-intl\.config/.test(p))};
  fs.writeFileSync(path.join(out,sha.slice(0,7)+'-source.json'),JSON.stringify(evidence,null,2));
  await probe(rc,sha,'dev');const buildExit=await exec(sha.slice(0,7)+'-build',[path.join(rc,'node_modules/next/dist/bin/next'),'build','--webpack'],path.join(rc,'apps/booking-admin'));
  if(buildExit===0)await probe(rc,sha,'start');else results.push({sha,mode:'start',status:'SKIP',reason:'production build exit '+buildExit});
  const diff=git(rc,'diff',sha,'--','apps');fs.writeFileSync(path.join(out,sha.slice(0,7)+'-integrity.json'),JSON.stringify({status:diff?'FAIL':'PASS',diffBytes:Buffer.byteLength(diff)}));if(diff)throw Error('Application drift detected');
 }
}finally{if(browser)await browser.close();fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({results,scope:'Local dev and Next production start; no deployed Cloudflare acceptance claimed; no app changes'},null,2));console.log('Evidence: '+out);}
