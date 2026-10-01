// Standalone re-runnable check of the ONE refund predicate across the app and the
// SQL spec (Codex round-2 H1). Prints the text-parity result and the full case
// table. Exit 0 only when every case matches the caretaker decision and the only
// divergence is the documented end-time-derivation case.
//
// Usage: node evidence/run-refund-parity.mjs
import {
  CANONICAL_EXPRESSION,
  CASES,
  DOCUMENTED_DIVERGENCES,
  RUNNER,
  normaliseSqlExpression,
  runParity,
  specPredicateExpression,
} from './refund-predicate-parity.mjs';

const canonical = normaliseSqlExpression(CANONICAL_EXPRESSION);
const specText = specPredicateExpression(RUNNER.readSpec());

console.log('== TEXT parity: the app expression vs the spec predicate ==');
console.log(`  app  : ${canonical}`);
console.log(`  spec : ${specText}`);
console.log(`  identical: ${canonical === specText}`);
console.log('');
console.log(`  spec file: ${RUNNER.specPath}`);

console.log('\n== CASE parity: one table, both implementations ==');
console.log('  case                                              ts     spec   expected  agree');
let failures = 0;
for (const row of runParity()) {
  if (!row.ok) failures += 1;
  const expected = row.divergence ? `ts:${row.divergence.ts} spec:${row.divergence.spec}` : String(row.expected);
  console.log(
    `  ${row.id.padEnd(50)} ${String(row.ts).padEnd(6)} ${String(row.spec).padEnd(6)} `
    + `${expected.padEnd(9)} ${row.agree}`,
  );
}

const diverging = runParity().filter((row) => !row.agree).map((row) => row.id).sort();
const documented = [...DOCUMENTED_DIVERGENCES].sort();
const undeclared = diverging.filter((id) => !documented.includes(id));

console.log('\n== divergences ==');
console.log(`  app-vs-spec divergences : ${diverging.length === 0 ? 'none' : diverging.join(' | ')}`);
console.log(`  declared in the report  : ${documented.join(' | ')}`);
console.log(`  undeclared (must be 0)  : ${undeclared.length}`);

console.log(`\ncases: ${CASES.length}  failures: ${failures}  text-identical: ${canonical === specText}`);
console.log(
  failures === 0 && undeclared.length === 0 && canonical === specText
    ? 'RESULT: app and SQL spec carry ONE refund predicate (with only the documented end-time divergence)'
    : 'RESULT: parity NOT satisfied',
);
process.exit(failures === 0 && undeclared.length === 0 && canonical === specText ? 0 : 1);
