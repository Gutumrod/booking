/**
 * BK01 P0 — H6: no `[[OWNER INPUT …]]` placeholder may reach a screen the customer
 * or the shop sees (council finding G32, brief 28 §4).
 *
 * THE DEFECT. `apps/booking-consumer/messages/th.json` (and its EN twin) carries 21
 * `[[OWNER INPUT: …]]` placeholders: the retention period, the privacy request
 * channel, the approved deposit/refund wording, the number of active providers per
 * plan, the Pro price, VAT treatment, the shop-owned OA add-on price. They are
 * visible as raw text on the legal pages today. They are there because the Owner has
 * not yet supplied the facts and a qualified legal reviewer has not passed them — the
 * draft badge says so on screen — which is a legitimate state to be in, but NOT a
 * legitimate thing to ship to a paying customer.
 *
 * WHAT THIS GATE DOES. It scans every message file the two apps render to a user and
 * fails when a placeholder is present. It runs NOW as a warning-level check
 * (`npm run gate:owner-input` exits 0 with a report, `--enforce` exits 1) because
 * brief 28 §4 schedules the hard failure before CP3, while the legal text is still
 * with the lawyer. The scan itself is the same either way, so switching the mode does
 * not change what is measured.
 *
 * WHO IS "THE USER" HERE. `apps/booking-consumer/messages/*.json` and
 * `apps/booking-admin/messages/*.json` are the two apps' rendered copy. `docs/legal/*`
 * and `docs/house-swarm-1/*` are the readable DRAFTS and their working notes; they
 * exist to carry the placeholders and are NOT rendered by either app, so they are
 * deliberately outside this scan (a repository-wide scan would also match the gate's
 * own pattern and this file's own explanation of it).
 *
 * Usage:
 *   node scripts/check-owner-input-placeholders.mjs            # report, exit 0
 *   node scripts/check-owner-input-placeholders.mjs --enforce  # fail on any hit
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ENFORCE = process.argv.includes('--enforce');

/** The apps whose message files are rendered to a user. */
const MESSAGE_ROOTS = [
  'apps/booking-consumer/messages',
  'apps/booking-admin/messages',
];

/**
 * The placeholder form the Owner inputs use, plus the general `[[…]]` shape so a
 * different placeholder cannot slip through by not being spelled "OWNER INPUT".
 */
const PLACEHOLDER = /\[\[[^\]]*\]\]/g;

function messageFiles() {
  const files = [];
  for (const root of MESSAGE_ROOTS) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root)) {
      if (entry.endsWith('.json')) files.push(join(root, entry));
    }
  }
  return files.sort();
}

const hits = [];
for (const file of messageFiles()) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const match of line.matchAll(PLACEHOLDER)) {
      hits.push({ file, line: index + 1, text: match[0].slice(0, 120) });
    }
  });
}

const files = messageFiles();
console.log(`Owner-input placeholder gate — scanned ${files.length} rendered message file(s)`);
for (const file of files) console.log(`  scanned ${file}`);

if (hits.length === 0) {
  console.log('Owner-input placeholders in rendered copy: 0 — nothing to fix.');
  process.exit(0);
}

console.log(`\nOwner-input placeholders in rendered copy: ${hits.length}`);
const byFile = new Map();
for (const hit of hits) byFile.set(hit.file, (byFile.get(hit.file) ?? 0) + 1);
for (const [file, count] of byFile) console.log(`  ${file}: ${count}`);

if (ENFORCE) {
  console.log('\nFAIL: a placeholder is visible on a screen a customer or shop can open.');
  console.log('Fix: supply the Owner fact and the legal review, replace the placeholder,');
  console.log('then re-run. Reaching a paid customer with a raw placeholder is a');
  console.log('contract and PDPA problem, not a cosmetic one.');
  process.exit(1);
}

console.log('\nWARN (enforcement off): these placeholders are visible today. The hard');
console.log('failure is scheduled before CP3, while the legal wording is with the lawyer');
console.log('(brief 28 §4 H6). Re-run with --enforce in the release gate.');
process.exit(0);
