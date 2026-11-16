import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { TaskLedger } from '../dist/memory/taskLedger.js';
import { TemporalMemoryEngine } from '../dist/memory/temporalMemory.js';
import { executeTaskTool } from '../dist/mcp/taskTools.js';

const dir = mkdtempSync(path.join(os.tmpdir(), 'hm28-cross-eval-'));
const write = (name, content) => writeFileSync(path.join(dir, name), content);
write('decision.md', 'Decision: Use a durable task ledger.\n');
write('linked.md', 'Decision-Source: decision.md\nConstraint: Checkpoints survive restarts.\n');
write('unrelated.md', 'Constraint: Durable task checkpoints survive restarts.\n');
write('conflicting.md', 'Decision-Source: decision.md\nConstraint: Checkpoints survive restarts.\nConstraint: Checkpoints do not survive restarts.\n');
write('stale.md', 'Decision-Source: decision.md\nConstraint: Checkpoints survive restarts.\n');
const ledger = new TaskLedger(dir);
const task = ledger.create({ goal: 'Trace the decision', acceptanceCriteria: ['Find constraints'], sourceRefs: ['decision.md', 'linked.md', 'unrelated.md', 'conflicting.md', 'stale.md'] });
const memory = new TemporalMemoryEngine(dir);
const forgotten = memory.remember('general', 'forgotten violetquasar marker', [], { artifacts: ['linked.md'] });
memory.forget(forgotten.id);
write('stale.md', 'Decision-Source: decision.md\nConstraint: Checkpoints survive restartS.\n');
const cases = [
  { name: 'linked', source: 'linked.md', expected: 'SUPPORTED' },
  { name: 'unrelated', source: 'unrelated.md', expected: 'INSUFFICIENT_EVIDENCE' },
  { name: 'missing', source: 'missing.md', expected: 'INSUFFICIENT_EVIDENCE' },
  { name: 'conflicting', source: 'conflicting.md', expected: 'INSUFFICIENT_EVIDENCE' },
  { name: 'stale', source: 'stale.md', expected: 'STALE_EVIDENCE' },
  { name: 'forgotten-memory', source: 'linked.md', expected: 'SUPPORTED' }
];
const results = cases.map(item => {
  const query = `What constraint in \`${item.source}\` is recorded for the decision in \`decision.md\`?`;
  const response = executeTaskTool(dir, ledger, 'hypersabmemory_task_grounded_query', { taskId: task.id, query }).structuredContent;
  assert.equal(response.status, item.expected, item.name);
  assert.equal(response.canAssert, item.expected === 'SUPPORTED', item.name);
  assert(!JSON.stringify(response).includes('violetquasar'), item.name);
  if (!response.canAssert) assert.equal(response.assertions.length, 0, item.name);
  return { name: item.name, status: response.status, sources: response.answer?.sources?.map(source => ({ path: source.path, line: source.line })) ?? [] };
});
const timedQuery = { taskId: task.id, query: 'What constraint in `linked.md` is recorded for the decision in `decision.md`?' };
executeTaskTool(dir, ledger, 'hypersabmemory_task_grounded_query', timedQuery);
const samples = [];
for (let i = 0; i < 20; i++) {
  const start = performance.now();
  assert.equal(executeTaskTool(dir, ledger, 'hypersabmemory_task_grounded_query', timedQuery).structuredContent.status, 'SUPPORTED');
  samples.push(performance.now() - start);
}
samples.sort((a, b) => a - b);
console.log(JSON.stringify({ cases: results.length, passed: results.length, failed: 0, supported: results.filter(item => item.status === 'SUPPORTED').length, abstained: results.filter(item => item.status !== 'SUPPORTED').length, synthetic: true, humanReviewed: false, latencyMs: { samples: samples.length, warmup: 1, p50: samples[9], p95: samples[18] }, results, workspace: dir }));
