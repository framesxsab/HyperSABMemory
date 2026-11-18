import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import fsDefault from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';
import { TaskLedger } from '../src/memory/taskLedger.js';
import { listActiveTasks } from '../src/mcp/taskTools.js';
import { restoreTaskContext } from '../src/harness/taskContext.js';
import { acquireFileLock, releaseFileLock } from '../src/memory/fileLock.js';
import Database from 'better-sqlite3';

describe('task ledger', () => {
  it('rejects a second agent claiming an exclusively held task', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-exclusive-claim-'));
    try {
      const ledger = new TaskLedger(dir);
      const task = ledger.create({ goal: 'Review ownership', acceptanceCriteria: ['One owner'] });
      ledger.claim({ taskId: task.id, agentId: 'first' });
      expect(() => ledger.claim({ taskId: task.id, agentId: 'second' })).toThrow('Task is already claimed.');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  it('restores adjacent recorded rationales from multiple fresh sources without inventing links', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-task-rationale-'));
    try {
      const first = path.join(dir, 'first.md');
      const second = path.join(dir, 'second.md');
      fs.writeFileSync(first, 'Decision: Use local storage.\nRationale: Keep data offline.\n');
      fs.writeFileSync(second, 'Decision: Fence task leases.\nRationale: Reject stale writes.\n');
      const task = new TaskLedger(dir).create({ goal: 'test', acceptanceCriteria: ['done'], sourceRefs: ['first.md', 'second.md'], decisions: ['Use local storage.', 'Fence task leases.'] });
      const restored = restoreTaskContext(dir, task);
      expect(restored.decisionsStatus).toBe('reported_unverified');
      expect(restored.decisionEvidence).toMatchObject([
        { decision: 'Use local storage.', sourcePath: 'first.md', rationale: { text: 'Keep data offline.', line: 2, excerpt: 'Rationale: Keep data offline.' } },
        { decision: 'Fence task leases.', sourcePath: 'second.md', rationale: { text: 'Reject stale writes.', line: 2, excerpt: 'Rationale: Reject stale writes.' } }
      ]);
      fs.writeFileSync(first, 'Decision: Use local storage.\nRationale: Keep data online.\n');
      const changed = restoreTaskContext(dir, task);
      expect(changed.decisionEvidence.map(item => item.sourcePath)).toEqual(['second.md']);
      expect(changed.sources).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'first.md', status: 'modified' })]));
      expect(restoreTaskContext(dir, { ...task, blockers: ['conflicting decisions'] }).decisionEvidence).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('does not associate a missing, separated or blank rationale with a decision', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-task-no-rationale-'));
    try {
      fs.writeFileSync(path.join(dir, 'decision.md'), 'Decision: Use local storage.\n\nRationale: A separate statement.\nDecision: Fence task leases.\nRationale: \nDecision: Keep data local.\nRationale: <!-- hidden text -->\n');
      const task = new TaskLedger(dir).create({ goal: 'test', acceptanceCriteria: ['done'], sourceRefs: ['decision.md'], decisions: ['Use local storage.', 'Fence task leases.', 'Keep data local.'] });
      const restored = restoreTaskContext(dir, task);
      expect(restored.decisionEvidence).toHaveLength(3);
      expect(restored.decisionEvidence.every(item => !item.rationale)).toBe(true);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('restores exact decision statements only from fresh captured markdown', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-task-decision-evidence-'));
    try {
      const source = path.join(dir, 'decision.md');
      const statement = 'Use a durable task ledger.';
      fs.writeFileSync(source, `# Architecture\nDecision: ${statement}\n`);
      const ledger = new TaskLedger(dir);
      const task = ledger.create({ goal: 'test', acceptanceCriteria: ['done'], sourceRefs: ['decision.md'], decisions: [statement, 'Unrelated assumption.'] });
      const restored = restoreTaskContext(dir, task);
      expect(restored.decisionEvidence).toEqual([{ decision: statement, sourcePath: 'decision.md', sha256: task.sourceRefs[0].sha256, line: 2, excerpt: `Decision: ${statement}` }]);
      expect(restored.decisionsStatus).toBe('reported_unverified');
      expect(restored.capsule).toContain('reported/unverified');
      expect(restoreTaskContext(dir, { ...task, blockers: ['Conflicting architecture records'] }).decisionEvidence).toEqual([]);
      expect(restoreTaskContext(dir, { ...task, evidenceRefs: [{ ...task.sourceRefs[0], sha256: '0'.repeat(64) }] }).decisionEvidence).toEqual([]);
      fs.writeFileSync(source, `# Architecture\nDecision: ${statement.replace('durable', 'mutable')}\n`);
      const stale = restoreTaskContext(dir, task);
      expect(stale.decisionEvidence).toEqual([]);
      expect(stale.sources[0].status).toBe('modified');
      expect(stale.decisionsStatus).toBe('historical_unverified');
      fs.unlinkSync(source);
      expect(restoreTaskContext(dir, task).decisionEvidence).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('does not treat markdown examples, comments or indented code as recorded decisions', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-task-decision-markdown-'));
    try {
      fs.writeFileSync(path.join(dir, 'decision.md'), '<!--\nDecision: Commented.\n-->\n```md\nDecision: Example.\n```\n    Decision: Code.\nDecision: Actual.\n');
      const task = new TaskLedger(dir).create({ goal: 'test', acceptanceCriteria: ['done'], sourceRefs: ['decision.md'], decisions: ['Commented.', 'Example.', 'Code.', 'Actual.'] });
      expect(restoreTaskContext(dir, task).decisionEvidence).toMatchObject([{ decision: 'Actual.', line: 8 }]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('does not restore a decision changed after its excerpt was read', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-task-decision-race-'));
    try {
      const filename = path.join(dir, 'decision.md');
      const original = 'Decision: Use stable leases.\nRationale: Avoid stale writes.\n';
      fs.writeFileSync(filename, original);
      const task = new TaskLedger(dir).create({ goal: 'test', acceptanceCriteria: ['done'], sourceRefs: ['decision.md'], decisions: ['Use stable leases.'] });
      const read = fs.readFileSync;
      let reads = 0;
      vi.spyOn(fsDefault, 'readFileSync').mockImplementation(((file: fs.PathOrFileDescriptor, options?: unknown) => {
        const result = read(file, options as never);
        if (String(file) === filename && ++reads === 2) fs.writeFileSync(filename, original.replace('stale', 'rogue'));
        return result;
      }) as typeof fs.readFileSync);
      syncBuiltinESMExports();
      const restored = restoreTaskContext(dir, task);
      expect(reads).toBeGreaterThanOrEqual(3);
      expect(restored.decisionEvidence).toEqual([]);
      expect(restored.sources[0].status).toBe('modified');
      expect(restored.warnings).toEqual(expect.arrayContaining([expect.stringContaining('decision.md: modified')]));
    } finally { vi.restoreAllMocks(); syncBuiltinESMExports(); fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('restores unclaimed, active and expired lease snapshots without changing the capsule', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-task-lease-context-'));
    try {
      const ledger = new TaskLedger(dir);
      const task = ledger.create({ goal: 'test', acceptanceCriteria: ['done'] });
      const unclaimed = restoreTaskContext(dir, task);
      expect(unclaimed.lease).toMatchObject({ status: 'unclaimed', generation: 0 });
      expect(unclaimed.lease).not.toHaveProperty('recordedOwner');
      const claimed = ledger.claim({ taskId: task.id, agentId: 'agent', leaseMinutes: 10 });
      const active = restoreTaskContext(dir, claimed);
      expect(active.lease).toMatchObject({ status: 'active', generation: claimed.leaseGeneration, recordedOwner: 'agent', expiresAt: claimed.leaseExpiresAt });
      const expired = restoreTaskContext(dir, { ...claimed, leaseExpiresAt: '2000-01-01T00:00:00.000Z' });
      expect(expired.lease.status).toBe('expired');
      expect(expired.warnings).toEqual(expect.arrayContaining([expect.stringContaining('reacquire') ]));
      expect(expired.capsule).toBe(active.capsule);
      expect(expired.estimatedTokens).toBeLessThanOrEqual(600);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('fences an expired lease even when an old agent knows the latest revision', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-task-'));
    try {
      let time = Date.now();
      const ledger = new TaskLedger(dir, { now: () => new Date(time) });
      const task = ledger.create({ goal: 'test', acceptanceCriteria: ['done'] });
      const first = ledger.claim({ taskId: task.id, agentId: 'same', leaseMinutes: 1 });
      time += 60_001;
      const second = ledger.claim({ taskId: task.id, agentId: 'same' });
      expect(second.leaseGeneration).toBe(first.leaseGeneration + 1);
      expect(() => ledger.checkpoint({ taskId: task.id, agentId: 'same', expectedRevision: second.revision, leaseGeneration: first.leaseGeneration })).toThrowError(/generation/i);
      const saved = ledger.checkpoint({ taskId: task.id, agentId: 'same', expectedRevision: second.revision, leaseGeneration: second.leaseGeneration, summary: 'saved' });
      expect(new TaskLedger(dir).get(task.id).summary).toBe('saved');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('preserves corrupt files and rejects path traversal', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-task-'));
    try {
      const ledger = new TaskLedger(dir);
      expect(() => ledger.create({ goal: 'test', acceptanceCriteria: ['done'], sourceRefs: ['../outside'] })).toThrow();
      fs.mkdirSync(path.join(dir, '.hypersabmemory'), { recursive: true });
      const file = path.join(dir, '.hypersabmemory', 'tasks.json');
      fs.writeFileSync(file, '{broken');
      expect(() => ledger.create({ goal: 'test', acceptanceCriteria: ['done'] })).toThrow(/preserved/);
      expect(fs.readFileSync(file, 'utf8')).toBe('{broken');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('rejects evidence through a symlink outside the workspace', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-task-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-outside-'));
    try {
      fs.symlinkSync(outside, path.join(dir, 'link'), 'junction');
      const ledger = new TaskLedger(dir);
      const task = ledger.create({ goal: 'test', acceptanceCriteria: ['done'] });
      const claim = ledger.claim({ taskId: task.id, agentId: 'a' });
      expect(() => ledger.checkpoint({ taskId: task.id, agentId: 'a', expectedRevision: claim.revision, leaseGeneration: claim.leaseGeneration, evidencePaths: ['link/file'] })).toThrow(/symbolic link/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); }
  });

  it('bounds and orders the active resource', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-task-'));
    try {
      const ledger = new TaskLedger(dir);
      for (let i = 0; i < 51; i++) ledger.create({ goal: `task ${i}`, acceptanceCriteria: ['done'] });
      const result = listActiveTasks(ledger);
      expect(result.total).toBe(51);
      expect(result.truncated).toBe(true);
      expect(result.tasks).toHaveLength(50);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('rejects wrong owners and stale revisions, and renews and releases a lease', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-task-'));
    try {
      const ledger = new TaskLedger(dir);
      const task = ledger.create({ goal: 'test', acceptanceCriteria: ['done'] });
      const a = ledger.claim({ taskId: task.id, agentId: 'a' });
      expect(() => ledger.checkpoint({ taskId: task.id, agentId: 'b', expectedRevision: a.revision, leaseGeneration: a.leaseGeneration })).toThrow(/owner/i);
      const b = ledger.claim({ taskId: task.id, agentId: 'a', action: 'renew', leaseGeneration: a.leaseGeneration });
      expect(b.revision).toBe(a.revision + 1);
      expect(() => ledger.checkpoint({ taskId: task.id, agentId: 'a', expectedRevision: a.revision, leaseGeneration: a.leaseGeneration })).toThrow(/revision/i);
      expect(ledger.claim({ taskId: task.id, agentId: 'a', action: 'release', leaseGeneration: b.leaseGeneration }).state).toBe('ready');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('detects same-size source changes and missing files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-task-'));
    try {
      const source = path.join(dir, 'PRD.md');
      fs.writeFileSync(source, 'first');
      const ledger = new TaskLedger(dir);
      const task = ledger.create({ goal: 'test', acceptanceCriteria: ['done'], sourceRefs: ['PRD.md'] });
      fs.writeFileSync(source, 'other');
      expect(restoreTaskContext(dir, task).sources[0].status).toBe('modified');
      fs.unlinkSync(source);
      expect(restoreTaskContext(dir, task).sources[0].status).toBe('missing');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('reports persistence failure without changing the durable ledger', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-task-'));
    try {
      const ledger = new TaskLedger(dir);
      const task = ledger.create({ goal: 'test', acceptanceCriteria: ['done'] });
      const filename = path.join(dir, '.hypersabmemory', 'tasks.json');
      const original = fs.readFileSync(filename, 'utf8');
      fs.mkdirSync(`${filename}.tmp`);
      expect(() => ledger.claim({ taskId: task.id, agentId: 'a' })).toThrow(/persist|EISDIR|permission/i);
      expect(fs.readFileSync(filename, 'utf8')).toBe(original);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('reports an uncertain commit when coordination fails after JSON replacement', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-task-'));
    const probe = new Database(':memory:');
    const prototype = Object.getPrototypeOf(probe);
    const original = prototype.transaction;
    try {
      const ledger = new TaskLedger(dir);
      const task = ledger.create({ goal: 'test', acceptanceCriteria: ['done'] });
      const spy = vi.spyOn(prototype, 'transaction').mockImplementation(function (this: Database.Database, fn: () => unknown) {
        return original.call(this, () => {
          fn();
          throw new Error('injected failure after JSON replacement');
        });
      });
      try {
        ledger.claim({ taskId: task.id, agentId: 'a' });
        expect.fail('expected uncertain commit');
      } catch (error) {
        expect(error).toMatchObject({ code: 'TASK_COMMIT_UNCERTAIN', message: expect.stringMatching(/ledger was replaced.*commit failed/i) });
      }
      spy.mockRestore();
      expect(new TaskLedger(dir).get(task.id).owner).toBe('a');
    } finally { vi.restoreAllMocks(); probe.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('fails closed on nested or abandoned task locks', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-task-'));
    const lock = path.join(dir, 'tasks.json.lock');
    try {
      acquireFileLock(lock, 30, false);
      expect(() => acquireFileLock(lock, 30, false)).toThrow(/acquire lock/i);
      releaseFileLock(lock);
      fs.writeFileSync(lock, JSON.stringify({ pid: 2147483647, acquiredAt: 0 }));
      expect(() => acquireFileLock(lock, 30, false)).toThrow(/acquire lock/i);
      expect(fs.existsSync(lock)).toBe(true);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('requires evidence and checks before reporting completion', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-task-'));
    try {
      fs.writeFileSync(path.join(dir, 'proof.txt'), 'proof');
      const ledger = new TaskLedger(dir);
      const task = ledger.create({ goal: 'test', acceptanceCriteria: ['done'] });
      const claim = ledger.claim({ taskId: task.id, agentId: 'a' });
      const input = { taskId: task.id, agentId: 'a', expectedRevision: claim.revision, leaseGeneration: claim.leaseGeneration, state: 'reported_complete' as const };
      expect(() => ledger.checkpoint(input)).toThrow(/evidence/i);
      const complete = ledger.checkpoint({ ...input, evidencePaths: ['proof.txt'], checks: ['passed'] });
      expect(complete.owner).toBeUndefined();
      expect(complete.state).toBe('reported_complete');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('fails explicitly when the same process nests a separate SQLite writer transaction', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-task-'));
    const ledger = new TaskLedger(dir);
    ledger.create({ goal: 'outer', acceptanceCriteria: ['keep'] });
    const db = new Database(path.join(dir, '.hypersabmemory', 'tasks-coordinator.sqlite'));
    try {
      const outer = db.transaction(() => {
        expect(() => ledger.create({ goal: 'nested', acceptanceCriteria: ['no deadlock'] })).toThrow(/coordination failed/i);
      });
      outer.immediate();
      expect(ledger.list()).toHaveLength(1);
    } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  }, 10_000);
});
