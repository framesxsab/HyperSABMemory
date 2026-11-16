import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TaskLedger } from '../dist/memory/taskLedger.js';
import { executeTaskTool } from '../dist/mcp/taskTools.js';

const fixtures = [
  { decisionFile: 'storage-choice.md', constraintFile: 'storage-rule.md', decision: 'Keep invoices local.', rationale: 'Avoid hosted processing.', constraint: 'Invoice data stays on device.', taskConstraint: 'Avoid hosted services', next: 'Review invoice tests' },
  { decisionFile: 'queue-choice.md', constraintFile: 'queue-rule.md', decision: 'Use ordered delivery.', rationale: 'Retain message order.', constraint: 'Messages remain ordered.', taskConstraint: 'Preserve queue order', next: 'Inspect queue tests' }
];
const results = [];
for (const fixture of fixtures) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'hm28-answer-eval-'));
  const write = (name, content) => writeFileSync(path.join(dir, name), content);
  write(fixture.decisionFile, `Decision: ${fixture.decision}\nRationale: ${fixture.rationale}\n`);
  const rule = `Decision-Source: ${fixture.decisionFile}\nConstraint: ${fixture.constraint}\n`;
  write(fixture.constraintFile, rule);
  write('unrelated.md', 'Constraint: This text has no decision reference.\n');
  const ledger = new TaskLedger(dir);
  const task = ledger.create({ goal: 'Continue project work', acceptanceCriteria: ['Review the component'], constraints: [fixture.taskConstraint], sourceRefs: [fixture.decisionFile, fixture.constraintFile, 'unrelated.md'], decisions: [fixture.decision], nextAction: fixture.next });
  const ask = (name, args) => executeTaskTool(dir, ledger, name, args).structuredContent;
  const context = ask('hypersabmemory_task_context', { taskId: task.id });
  const decision = context.decisionEvidence.find(item => item.decision === fixture.decision);
  const link = context.answerBundle?.linkedConstraints?.[0];
  const recorded = context.answerBundle?.recordedTask;
  const checks = {
    decision: decision?.sourcePath === fixture.decisionFile && decision.line === 1 && decision.sha256 === task.sourceRefs[0].sha256,
    rationale: decision?.rationale?.text === fixture.rationale && decision.rationale.line === 2,
    linkedConstraint: link?.decision === fixture.decision && link.constraint === fixture.constraint && link.taskDecisionMatch === 'exact_text_unverified' && link.sources.length === 3 && link.sources[0].path === fixture.decisionFile && link.sources[1].path === fixture.constraintFile && link.sources[2].line === 2 && link.sources[2].sha256 === task.sourceRefs[1].sha256,
    continuation: recorded?.nextAction === fixture.next && recorded.constraints.includes(fixture.taskConstraint) && recorded.attribution === 'agent_reported' && recorded.provenance.taskId === task.id,
    unrelatedExcluded: context.answerBundle ? context.answerBundle.linkedConstraints.length === 1 && !JSON.stringify(context.answerBundle.linkedConstraints).includes('unrelated.md') : null
  };
  const unknown = ask('hypersabmemory_task_grounded_query', { taskId: task.id, query: 'What is the encryption key?' });
  const abstained = unknown.canAssert === false && unknown.assertions.length === 0;
  write(fixture.constraintFile, rule.replace('Constraint:', 'ConstrainT:'));
  const stale = ask('hypersabmemory_task_context', { taskId: task.id });
  const staleExcluded = stale.answerBundle ? stale.answerBundle.linkedConstraints.length === 0 && stale.sources.some(item => item.path === fixture.constraintFile && item.status === 'modified') : null;
  const incorrectAssertions = Number(!abstained) + Number(Boolean(link) && !checks.linkedConstraint);
  const unsupportedRelationships = context.answerBundle ? Number(!checks.unrelatedExcluded) : null;
  const missingProvenance = Number(Boolean(decision) && (!decision.sourcePath || !decision.sha256 || !decision.line)) + Number(Boolean(link) && (!Array.isArray(link.sources) || link.sources.some(source => !source.path || !source.sha256 || !source.line)));
  const freshnessFailures = stale.answerBundle ? Number(!staleExcluded) : null;
  results.push({ taskId: task.id, decisionFile: fixture.decisionFile, constraintFile: fixture.constraintFile, checks, abstained, staleExcluded, incorrectAssertions, unsupportedRelationships, missingProvenance, freshnessFailures });
}
const supported = results.flatMap(item => [item.checks.decision, item.checks.rationale, item.checks.linkedConstraint, item.checks.continuation]).filter(Boolean).length;
const output = { synthetic: true, independentlyHumanReviewed: false, supported, answerable: 8, correctAbstentions: results.filter(item => item.abstained).length, unknownCases: results.length, incorrectAssertions: results.reduce((sum, item) => sum + item.incorrectAssertions, 0), unsupportedRelationships: results.some(item => item.unsupportedRelationships === null) ? null : results.reduce((sum, item) => sum + item.unsupportedRelationships, 0), missingProvenance: results.reduce((sum, item) => sum + item.missingProvenance, 0), freshnessFailures: results.some(item => item.freshnessFailures === null) ? null : results.reduce((sum, item) => sum + item.freshnessFailures, 0), unrelatedExcluded: results.filter(item => item.checks.unrelatedExcluded === true).length, staleExcluded: results.filter(item => item.staleExcluded === true).length, results };
console.log(JSON.stringify(output));
if (process.argv.includes('--expect-pass')) {
  assert.equal(output.supported, output.answerable);
  assert.equal(output.correctAbstentions, output.unknownCases);
  assert.equal(output.unrelatedExcluded, results.length);
  assert.equal(output.staleExcluded, results.length);
  assert.equal(output.incorrectAssertions, 0);
  assert.equal(output.unsupportedRelationships, 0);
  assert.equal(output.missingProvenance, 0);
  assert.equal(output.freshnessFailures, 0);
}
