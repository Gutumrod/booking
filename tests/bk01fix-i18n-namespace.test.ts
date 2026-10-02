import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

/**
 * BK01 D5 (report HOUSE-BK01-PRIVACY-SMOKE-2026-10-02, defect D5).
 *
 * THE MEASURED DEFECT. On `/register` the Pro card rendered the raw string
 * `auth.notSellableBadge` instead of a label: the component called
 * `useTranslations('auth')` and asked for `notSellableBadge`, but the catalogues carried
 * that key under `dashboard`. next-intl reports MISSING_MESSAGE and renders the key
 * itself, which is what the browser showed. A second instance of the same defect sat on
 * the dashboard: `useTranslations('dashboard')` asked for `planProNote`, which the
 * catalogues carry under `auth` — the scanner below found that one, not the report, and
 * it is fixed in the same change.
 *
 * WHY A SCANNER AND NOT TWO ASSERTIONS. The class of defect is "a component asks for a
 * key that no namespace it registered actually has". Two hand-written assertions pin the
 * two instances found today and cannot see the next one. This test walks every component
 * in both apps, resolves each translation call against the catalogue it asks in, and
 * fails on any key that does not resolve — the property the page needs, not the examples.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not read the `.next` build output and it does
 * not render the components: the catalogue is the artifact the runtime reads, so the
 * check is a static resolution against that same file (JSON.parse, the same parse
 * next-intl performs). Hook variables are tracked per scope, so two components in one
 * file each calling `useTranslations('different')` are never confused for one another —
 * a file-wide regex would be wrong here, and the first version of this scanner was.
 *
 * The resolver splits BOTH the namespace (`legal.meta`) and the key
 * (`terms.sections.contact.b`) on `.`, which is how a file-based next-intl catalogue
 * nests them.
 */

const APPS = ['booking-consumer', 'booking-admin'];

/** The next-intl entry points whose first string argument is a namespace. */
const NAMESPACE_HOOKS = new Set(['useTranslations', 'getTranslations']);

type Call = { namespace: string; key: string; file: string; line: number };

const isHookCallWithNamespace = (node: ts.Node): string | null => {
  if (!ts.isCallExpression(node)) return null;
  const callee = node.expression;
  if (!ts.isIdentifier(callee) || !NAMESPACE_HOOKS.has(callee.text)) return null;
  const argument = node.arguments[0];
  return argument && ts.isStringLiteralLike(argument) ? argument.text : null;
};

/**
 * Every translation key a component asks for, with the namespace of the hook variable it
 * used. Bindings are collected per scope and inherited by nested scopes, so `t` declared
 * in one component never leaks into a sibling component's calls.
 */
function collectTranslationCalls(file: string, source: string): Call[] {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found: Call[] = [];

  const bindingsInScope = (scope: ts.Node): Array<[string, string]> => {
    const bindings: Array<[string, string]> = [];
    const scan = (node: ts.Node) => {
      if (ts.isFunctionLike(node) && node !== scope) return; // a nested scope has its own
      if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.name)) {
        const namespace = isHookCallWithNamespace(node.initializer);
        if (namespace !== null) bindings.push([node.name.text, namespace]);
      }
      ts.forEachChild(node, scan);
    };
    ts.forEachChild(scope, scan);
    return bindings;
  };

  const visit = (node: ts.Node, inherited: ReadonlyMap<string, string>) => {
    const scope: ReadonlyMap<string, string> = ts.isFunctionLike(node) || ts.isSourceFile(node)
      ? new Map<string, string>(Array.from(inherited.entries()).concat(bindingsInScope(node)))
      : inherited;
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      // t('key') and t.raw('key') both read the same namespace.
      const holder = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.name.text === 'raw'
          ? callee.expression.text
          : null;
      const argument = node.arguments[0];
      if (holder && scope.has(holder) && argument && ts.isStringLiteralLike(argument)) {
        found.push({
          namespace: scope.get(holder) as string,
          key: argument.text,
          file,
          line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
        });
      }
    }
    ts.forEachChild(node, (child) => visit(child, scope));
  };
  visit(sourceFile, new Map<string, string>());
  return found;
}

/** The value a message file holds for `namespace.key`, or `undefined`. */
const resolveMessage = (messages: unknown, namespace: string, key: string): unknown =>
  namespace.split('.').concat(key.split('.')).reduce<unknown>(
    (current, part) => (current && typeof current === 'object' ? (current as Record<string, unknown>)[part] : undefined),
    messages,
  );

const sourceFilesIn = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFilesIn(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });

test('every translation key the app components ask for exists in the namespace they ask in', () => {
  const findings: string[] = [];
  let checkedKeys = 0;

  for (const app of APPS) {
    const th: unknown = JSON.parse(readFileSync(`apps/${app}/messages/th.json`, 'utf8'));
    const en: unknown = JSON.parse(readFileSync(`apps/${app}/messages/en.json`, 'utf8'));
    const calls = sourceFilesIn(`apps/${app}/src`).flatMap((file) =>
      collectTranslationCalls(file, readFileSync(file, 'utf8')),
    );
    const distinct = new Map<string, Call>();
    for (const call of calls) {
      const id = `${call.namespace}.${call.key}`;
      if (!distinct.has(id)) distinct.set(id, call);
    }
    checkedKeys += distinct.size;
    for (const [id, call] of Array.from(distinct.entries())) {
      const inTh = resolveMessage(th, call.namespace, call.key) !== undefined;
      const inEn = resolveMessage(en, call.namespace, call.key) !== undefined;
      if (!inTh || !inEn) {
        findings.push(
          `${id} <- ${call.file}:${call.line} (th=${inTh ? 'present' : 'ABSENT'}, en=${inEn ? 'present' : 'ABSENT'})`,
        );
      }
    }
  }

  // Non-vacuity: if the scanner silently stopped resolving, this test would pass on a
  // count of zero. The two apps ask for several hundred distinct keys today.
  assert.ok(checkedKeys > 100, `the scanner resolved only ${checkedKeys} keys — it is not reading the components`);
  assert.deepEqual(
    findings,
    [],
    `translation keys missing from the namespace the component asks in:\n${findings.join('\n')}`,
  );
});

test('the Pro card badge and note resolve in the namespaces their components register', () => {
  // The two instances measured in the report and in this change, pinned by value, so a
  // silent rename cannot make the scanner above pass on an absent key.
  const th: unknown = JSON.parse(readFileSync('apps/booking-admin/messages/th.json', 'utf8'));
  const en: unknown = JSON.parse(readFileSync('apps/booking-admin/messages/en.json', 'utf8'));
  assert.equal(resolveMessage(th, 'auth', 'notSellableBadge'), 'ยังไม่เปิดขาย');
  assert.equal(resolveMessage(en, 'auth', 'notSellableBadge'), 'Not on sale');
  assert.equal(typeof resolveMessage(th, 'dashboard', 'planProNote'), 'string');
  assert.equal(typeof resolveMessage(en, 'dashboard', 'planProNote'), 'string');
});
