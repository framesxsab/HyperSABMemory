import path from 'node:path';
import ts from 'typescript';
import type { ClaimSourceSnapshot } from './claimVerification.js';
import { queryIdentifiers, tokenizeSearchQuery, tokenizeSearchText } from './hybridSearch.js';

export function wantsImplementationEvidence(query: string): boolean {
  return /^(?:where|which|show|find|locate)\b/i.test(query.trim()) &&
    /\b(?:code|calls?|implement\w*|tests?|defined|evidence)\b/i.test(query);
}

type ImplementationEvidenceResult = {
  code: Array<{
    kind: 'code_observed';
    symbol: string;
    source: { path: string; sha256: string; freshness: 'current'; startLine: number; endLine: number; excerpt: string };
    facts: Array<{ kind: 'call_site' | 'throw_statement'; source: { path: string; sha256: string; freshness: 'current'; startLine: number; endLine: number; excerpt: string } }>;
  }>;
  tests: Array<{
    kind: 'test_defined';
    symbol: string;
    name: string;
    source: { path: string; sha256: string; freshness: 'current'; startLine: number; endLine: number; excerpt: string };
    imports: { path: string; sha256: string; freshness: 'current'; startLine: number; endLine: number; excerpt: string };
    target: { path: string; sha256: string; freshness: 'current'; startLine: number; endLine: number; excerpt: string };
    execution: 'unverified';
  }>;
  limitations: string[];
};

const MAX_AST_CACHE = 256;
const MAX_EVIDENCE_CACHE = 128;
const unboundAstCache = new Map<string, ts.SourceFile>();
const evidenceResultCache = new Map<string, ImplementationEvidenceResult>();

function getUnboundAst(sourcePath: string, content: string, sha256: string): ts.SourceFile {
  const key = `${sourcePath}\0${sha256}`;
  const cached = unboundAstCache.get(key);
  if (cached) return cached;
  const ast = ts.createSourceFile(sourcePath, content, ts.ScriptTarget.Latest, true);
  if (unboundAstCache.size >= MAX_AST_CACHE) {
    const oldest = unboundAstCache.keys().next().value;
    if (oldest !== undefined) unboundAstCache.delete(oldest);
  }
  unboundAstCache.set(key, ast);
  return ast;
}

function cloneEvidence(result: ImplementationEvidenceResult): ImplementationEvidenceResult {
  return {
    code: result.code.map(item => ({
      ...item,
      source: { ...item.source },
      facts: item.facts.map(fact => ({ ...fact, source: { ...fact.source } }))
    })),
    tests: result.tests.map(item => ({
      ...item,
      source: { ...item.source },
      imports: { ...item.imports },
      target: { ...item.target }
    })),
    limitations: [...result.limitations]
  };
}

