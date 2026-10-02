#!/usr/bin/env node
/**
 * F2 — cross-shell entry point for the route-export gate.
 *
 * `package.json` scripts run under cmd.exe on Windows or /bin/sh elsewhere. Neither
 * shell passes the App Router bracket directory `[shopId]` through reliably: cmd
 * globs it, sh leaves it as a literal that happens to work only when the working
 * directory is already the repo root, and a bare `apps/*` glob is not expanded by
 * cmd.exe at all. So the npm script must not depend on shell globbing.
 *
 * This wrapper enumerates every `app/api/**\/route.ts` module itself (skipping
 * node_modules and .next) across BOTH apps and delegates to the existing
 * `scripts/check-route-exports.mjs`, which owns the actual allow-list. Running the
 * gate locally and through `npm run gate:route-exports` therefore checks the same
 * nine modules on every host.
 *
 * Exit codes: 0 = every route module clean; 1 = at least one offending export, an
 * unreadable module, or no module found (a gate that matches nothing must never
 * report success).
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const APPS = ['apps/booking-consumer', 'apps/booking-admin'];
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', '.wrangler', 'dist', 'build']);

function collect(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      collect(full, out);
    } else if (entry.isFile() && entry.name === 'route.ts') {
      out.push(full);
    }
  }
  return out;
}

const files = APPS
  .flatMap((app) => collect(join(ROOT, app, 'src', 'app', 'api')))
  .sort();

if (files.length === 0) {
  console.error('gate:route-exports: found no app/api/**/route.ts modules — refusing to pass vacuously');
  process.exit(1);
}

console.log(`gate:route-exports: checking ${files.length} route module(s)`);
const result = spawnSync(
  process.execPath,
  [join(ROOT, 'scripts', 'check-route-exports.mjs'), ...files],
  { stdio: 'inherit' },
);
process.exit(result.status ?? 1);
