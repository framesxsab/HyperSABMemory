import { it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { TaskLedger } from '../src/memory/taskLedger.js';
import { executeTaskTool } from '../src/mcp/taskTools.js';

it('finds recorded decision evidence without requiring a descriptive filename', () => {
  const found: boolean[] = [];
  for (const fixture of [
    { name: 'notes.md', decision: 'Keep invoice storage local.', query: 'What decision was recorded about invoice storage?' },
    { name: 'log.md', decision: 'Keep queue delivery ordered.', query: 'What decision was recorded about queue delivery?' }
  ]) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-practical-'));
    try {
      fs.writeFileSync(path.join(dir, fixture.name), `Decision: ${fixture.decision}\nRationale: Preserve local guarantees.\n`);
      fs.writeFileSync(path.join(dir, 'other.md'), 'Decision: Use unrelated settings.\n');
      const ledger = new TaskLedger(dir);
      const task = ledger.create({ goal: 'Continue component work', acceptanceCriteria: ['Review constraints'], sourceRefs: [fixture.name, 'other.md'] });
      const query = () => executeTaskTool(dir, ledger, 'hypersabmemory_task_grounded_query', { taskId: task.id, query: fixture.query })!.structuredContent as any;
      const result = query();
      const decisionRole = result.requirements.find((item: any) => item.role === 'decision');
      expect(decisionRole?.status).toBe('unresolved');
      expect(result.canAssert).toBe(false);
      found.push(decisionRole?.verifiedFacts.some((fact: any) => fact.sourcePath === fixture.name && fact.excerpt === `Decision: ${fixture.decision}` && fact.line === 1 && fact.sha256 === task.sourceRefs[0].sha256) ?? false);
      expect(decisionRole.verifiedFacts.some((fact: any) => fact.sourcePath === 'other.md')).toBe(false);
      fs.writeFileSync(path.join(dir, fixture.name), `Decision: ${fixture.decision.replace('local', 'LOCAL').replace('ordered', 'ORDERED')}\nRationale: Preserve local guarantees.\n`);
      const stale = query();
      expect(stale.requirements.flatMap((item: any) => item.verifiedFacts).some((fact: any) => fact.sourcePath === fixture.name)).toBe(false);
      expect(stale.staleSources).toEqual(expect.arrayContaining([expect.objectContaining({ path: fixture.name, status: 'modified' })]));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
  expect(found).toEqual([true, true]);
});
