import { expect, it } from 'vitest';
import * as fs from 'node:fs';
import fsDefault from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { vi } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import { TaskLedger } from '../src/memory/taskLedger.js';
import { executeTaskTool } from '../src/mcp/taskTools.js';
import { TemporalMemoryEngine } from '../src/memory/temporalMemory.js';
import { matchesTargetFile } from './testUtils.js';

it('answers an explicitly referenced decision and constraint from two current task sources', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-cross-file-'));
  try {
    fs.writeFileSync(path.join(dir, 'decision.md'), 'Decision: Use a durable task ledger.\n');
    fs.writeFileSync(path.join(dir, 'constraint.md'), 'Decision-Source: decision.md\nConstraint: Checkpoints must survive restarts.\n');
    const ledger = new TaskLedger(dir);
    const task = ledger.create({ goal: 'Preserve checkpoints', acceptanceCriteria: ['Find the constraint'], sourceRefs: ['decision.md', 'constraint.md'] });
    const response = executeTaskTool(dir, ledger, 'hypersabmemory_task_grounded_query', { taskId: task.id, query: 'What constraint in `constraint.md` is recorded for the decision in `decision.md`?' });
    expect(response?.structuredContent).toMatchObject({ status: 'SUPPORTED', canAssert: true, answer: { text: expect.stringContaining('Checkpoints must survive restarts.'), sources: expect.arrayContaining([expect.objectContaining({ path: 'decision.md', line: 1, sha256: task.sourceRefs[0].sha256, excerpt: 'Decision: Use a durable task ledger.' }), expect.objectContaining({ path: 'constraint.md', line: 1, sha256: task.sourceRefs[1].sha256, excerpt: 'Decision-Source: decision.md' }), expect.objectContaining({ path: 'constraint.md', line: 2, sha256: task.sourceRefs[1].sha256, excerpt: 'Constraint: Checkpoints must survive restarts.' })]) } });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

it('abstains for unrelated, missing, conflicting and stale sources and excludes forgotten memory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-cross-safety-'));
  try {
    const decision = path.join(dir, 'decision.md');
    const constraint = path.join(dir, 'constraint.md');
    fs.writeFileSync(decision, 'Decision: Use a durable task ledger.\n');
    const query = 'What constraint in `constraint.md` is recorded for the decision in `decision.md`?';
    const ledger = new TaskLedger(dir);
    const ask = (taskId: string, conflictingPaths?: string[]) => executeTaskTool(dir, ledger, 'hypersabmemory_task_grounded_query', { taskId, query, ...(conflictingPaths ? { conflictingPaths } : {}) })!.structuredContent;
    fs.writeFileSync(constraint, 'Constraint: Durable task checkpoints survive restarts.\n');
    const unrelated = ledger.create({ goal: 'check', acceptanceCriteria: ['inspect'], sourceRefs: ['decision.md', 'constraint.md'] });
    expect(ask(unrelated.id)).toMatchObject({ status: 'INSUFFICIENT_EVIDENCE', canAssert: false, assertions: [] });
    fs.writeFileSync(constraint, 'Decision-Source: other.md\nConstraint: Durable task checkpoints survive restarts.\n');
    const differentReference = ledger.create({ goal: 'check', acceptanceCriteria: ['inspect'], sourceRefs: ['decision.md', 'constraint.md'] });
    expect(ask(differentReference.id)).toMatchObject({ status: 'INSUFFICIENT_EVIDENCE', canAssert: false, assertions: [] });
    const missing = ledger.create({ goal: 'check', acceptanceCriteria: ['inspect'], sourceRefs: ['decision.md'] });
    expect(ask(missing.id)).toMatchObject({ status: 'INSUFFICIENT_EVIDENCE', reason: 'Both named files must be captured task sources.', canAssert: false, assertions: [] });
    fs.writeFileSync(constraint, 'Decision-Source: decision.md\nConstraint: Survive restarts.\nConstraint: Do not survive restarts.\n');
    const conflicting = ledger.create({ goal: 'check', acceptanceCriteria: ['inspect'], sourceRefs: ['decision.md', 'constraint.md'] });
    expect(ask(conflicting.id)).toMatchObject({ status: 'INSUFFICIENT_EVIDENCE', canAssert: false, assertions: [] });
    expect(ask(conflicting.id, ['constraint.md'])).toMatchObject({ status: 'CONFLICTING_EVIDENCE', canAssert: false, assertions: [] });
    fs.writeFileSync(constraint, 'Decision-Source: decision.md\nConstraint: Survive restarts.\n');
    const current = ledger.create({ goal: 'check', acceptanceCriteria: ['inspect'], sourceRefs: ['decision.md', 'constraint.md'] });
    const disputed = ledger.create({ goal: 'check', acceptanceCriteria: ['inspect'], sourceRefs: ['decision.md', 'constraint.md'], openIssues: ['Conflicting decision sources'] });
    expect(ask(disputed.id)).toMatchObject({ status: 'CONFLICTING_EVIDENCE', conflictDetails: 'task_reported', canAssert: false, assertions: [] });
    const memory = new TemporalMemoryEngine(dir);
    const secret = memory.remember('general', 'forgotten violetquasar marker', [], { artifacts: ['constraint.md'] });
    memory.forget(secret.id);
    expect(JSON.stringify(ask(current.id))).not.toContain('violetquasar');
    fs.writeFileSync(constraint, 'Decision-Source: decision.md\nConstraint: Survive RestartS.\n');
    expect(ask(current.id)).toMatchObject({ status: 'STALE_EVIDENCE', canAssert: false, evidence: [], assertions: [], staleSources: expect.arrayContaining([expect.objectContaining({ path: 'constraint.md', status: 'modified' })]) });
    const claim = ledger.claim({ taskId: current.id, agentId: 'agent' });
    ledger.checkpoint({ taskId: current.id, agentId: 'agent', expectedRevision: claim.revision, leaseGeneration: claim.leaseGeneration, evidencePaths: ['constraint.md'] });
    expect(ask(current.id)).toMatchObject({ status: 'CONFLICTING_EVIDENCE', conflictOrigin: 'source_hash_mismatch', canAssert: false, evidence: [], assertions: [] });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

it('rechecks both supporting sources before returning the cross-file assertion', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-cross-race-'));
  try {
    const decision = path.join(dir, 'decision.md');
    const constraint = path.join(dir, 'constraint.md');
    fs.writeFileSync(decision, 'Decision: Use a durable task ledger.\n');
    const original = 'Decision-Source: decision.md\nConstraint: Survive restarts.\n';
    fs.writeFileSync(constraint, original);
    const ledger = new TaskLedger(dir);
    const task = ledger.create({ goal: 'check', acceptanceCriteria: ['inspect'], sourceRefs: ['decision.md', 'constraint.md'] });
    const read = fs.readFileSync;
    let reads = 0;
    vi.spyOn(fsDefault, 'readFileSync').mockImplementation(((file: fs.PathOrFileDescriptor, options?: unknown) => {
      const value = read(file, options as never);
      if (matchesTargetFile(file, constraint) && ++reads === 1) fs.writeFileSync(constraint, original.replace('Survive', 'Changed'));
      return value;
    }) as typeof fs.readFileSync);
    syncBuiltinESMExports();
    const response = executeTaskTool(dir, ledger, 'hypersabmemory_task_grounded_query', { taskId: task.id, query: 'What constraint in `constraint.md` is recorded for the decision in `decision.md`?' });
    expect(response?.structuredContent).toMatchObject({ status: 'STALE_EVIDENCE', canAssert: false, evidence: [], assertions: [] });
  } finally { vi.restoreAllMocks(); syncBuiltinESMExports(); fs.rmSync(dir, { recursive: true, force: true }); }
});
