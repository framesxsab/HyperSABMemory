import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DEVELOPMENT } from '../dist/eval/repositoryTaskFixture.js';
import { captureTaskSources } from '../dist/harness/taskSources.js';
import { searchGrounded } from '../dist/memory/groundedSearch.js';
import { HybridSearchEngine } from '../dist/memory/hybridSearch.js';
import { TemporalMemoryEngine } from '../dist/memory/temporalMemory.js';

const count = Number(process.argv[2]);
assert(Number.isInteger(count) && count >= 500);
const root = process.cwd();
const paths = [];
function walk(dir) {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const filename = path.posix.join(dir, entry.name);
    if (entry.isSymbolicLink() || filename === 'src/eval') continue;
    if (entry.isDirectory()) walk(filename);
    else if (entry.isFile() && filename.endsWith('.ts') && !['tests/repositoryTaskEvaluation.test.ts', 'tests/groundedSearch.test.ts'].includes(filename)) paths.push(filename);
  }
}
walk('src');
walk('tests');
paths.sort();
assert(paths.length < count);
if (process.argv[3] === '--cold-worker') {
  const workspace = process.argv[4];
  const query = DEVELOPMENT[Number(process.argv[5])].query;
  const sources = paths.flatMap(filename => captureTaskSources(root, [filename]));
  const timing = { candidateMs: 0, indexingMs: 0, rankingMs: 0, pathMs: 0, readMs: 0, hashMs: 0, excerptMs: 0, decisionMs: 0 };
  const start = performance.now();
  const engine = new HybridSearchEngine(workspace, new TemporalMemoryEngine(workspace));
  JSON.stringify(searchGrounded(engine, root, query, sources, [], timing));
  console.log(JSON.stringify({ totalMs: performance.now() - start, ...timing }));
  process.exit(0);
}
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-grounded-bench-'));
try {
  fs.mkdirSync(path.join(workspace, '.hypersabmemory'));
  const records = paths.map(filename => ({ id: filename, category: 'architecture', content: fs.readFileSync(path.join(root, filename), 'utf8'), artifacts: [filename], status: 'active', timestamp: '2026-10-27T00:00:00.000Z' }));
  for (let i = records.length; i < count; i++) records.push({ id: `noise-${i}`, category: 'general', content: `Synthetic benchmark note ${i} about routine project work`, status: 'active', timestamp: '2026-10-27T00:00:00.000Z' });
  assert.equal(records.length, count);
  fs.writeFileSync(path.join(workspace, '.hypersabmemory', 'memory_store.json'), JSON.stringify(records));
  const engine = new HybridSearchEngine(workspace, new TemporalMemoryEngine(workspace));
  const sources = paths.flatMap(filename => captureTaskSources(root, [filename]));
  const queries = DEVELOPMENT.slice(0, 6);
  const samples = [];
  const cold = [];
  const coldProcess = [];
  const stages = [];
  const serialization = [];
  for (const [queryIndex, { query }] of queries.entries()) {
    const worker = spawnSync(process.execPath, [fileURLToPath(import.meta.url), String(count), '--cold-worker', workspace, String(queryIndex)], { cwd: root, encoding: 'utf8' });
    assert.equal(worker.status, 0, worker.stderr);
    coldProcess.push(JSON.parse(worker.stdout));
    const coldStart = performance.now();
    const coldEngine = new HybridSearchEngine(workspace, new TemporalMemoryEngine(workspace));
    JSON.stringify(searchGrounded(coldEngine, root, query, sources));
    cold.push(performance.now() - coldStart);
    for (let i = 0; i < 5; i++) {
      const timing = { candidateMs: 0, indexingMs: 0, rankingMs: 0, pathMs: 0, readMs: 0, hashMs: 0, excerptMs: 0, decisionMs: 0 };
      const start = performance.now();
      const result = searchGrounded(engine, root, query, sources, [], timing);
      const serializationStart = performance.now();
      JSON.stringify(result);
      serialization.push(performance.now() - serializationStart);
      samples.push(performance.now() - start);
      timing.groundingMs = samples.at(-1) - timing.candidateMs - timing.rankingMs - serialization.at(-1);
      stages.push(timing);
    }
  }
  samples.sort((a, b) => a - b);
  const distribution = values => { values.sort((a, b) => a - b); return { p50: values[Math.ceil(values.length * .5) - 1], p95: values[Math.ceil(values.length * .95) - 1] }; };
  const profile = Object.fromEntries(Object.keys(stages[0]).map(key => [key, distribution(stages.map(item => item[key]))]));
  profile.serializationMs = distribution(serialization);
  const coldProcessStages = Object.fromEntries(Object.keys(coldProcess[0]).map(key => [key, distribution(coldProcess.map(item => item[key]))]));
  console.log(JSON.stringify({ environment: { node: process.version, platform: process.platform, arch: process.arch }, records: count, realSourceFiles: paths.length, syntheticDistractors: count - paths.length, queries: queries.length, warmupsPerQuery: 1, samplesPerQuery: 5, samples: samples.length, coldFirstQueryCalls: distribution(cold), independentColdProcesses: coldProcessStages, warm: distribution(samples), stages: profile }, null, 2));
} finally {
  fs.rmSync(workspace, { recursive: true, force: true });
}
