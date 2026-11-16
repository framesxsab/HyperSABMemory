import { it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { TaskLedger } from '../src/memory/taskLedger.js';
import { executeTaskTool } from '../src/mcp/taskTools.js';

it('does not promote fenced or commented examples into recorded decisions', () => {
  const fixtures = [
    '\`\`\`text\nDecision: Keep invoice queues local.\n\`\`\`\n',
    '<!--\nDecision: Keep invoice queues local.\n-->\n'
  ];
  for (const content of fixtures) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-markdown-decision-'));
    try {
      fs.writeFileSync(path.join(dir, 'memo.md'), content);
      const ledger = new TaskLedger(dir);
      const task = ledger.create({ goal: 'Review queues', acceptanceCriteria: ['Inspect decision'], sourceRefs: ['memo.md'] });
      const result = executeTaskTool(dir, ledger, 'hypersabmemory_task_grounded_query', { taskId: task.id, query: 'What decision was recorded about invoice queues?' })!.structuredContent as any;
      expect(result.canAssert).toBe(false);
      expect(result.requirements.find((item: any) => item.role === 'decision')?.verifiedFacts).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});


it('retains a genuine decision after fenced and commented examples', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-markdown-prose-'));
  try {
    const content = ['# Invoice queues', '\`\`\`text', 'Decision: Send invoice queues remote.', '\`\`\`', '<!--', 'Decision: Publish invoice queues externally.', '-->', 'Decision: Keep invoice queues local.'].join('\n') + '\n';
    fs.writeFileSync(path.join(dir, 'memo.md'), content);
    const ledger = new TaskLedger(dir);
    const task = ledger.create({ goal: 'Review queues', acceptanceCriteria: ['Inspect decision'], sourceRefs: ['memo.md'] });
    const result = executeTaskTool(dir, ledger, 'hypersabmemory_task_grounded_query', { taskId: task.id, query: 'What decision was recorded about invoice queues?' })!.structuredContent as any;
    const role = result.requirements.find((item: any) => item.role === 'decision');
    expect(result.canAssert).toBe(false);
    expect(role.verifiedFacts).toEqual([expect.objectContaining({ excerpt: 'Decision: Keep invoice queues local.', sourcePath: 'memo.md', line: 8, sha256: task.sourceRefs[0].sha256 })]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
