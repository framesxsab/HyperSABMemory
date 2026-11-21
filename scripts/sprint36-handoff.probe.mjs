import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildHandoffBrief } from '../dist/cli/handoffCommand.js';
import { TokenCompressor } from '../dist/harness/tokenCompressor.js';
import { SqliteStore } from '../dist/memory/sqliteStore.js';
import { TaskLedger } from '../dist/memory/taskLedger.js';
import { TemporalMemoryEngine } from '../dist/memory/temporalMemory.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hm36-handoff-probe-'));
try {
  execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'probe@example.invalid'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Sprint 3.6 Probe'], { cwd: root, stdio: 'ignore' });
  fs.writeFileSync(path.join(root, 'proof.txt'), 'verified\n');
  execFileSync('git', ['add', 'proof.txt'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'checkpoint: auto snapshot (probe)'], { cwd: root, stdio: 'ignore' });

  const memory = new TemporalMemoryEngine(root);
  memory.remember('decision', 'Keep forward handoff briefs focused on durable decisions', [], {
    nextSteps: 'Audit handoff token budget'
  });
  memory.remember('bug', 'Prevent file watcher floods from hiding active bugs');
  memory.remember('architecture', 'File add: src/legacy-event.ts');

  const store = new SqliteStore(path.join(root, '.hypersabmemory'));
  for (let i = 0; i < 8; i++) {
    store.set({
      id: `auto_probe_${i}`,
      category: 'architecture',
      content: `File change: src/module-${i}.ts`,
      artifacts: [`src/module-${i}.ts`],
      source: 'auto',
      timestamp: new Date(Date.now() + (i + 1) * 1000).toISOString()
    });
  }

  const ledger = new TaskLedger(root);
  const completed = ledger.create({
    goal: 'Finished work',
    acceptanceCriteria: ['Done'],
    nextAction: 'Completed task step must not appear in open next steps'
  });
  const completedClaim = ledger.claim({ taskId: completed.id, agentId: 'worker' });
  ledger.checkpoint({
    taskId: completed.id,
    agentId: 'worker',
    expectedRevision: completedClaim.revision,
    leaseGeneration: completedClaim.leaseGeneration,
    state: 'reported_complete',
    evidencePaths: ['proof.txt'],
    checks: ['passed']
  });

  ledger.create({
    goal: 'Continue handoff prioritization',
    acceptanceCriteria: ['Prioritize durable facts and active task actions'],
    nextAction: 'Include active TaskLedger next actions in forward handoff brief'
  });

  const brief = await buildHandoffBrief(root);
  const topSection = brief.split('## Top active facts')[1]?.split('## Open next steps')[0] ?? '';
  const decisionPos = topSection.indexOf('Keep forward handoff briefs focused on durable decisions');
  const bugPos = topSection.indexOf('Prevent file watcher floods from hiding active bugs');
  const firstAutoPos = topSection.search(/File (change|add|unlink):/);
  assert.ok(
    decisionPos >= 0 &&
      bugPos >= 0 &&
      (firstAutoPos === -1 || (decisionPos < firstAutoPos && bugPos < firstAutoPos)),
    'durable decisions and bugs must rank ahead of automatic file-event observations in buildHandoffBrief'
  );

  const stepsSection = brief.split('## Open next steps')[1]?.split('## Recent checkpoints')[0] ?? '';
  assert.ok(
    stepsSection.includes('Include active TaskLedger next actions in forward handoff brief'),
    'open next steps must include active TaskLedger nextAction entries'
  );
  assert.ok(
    stepsSection.includes('Audit handoff token budget'),
    'open next steps must retain active memory nextSteps'
  );
  assert.equal(
    stepsSection.includes('Completed task step must not appear in open next steps'),
    false,
    'reported_complete tasks must not appear in open next steps'
  );
  assert.ok(TokenCompressor.estimateTokens(brief) <= 600, 'forward brief must stay within 600 estimated tokens');

  const storyA = await buildHandoffBrief(root, { story: true });
  const storyB = await buildHandoffBrief(root, { story: true });
  assert.equal(storyA, storyB, 'story mode must remain deterministic');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
