import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd();
async function loadTypeScript(file, stripImports = false) {
  let source = fs.readFileSync(file, 'utf8');
  if (stripImports) source = source.replace(/^import .* from '\.\/.*';\r?\n/gm, '');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
}
const { HybridSearchEngine } = await loadTypeScript('src/memory/hybridSearch.ts', true);
const { SPRINT25_DEVELOPMENT: cases } = await loadTypeScript('src/eval/sprint25DevelopmentFixture.ts');
const paths = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.posix.join(dir, entry.name);
    if (file === 'src/eval' || entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) walk(file);
    else if (entry.isFile() && file.endsWith('.ts') && !['tests/repositoryTaskEvaluation.test.ts', 'tests/groundedSearch.test.ts'].includes(file)) paths.push(file);
  }
}
walk('src');
walk('tests');
if (fs.existsSync('Architecture.md')) paths.push('Architecture.md');
paths.sort();
const records = paths.map(file => ({ id: file, category: 'architecture', content: fs.readFileSync(file, 'utf8'), artifacts: [file], status: 'active' }));
const hybrid = new HybridSearchEngine(root, { getActive: () => records }, {});
const variants = ['baseline', 'path0', 'path0.5', 'path2', 'novel0.2', 'novel0.4', 'term2'];
const totals = Object.fromEntries(variants.map(name => [name, { p5: 0, recall5: 0, noAnswerReturns: 0, changed: 0 }]));
const details = [];
for (const item of cases) {
  const candidates = hybrid.searchRecordsWithScores(item.query, 100);
  const max = Math.max(1, ...candidates.map(c => c.score));
  const base = candidates.slice(0, 5).map(c => c.record.id);
  const perCase = {};
  for (const name of variants) {
    const remaining = candidates.filter(candidate => name !== 'term2' || candidate.queryTermEvidence.filter(term => term.matched).length >= 2);
    const selected = [];
    const covered = new Set();
    const weight = name === 'path0' ? 0 : name === 'path0.5' ? 0.5 : name === 'path2' ? 2 : 1;
    const novelty = name === 'novel0.2' ? 0.2 : name === 'novel0.4' ? 0.4 : 0;
    while (remaining.length && selected.length < 5) {
      const score = c => c.score / max + weight * c.pathCoverage + novelty * c.queryTermEvidence.filter(t => t.matched && !covered.has(t.term)).reduce((sum, t) => sum + t.idf, 0) / (c.queryTermEvidence.reduce((sum, t) => sum + t.idf, 0) || 1);
      remaining.sort((a, b) => Number(b.exactPathMatch) - Number(a.exactPathMatch) || b.identifierDefinitions.length - a.identifierDefinitions.length || score(b) - score(a));
      const choice = remaining.shift();
      selected.push(choice.record.id);
      for (const term of choice.queryTermEvidence) if (term.matched) covered.add(term.term);
    }
    const hits = selected.filter(id => item.relevantPaths.includes(id)).length;
    if (name === 'baseline' && selected.join('\0') !== base.join('\0')) throw new Error(`Baseline mismatch: ${item.query}`);
    if (item.relevantPaths.length) {
      totals[name].p5 += hits / 5;
      totals[name].recall5 += hits / item.relevantPaths.length;
      if (selected.join('\0') !== base.join('\0')) totals[name].changed++;
      perCase[name] = hits;
    } else if (selected.length) totals[name].noAnswerReturns++;
  }
  if (item.relevantPaths.length) details.push({ query: item.query, hits: perCase });
}
const count = cases.filter(c => c.relevantPaths.length).length;
for (const value of Object.values(totals)) { value.p5 /= count; value.recall5 /= count; }
console.log(JSON.stringify({ corpus: { files: paths.length, scope: 'src and tests using repository evaluation exclusions, plus Architecture.md', candidateLimit: 100 }, answerable: count, unanswerable: cases.length - count, totals, details }, null, 2));
