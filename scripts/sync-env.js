const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const targets = [
  path.join(root, 'apps', 'booking-admin', '.env.local'),
  path.join(root, 'apps', 'booking-consumer', '.env.local'),
];

function fail(message) {
  console.error(`sync-env: ${message}`);
  process.exit(1);
}

const args = process.argv.slice(2);
let sourceArg = '.env.local';
for (let i = 0; i < args.length; i += 1) {
  if (args[i] !== '--source') fail(`unknown argument: ${args[i]}`);
  if (!args[i + 1]) fail('--source requires a repo-relative file path');
  sourceArg = args[i + 1];
  i += 1;
}

const source = path.resolve(root, sourceArg);
const relativeSource = path.relative(root, source);
if (relativeSource.startsWith('..') || path.isAbsolute(relativeSource)) {
  fail('source file must stay inside the BK01 repository');
}
if (!fs.existsSync(source)) {
  if (relativeSource === '.env.staging.local') {
    fail('.env.staging.local not found; copy .env.staging.example and fill non-production values');
  }
  fail(`${relativeSource} not found`);
}

if (!fs.statSync(source).isFile()) fail(`${relativeSource} is not a file`);

try {
  const content = fs.readFileSync(source);
  for (const target of targets) {
    fs.writeFileSync(target, content);
    console.log(
      `sync-env: ${relativeSource} -> ${path.relative(root, target)}`,
    );
  }
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  fail(`failed to sync ${relativeSource}: ${detail}`);
}
