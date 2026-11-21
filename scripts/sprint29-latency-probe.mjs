import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { HyperSABMemoryMcpServer } from '../dist/mcp/server.js';
import { TemporalMemoryEngine } from '../dist/memory/temporalMemory.js';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

const root = mkdtempSync(path.join(os.tmpdir(), 'sprint29-latency-'));
const compare = process.argv[2] === '--compare' ? process.argv[3] : undefined;
const mkdir = file => mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
mkdir('prefs.json');
mkdir('design/storage-choice.md');
mkdir('architecture/task-rules.md');
writeFileSync(path.join(root, 'prefs.json'), '{"port": 4321}\n');
writeFileSync(path.join(root, 'design/storage-choice.md'), 'Decision: Use SQLite for task coordination.\nRationale: Preserve atomic task transitions.\n');
writeFileSync(path.join(root, 'architecture/task-rules.md'), 'Decision-Source: design/storage-choice.md\nConstraint: Task updates must use a transactional coordinator.\n');
const memory = new TemporalMemoryEngine(root);
memory.remember('decision', 'The local service port is configured.', [], { artifacts: ['prefs.json'] });
memory.remember('decision', 'The storage decision preserves atomic task transitions.', [], { artifacts: ['design/storage-choice.md'] });
memory.remember('architecture', 'The implementation constraint requires transactional updates.', [], { artifacts: ['architecture/task-rules.md'] });
if (compare) {
  // Compare the same two server paths over one fixture and one captured task.
  const before = await import(pathToFileURL(path.join(path.resolve(compare), 'mcp/server.js')).href);
  writeFileSync(path.join(root, 'ledger.ts'), 'export function countPallets() { return 5; }\n');
  writeFileSync(path.join(root, 'ledger.spec.ts'), "import { it, expect } from 'vitest';\nimport { countPallets } from './ledger.js';\nit('counts inventory', () => expect(countPallets()).toBe(5));\n");
  memory.remember('architecture', 'countPallets inventory implementation', [], { artifacts: ['ledger.ts'] });
  memory.remember('architecture', 'countPallets inventory tests', [], { artifacts: ['ledger.spec.ts'] });
  const clients = [];
  for (const Server of [before.HyperSABMemoryMcpServer, HyperSABMemoryMcpServer]) {
    const client = new Client({ name: 'matched-handoff', version: '1' });
    const [c, s] = InMemoryTransport.createLinkedPair();
    await Promise.all([new Server(root).connect(s), client.connect(c)]);
    clients.push(client);
  }
  const task = await clients[0].callTool({ name: 'hypersabmemory_task_create', arguments: {
    goal: 'Continue inventory changes', acceptanceCriteria: ['Keep source attribution'],
    sourceRefs: ['design/storage-choice.md', 'architecture/task-rules.md'], nextAction: 'Inspect current sources.'
  } });
  assert.ok(task.structuredContent?.taskId, JSON.stringify(task));
  const taskId = task.structuredContent.taskId;
  const owner = await clients[0].callTool({ name: 'hypersabmemory_task_claim', arguments: { taskId, agentId: 'latency-fixture' } });
  assert.ok(!owner.isError, JSON.stringify(owner));
  const saved = await clients[0].callTool({ name: 'hypersabmemory_task_checkpoint', arguments: {
    taskId, agentId: 'latency-fixture', expectedRevision: owner.structuredContent.revision,
    leaseGeneration: owner.structuredContent.leaseGeneration, decisions: ['Use SQLite for task coordination.']
  } });
  assert.ok(!saved.isError, JSON.stringify(saved));
  const calls = {
    task: { name: 'hypersabmemory_task_context', arguments: { taskId } },
    evidence: { name: 'hypersabmemory_query_evidence', arguments: { query: 'Where is countPallets implemented and which tests exercise it?' } }
  };
  const tracks = [Object.fromEntries(Object.keys(calls).map(key => [key, []])), Object.fromEntries(Object.keys(calls).map(key => [key, []]))];
  const read = fs.readFileSync;
  let reads = 0;
  fs.readFileSync = function (file, ...args) {
    if (typeof file === 'string' && path.isAbsolute(file) && file.startsWith(root + path.sep) && /\.(?:md|ts)$/.test(file)) reads++;
    return read.call(this, file, ...args);
  };
  syncBuiltinESMExports();
  try {
    const sample = async (side, key, call, warmup) => {
      reads = 0;
      const start = performance.now();
      const packet = await clients[side].callTool(call);
      const ms = performance.now() - start;
      assert.ok(!packet.isError, JSON.stringify(packet));
      if (key === 'task') assert.equal(packet.structuredContent.answerBundle.linkedConstraints.length, 1);
      else assert.equal(JSON.parse(packet.content[0].text).implementationEvidence.tests.length, 1);
      if (!warmup) tracks[side][key].push({ ms, reads, bytes: Buffer.byteLength(JSON.stringify(packet)) });
    };
    for (let round = -3; round < 40; round++) {
      for (const side of round % 2 ? [1, 0] : [0, 1]) {
        for (const [key, call] of Object.entries(calls)) await sample(side, key, call, round < 0);
      }
    }
    const percentile = (values, p) => values.sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
    console.log(JSON.stringify({ versions: ['before', 'after'], samplesPerPath: 40, processRssMiB: +(process.memoryUsage().rss / 2 ** 20).toFixed(2), results:
      tracks.map(workloads => Object.fromEntries(Object.entries(workloads).map(([key, samples]) => [key, {
        p50: percentile(samples.map(item => item.ms), .5), p95: percentile(samples.map(item => item.ms), .95),
        sourceReads: [...new Set(samples.map(item => item.reads))], responseBytes: [...new Set(samples.map(item => item.bytes))]
      }])) ) }, null, 2));
  } finally {
    fs.readFileSync = read;
    syncBuiltinESMExports();
    for (const client of clients) await client.close();
  }
  // Keep the disposable comparison fixture available for inspection.
  console.error('Matched fixture:', root);
  process.exit(0);
}
const server = new HyperSABMemoryMcpServer(root);
const client = new Client({ name: 'sprint29-latency', version: '1' });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
try {
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const queries = [
    { kind: 'one-source', query: 'What port is configured for the local service?', files: ['prefs.json'] },
    { kind: 'multi-source', query: 'Why was the storage design selected, and which implementation constraint is explicitly linked?', files: ['design/storage-choice.md', 'architecture/task-rules.md'] }
  ];
  const call = async item => {
    const response = await client.callTool({ name: 'hypersabmemory_query_evidence', arguments: { query: item.query } });
    const packet = JSON.parse(response.content[0].text);
    assert.ok(item.kind === 'one-source' ? packet.answerVerified : packet.compoundAnswer?.status === 'source_verified');
    return packet;
  };
  const samples = Object.fromEntries(queries.map(item => [item.kind, []]));
  for (const item of queries) await call(item);
  for (let run = 0; run < 30; run++) for (const item of queries) {
    const start = performance.now();
    await call(item);
    samples[item.kind].push(performance.now() - start);
  }
  const percentile = (values, p) => values.slice().sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
  console.log(JSON.stringify({ snapshot: Object.fromEntries(queries.map(item => [item.kind, item.files])), samples: 30, latencyMs: Object.fromEntries(Object.entries(samples).map(([kind, values]) => [kind, { p50: percentile(values, .5), p95: percentile(values, .95) }])) }, null, 2));
} finally {
  await client.close();
  const temp = realpathSync(os.tmpdir());
  const actual = realpathSync(root);
  const relative = path.relative(temp, actual);
  assert.ok(path.basename(actual).startsWith('sprint29-latency-') && relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
  rmSync(actual, { recursive: true, force: true });
}
