import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { SPRINT25_DEVELOPMENT } from '../dist/eval/sprint25DevelopmentFixture.js';
import { captureTaskSources, createTaskSourceContentInspector, inspectTaskSources } from '../dist/harness/taskSources.js';
import { HybridSearchEngine } from '../dist/memory/hybridSearch.js';
import { GROUNDED_SUPPORT_THRESHOLD, isExplicitGroundedQuery, lexicalSupport, searchGrounded, sourceKey } from '../dist/memory/groundedSearch.js';

const source = fs.readFileSync('src/memory/hybridSearch.ts', 'utf8');
const marker = 'function staticImports(content: string): string[] {';
assert.equal(source.split(marker).length, 2);
const baselineSource = source.replace(marker, `${marker} return [];`).replace(/^import .* from '\.\/.*';\r?\n/gm, '').replace("from 'stemmer'", `from '${pathToFileURL(path.resolve('node_modules/stemmer/index.js')).href}'`);
const baselineCode = ts.transpileModule(baselineSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { HybridSearchEngine: BaselineEngine } = await import(`data:text/javascript;base64,${Buffer.from(baselineCode).toString('base64')}`);
const root = process.cwd();
const files = [];
function walk(directory) {
  for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
    const filename = path.posix.join(directory, entry.name);
    if (entry.isSymbolicLink() || filename === 'src/eval') continue;
    if (entry.isDirectory()) walk(filename);
    else if (entry.isFile() && filename.endsWith('.ts') && !['tests/repositoryTaskEvaluation.test.ts', 'tests/groundedSearch.test.ts'].includes(filename)) files.push(filename);
  }
}
walk('src');
walk('tests');
if (fs.existsSync(path.join(root, 'Architecture.md'))) files.push('Architecture.md');
files.sort();
const records = files.map(filename => ({ id: filename, category: 'architecture', content: fs.readFileSync(path.join(root, filename), 'utf8'), artifacts: [filename], status: 'active', timestamp: '2026-10-27T00:00:00.000Z' }));
const sources = files.flatMap(filename => captureTaskSources(root, [filename]));
const references = new Map(sources.map(source => [sourceKey(source.path), source]));
const memory = { getActive: () => records };
const engines = { baseline: new BaselineEngine(root, memory, {}), candidate: new HybridSearchEngine(root, memory, {}) };
const answerable = SPRINT25_DEVELOPMENT.filter(item => item.relevantPaths.length);
const noAnswer = SPRINT25_DEVELOPMENT.filter(item => !item.relevantPaths.length);
function baselineGrounded(engine, query) {
  assert.equal(isExplicitGroundedQuery(query), false);
  const seen = new Set();
  const selected = [];
  const inspect = createTaskSourceContentInspector(root);
  for (const candidate of engine.searchRecordsWithScores(query, 50)) {
    for (const artifact of candidate.record.artifacts ?? []) {
      const key = sourceKey(artifact);
      const reference = references.get(key);
      if (!reference || seen.has(key)) continue;
      seen.add(key);
      const result = inspect([reference])[0];
      if (result.status !== 'current' || !result.content) continue;
      if (lexicalSupport(query, result.content.toString('utf8'), candidate.queryTermEvidence) < GROUNDED_SUPPORT_THRESHOLD) continue;
      selected.push({ record: candidate.record, reference });
    }
    if (selected.length >= 5) break;
  }
  const evidence = selected.slice(0, 5).filter(item => inspectTaskSources(root, [item.reference])[0].status === 'current');
  return { evidence, canAssert: false };
}
const output = {};
for (const [name, engine] of Object.entries(engines)) {
  const results = SPRINT25_DEVELOPMENT.map(item => ({ item, raw: engine.searchRecords(item.query, 5), grounded: name === 'baseline' ? baselineGrounded(engine, item.query) : searchGrounded(engine, root, item.query, sources) }));
  const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
  const relevant = result => result.item.relevantPaths;
  const hits = (result, records) => records.filter(id => relevant(result).includes(id)).length;
  const answered = results.filter(result => relevant(result).length);
  output[name] = {
    rawPrecisionAt5: mean(answered.map(result => hits(result, result.raw.map(record => record.id)) / 5)),
    rawMacroRecallAt5: mean(answered.map(result => hits(result, result.raw.map(record => record.id)) / relevant(result).length)),
    groundedPrecisionAt5: mean(answered.map(result => hits(result, result.grounded.evidence.map(item => item.record.id)) / 5)),
    groundedMacroRecallAt5: mean(answered.map(result => hits(result, result.grounded.evidence.map(item => item.record.id)) / relevant(result).length)),
    supportedAnswerable: answered.filter(result => result.grounded.canAssert).length,
    unsupportedNoAnswer: results.filter(result => !relevant(result).length && result.grounded.canAssert).length,
    noAnswerCandidates: results.filter(result => !relevant(result).length && result.raw.length).length
  };
}
console.log(JSON.stringify({ methodology: { files: files.length, answerable: answerable.length, noAnswer: noAnswer.length, sameSourceSnapshot: true, normalization: 'current for both engines; isolates relationship and evidence selection', syntheticLabels: true, humanReviewed: false, staleAndForgottenTested: false }, ...output }, null, 2));
