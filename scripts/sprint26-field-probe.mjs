import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const loader = `import ts from ${JSON.stringify(pathToFileURL(path.join(root, 'node_modules/typescript/lib/typescript.js')).href)};
import fs from 'node:fs';
export async function resolve(specifier, context, next) {
  if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL?.startsWith('file:')) {
    const url = new URL(specifier.slice(0, -3) + '.ts', context.parentURL);
    if (fs.existsSync(url)) return { url: url.href, shortCircuit: true };
  }
  return next(specifier, context);
}
export async function load(url, context, next) {
  if (url.endsWith('.ts')) return { format: 'module', shortCircuit: true, source: ts.transpileModule(fs.readFileSync(new URL(url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText };
  return next(url, context);
}`;
register(`data:text/javascript,${encodeURIComponent(loader)}`, import.meta.url);
const load = p => import(pathToFileURL(path.join(root, p)).href);
const [{ SPRINT25_DEVELOPMENT: cases }, { HybridSearchEngine }, { searchGrounded }, { captureTaskSources }] = await Promise.all([
  load('src/eval/sprint25DevelopmentFixture.ts'), load('src/memory/hybridSearch.ts'),
  load('src/memory/groundedSearch.ts'), load('src/harness/taskSources.ts')
]);
const paths = [];
function walk(dir) {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const name = path.posix.join(dir, entry.name);
    if (entry.isSymbolicLink() || name === 'src/eval') continue;
    if (entry.isDirectory()) walk(name);
    else if (entry.isFile() && name.endsWith('.ts') && !['tests/repositoryTaskEvaluation.test.ts', 'tests/groundedSearch.test.ts'].includes(name)) paths.push(name);
  }
}
walk('src'); walk('tests');
if (fs.existsSync(path.join(root, 'Architecture.md'))) paths.push('Architecture.md');
paths.sort();
const records = paths.map(id => ({ id, category: 'architecture', content: fs.readFileSync(path.join(root, id), 'utf8'), artifacts: [id], status: 'active', timestamp: '2026-10-27T00:00:00.000Z' }));
const hybrid = new HybridSearchEngine(root, { getActive: () => records }, {});
const sources = paths.flatMap(p => captureTaskSources(root, [p]));
function rerank(query) {
  const candidates = hybrid.searchRecordsWithScores(query, 100);
  return candidates.map((c, i) => {
    const total = c.queryTermEvidence.reduce((s, t) => s + t.idf, 0);
    const coverage = total ? c.queryTermEvidence.reduce((s, t) => s + (t.matched ? t.idf : 0), 0) / total : 0;
    return { c, i, score: c.rankingScore + coverage };
  }).sort((a, b) => Number(b.c.exactPathMatch) - Number(a.c.exactPathMatch) || b.c.identifierDefinitions.length - a.c.identifierDefinitions.length || b.score - a.score || a.i - b.i).map(x => x.c);
}
const results = cases.map(item => {
  const base = hybrid.searchRecordsWithScores(item.query, 50);
  const ranked = rerank(item.query);
  const adapter = { searchRecordsWithScores: (_query, limit) => ranked.slice(0, limit) };
  const ground = engine => searchGrounded(engine, root, item.query, sources);
  const a = ground(hybrid), b = ground(adapter);
  return { query: item.query, relevant: item.relevantPaths, baseline: base.slice(0, 5).map(x => x.record.id), candidate: ranked.slice(0, 5).map(x => x.record.id), groundedBaseline: a.evidence.map(x => x.record.id), groundedCandidate: b.evidence.map(x => x.record.id), baselineAssert: a.canAssert, candidateAssert: b.canAssert };
});
const answerable = results.filter(x => x.relevant.length), noAnswer = results.filter(x => !x.relevant.length);
const hits = (x, key) => x[key].filter(p => x.relevant.includes(p)).length;
const mean = values => values.reduce((a, b) => a + b, 0) / values.length;
const summary = key => ({ p5: mean(answerable.map(x => hits(x, key) / 5)), macroRecall5: mean(answerable.map(x => hits(x, key) / x.relevant.length)), relevantFound: answerable.reduce((s, x) => s + hits(x, key), 0), relevantTotal: answerable.reduce((s, x) => s + x.relevant.length, 0), noAnswerWithResults: noAnswer.filter(x => x[key].length).length });
console.log(JSON.stringify({ corpus: { files: paths.length, cases: cases.length, answerable: answerable.length, noAnswer: noAnswer.length }, baseline: summary('baseline'), candidate: summary('candidate'), groundedBaseline: summary('groundedBaseline'), groundedCandidate: summary('groundedCandidate'), assertions: { baseline: results.filter(x => x.baselineAssert).length, candidate: results.filter(x => x.candidateAssert).length }, results }, null, 2));
