import { it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import fsDefault from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';
import { TaskLedger } from '../src/memory/taskLedger.js';
import { executeTaskTool } from '../src/mcp/taskTools.js';
import { TemporalMemoryEngine } from '../src/memory/temporalMemory.js';

it('restores recorded task facts and explicit linked evidence without a filename-specific question', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-answer-bundle-'));
  try {
    fs.writeFileSync(path.join(dir, 'choice.md'), 'Decision: Keep invoices local.\nRationale: Avoid hosted processing.\n');
    fs.writeFileSync(path.join(dir, 'rule.md'), 'Decision-Source: choice.md\nConstraint: Invoice data stays on device.\n');
    fs.writeFileSync(path.join(dir, 'unrelated.md'), 'Constraint: Invoice data moves elsewhere.\n');
    const ledger = new TaskLedger(dir);
    const task = ledger.create({ goal: 'Review invoice storage', acceptanceCriteria: ['Preserve local storage'], constraints: ['Avoid hosted services'], sourceRefs: ['choice.md', 'rule.md', 'unrelated.md'] });
    const claimed = ledger.claim({ taskId: task.id, agentId: 'worker' });
    ledger.checkpoint({ taskId: task.id, agentId: 'worker', expectedRevision: claimed.revision, leaseGeneration: claimed.leaseGeneration, decisions: ['Keep invoices local.'], completedWork: ['Recorded the decision'], nextAction: 'Review invoice tests' });
    const memory = new TemporalMemoryEngine(dir);
    const forgotten = memory.remember('general', 'forgotten cometmarker', [], { artifacts: ['rule.md'] });
    memory.forget(forgotten.id);
    const context = executeTaskTool(dir, ledger, 'hypersabmemory_task_context', { taskId: task.id })!.structuredContent;
    expect(JSON.stringify(context)).not.toContain('cometmarker');
    expect(context).toMatchObject({ decisionEvidence: [{ decision: 'Keep invoices local.', sourcePath: 'choice.md', sha256: task.sourceRefs[0].sha256, line: 1, rationale: { text: 'Avoid hosted processing.', line: 2 } }], answerBundle: { recordedTask: { constraints: ['Avoid hosted services'], decisions: ['Keep invoices local.'], nextAction: 'Review invoice tests', attribution: 'agent_reported', provenance: { taskId: task.id, revision: 3, path: '.hypersabmemory/tasks.json' } }, linkedConstraints: [{ decision: 'Keep invoices local.', constraint: 'Invoice data stays on device.', attribution: 'source_recorded', sources: [{ path: 'choice.md', sha256: task.sourceRefs[0].sha256, line: 1, excerpt: 'Decision: Keep invoices local.' }, { path: 'rule.md', sha256: task.sourceRefs[1].sha256, line: 1, excerpt: 'Decision-Source: choice.md' }, { path: 'rule.md', sha256: task.sourceRefs[1].sha256, line: 2, excerpt: 'Constraint: Invoice data stays on device.' }] }] } });
    const unknown = executeTaskTool(dir, ledger, 'hypersabmemory_task_grounded_query', { taskId: task.id, query: 'What is the encryption key?' })!.structuredContent;
    expect(unknown).toMatchObject({ canAssert: false, assertions: [] });
    const unrecorded = ledger.create({ goal: 'Review storage', acceptanceCriteria: ['Inspect'], sourceRefs: ['choice.md', 'rule.md'] });
    expect(executeTaskTool(dir, ledger, 'hypersabmemory_task_context', { taskId: unrecorded.id })!.structuredContent).toMatchObject({ answerBundle: { linkedConstraints: [] } });
    fs.writeFileSync(path.join(dir, 'rule.md'), 'Decision-Source: choice.md\nConstraint: Invoice data stays on devicE.\n');
    const stale = executeTaskTool(dir, ledger, 'hypersabmemory_task_context', { taskId: task.id })!.structuredContent;
    expect(stale).toMatchObject({ answerBundle: { linkedConstraints: [] }, sources: expect.arrayContaining([expect.objectContaining({ path: 'rule.md', status: 'modified' })]) });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

it('discovers different task sources while refusing an unlinked constraint', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-answer-other-'));
  try {
    fs.writeFileSync(path.join(dir, 'queue.md'), 'Decision: Use ordered delivery.\nRationale: Retain message order.\n');
    fs.writeFileSync(path.join(dir, 'policy.md'), 'Constraint: Messages remain ordered.\n');
    const ledger = new TaskLedger(dir);
    const task = ledger.create({ goal: 'Review queues', acceptanceCriteria: ['Check ordering'], sourceRefs: ['queue.md', 'policy.md'], decisions: ['Use ordered delivery.'], nextAction: 'Inspect the queue' });
    const response = executeTaskTool(dir, ledger, 'hypersabmemory_task_context', { taskId: task.id })!.structuredContent;
    expect(response).toMatchObject({ answerBundle: { recordedTask: { provenance: { taskId: task.id }, nextAction: 'Inspect the queue' }, linkedConstraints: [] } });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

it('bounds returned relationships and reports omitted links', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-answer-bound-'));
  try {
    fs.writeFileSync(path.join(dir, 'choice.md'), 'Decision: Keep data local.\n');
    const files = Array.from({ length: 6 }, (_, index) => `rule${index}.md`);
    for (const [index, name] of files.entries()) fs.writeFileSync(path.join(dir, name), `Decision-Source: choice.md\nConstraint: Keep item ${index} local.\n`);
    const ledger = new TaskLedger(dir);
    const task = ledger.create({ goal: 'Check locality', acceptanceCriteria: ['Inspect rules'], sourceRefs: ['choice.md', ...files], decisions: ['Keep data local.'] });
    const response = executeTaskTool(dir, ledger, 'hypersabmemory_task_context', { taskId: task.id })!.structuredContent as { answerBundle: { linkedConstraints: unknown[]; truncated: boolean } };
    expect(response.answerBundle.linkedConstraints.length).toBeLessThanOrEqual(5);
    expect(response.answerBundle.linkedConstraints.length).toBeGreaterThan(0);
    expect(response.answerBundle.truncated).toBe(true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

it('removes a relationship if its supporting source changes during restoration', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-answer-race-'));
  try {
    fs.writeFileSync(path.join(dir, 'choice.md'), 'Decision: Keep invoices local.\n');
    const file = path.join(dir, 'rule.md');
    const original = 'Decision-Source: choice.md\nConstraint: Invoice data stays local.\n';
    fs.writeFileSync(file, original);
    const ledger = new TaskLedger(dir);
    const task = ledger.create({ goal: 'Review storage', acceptanceCriteria: ['Check locality'], sourceRefs: ['choice.md', 'rule.md'], decisions: ['Keep invoices local.'] });
    const read = fs.readFileSync;
    let reads = 0;
    vi.spyOn(fsDefault, 'readFileSync').mockImplementation(((name: fs.PathOrFileDescriptor, options?: unknown) => {
      const value = read(name, options as never);
      if (String(name) === file && ++reads === 3) fs.writeFileSync(file, original.replace('local', 'other'));
      return value;
    }) as typeof fs.readFileSync);
    syncBuiltinESMExports();
    const result = executeTaskTool(dir, ledger, 'hypersabmemory_task_context', { taskId: task.id })!.structuredContent;
    expect(reads).toBeGreaterThanOrEqual(3);
    expect(result).toMatchObject({ answerBundle: { linkedConstraints: [] }, sources: expect.arrayContaining([expect.objectContaining({ path: 'rule.md', status: 'modified' })]) });
  } finally { vi.restoreAllMocks(); syncBuiltinESMExports(); fs.rmSync(dir, { recursive: true, force: true }); }
});


it('restores linked evidence while avoiding a redundant read of unrelated captured sources', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-answer-reads-'));
  try {
    fs.writeFileSync(path.join(dir, 'choice.md'), 'Decision: Keep invoices local.\n');
    fs.writeFileSync(path.join(dir, 'rule.md'), 'Decision-Source: choice.md\nConstraint: Keep data local.\n');
    const other = path.join(dir, 'other.md');
    fs.writeFileSync(other, 'Unrelated notes.\n');
    const ledger = new TaskLedger(dir);
    const task = ledger.create({ goal: 'Review storage', acceptanceCriteria: ['Check locality'], sourceRefs: ['choice.md', 'rule.md', 'other.md'], decisions: ['Keep invoices local.'] });
    const read = fs.readFileSync;
    let reads = 0;
    vi.spyOn(fsDefault, 'readFileSync').mockImplementation(((name: fs.PathOrFileDescriptor, options?: unknown) => {
      if (String(name) === other) reads++;
      return read(name, options as never);
    }) as typeof fs.readFileSync);
    syncBuiltinESMExports();
    const result = executeTaskTool(dir, ledger, 'hypersabmemory_task_context', { taskId: task.id })!.structuredContent;
    expect(result).toMatchObject({ answerBundle: { linkedConstraints: [{ constraint: 'Keep data local.' }] } });
    expect(reads).toBe(2);
  } finally { vi.restoreAllMocks(); syncBuiltinESMExports(); fs.rmSync(dir, { recursive: true, force: true }); }
});
