import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { createRpcSourceResolver, matchingRpcIdentities } from '../scripts/lib/bk01-rpc-source-shapes.mjs';

function resolveFixture(builder: string) {
  const files = new Map([
    ['/builder.ts', `export function args(request: unknown): Record<string, unknown> { ${builder} }`],
    ['/caller.ts', "import { args as importedBuilder } from './builder'; const payload = importedBuilder(null);"],
  ]);
  const host = ts.createCompilerHost({});
  host.fileExists = f => files.has(f);
  host.readFile = f => files.get(f);
  host.getSourceFile = (f, version) => files.has(f) ? ts.createSourceFile(f, files.get(f)!, version, true) : undefined;
  const program = ts.createProgram([...files.keys()], { moduleResolution: ts.ModuleResolutionKind.Node10, noLib: true }, host);
  const ast = program.getSourceFile('/caller.ts')!;
  const declaration = (ast.statements[1] as ts.VariableStatement).declarationList.declarations[0];
  return createRpcSourceResolver(program).shapes(declaration.initializer);
}

test('RPC scanner resolves the imported implementation through an alias and validates exact catalog keys', () => {
  const keys = resolveFixture('return { p_shop: request, p_note: null };')[0];
  assert.deepEqual(keys, ['p_shop', 'p_note']);
  const catalog = [{ proname: 'hold', proargnames: keys, pronargs: 2, pronargdefaults: 1 }];
  assert.equal(matchingRpcIdentities(catalog, 'hold', keys).length, 1);
  assert.equal(matchingRpcIdentities(catalog, 'hold', ['p_shop']).length, 1);
  assert.equal(matchingRpcIdentities(catalog, 'hold', ['p_note']).length, 0);
  assert.equal(matchingRpcIdentities(catalog, 'hold', ['p_shop', 'p_typo']).length, 0);
  assert.equal(matchingRpcIdentities([...catalog, ...catalog], 'hold', keys).length, 2);
});

test('RPC scanner refuses spreads, computed names, unresolved returns and branching builders', () => {
  for (const body of ['return { ...request };', "return { ['p_shop']: request };", 'return request;', 'if(request) return { p_shop: request }; return {};']) {
    assert.throws(() => resolveFixture(body));
  }
});
