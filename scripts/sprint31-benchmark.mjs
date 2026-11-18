import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Session } from 'node:inspector';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';

const [mode, ...args] = process.argv.slice(2);
const quantiles = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return [sorted[Math.ceil(sorted.length / 2) - 1], sorted[Math.ceil(sorted.length * .95) - 1]].map(n => +n.toFixed(2));
};
const queries = ['crate inventory reconciliation', 'Where is reconcileCrates implemented and which tests exercise it?'];
if (mode === '--worker') {
  const [dist, root, queryIndex, profile] = args;
  const started = performance.now();
  const load = file => import(pathToFileURL(path.resolve(dist, file)).href);
  const { searchGrounded } = await load('memory/groundedSearch.js');
  const { HybridSearchEngine } = await load('memory/hybridSearch.js');
  const refs = JSON.parse(fs.readFileSync(path.join(root, 'refs.json'), 'utf8'));
  const engine = new HybridSearchEngine(root);
  const query = queries[Number(queryIndex)];
  let digest;
  function sample() {
    const timing = { candidateMs: 0, indexingMs: 0, rankingMs: 0, pathMs: 0, readMs: 0, hashMs: 0, excerptMs: 0, decisionMs: 0 };
    const start = performance.now();
    const result = searchGrounded(engine, root, query, refs, [], timing);
    const serialize = performance.now();
    const output = JSON.stringify(result);
    const end = performance.now();
    digest = createHash('sha256').update(output).digest('hex');
    assert.equal(result.canAssert, false);
    if (Number(queryIndex)) assert.equal(result.implementationEvidence.tests.length, 1);
    return { totalMs: end - start, ...timing, serializeMs: end - serialize };
  }
  const first = sample();
  const fresh = performance.now() - started;
  for (let i = 0; i < 3; i++) sample();
  const inspector = profile ? new Session() : undefined;
  inspector?.connect();
  const post = (method, params = {}) => new Promise((resolve, reject) => inspector.post(method, params, (error, result) => error ? reject(error) : resolve(result)));
  if (inspector) {
    await post('Profiler.enable');
    await post('Profiler.start');
  }
  const warm = Array.from({ length: 20 }, sample);
  let cpu;
  if (inspector) {
    const { profile: trace } = await post('Profiler.stop');
    const nodes = new Map(trace.nodes.map(node => [node.id, node]));
    const parent = new Map(trace.nodes.flatMap(node => (node.children ?? []).map(id => [id, node.id])));
    function under(id, name) {
      for (; id; id = parent.get(id)) if (nodes.get(id).callFrame.functionName === name) return true;
      return false;
    }
    cpu = Object.fromEntries(['tokenizeSearchQuery', 'searchRecordsWithScores', 'createProgram', 'createSourceFile',
      'collectImplementationEvidence', 'inspectSourceContents', 'verifyRecordedClaims'].map(name =>
      [name, trace.samples.filter(id => under(id, name)).length]));
    cpu.samples = trace.samples.length;
    inspector.disconnect();
  }
  console.log(JSON.stringify({ first, fresh, warm, digest, rssMiB: process.memoryUsage().rss / 2 ** 20, cpu }));
} else {
  const baseline = mode;
  assert.ok(baseline, 'Pass the Sprint 3.0 dist directory');
  const candidate = args[0] ?? 'dist';
  const profile = args.includes('--profile');
  const parentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm31-benchmark-'));
  function fixture(count) {
    const root = path.join(parentDir, String(count));
    fs.mkdirSync(path.join(root, '.hypersabmemory'), { recursive: true });
    const records = [], refs = [];
    function add(id, content, artifact) {
      records.push({ id, category: 'architecture', content, artifacts: artifact ? [id] : [], status: 'active', timestamp: '2026-10-27T00:00:00.000Z' });
      if (artifact) {
        fs.writeFileSync(path.join(root, id), artifact);
        refs.push({ path: id, sha256: createHash('sha256').update(artifact).digest('hex') });
      }
    }
    add('warehouse.ts', 'reconcileCrates crate inventory reconciliation implementation', 'export function reconcileCrates() { return 5; }\n');
    for (let i = 2; i < Math.min(count, 12); i++) {
      add('distractor' + i + '.test.ts', 'reconcileCrates crate inventory reconciliation tests', "import { it, expect } from 'vitest';\nit('checks unrelated inventory', () => expect(2).toBe(2));\n");
    }
    add('warehouse.test.ts', 'reconcileCrates crate inventory reconciliation tests', "import { it, expect } from 'vitest';\nimport { reconcileCrates as reconcile } from './warehouse.js';\nit('checks crate totals', () => expect(reconcile()).toBe(5));\n");
    for (let i = records.length; i < count; i++) add('noise-' + i, 'routine project note ' + i);
    fs.writeFileSync(path.join(root, '.hypersabmemory', 'memory_store.json'), JSON.stringify(records));
    fs.writeFileSync(path.join(root, 'refs.json'), JSON.stringify(refs));
    return root;
  }
  for (const count of profile ? [12] : [2, 12, 500]) {
    const root = fixture(count);
    for (const index of profile ? [1] : [0, 1]) {
      const streams = [[], []];
      for (let round = 0; round < (profile ? 1 : 4); round++) {
        for (const side of round % 2 ? [1, 0] : [0, 1]) {
          const start = performance.now();
          const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--worker', [baseline, candidate][side], root, String(index), ...(profile ? ['profile'] : [])], { encoding: 'utf8' });
          assert.equal(child.status, 0, child.stderr);
          streams[side].push({ ...JSON.parse(child.stdout), processMs: performance.now() - start });
        }
      }
      assert.equal(new Set(streams.flat().map(item => item.digest)).size, 1, 'grounded evidence output must match byte-for-byte');
      console.log(JSON.stringify({ count, query: queries[index], results: streams.map(runs => ({
        warmN: runs.flatMap(run => run.warm).length, freshN: runs.length,
        warmMs: quantiles(runs.flatMap(run => run.warm.map(item => item.totalMs))),
        freshMs: quantiles(runs.map(run => run.fresh)),
        wholeWorkerMs: quantiles(runs.map(run => run.processMs)),
        rssMiB: quantiles(runs.map(run => run.rssMiB)),
        stagesMs: Object.fromEntries(Object.keys(runs[0].first).map(key => [key, quantiles(runs.flatMap(run => run.warm.map(item => item[key])))])),
        cpu: runs[0].cpu
      })) }));
    }
  }
  console.error('Disposable benchmark fixtures retained at', parentDir);
}
