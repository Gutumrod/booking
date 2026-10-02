import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import { validateHistory } from './evidence-history.mjs';

const manifest = { entries: [5,10,15].map(order => ({ order, path: `migrations/order${order}.sql`, sha256: String(order).padStart(64,'0') })) };
function cleanupTemporary(dir){const actual=fs.realpathSync(dir),tmp=fs.realpathSync(os.tmpdir());
 if(path.dirname(actual)!==tmp||!/^bk01-(history|operator)-[A-Za-z0-9]+$/.test(path.basename(actual)))throw Error('Temporary cleanup target rejected');
 fs.rmSync(actual,{recursive:true,force:true});
}
function fixture(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bk01-history-'));
  const records = manifest.entries.map((e, i) => ({ file:e.path, sha256:e.sha256, operation:'apply', result:'applied',
    at:`2026-10-01T00:00:0${i}.000Z`, toolGitSha:'a'.repeat(40), provenance:{mode:'platform-sql-apply',projectRef:'local-fixture',sourceRepository:'fixture'} }));
  const write = () => { for (const r of records) fs.writeFileSync(path.join(dir,`apply-${r.file.replace(/[^a-zA-Z0-9_-]/g,'_')}-${r.at?.replace(/[-:.]/g,'') ?? '20261001T000002000Z'}-12345678.json`),JSON.stringify(r)); };
  try { return fn(dir,records,write); } finally { cleanupTemporary(dir); }
}
test('legacy stdout without at reproduces EVIDENCE_HISTORY_INVALID (red-before)',()=>fixture((dir,records,write)=>{
  write(); fs.writeFileSync(path.join(dir,'apply-order15.stdout.json'),JSON.stringify({result:'applied',file:records[2].file,sha256:records[2].sha256}));
  assert.throws(()=>validateHistory(dir,manifest),/EVIDENCE_HISTORY_INVALID/);
}));
test('legacy empty plan stdout reproduces parse failure (red-before)',()=>fixture((dir,r,write)=>{
  write();fs.writeFileSync(path.join(dir,'plan-before-order20.stdout.json'),'');assert.throws(()=>validateHistory(dir,manifest),/EVIDENCE_HISTORY_INVALID/);
}));
test('tool-only exact records pass without altering bytes (green-after)',()=>fixture((dir,r,write)=>{
  write();const before=fs.readdirSync(dir).map(n=>fs.readFileSync(path.join(dir,n)));assert.equal(validateHistory(dir,manifest).status,'PASS');
  assert.deepEqual(fs.readdirSync(dir).map(n=>fs.readFileSync(path.join(dir,n))),before);
}));
for(const [name,change] of [
  ['duplicate timestamp',r=>{r[1].at=r[0].at;}],['reversed timestamp',r=>{r[1].at='2026-09-30T00:00:00.000Z';}],
  ['missing at',r=>{delete r[2].at;}],['invalid calendar date',r=>{r[2].at='2026-02-30T00:00:00.000Z';}],
  ['wrong hash',r=>{r[2].sha256='b'.repeat(64);}],['missing provenance',r=>{delete r[2].provenance;}],
  ['mixed target',r=>{r[2].provenance.projectRef='other';}],['failed mutation',r=>{r[2].result='failed';}],
]) test(name,()=>fixture((dir,r,write)=>{change(r);write();assert.throws(()=>validateHistory(dir,manifest),/EVIDENCE_HISTORY_INVALID/);}));
test('no records fails closed',()=>fixture(dir=>assert.throws(()=>validateHistory(dir,manifest),/EVIDENCE_HISTORY_INVALID/)));
test('foreign file and nested directory are forbidden',()=>fixture((dir,r,write)=>{
  write();fs.mkdirSync(path.join(dir,'operator'));assert.throws(()=>validateHistory(dir,manifest),/EVIDENCE_HISTORY_INVALID/);
}));
test('CLI red exit 1 before separation; green exit 0 after tool/operator separation',()=>fixture((dir,r,write)=>{
 write();const outer=fs.mkdtempSync(path.join(os.tmpdir(),'bk01-operator-'));
 try {
  const manifestPath=path.join(outer,'manifest.json');fs.writeFileSync(manifestPath,JSON.stringify(manifest));
  const legacy=path.join(dir,'apply-order15.stdout.json');const original=JSON.stringify({result:'applied',file:r[2].file,sha256:r[2].sha256});fs.writeFileSync(legacy,original);
  const cli=new URL('./evidence-history.mjs',import.meta.url);
  const before=spawnSync(process.execPath,[fileURLToPath(cli),dir,manifestPath],{encoding:'utf8',windowsHide:true});
  assert.equal(before.status,1);assert.match(before.stderr,/EVIDENCE_HISTORY_INVALID/);
  // Move only this synthetic operator fixture; real histories are never repaired by tests.
  const operator=path.join(outer,'operator');fs.mkdirSync(operator);fs.renameSync(legacy,path.join(operator,'apply-order15.stdout.json'));
  assert.equal(fs.readFileSync(path.join(operator,'apply-order15.stdout.json'),'utf8'),original);
  const after=spawnSync(process.execPath,[fileURLToPath(cli),dir,manifestPath],{encoding:'utf8',windowsHide:true});assert.equal(after.status,0);
 }finally{cleanupTemporary(outer);}
}));
