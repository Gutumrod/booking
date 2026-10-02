// Offline only: own previously created rehearsal cluster; never accepts a target URL.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn,spawnSync} from 'node:child_process';

const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
assert.deepEqual(Object.keys(config).sort(),['clusterEvidence','evidenceRoot','pgBin','trialGateway'].sort());
for(const value of Object.values(config))assert.ok(path.isAbsolute(value));
const prior=JSON.parse(fs.readFileSync(path.join(config.clusterEvidence,'summary.json')));
assert.equal(prior.status,'PASS');assert.equal(prior.labConnectionAttempted,false);
const data=path.join(config.clusterEvidence,'data');
const port=Number([...fs.readFileSync(path.join(data,'postgresql.conf'),'utf8').matchAll(/^port=(\d+)$/gm)].at(-1)[1]);
const evidence=path.join(config.evidenceRoot,new Date().toISOString().replace(/[-:.]/g,''));fs.mkdirSync(evidence,{recursive:true});
const require=createRequire(import.meta.url),{createClient}=require('@supabase/supabase-js');
const postgres=createRequire(config.trialGateway)('postgres');
const ctl=(args)=>{const r=spawnSync(path.join(config.pgBin,'pg_ctl.exe'),args,{windowsHide:true,stdio:'ignore'});assert.equal(r.status,0);};
const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const gatewayPort=server.address().port;await new Promise(resolve=>server.close(resolve));
const secret=crypto.randomBytes(32).toString('hex');
const h=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),p=Buffer.from(JSON.stringify({role:'bk01_runtime',aud:'authenticated',exp:Math.floor(Date.now()/1000)+600})).toString('base64url');
const token=`${h}.${p}.${crypto.createHmac('sha256',secret).update(`${h}.${p}`).digest('base64url')}`;
let child,db,running=false,metadataAdded=false;let objectPath;const summary={status:'FAIL',scope:'OFFLINE_SIMULATION',rcSha:prior.rcSha,labConnectionAttempted:false,hostedStorageVerified:false};
try {
  ctl(['-D',data,'-l',path.join(config.clusterEvidence,'postgres.log'),'-w','start']);running=true;
  db=postgres(`postgresql://fixture_admin@127.0.0.1:${port}/postgres`,{max:1,prepare:false,onnotice:()=>{}});
  const [guard]=await db`select current_setting('data_directory') data`;assert.equal(path.resolve(guard.data),path.resolve(data));
  // The SQL-only rehearsal uses a minimal managed storage table. Match the R3
  // harness metadata column for this wire-format probe, then remove it at closeout.
  const [column]=await db`select exists(select 1 from information_schema.columns where table_schema='storage' and table_name='objects' and column_name='metadata') present`;
  if(!column.present){await db`alter table storage.objects add column metadata jsonb`;metadataAdded=true;}
  summary.managedFixtureMetadataColumnAdded=metadataAdded;
  const log=fs.openSync(path.join(evidence,'gateway.log'),'a');
  child=spawn(process.execPath,[config.trialGateway],{windowsHide:true,stdio:['ignore',log,log],env:{...process.env,RC_PG_PORT:String(port),RC_GATEWAY_PORT:String(gatewayPort),RC_EVIDENCE:evidence,RC_JWT_SECRET:secret}});fs.closeSync(log);
  const base=`http://127.0.0.1:${gatewayPort}`;
  for(let i=0;i<100;i++){try{const r=await fetch(base+'/health');if(r.ok)break;}catch{}if(i===99)throw Error('OWN_GATEWAY_NOT_READY');await new Promise(resolve=>setTimeout(resolve,100));}
  const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64');
  objectPath=`${crypto.randomUUID()}/${crypto.randomUUID()}.png`;
  await db.begin(async tx=>{await tx.unsafe("SET LOCAL ROLE bk01_migrator; SET LOCAL request.jwt.claim.role='bk01_runtime'");await tx`select wstera_platform_internal.register_storage_upload_grant('deposit-slips',${objectPath},${crypto.randomBytes(32).toString('hex')},'image/png',${bytes.length},statement_timestamp()+interval '4 minutes')`;});
  const wires=[];
  const client=createClient(base,'offline-public-placeholder',{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:`Bearer ${token}`},fetch:async(url,init)=>{const request=new Request(url,init);if(request.method==='PUT')wires.push({contentType:request.headers.get('content-type'),size:(await request.clone().arrayBuffer()).byteLength});return fetch(request);}}});
  const signed=await client.storage.from('deposit-slips').createSignedUploadUrl(objectPath);assert.equal(signed.error,null);
  const upload=await client.storage.from('deposit-slips').uploadToSignedUrl(objectPath,signed.data.token,new File([bytes],'slip.png',{type:'image/png'}),{contentType:'image/png'});
  summary.observedFileUpload={message:upload.error?.message,statusCode:upload.error?.statusCode,wires};
  assert.ok(upload.error?.message.includes('No matching unused product storage grant'));assert.equal(Number(upload.error.statusCode),500);
  const [before]=await db`select consumed_at from wstera_platform_internal.storage_upload_grants where object_path=${objectPath}`;assert.equal(before.consumed_at,null);
  const raw=await fetch(signed.data.signedUrl,{method:'PUT',headers:{'Content-Type':'image/png'},body:bytes});assert.equal(raw.status,200);
  const [after]=await db`select consumed_at from wstera_platform_internal.storage_upload_grants where object_path=${objectPath}`;assert.ok(after.consumed_at);
  const [object]=await db`select metadata from storage.objects where bucket_id='deposit-slips' and name=${objectPath}`;assert.equal(object.metadata.mimetype,'image/png');assert.equal(object.metadata.size,bytes.length);
  assert.ok(wires[0].contentType.startsWith('multipart/form-data;'));assert.ok(wires[0].size>bytes.length);
  Object.assign(summary,{status:'PASS',ledgerCount:(await db`select count(*)::int count from local_service_internal.schema_migrations`)[0].count,fixtureGatewaySha256:crypto.createHash('sha256').update(fs.readFileSync(config.trialGateway)).digest('hex'),fileUpload:{status:500,message:upload.error.message,wire:wires[0],grantConsumed:false},rawUpload:{status:raw.status,metadata:object.metadata,grantConsumed:true},conclusion:'TRIAL_STORAGE_FIXTURE_MULTIPART_METADATA_BUG; raw R3 does not cover browser File upload'});
} catch(error){summary.error=error.message;process.exitCode=1;}
finally {
  if(child){child.kill();await new Promise(resolve=>{if(child.exitCode!==null)resolve();else child.once('exit',resolve);});}
  if(db){if(objectPath){await db`delete from storage.objects where bucket_id='deposit-slips' and name=${objectPath}`;await db`delete from wstera_platform_internal.storage_upload_grants where object_path=${objectPath}`;}if(metadataAdded)await db`alter table storage.objects drop column metadata`;await db.end();}
  if(running){ctl(['-D',data,'-m','fast','-w','stop']);summary.clusterStopped=true;}
  fs.writeFileSync(path.join(evidence,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify({evidence,...summary}));
}
