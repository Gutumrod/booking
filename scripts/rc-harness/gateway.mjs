// Local issuer/Auth/Storage scaffolding. Data API requests always reach real
// PostgREST/PG roles. No database responses or business decisions are mocked.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';
const env=process.env;
const db=postgres(`postgresql://runtime_probe@127.0.0.1:${env.RC_PG_PORT}/postgres`,{max:4,prepare:false,onnotice:()=>{}});
const owner='90000000-0000-4000-8000-000000000001';
const user={id:owner,aud:'authenticated',role:'authenticated',email:'owner@example.test',email_confirmed_at:new Date().toISOString(),app_metadata:{provider:'email',providers:['email']},user_metadata:{},identities:[],created_at:new Date().toISOString(),is_anonymous:false};
const grants=new Map();
const sign=payload=>{const h=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');const p=Buffer.from(JSON.stringify(payload)).toString('base64url');return `${h}.${p}.${crypto.createHmac('sha256',env.RC_JWT_SECRET).update(`${h}.${p}`).digest('base64url')}`;};
function claims(value) {
  const token=value?.replace(/^Bearer /,'')??'',parts=token.split('.');
  if(parts.length!==3)throw Error('Invalid local token');
  const expected=crypto.createHmac('sha256',env.RC_JWT_SECRET).update(`${parts[0]}.${parts[1]}`).digest();
  const provided=Buffer.from(parts[2],'base64url');if(expected.length!==provided.length||!crypto.timingSafeEqual(expected,provided))throw Error('Invalid local token');
  const c=JSON.parse(Buffer.from(parts[1],'base64url'));if(c.exp<=Date.now()/1000)throw Error('Expired local token');return c;
}
const server=http.createServer(async(req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','*');res.setHeader('Access-Control-Allow-Methods','GET,POST,PUT,DELETE,OPTIONS');
  const json=(code,body)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(body));};
  try {
    if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/health'){json(200,{ok:true});return;}
    if(url.pathname==='/issuer') {
      if(req.method!=='POST'||req.headers.authorization!==`Basic ${Buffer.from(`${env.HOUSE_RUNTIME_CLIENT_ID}:${env.HOUSE_RUNTIME_CLIENT_SECRET}`).toString('base64')}`){json(401,{error:'invalid_client'});return;}
      const body=await read(req);const params=new URLSearchParams(body.toString());
      if(params.get('scope')!=='bk01_runtime'||params.get('audience')!=='authenticated'||params.get('grant_type')!=='client_credentials'){json(400,{error:'invalid_scope'});return;}
      json(200,{access_token:sign({role:'bk01_runtime',aud:'authenticated',exp:Math.floor(Date.now()/1000)+600}),token_type:'Bearer',expires_in:600});return;
    }
    if(url.pathname.startsWith('/rest/v1')) {
      const headers={...req.headers};delete headers.host;delete headers.connection;delete headers['content-length'];
      const response=await fetch(`http://127.0.0.1:${env.RC_REST_PORT}${url.pathname.slice(8)}${url.search}`,{method:req.method,headers,body:['GET','HEAD'].includes(req.method)?undefined:await read(req)});
      for(const [k,v] of response.headers)if(!['transfer-encoding','content-encoding','content-length'].includes(k))res.setHeader(k,v);
      res.writeHead(response.status);res.end(Buffer.from(await response.arrayBuffer()));return;
    }
    // Auth is an explicitly labelled local fixture, never a claim of hosted Auth proof.
    if(url.pathname==='/auth/v1/user'){const c=claims(req.headers.authorization);if(c.sub!==owner){json(403,{error:'fixture owner only'});return;}json(200,user);return;}
    if(url.pathname==='/auth/v1/token'){const body=JSON.parse((await read(req)).toString());if(body.email!=='owner@example.test'||body.password!=='fixture-only'){json(400,{error:'fixture credentials'});return;}
      json(200,{access_token:env.RC_OWNER_TOKEN,refresh_token:crypto.randomBytes(32).toString('hex'),expires_in:600,expires_at:Math.floor(Date.now()/1000)+600,token_type:'bearer',user});return;}
    if(url.pathname.startsWith('/storage/v1/object/upload/sign/deposit-slips/')) {
      const objectPath=decodeURIComponent(url.pathname.split('/deposit-slips/')[1]);
      if(req.method==='POST') {
        const c=claims(req.headers.authorization);if(c.role!=='bk01_runtime'){json(403,{error:'runtime required'});return;}
        const [allowed]=await db.begin(async tx=>{await tx.unsafe("SET LOCAL ROLE bk01_runtime; SET LOCAL request.jwt.claim.role='bk01_runtime'");return tx`select wstera_platform_internal.can_create_storage_upload('deposit-slips',${objectPath}) ok`;});
        if(!allowed.ok){json(403,{error:'missing unused DB grant'});return;}
        const token=crypto.randomBytes(32).toString('hex');grants.set(token,{objectPath,expires:Date.now()+300000});
        json(200,{url:`/object/upload/sign/deposit-slips/${objectPath}?token=${token}`});return;
      }
      if(req.method==='PUT') {
        const g=grants.get(url.searchParams.get('token'));if(!g||g.expires<Date.now()||g.objectPath!==objectPath){json(403,{error:'invalid upload token'});return;}
        const bytes=await read(req);const mime=req.headers['content-type'];
        await db.begin(async tx=>{await tx.unsafe("SET LOCAL ROLE bk01_runtime; SET LOCAL request.jwt.claim.role='bk01_runtime'");await tx`insert into storage.objects(bucket_id,name,metadata) values('deposit-slips',${objectPath},${tx.json({mimetype:mime,size:bytes.length})})`;});
        grants.delete(url.searchParams.get('token'));const file=path.resolve(env.RC_EVIDENCE,'objects',objectPath);
        const objectRoot=path.resolve(env.RC_EVIDENCE,'objects')+path.sep;if(!file.startsWith(objectRoot))throw Error('object path rejected');
        fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);json(200,{Key:`deposit-slips/${objectPath}`});return;
      }
    }
    if(url.pathname.startsWith('/storage/v1/object/sign/deposit-slips/')) {
      const c=claims(req.headers.authorization);if(c.role!=='authenticated'||c.sub!==owner){json(403,{error:'owner required'});return;}
      const objectPath=url.pathname.split('/deposit-slips/')[1];json(200,{signedURL:`/object/local/deposit-slips/${objectPath}`});return;
    }
    if(url.pathname.startsWith('/storage/v1/object/local/deposit-slips/')) {
      const objectPath=decodeURIComponent(url.pathname.split('/deposit-slips/')[1]);const file=path.resolve(env.RC_EVIDENCE,'objects',objectPath);
      if(!file.startsWith(path.resolve(env.RC_EVIDENCE,'objects')+path.sep)){json(403,{error:'path'});return;}
      res.writeHead(200,{'Content-Type':'image/png'});res.end(fs.readFileSync(file));return;
    }
    json(404,{error:'fixture endpoint unsupported'});
  } catch(error) {json(400,{error:error.message});}
});
async function read(req){const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>6*1024*1024)throw Error('request too large');chunks.push(c);}return Buffer.concat(chunks);}
server.listen(Number(env.RC_GATEWAY_PORT),'127.0.0.1',()=>console.log('Local gateway ready; real PostgREST, fixture issuer/Auth/Storage'));
process.on('SIGTERM',()=>server.close(async()=>{await db.end();process.exit(0);}));
