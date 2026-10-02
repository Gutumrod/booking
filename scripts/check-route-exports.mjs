#!/usr/bin/env node
/**
 * Commander-side gate: a Next.js App Router route module may export ONLY HTTP
 * methods and the documented Next config symbols.
 *
 * Next 16.3.6 generates `.next/types/<route>/route.ts`, which asserts via
 * `checkFields<Diff<{...allowed...}, typeof import(route)>>()` that every other
 * export is assignable to `never`. An extra `export` therefore fails typecheck
 * (TS2344) and the production build. This gate fails on the same fact the
 * generated check fails on, so a build is not required to see it — and it also
 * catches the case Next does not currently report (the /api/line/webhook entry).
 *
 * Usage: node check-route-exports.mjs <file> [<file> ...]
 * Exit 0 = every listed file is clean; exit 1 = at least one offending export.
 *
 * Authorised for: `export (async) function GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS`
 * and `export const dynamic|dynamicParams|revalidate|fetchCache|runtime|maxDuration|preferredRegion|config`
 * plus `export type`/`export interface` declarations (types are erased and are not
 * runtime exports, so the generated index signature is not affected by them).
 */
import fs from 'node:fs';

const ALLOWED = [
  /^export\s+(async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*[(<]/,
  /^export\s+const\s+(dynamic|dynamicParams|revalidate|fetchCache|runtime|maxDuration|preferredRegion|config)\s*[:=]/,
  /^export\s+(type|interface)\s/,
];

const files = process.argv.slice(2);
if (files.length === 0) {
  console.log('usage: node check-route-exports.mjs <file> [...]');
  process.exit(2);
}

let failed = false;
for (const file of files) {
  let source;
  try {
    source = fs.readFileSync(file, 'utf8');
  } catch (error) {
    console.log(`${file}: UNREADABLE (${error.code})`);
    failed = true;
    continue;
  }
  const offenders = [];
  for (const line of source.split('\n')) {
    const text = line.trim();
    if (!/^export\b/.test(text)) continue;
    if (ALLOWED.some((pattern) => pattern.test(text))) continue;
    offenders.push(text);
  }
  if (offenders.length === 0) {
    console.log(`${file}: OK`);
  } else {
    failed = true;
    console.log(`${file}: ${offenders.length} non-HTTP export(s):`);
    for (const offender of offenders) console.log(`  ${offender}`);
  }
}

process.exit(failed ? 1 : 0);
