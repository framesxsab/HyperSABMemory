import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import ts from 'typescript';

function moduleUrl(file, replacements = {}) {
  let code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const [from, to] of Object.entries(replacements)) code = code.replaceAll(from, to);
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
}
const sourceUrl = moduleUrl('src/harness/taskSources.ts');
const hybridUrl = moduleUrl('src/memory/hybridSearch.ts', { "import { TemporalMemoryEngine } from './temporalMemory.js';": '', "import { StructuralGraphEngine } from './structuralGraph.js';": '' });
const { captureTaskSources, inspectTaskSourceContents } = await import(sourceUrl);
const { HybridSearchEngine } = await import(hybridUrl);
const { searchGrounded, lexicalSupport, GROUNDED_SUPPORT_THRESHOLD, sourceKey } = await import(moduleUrl('src/memory/groundedSearch.ts', { '../harness/taskSources.js': sourceUrl, './hybridSearch.js': hybridUrl }));
const { SPRINT25_DEVELOPMENT: cases } = await import(moduleUrl('src/eval/sprint25DevelopmentFixture.ts'));
assert.equal(cases.length, 21);
assert.equal(GROUNDED_SUPPORT_THRESHOLD, 0.3);
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
const records = files.map(file => ({ id: file, category: 'architecture', content: fs.readFileSync(file, 'utf8'), artifacts: [file], status: 'active', timestamp: '2026-10-27T00:00:00.000Z' }));
const forgotten = { id: 'forgotten-fixture', category: 'general', content: 'Confidential enterprise contract production database password', status: 'forgotten', timestamp: '2026-10-27T00:00:00.000Z' };
const allRecords = [...records, forgotten];
const hybrid = new HybridSearchEngine(process.cwd(), { getActive: () => allRecords.filter(r => r.status === 'active') }, {});
const references = files.flatMap(file => captureTaskSources(process.cwd(), [file]));
const refMap = new Map(references.map(ref => [sourceKey(ref.path), ref]));
assert.throws(() => captureTaskSources(process.cwd(), ['../outside-probe']));
const inspectLimit = process.argv[2] === undefined ? 50 : Number(process.argv[2]);
assert(Number.isInteger(inspectLimit) && inspectLimit >= 5 && inspectLimit <= 50);
const rules = {
  first: (a, b) => a.rank - b.rank,
  support: (a, b) => b.support - a.support || a.rank - b.rank,
  blend: (a, b) => (b.normalized + b.support) - (a.normalized + a.support) || a.rank - b.rank,
  reciprocal: (a, b) => (1 / (10 + b.rank) + b.support / 10) - (1 / (10 + a.rank) + a.support / 10) || a.rank - b.rank
};
function select(candidates, refs, compare) {
  const seen = new Set();
  const pool = [];
  const max = Math.max(0, ...candidates.map(c => c.score));
  let stale = 0;
  for (const [index, c] of candidates.slice(0, inspectLimit).entries()) for (const artifact of c.record.artifacts ?? []) {
    const key = sourceKey(artifact), ref = refs.get(key);
    if (!ref || seen.has(key)) continue;
    seen.add(key);
    const source = inspectTaskSourceContents(process.cwd(), [ref])[0];
    if (source.status !== 'current' || !source.content) { stale++; continue; }
    const support = lexicalSupport(c.query, source.content.toString('utf8'), c.queryTermEvidence);
    if (support >= GROUNDED_SUPPORT_THRESHOLD) pool.push({ path: ref.path, rank: index + 1, support, normalized: max > 0 ? c.score / max : 0, ref });
  }
  const chosen = pool.sort(compare).slice(0, 5);
  const final = chosen.filter(item => inspectTaskSourceContents(process.cwd(), [item.ref])[0].status === 'current');
  return { paths: final.map(item => item.path), stale, pool: pool.length };
}
const rows = [];
for (const item of cases) {
  const candidates = hybrid.searchRecordsWithScores(item.query, 50).map(c => ({ ...c, query: item.query }));
  const raw = candidates.slice(0, 5).map(c => c.record.id);
  const actual = searchGrounded(hybrid, process.cwd(), item.query, references);
  const variants = Object.fromEntries(Object.entries(rules).map(([name, compare]) => [name, select(candidates, refMap, compare)]));
  if (inspectLimit === 50) assert.deepEqual(variants.first.paths, actual.evidence.map(e => e.source.path), `production baseline mismatch: ${item.query}`);
  assert.equal(actual.assertions.length, 0);
  assert.equal(actual.canAssert, false);
  const invalid = new Map([...refMap].map(([key, value]) => [key, { ...value, sha256: '0'.repeat(64) }]));
  const staleActual = searchGrounded(hybrid, process.cwd(), item.query, [...invalid.values()]);
  assert.equal(staleActual.evidence.length, 0);
  assert.equal(staleActual.assertions.length, 0);
  for (const [name, compare] of Object.entries(rules)) {
    const probe = select(candidates, invalid, compare);
    assert.equal(probe.paths.length, 0, `${name} stale leak`);
    variants[name].staleFlagged = probe.stale;
  }
  rows.push({ query: item.query, relevantPaths: item.relevantPaths, raw, actualStatus: actual.status, assertions: actual.assertions.length, actualStaleFlagged: staleActual.staleSources.length, variants });
}
const answerable = rows.filter(r => r.relevantPaths.length), noAnswer = rows.filter(r => !r.relevantPaths.length);
const summarize = pick => ({ p5: answerable.reduce((s,r) => s + pick(r).filter(p => r.relevantPaths.includes(p)).length / 5,0) / answerable.length, recall: answerable.reduce((s,r) => s + pick(r).filter(p => r.relevantPaths.includes(p)).length / r.relevantPaths.length,0) / answerable.length, hits: answerable.reduce((s,r) => s + pick(r).filter(p => r.relevantPaths.includes(p)).length,0), noAnswerWithEvidence: noAnswer.filter(r => pick(r).length).length, forgottenLeaks: rows.flatMap(pick).filter(p => p === forgotten.id).length });
const summary = { raw: summarize(r => r.raw), ...Object.fromEntries(Object.keys(rules).map(name => [name, summarize(r => r.variants[name].paths)])) };
console.log(JSON.stringify({ node: process.version, files: files.length, cases: cases.length, answerable: answerable.length, noAnswer: noAnswer.length, threshold: GROUNDED_SUPPORT_THRESHOLD, inspectLimit, summary, rows }, null, 2));
