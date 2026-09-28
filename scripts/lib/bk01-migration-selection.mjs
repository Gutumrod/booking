export function parseBk01MigrationArgs(args) {
  const [mode, ...options] = args;
  if (!['plan', 'apply'].includes(mode)) {
    throw new Error('Usage: node scripts/bk01-migrate.mjs <plan|apply> [--through <migration-filename>]');
  }

  let throughFilename;
  for (let index = 0; index < options.length; index += 1) {
    if (options[index] !== '--through') {
      throw new Error(`Unsupported BK01 migration option: ${options[index]}`);
    }
    if (throughFilename !== undefined) {
      throw new Error('--through may be specified only once.');
    }
    const candidate = options[index + 1];
    if (!candidate || candidate.startsWith('--')) {
      throw new Error('--through requires a migration filename.');
    }
    throughFilename = candidate;
    index += 1;
  }

  return { mode, throughFilename };
}

export function selectPendingBk01Migrations(migrations, applied, throughFilename) {
  const pending = migrations.filter((migration) => !applied.has(migration.migrationId));
  if (throughFilename === undefined) return pending;

  const throughIndex = migrations.findIndex((migration) => migration.filename === throughFilename);
  if (throughIndex < 0) {
    throw new Error(`Unknown BK01 migration filename for --through: ${throughFilename}`);
  }

  const target = migrations[throughIndex];
  if (applied.has(target.migrationId)) {
    throw new Error(`--through migration has already been applied: ${throughFilename}`);
  }

  const firstPendingIndex = migrations.findIndex((migration) => !applied.has(migration.migrationId));
  if (firstPendingIndex < 0 || throughIndex < firstPendingIndex) {
    throw new Error(`--through migration is not pending: ${throughFilename}`);
  }

  // A staged apply is only safe when the ledger still forms a prefix. An applied
  // migration after the first pending item would make the requested interval skip
  // a migration and could conceal a partial or out-of-order deployment.
  const appliedAfterGap = migrations.slice(firstPendingIndex).find((migration) =>
    applied.has(migration.migrationId));
  if (appliedAfterGap) {
    throw new Error(`Applied BK01 migration ledger is out of order at ${appliedAfterGap.filename}.`);
  }

  return pending.filter((migration) => migrations.indexOf(migration) <= throughIndex);
}
