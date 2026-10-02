import ts from 'typescript';

// Resolve symbols in their actual lexical/import scope. Unknown/dynamic builders
// fail closed; only literal object returns with statically named keys are accepted.
export function createRpcSourceResolver(program) {
  const checker = program.getTypeChecker();
  const unwrap = n => {
    while (n && (ts.isAsExpression(n) || ts.isParenthesizedExpression(n) || ts.isTypeAssertionExpression(n))) n = n.expression;
    return n;
  };
  function declaration(n) {
    let symbol = checker.getSymbolAtLocation(n);
    if (symbol?.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    return symbol?.valueDeclaration ?? symbol?.declarations?.[0];
  }
  function enter(n, seen) {
    if (seen.has(n)) throw Error('Recursive RPC expression cannot be safely resolved');
    return new Set([...seen, n]);
  }
  function returns(fn) {
    if (!fn.body) throw Error('RPC builder has no implementation');
    if (!ts.isBlock(fn.body)) return [fn.body];
    const result = [];
    function walk(n) {
      if (n !== fn.body && ts.isFunctionLike(n)) return;
      if (ts.isReturnStatement(n)) {
        if (!n.expression) throw Error('RPC builder has an empty return');
        result.push(n.expression);
      } else ts.forEachChild(n, walk);
    }
    walk(fn.body);
    // Branching/fallthrough and side effects need a stronger analysis. Accept the
    // existing pure builder only; do not infer keys from Record<string, unknown>.
    if (fn.body.statements.length !== 1 || !ts.isReturnStatement(fn.body.statements[0])) {
      throw Error('RPC builder must have a single unconditional return');
    }
    return result;
  }
  function values(node, seen = new Set()) {
    const n = unwrap(node);
    if (!n) return [];
    const next = enter(n, seen);
    if (ts.isStringLiteralLike(n)) return [n.text];
    if (ts.isIdentifier(n)) return values(declaration(n)?.initializer, next);
    if (ts.isConditionalExpression(n)) return [...values(n.whenTrue, next), ...values(n.whenFalse, next)];
    return [];
  }
  function shapes(node, seen = new Set()) {
    const n = unwrap(node);
    if (!n) return [[]];
    const next = enter(n, seen);
    if (ts.isObjectLiteralExpression(n)) {
      const keys = n.properties.map(p => {
        if ((!ts.isPropertyAssignment(p) && !ts.isShorthandPropertyAssignment(p)) || ts.isComputedPropertyName(p.name)) {
          throw Error('RPC spread/method/computed key cannot be safely resolved');
        }
        return p.name.text;
      });
      if (new Set(keys).size !== keys.length) throw Error('Duplicate RPC argument key');
      return [keys];
    }
    if (ts.isIdentifier(n)) {
      const d = declaration(n);
      if (!d?.initializer) throw Error('Unresolved RPC argument identifier ' + n.text);
      return shapes(d.initializer, next);
    }
    if (ts.isConditionalExpression(n)) return [...shapes(n.whenTrue, next), ...shapes(n.whenFalse, next)];
    if (ts.isCallExpression(n)) {
      const d = declaration(n.expression);
      const fn = d?.initializer ? unwrap(d.initializer) : d;
      if (!fn || !ts.isFunctionLike(fn)) throw Error('Unresolved RPC builder ' + n.expression.getText());
      return returns(fn).flatMap(r => shapes(r, next));
    }
    throw Error('Unresolved RPC argument shape ' + n.getText());
  }
  return { values, shapes };
}

export function matchingRpcIdentities(catalog, name, keys) {
  return catalog.filter(p => p.proname === name &&
    keys.every(k => p.proargnames?.slice(0, p.pronargs).includes(k)) &&
    (p.proargnames ?? []).slice(0, p.pronargs - p.pronargdefaults).every(k => keys.includes(k)));
}
