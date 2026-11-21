import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TaskLedger } from '../dist/memory/taskLedger.js';
import { restoreTaskContext } from '../dist/harness/taskContext.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hm34-prose-'));
const decision = 'Use an append-only shipment log.';
const restore = text => {
  fs.writeFileSync(path.join(root, 'notes.md'), text);
  const task = new TaskLedger(root).create({
    goal: 'Keep shipment history', sourceRefs: ['notes.md'],
    decisions: [decision], acceptanceCriteria: ['Restore cited decisions']
  });
  return restoreTaskContext(root, task).decisionEvidence;
};
const prose = 'Decision: ' + decision + '\nRationale: Audit every shipment change.\n';
assert.equal(restore(prose).length, 1);
assert.equal(restore('<!--\n' + prose + '-->\n').length, 0);
assert.equal(restore('~~~md\n<!--\n' + prose + '~~~\n').length, 0);
for (const fence of ['~~~md', '\x60\x60\x60md']) {
  const result = restore('<!--\n' + fence + '\nexample begins here\n-->\n' + prose);
  assert.equal(result.length, 1, 'a commented fence must not suppress the recorded decision');
  assert.equal(result[0].line, 5);
  assert.equal(result[0].rationale?.line, 6);
}
