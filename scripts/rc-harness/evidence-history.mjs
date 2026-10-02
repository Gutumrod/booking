import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const invalid = (reason) => { throw new Error(`EVIDENCE_HISTORY_INVALID: ${reason}`); };
const object = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const sha = (x) => typeof x === 'string' && /^[a-f0-9]{64}$/i.test(x);
const gitSha = (x) => typeof x === 'string' && /^[a-f0-9]{40}$/i.test(x);
const utc = (x) => typeof x === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(x)
  && Number.isFinite(Date.parse(x)) && new Date(x).toISOString() === (x.includes('.') ? x : x.replace('Z', '.000Z'));

/** Read-only; does not repair, move, delete, or normalize evidence bytes. */
export function validateHistory(directory, manifest, expectedOrders = [5, 10, 15]) {
  if (!object(manifest) || !Array.isArray(manifest.entries)) invalid('manifest shape');
  const names = fs.readdirSync(directory).sort();
  const mutations = [], inventory = [];
  for (const name of names) {
    const filename = path.join(directory, name);
    if (!fs.lstatSync(filename).isFile()) invalid(`non-regular tool file: ${name}`);
    if (name !== 'latest-plan.json' && !/^(apply|rollback)-[A-Za-z0-9_-]+-\d{8}T\d{9}Z-[a-f0-9]{8}\.json$/.test(name)) invalid(`not a tool filename: ${name}`);
    const bytes = fs.readFileSync(filename);
    let record;
    try { record = JSON.parse(bytes.toString('utf8')); } catch { invalid(`JSON parse: ${name}`); }
    if (!object(record)) invalid(`record shape: ${name}`);
    inventory.push({ name, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length });
    if (name === 'latest-plan.json') {
      if (!utc(record.createdAt) || !gitSha(record.toolGitSha)
        || typeof record.projectRef !== 'string' || !record.projectRef || !object(record.state) || !object(record.baseline)) invalid('latest-plan shape');
      continue;
    }
    if (!['apply', 'rollback'].includes(record.operation) || !['applied', 'rolled_back', 'failed'].includes(record.result)
      || !utc(record.at) || !sha(record.sha256) || !gitSha(record.toolGitSha)
      || !object(record.provenance) || record.provenance.mode !== `platform-sql-${record.operation}`
      || typeof record.provenance.projectRef !== 'string' || !record.provenance.projectRef
      || typeof record.provenance.sourceRepository !== 'string' || !record.provenance.sourceRepository) invalid(`tool record schema: ${name}`);
    const entry = manifest.entries.find((x) => x.path === record.file && x.sha256.toLowerCase() === record.sha256.toLowerCase());
    if (!entry || !Number.isInteger(entry.order)) invalid(`manifest pin mismatch: ${name}`);
    const stem = record.file.replace(/[^a-zA-Z0-9_-]/g, '_');
    if (!name.startsWith(`${record.operation}-${stem}-${record.at.replace(/[-:.]/g, '')}-`)) invalid(`filename/record mismatch: ${name}`);
    if (record.result === 'failed') invalid(`failed mutation requires controller review: ${name}`);
    if (record.operation !== 'apply' || record.result !== 'applied') invalid(`GO baseline is forward-only: ${name}`);
    mutations.push({ order: entry.order, file: record.file, at: record.at, projectRef: record.provenance.projectRef });
  }
  mutations.sort((a, b) => a.order - b.order);
  if (JSON.stringify(mutations.map((x) => x.order)) !== JSON.stringify(expectedOrders)) invalid('required orders must be exactly 5/10/15');
  for (let i = 1; i < mutations.length; i++) {
    if (Date.parse(mutations[i - 1].at) >= Date.parse(mutations[i].at)) invalid('timestamps must be strictly increasing with migration order');
    if (mutations[i - 1].projectRef !== mutations[i].projectRef) invalid('mixed target provenance');
  }
  return { status: 'PASS', mutations, inventory };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 4) throw new Error('Usage: node evidence-history.mjs TOOL_DIRECTORY MANIFEST_JSON');
    console.log(JSON.stringify(validateHistory(process.argv[2], JSON.parse(fs.readFileSync(process.argv[3], 'utf8'))), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