export function collectImplementationEvidence(query: string, sources: Iterable<ClaimSourceSnapshot>): ImplementationEvidenceResult {
  const terms = new Set(tokenizeSearchQuery(query));
  const identifiers = new Set(queryIdentifiers(query));
  const eligible: ClaimSourceSnapshot[] = [];
  for (const source of sources) {
    if (!source.currentSha256 || !source.content || !/\.[cm]?[jt]sx?$/i.test(source.path) ||
        Buffer.byteLength(source.content) > 256 * 1024 || eligible.length >= 20) continue;
    eligible.push(source);
  }
  const cacheKey = `${query.trim()}\0${eligible.map(source => `${source.path}:${source.currentSha256}`).join('\0')}`;
  const cached = evidenceResultCache.get(cacheKey);
  if (cached) {
    evidenceResultCache.delete(cacheKey);
    evidenceResultCache.set(cacheKey, cached);
    return cloneEvidence(cached);
  }
  const files = new Map<string, { source: ClaimSourceSnapshot; ast: ts.SourceFile }>();
  for (const source of eligible) {
    files.set(source.path, { source, ast: getUnboundAst(source.path, source.content!, source.currentSha256!) });
  }
  function span(node: ts.Node, sourceOverride?: ClaimSourceSnapshot) {
    const ast = node.getSourceFile();
    const source = sourceOverride ?? files.get(ast.fileName)!.source;
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

  const tests: ImplementationEvidenceResult['tests'] = [];
  const wantsTests = /\b(?:tests?|evidence)\b/i.test(query);
  if (wantsTests && locations.length) {
    const byStem = new Map<string, string[]>();
    for (const file of files.keys()) {
      const stem = file.replace(/\.[cm]?[jt]sx?$/, '');
      byStem.set(stem, [...(byStem.get(stem) ?? []), file]);
    }
    const candidateTests: Array<{
      fileName: string;
      source: ClaimSourceSnapshot;
      programAst: ts.SourceFile;
      targetImports: Map<ts.ImportSpecifier, string>;
      importedNames: Map<string, number>;
    }> = [];
    for (const { source, ast } of files.values()) {
      if (!isTest(ast.fileName)) continue;
      let hasMatchingImport = false;
      for (const statement of ast.statements) {
        if (!ts.isImportDeclaration(statement)) continue;
        const bindings = statement.importClause?.namedBindings;
        if (!bindings || !ts.isNamedImports(bindings)) continue;
        if (!ts.isStringLiteral(statement.moduleSpecifier) || !statement.moduleSpecifier.text.startsWith('.')) continue;
        const stem = path.posix.normalize(path.posix.join(path.posix.dirname(ast.fileName), statement.moduleSpecifier.text)).replace(/\.[cm]?[jt]sx?$/, '');
        const matches = byStem.get(stem);
        if (matches?.length !== 1) continue;
        for (const binding of bindings.elements) {
          if (ts.isTypeOnlyImportDeclaration(binding)) continue;
          if (locations.some(location => location.node.getSourceFile().fileName === matches[0] &&
              (location.owner ?? location.name) === (binding.propertyName ?? binding.name).text)) {
            hasMatchingImport = true;
            break;
          }
        }
        if (hasMatchingImport) break;
      }
      if (!hasMatchingImport) continue;
      const programAst = ts.createSourceFile(ast.fileName, source.content!, ts.ScriptTarget.Latest, true);
      const targetImports = new Map<ts.ImportSpecifier, string>();
      const importedNames = new Map<string, number>();
      const countImport = (name: ts.Identifier) => {
        importedNames.set(name.text, (importedNames.get(name.text) ?? 0) + 1);
      };
      for (const statement of programAst.statements) {
        if (ts.isImportEqualsDeclaration(statement)) countImport(statement.name);
        if (!ts.isImportDeclaration(statement)) continue;
        const clause = statement.importClause;
        const bindings = clause?.namedBindings;
        if (clause?.name) countImport(clause.name);
        if (bindings && ts.isNamespaceImport(bindings)) countImport(bindings.name);
        if (!bindings || !ts.isNamedImports(bindings)) continue;
        for (const binding of bindings.elements) countImport(binding.name);
        if (!ts.isStringLiteral(statement.moduleSpecifier) || !statement.moduleSpecifier.text.startsWith('.')) continue;
        const stem = path.posix.normalize(path.posix.join(path.posix.dirname(programAst.fileName), statement.moduleSpecifier.text)).replace(/\.[cm]?[jt]sx?$/, '');
        const matches = byStem.get(stem);
        if (matches?.length !== 1) continue;
        for (const binding of bindings.elements) {
          if (ts.isTypeOnlyImportDeclaration(binding)) continue;
          if (locations.some(location => location.node.getSourceFile().fileName === matches[0] &&
              (location.owner ?? location.name) === (binding.propertyName ?? binding.name).text)) {
            targetImports.set(binding, matches[0]);
          }
        }
      }
      if (targetImports.size) {
        candidateTests.push({ fileName: programAst.fileName, source, programAst, targetImports, importedNames });
      }
    }

    if (candidateTests.length) {
      // Bind names locally across candidate test modules in one program so shadowed imports never link.
      const options = { noLib: true, noResolve: true, allowJs: true };
      const host = ts.createCompilerHost(options);
      const astByFile = new Map(candidateTests.map(item => [item.fileName, item.programAst]));
      host.getSourceFile = file => astByFile.get(file);
      const checker = ts.createProgram(candidateTests.map(item => item.fileName), options, host).getTypeChecker();

      for (const { source, programAst, targetImports, importedNames } of candidateTests) {
        if (tests.length >= 4) break;
        const imported = (name: ts.Identifier) => {
          // The checker can recover a symbol for source with duplicate imports.
          if (importedNames.get(name.text) !== 1) return;
          const declarations = checker.getSymbolAtLocation(name)?.declarations;
          const binding = declarations?.[0];
          return declarations?.length === 1 && binding && ts.isImportSpecifier(binding) &&
            !ts.isTypeOnlyImportDeclaration(binding) ? binding : undefined;
        };
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
                        tests.push({ kind: 'test_defined', symbol: code[index].symbol, name: testName.slice(0, 160), source: span(child, source), imports: span(targetImport.parent.parent.parent, source), target: code[index].source, execution: 'unverified' });
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
        visit(programAst);
      }
    }
  }
  const result: ImplementationEvidenceResult = { code, tests, limitations: [
    'Locations and statements are observed in source. Call sites do not establish which branches run or what callees do.',
    'Test links identify an assertion containing a call through a local import. Test execution and behavioral correctness are unverified.'
  ] };
  if (evidenceResultCache.size >= MAX_EVIDENCE_CACHE) {
    const oldest = evidenceResultCache.keys().next().value;
    if (oldest !== undefined) evidenceResultCache.delete(oldest);
  }
  evidenceResultCache.set(cacheKey, result);
  return cloneEvidence(result);
}
