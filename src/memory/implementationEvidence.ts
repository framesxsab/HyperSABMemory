import path from 'node:path';
import ts from 'typescript';
import type { ClaimSourceSnapshot } from './claimVerification.js';
import { queryIdentifiers, tokenizeSearchQuery, tokenizeSearchText } from './hybridSearch.js';

export function wantsImplementationEvidence(query: string): boolean {
  return /^(?:where|which|show|find|locate)\b/i.test(query.trim()) &&
    /\b(?:code|calls?|implement\w*|tests?|defined|evidence)\b/i.test(query);
}

export function collectImplementationEvidence(query: string, sources: Iterable<ClaimSourceSnapshot>) {
  const terms = new Set(tokenizeSearchQuery(query));
  const identifiers = new Set(queryIdentifiers(query));
  const files = new Map<string, { source: ClaimSourceSnapshot; ast: ts.SourceFile }>();
  for (const source of sources) {
    if (!source.currentSha256 || !source.content || !/\.[cm]?[jt]sx?$/i.test(source.path) ||
        Buffer.byteLength(source.content) > 256 * 1024 || files.size >= 20) continue;
    files.set(source.path, { source, ast: ts.createSourceFile(source.path, source.content, ts.ScriptTarget.Latest, true) });
  }
  function span(node: ts.Node) {
    const ast = node.getSourceFile();
    const source = files.get(ast.fileName)!.source;
    return {
      path: source.path, sha256: source.currentSha256!, freshness: 'current' as const,
      startLine: ast.getLineAndCharacterOfPosition(node.getStart()).line + 1,
      endLine: ast.getLineAndCharacterOfPosition(node.end - 1).line + 1,
      excerpt: node.getText().slice(0, 320)
    };
  }
  const isTest = (file: string) => /(?:^|\/)(?:tests?|__tests__)\//.test(file) || /\.(?:test|spec)\./.test(file);
  type Location = { node: ts.FunctionDeclaration | ts.MethodDeclaration; name: string; owner?: string };
  const locations = [...files.values()].filter(({ ast }) => !isTest(ast.fileName)).flatMap(({ ast }) =>
    ast.statements.flatMap<Location>(statement => {
      if (ts.isFunctionDeclaration(statement) && statement.body && statement.name) {
        return [{ node: statement, name: statement.name.text }];
      }
      if (!ts.isClassDeclaration(statement) || !statement.name) return [];
      const owner = statement.name.text;
      return statement.members.flatMap(node => ts.isMethodDeclaration(node) && node.body && ts.isIdentifier(node.name)
        ? [{ node, name: node.name.text, owner }] : []);
    })).map(location => ({
      ...location,
      score: identifiers.has(location.name) ? 100 : tokenizeSearchText(location.name).filter(term => terms.has(term)).length
    })).filter(location => location.score > 0 && (!identifiers.size || location.score === 100))
    .sort((a, b) => b.score - a.score).slice(0, 3);

  const code = locations.map(({ node, name, owner }) => {
    const facts: Array<{ kind: 'call_site' | 'throw_statement'; source: ReturnType<typeof span> }> = [];
    function visit(child: ts.Node) {
      if (ts.isCallExpression(child) && (ts.isIdentifier(child.expression) ||
          (ts.isPropertyAccessExpression(child.expression) && child.expression.expression.kind === ts.SyntaxKind.ThisKeyword))) {
        if (facts.filter(fact => fact.kind === 'call_site').length < 5) facts.push({ kind: 'call_site', source: span(child) });
      }
      if (ts.isThrowStatement(child) && facts.filter(fact => fact.kind === 'throw_statement').length < 5) {
        facts.push({ kind: 'throw_statement', source: span(child) });
      }
      ts.forEachChild(child, visit);
    }
    visit(node.body!);
    return { kind: 'code_observed' as const, symbol: owner ? owner + '.' + name : name, source: span(node), facts };
  });

  const tests: Array<{ kind: 'test_defined'; symbol: string; name: string; source: ReturnType<typeof span>; imports: ReturnType<typeof span>; target: ReturnType<typeof span>; execution: 'unverified' }> = [];
  const byStem = new Map<string, string[]>();
  for (const file of files.keys()) {
    const stem = file.replace(/\.[cm]?[jt]sx?$/, '');
    byStem.set(stem, [...(byStem.get(stem) ?? []), file]);
  }
  for (const { ast } of files.values()) {
    if (!/\b(?:tests?|evidence)\b/i.test(query) || !isTest(ast.fileName) || !locations.length || tests.length >= 4) continue;
    const targetImports = new Map<ts.ImportSpecifier, string>();
    for (const statement of ast.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || !statement.moduleSpecifier.text.startsWith('.')) continue;
      const bindings = statement.importClause?.namedBindings;
      if (!bindings || !ts.isNamedImports(bindings)) continue;
      const stem = path.posix.normalize(path.posix.join(path.posix.dirname(ast.fileName), statement.moduleSpecifier.text)).replace(/\.[cm]?[jt]sx?$/, '');
      const matches = byStem.get(stem);
      if (matches?.length !== 1) continue;
      for (const binding of bindings.elements) {
        if (locations.some(location => location.node.getSourceFile().fileName === matches[0] &&
            (location.owner ?? location.name) === (binding.propertyName ?? binding.name).text)) {
          targetImports.set(binding, matches[0]);
        }
      }
    }
    // A file without a candidate named import cannot produce a supported link.
    if (!targetImports.size) continue;
    // Bind names locally so a shadowed import or receiver cannot establish the link.
    const options = { noLib: true, noResolve: true, allowJs: true };
    const host = ts.createCompilerHost(options);
    host.getSourceFile = file => file === ast.fileName ? ast : undefined;
    const checker = ts.createProgram([ast.fileName], options, host).getTypeChecker();
    const imported = (name: ts.Identifier) => checker.getSymbolAtLocation(name)?.declarations?.find(ts.isImportSpecifier);
    const moduleOf = (binding: ts.ImportSpecifier) => binding.parent.parent.parent.moduleSpecifier;
    function visit(node: ts.Node) {
      if (tests.length >= 4) return;
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
        const binding = imported(node.expression);
        const module = binding && moduleOf(binding);
        const testName = node.arguments[0].text;
        const callback = node.arguments[1];
        if (module && ts.isStringLiteral(module) && ['vitest', 'node:test'].includes(module.text) &&
            ['it', 'test'].includes((binding!.propertyName ?? binding!.name).text) && callback && ts.isArrowFunction(callback)) {
          function assertion(child: ts.Node) {
            if (tests.length >= 4) return;
            if (ts.isCallExpression(child) && ts.isPropertyAccessExpression(child.expression)) {
              const receiver = child.expression.expression;
              if (ts.isCallExpression(receiver) && ts.isIdentifier(receiver.expression)) {
                const expectBinding = imported(receiver.expression);
                const expectModule = expectBinding && moduleOf(expectBinding);
                let target = receiver.arguments[0];
                if (target && ts.isArrowFunction(target) && !ts.isBlock(target.body)) target = target.body;
                if (expectModule && ts.isStringLiteral(expectModule) && expectModule.text === 'vitest' &&
                    (expectBinding!.propertyName ?? expectBinding!.name).text === 'expect' &&
                    /^to(?:Be|Equal|Match|Throw|Have|Contain)/.test(child.expression.name.text) &&
                    target && ts.isCallExpression(target)) {
                  const callee = target.expression;
                  for (const [index, location] of locations.entries()) {
                    const declaration = ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)
                      ? checker.getSymbolAtLocation(callee.expression)?.valueDeclaration : undefined;
                    const constructor = declaration && ts.isVariableDeclaration(declaration) &&
                      (declaration.parent.flags & ts.NodeFlags.Const) && declaration.initializer && ts.isNewExpression(declaration.initializer)
                      ? declaration.initializer.expression : undefined;
                    const local = location.owner
                      ? ts.isPropertyAccessExpression(callee) && callee.name.text === location.name && constructor
                      : callee;
                    if (!local || !ts.isIdentifier(local)) continue;
                    const targetImport = imported(local);
                    const targetPath = location.node.getSourceFile().fileName;
                    if (!targetImport || targetImports.get(targetImport) !== targetPath ||
                        (targetImport.propertyName ?? targetImport.name).text !== (location.owner ?? location.name)) continue;
                    const exported = ts.isMethodDeclaration(location.node) ? location.node.parent : location.node;
                    if (ts.getModifiers(location.node)?.some(modifier => modifier.kind === ts.SyntaxKind.StaticKeyword)) continue;
                    if (!ts.canHaveModifiers(exported) || !ts.getModifiers(exported)?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword) ||
                        ts.getModifiers(exported)?.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword)) continue;
                    tests.push({ kind: 'test_defined', symbol: code[index].symbol, name: testName.slice(0, 160), source: span(child), imports: span(targetImport.parent.parent.parent), target: code[index].source, execution: 'unverified' });
                    break;
                  }
                }
              }
            }
            ts.forEachChild(child, assertion);
          }
          assertion(callback.body);
          return;
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
  return { code, tests, limitations: [
    'Locations and statements are observed in source. Call sites do not establish which branches run or what callees do.',
    'Test links identify an assertion containing a call through a local import. Test execution and behavioral correctness are unverified.'
  ] };
}
