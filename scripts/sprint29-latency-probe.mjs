import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { HyperSABMemoryMcpServer } from '../dist/mcp/server.js';
import { TemporalMemoryEngine } from '../dist/memory/temporalMemory.js';

const root = mkdtempSync(path.join(os.tmpdir(), 'sprint29-latency-'));
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
