import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

async function load(file, strip = false) {
  let source = fs.readFileSync(file, 'utf8');
  if (strip) source = source.replace(/^import .* from '\.\/.*';\r?\n/gm, '');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
}
const { HybridSearchEngine } = await load('src/memory/hybridSearch.ts', true);
const { SPRINT25_DEVELOPMENT: cases } = await load('src/eval/sprint25DevelopmentFixture.ts');
const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.posix.join(dir, entry.name);
    if (entry.isSymbolicLink() || file === 'src/eval') continue;
    if (entry.isDirectory()) walk(file);
    else if (entry.isFile() && file.endsWith('.ts') && !['tests/repositoryTaskEvaluation.test.ts', 'tests/groundedSearch.test.ts'].includes(file)) files.push(file);
  }
}
walk('src'); walk('tests');
if (fs.existsSync('Architecture.md')) files.push('Architecture.md');
files.sort();
if (files.length !== 72 || cases.length !== 21) throw new Error(`Unexpected fixture size: ${files.length} files, ${cases.length} cases`);
const records = files.map(file => ({ id: file, category: 'architecture', content: fs.readFileSync(file, 'utf8'), artifacts: [file], status: 'active' }));
const known = new Set(files);
const edges = new Map(files.map(file => [file, new Set()]));
for (const record of records.filter(record => record.id.endsWith('.ts'))) {
  const ast = ts.createSourceFile(record.id, record.content, ts.ScriptTarget.Latest, true);
  for (const statement of ast.statements) {
    if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
    const specifier = statement.moduleSpecifier;
    if (!specifier || !ts.isStringLiteral(specifier) || !specifier.text.startsWith('.')) continue;
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(record.id), specifier.text)).replace(/\.js$/, '.ts');
    if (known.has(target) && target !== record.id) { edges.get(record.id).add(target); edges.get(target).add(record.id); }
  }
}
const hybrid = new HybridSearchEngine(process.cwd(), { getActive: () => records }, {});
const weights = [0, 0.1, 0.25, 0.5];
const totals = Object.fromEntries(weights.map(w => [w, { precisionAt5: 0, recallAt5: 0, hits: 0, noAnswerReturns: 0 }]));
const details = [];
for (const item of cases) {
  const candidates = hybrid.searchRecordsWithScores(item.query, 100);
  const anchors = candidates.slice(0, 3).map(c => c.record.id);
  const variants = {};
  for (const weight of weights) {
    const selected = [...candidates].sort((a, b) => {
      const relationship = c => anchors.reduce((sum, anchor, i) => sum + (edges.get(anchor).has(c.record.id) ? 1 / (i + 1) : 0), 0);
      return Number(b.exactPathMatch) - Number(a.exactPathMatch) || b.identifierDefinitions.length - a.identifierDefinitions.length || (b.rankingScore + weight * relationship(b)) - (a.rankingScore + weight * relationship(a));
    }).slice(0, 5).map(c => c.record.id);
    if (weight === 0 && selected.join('\0') !== hybrid.searchRecords(item.query, 5).map(r => r.id).join('\0')) throw new Error('Baseline mismatch');
    const hits = selected.filter(id => item.relevantPaths.includes(id)).length;
    if (item.relevantPaths.length) { totals[weight].precisionAt5 += hits / 5; totals[weight].recallAt5 += hits / item.relevantPaths.length; totals[weight].hits += hits; }
    else if (selected.length) totals[weight].noAnswerReturns++;
    variants[weight] = { hits, selected };
  }
  details.push({ query: item.query, relevantCount: item.relevantPaths.length, anchors, variants });
}
const answerable = cases.filter(c => c.relevantPaths.length).length;
for (const total of Object.values(totals)) { total.precisionAt5 /= answerable; total.recallAt5 /= answerable; }
console.log(JSON.stringify({ files: files.length, edges: [...edges.values()].reduce((sum, e) => sum + e.size, 0) / 2, answerable, noAnswer: cases.length - answerable, totals, details }, null, 2));
