import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TaskLedger } from '../dist/memory/taskLedger.js';
import { executeTaskTool } from '../dist/mcp/taskTools.js';
import { TemporalMemoryEngine } from '../dist/memory/temporalMemory.js';
import { HybridSearchEngine } from '../dist/memory/hybridSearch.js';
import { searchGrounded } from '../dist/memory/groundedSearch.js';
import { captureTaskSources } from '../dist/harness/taskSources.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hm35-links-'));
try {
  fs.mkdirSync(path.join(root, 'design'), { recursive: true });
  fs.mkdirSync(path.join(root, 'rules'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });

  const decisionFile = 'design/storage.md';
  const ruleFile = 'rules/task-rules.md';
  const guideFile = 'docs/guide.md';

  const decisionText = [
    '\uFEFF# Storage Design',
    '<!--',
    'Decision: Store tasks in memory only.',
    '-->',
    'Decision: Use SQLite for task coordination.',
    'Rationale: Preserve atomic task transitions.'
  ].join('\n') + '\n';

  const ruleText = [
    '\uFEFF# Task Rules',
    '',
    '~~~md',
    'Decision-Source: design/other.md',
    'Constraint: Example constraint inside fence.',
    '~~~',
    '',
    'Decision-Source: design/storage.md',
    'Constraint: Task updates must use a transactional coordinator.'
  ].join('\n') + '\n';

  const guideText = [
    '# Documentation Guide',
    '',
    '```md',
    'Decision: Store tasks in a flat text file.',
    'Rationale: Example rationale.',
    '```'
  ].join('\n') + '\n';

  fs.writeFileSync(path.join(root, decisionFile), decisionText);
  fs.writeFileSync(path.join(root, ruleFile), ruleText);
  fs.writeFileSync(path.join(root, guideFile), guideText);

  const ledger = new TaskLedger(root);
  const task = ledger.create({
    goal: 'Keep storage coordination consistent',
    acceptanceCriteria: ['Restore formatted linked constraints'],
    sourceRefs: [decisionFile, ruleFile, guideFile],
    decisions: ['Use SQLite for task coordination.'],
    nextAction: 'Check storage rules'
  });

  const restored = executeTaskTool(root, ledger, 'hypersabmemory_task_context', { taskId: task.id })?.structuredContent;
  assert.equal(
    restored?.answerBundle?.linkedConstraints?.length,
    1,
    'task_context must discover prose linked constraints in formatted Markdown with BOM, headings, and fenced examples'
  );
  assert.equal(restored.answerBundle.linkedConstraints[0].decision, 'Use SQLite for task coordination.');
  assert.equal(restored.answerBundle.linkedConstraints[0].constraint, 'Task updates must use a transactional coordinator.');
  assert.deepEqual(
    restored.answerBundle.linkedConstraints[0].sources.map(item => [item.path, item.line]),
    [[decisionFile, 5], [ruleFile, 8], [ruleFile, 9]]
  );

  const memory = new TemporalMemoryEngine(root);
  memory.remember('decision', 'SQLite storage coordination decision and rationale', [], { artifacts: [decisionFile] });
  memory.remember('architecture', 'Transactional coordinator storage constraint rules', [], { artifacts: [ruleFile] });
  memory.remember('decision', 'What storage decision was recorded and which constraint follows in guide examples', [], { artifacts: [guideFile] });

  const refs = captureTaskSources(root, [decisionFile, ruleFile, guideFile]);
  const grounded = searchGrounded(
    new HybridSearchEngine(root, memory),
    root,
    'What storage decision was recorded, why, and which constraint follows?',
    refs
  );
  assert.equal(
    grounded.status,
    'SUPPORTED',
    'fenced or commented Decision and Constraint examples must not trigger false recorded-claim conflicts'
  );
  assert.equal(grounded.canAssert, true);
  assert.equal(grounded.claims?.length, 3);
  assert.ok(grounded.compoundAnswer?.text.includes('transactional coordinator'));

  // Negative control 1: genuine second prose Constraint line must trigger conflict abstention.
  fs.writeFileSync(path.join(root, ruleFile), ruleText + 'Constraint: Allow uncoordinated updates.\n');
  const conflictTask = ledger.create({
    goal: 'Check prose conflict',
    acceptanceCriteria: ['Abstain on conflict'],
    sourceRefs: [decisionFile, ruleFile],
    decisions: ['Use SQLite for task coordination.']
  });
  const conflictContext = executeTaskTool(root, ledger, 'hypersabmemory_task_context', { taskId: conflictTask.id })?.structuredContent;
  assert.deepEqual(conflictContext.answerBundle.linkedConstraints, []);
  const conflictGrounded = searchGrounded(
    new HybridSearchEngine(root, memory),
    root,
    'What storage decision was recorded, why, and which constraint follows?',
    captureTaskSources(root, [decisionFile, ruleFile, guideFile])
  );
  assert.equal(conflictGrounded.status, 'CONFLICTING_EVIDENCE');
  assert.equal(conflictGrounded.canAssert, false);

  // Negative control 2: second real prose Decision file must trigger conflict abstention.
  fs.writeFileSync(path.join(root, ruleFile), ruleText);
  const altDecisionFile = 'design/other.md';
  fs.writeFileSync(path.join(root, altDecisionFile), 'Decision: Use a queue for storage coordination.\n');
  memory.remember('decision', 'SQLite storage coordination decision and rationale', [], { artifacts: [decisionFile, altDecisionFile] });
  const twoDecisions = searchGrounded(
    new HybridSearchEngine(root, memory),
    root,
    'What storage decision was recorded, why, and which constraint follows?',
    captureTaskSources(root, [decisionFile, ruleFile, altDecisionFile])
  );
  assert.equal(twoDecisions.status, 'CONFLICTING_EVIDENCE');
  assert.equal(twoDecisions.canAssert, false);

  // Negative control 3: stale rewrite after capture must drop task_context linkedConstraints.
  fs.writeFileSync(path.join(root, ruleFile), ruleText.replace('coordinator', 'coordinatoR'));
  const staleContext = executeTaskTool(root, ledger, 'hypersabmemory_task_context', { taskId: task.id })?.structuredContent;
  assert.deepEqual(staleContext.answerBundle.linkedConstraints, []);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
