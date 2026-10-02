// Offline control using the pinned application's real OpenNext/Wrangler config.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {spawn,execFileSync} from 'node:child_process';
if(!process.argv[3])throw Error('Usage: node triage-cloudflare.mjs CONFIG_JSON RC_WORKTREE');
const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),sourceRc=path.resolve(process.argv[3]);
const sha=execFileSync('git',['-C',sourceRc,'rev-parse','HEAD'],{encoding:'utf8',windowsHide:true}).trim();
if(sha!=='6efec0ca7275b583076deb4eec1aa953f0bd9354')throw Error('Wrong RC pin');
const out=path.join(path.dirname(sourceRc),'cloudflare-'+new Date().toISOString().replace(/[-:.]/g,''));fs.mkdirSync(out,{recursive:true});
const rc=config.cloudflareBuiltRc?path.resolve(config.cloudflareBuiltRc):path.join(out,'rc');
if(config.cloudflareBuiltRc){if(execFileSync('git',['-C',rc,'rev-parse','HEAD'],{encoding:'utf8',windowsHide:true}).trim()!==sha||!fs.existsSync(path.join(rc,'apps/booking-admin/.open-next/worker.js')))throw Error('Reviewed built RC required');}
else execFileSync('git',['-C',sourceRc,'worktree','add','--detach',rc,sha],{windowsHide:true});
const app=path.join(rc,'apps/booking-admin'),nodeModules=path.join(rc,'node_modules');
const env={...Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|APPDATA|LOCALAPPDATA|USERPROFILE|PROGRAMFILES|PROGRAMFILES\(X86\)|SYSTEMDRIVE|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE)$/i.test(k))),CI:'true',NEXT_TELEMETRY_DISABLED:'1',WRANGLER_SEND_METRICS:'false',NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:9',NEXT_PUBLIC_SUPABASE_ANON_KEY:'rc-triage-public-placeholder'};
const result={sha,status:'UNVERIFIED',target:'local-only OpenNext/Wrangler',deployedAcceptance:false,reusedBuild:Boolean(config.cloudflareBuiltRc)};
let worker,fd;
try{
 if(!config.cloudflareBuiltRc){
 const npmCli=config.npmCli??path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
 const depsOut=fs.openSync(path.join(out,'dependencies.stdout.log'),'w'),depsErr=fs.openSync(path.join(out,'dependencies.stderr.log'),'w');
 try{execFileSync(process.execPath,[npmCli,'ci','--no-audit','--no-fund'],{cwd:rc,env,windowsHide:true,timeout:300000,stdio:['ignore',depsOut,depsErr]});}finally{fs.closeSync(depsOut);fs.closeSync(depsErr);}
 const stdout=fs.openSync(path.join(out,'build.stdout.log'),'w'),stderr=fs.openSync(path.join(out,'build.stderr.log'),'w');
 const child=spawn(process.execPath,[path.join(nodeModules,'@opennextjs/cloudflare/dist/cli/index.js'),'build'],{cwd:app,env,windowsHide:true,stdio:['ignore',stdout,stderr]});
 try{result.buildExit=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();reject(Error('Build timeout'));},300000);child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('exit',code=>{clearTimeout(timer);resolve(code);});});}finally{fs.closeSync(stdout);fs.closeSync(stderr);}
 }else result.buildExit=0;
 if(result.buildExit!==0){result.status='WORKER_PROBE_SKIPPED_BUILD_FAILED';}
 else{
  const port=await new Promise(resolve=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const n=server.address().port;server.close(()=>resolve(n));});});
  const logfile=path.join(out,'worker.log');fd=fs.openSync(logfile,'w');
  worker=spawn(process.execPath,[path.join(nodeModules,'wrangler/bin/wrangler.js'),'dev','--local','--log-level','debug','--ip','127.0.0.1','--port',String(port),'--config',path.join(app,'wrangler.jsonc')],{cwd:app,env,windowsHide:true,stdio:['ignore',fd,fd]});
  let error;worker.once('error',e=>{error=e;});let response;
  const until=Date.now()+60000;while(Date.now()<until){if(error)throw error;if(worker.exitCode!==null)throw Error('Worker exited '+worker.exitCode);
   try{response=await fetch(`http://127.0.0.1:${port}/dashboard`,{signal:AbortSignal.timeout(10000)});break;}catch{}await new Promise(resolve=>setTimeout(resolve,500));}
  if(!response)throw Error('Worker readiness timeout');const body=await response.text();fs.writeFileSync(path.join(out,'dashboard-body.txt'),body);
  await new Promise(resolve=>setTimeout(resolve,1500));
  result.httpStatus=response.status;result.missingConfig=fs.readFileSync(logfile,'utf8').includes("Couldn't find next-intl config file")||body.includes("Couldn't find next-intl config file");
  result.status=result.missingConfig?'APP_I18N_FAILURE':'OTHER_RESULT';
 }
}catch(e){result.status='INFRA_FAILURE';result.error=e.message;}
finally{if(worker?.exitCode===null)await new Promise(resolve=>{worker.once('exit',resolve);worker.kill();});if(fd!==undefined)fs.closeSync(fd);
 const diff=execFileSync('git',['-C',rc,'diff',sha,'--','apps'],{encoding:'utf8',windowsHide:true});result.appIntegrity={status:diff?'FAIL':'PASS',diffBytes:Buffer.byteLength(diff)};
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));console.log('Evidence: '+out);}
