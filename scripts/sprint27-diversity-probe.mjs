import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import ts from 'typescript';

const root = process.cwd();
const source = fs.readFileSync('src/memory/hybridSearch.ts', 'utf8');
const original = 'anchors.reduce((sum, anchor, index) => sum + ((entry.record.artifacts ?? []).some(artifact => anchor.has(normalizePath(artifact))) ? 1 / (index + 1) : 0), 0)';
assert.equal(source.split(original).length, 2);
const variants = {
  baseline: original,
  candidateDegree: `${original} / Math.sqrt(Math.max(1, ...(entry.record.artifacts ?? []).map(artifact => links.get(normalizePath(artifact))?.size ?? 0)))`,
  anchorDegree: 'anchors.reduce((sum, anchor, index) => sum + ((entry.record.artifacts ?? []).some(artifact => anchor.has(normalizePath(artifact))) ? 1 / ((index + 1) * Math.sqrt(Math.max(1, anchor.size))) : 0), 0)',
  cappedRelationships: `Math.min(1, ${original})`
};
async function load(text) {
  const js = ts.transpileModule(text.replace(/^import .* from '\.\/.*';\r?\n/gm, ''), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
}
const { SPRINT25_DEVELOPMENT: cases } = await load(fs.readFileSync('src/eval/sprint25DevelopmentFixture.ts', 'utf8'));
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
assert.equal(cases.length, 21);
const records = files.map(file => ({ id: file, category: 'architecture', content: fs.readFileSync(file, 'utf8'), artifacts: [file], status: 'active', timestamp: '2026-10-27T00:00:00.000Z' }));
const results = {};
for (const [name, expression] of Object.entries(variants)) {
  const { HybridSearchEngine } = await load(source.replace(original, expression));
  const engine = new HybridSearchEngine(root, { getActive: () => records }, {});
  results[name] = cases.map(item => {
    const selected = engine.searchRecords(item.query, 5).map(record => record.id);
    const hits = selected.filter(id => item.relevantPaths.includes(id)).length;
    return { query: item.query, relevantCount: item.relevantPaths.length, hits, selected };
  });
}
const answerable = cases.filter(item => item.relevantPaths.length).length;
const totals = {};
for (const [name, rows] of Object.entries(results)) {
  const answered = rows.filter(row => row.relevantCount);
  totals[name] = {
    rawP5: answered.reduce ( (sum, row) => sum + row.hits / 5, 0) / answerable,
    macroRecall5: answered.reduce((sum, row) => sum + row.hits / row.relevantCount, 0) / answerable,
    hits: answered.reduce((sum, row) => sum + row.hits, 0),
    noAnswerWithCandidates: rows.filter(row => !row.relevantCount && row.selected.length).length,
    regressions: rows.filter((row, i) => row.relevantCount && row.hits < results.baseline[i].hits).map(row => row.query),
    improvements: rows.filter((row, i) => row.relevantCount && row.hits > results.baseline[i].hits).map(row => row.query)
  };
}
console.log(JSON.stringify({ files: files.length, answerable, noAnswer: cases.length - answerable, totals, results }, null, 2));
