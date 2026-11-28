import { it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import fsDefault from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';
import { TaskLedger } from '../src/memory/taskLedger.js';
import { executeTaskTool } from '../src/mcp/taskTools.js';
import { matchesTargetFile } from './testUtils.js';

it('rechecks decision evidence when its source changes during construction', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-evidence-race-'));
  try {
    const file = path.join(dir, 'misc.md');
    const original = 'Decision: Keep invoice storage local.\n';
    fs.writeFileSync(file, original);
    const ledger = new TaskLedger(dir);
    const task = ledger.create({ goal: 'Review storage', acceptanceCriteria: ['Review decision'], sourceRefs: ['misc.md'] });
    const read = fs.readFileSync;
    let reads = 0;
    vi.spyOn(fsDefault, 'readFileSync').mockImplementation(((name: fs.PathOrFileDescriptor, options?: unknown) => {
      const value = read(name, options as never);
      if (matchesTargetFile(name, file) && ++reads === 4) fs.writeFileSync(file, original.replace('local', 'LOCAL'));
      return value;
    }) as typeof fs.readFileSync);
    syncBuiltinESMExports();
    const payload = executeTaskTool(dir, ledger, 'hypersabmemory_task_grounded_query', { taskId: task.id, query: 'What decision was recorded about invoice storage?' })!.structuredContent as any;
    expect(reads).toBeGreaterThanOrEqual(5);
    expect(payload.requirements.flatMap((item: any) => item.verifiedFacts)).toEqual([]);
    expect(payload.staleSources).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'misc.md', status: 'modified' })]));
    expect(payload.canAssert).toBe(false);
  } finally { vi.restoreAllMocks(); syncBuiltinESMExports(); fs.rmSync(dir, { recursive: true, force: true }); }
}, 15_000);

it('does not verify ambiguous or unsupported quotation syntax as decision evidence', () => {
  for (const content of ['Decision: Keep invoice storage local.\nDecision: Keep invoice storage local.\n', 'Decision: Keep invoice storage \`local\`.\n']) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-evidence-ambiguous-'));
    try {
      fs.writeFileSync(path.join(dir, 'memo.md'), content);
      const ledger = new TaskLedger(dir);
      const task = ledger.create({ goal: 'Review storage', acceptanceCriteria: ['Review decision'], sourceRefs: ['memo.md'] });
      const payload = executeTaskTool(dir, ledger, 'hypersabmemory_task_grounded_query', { taskId: task.id, query: 'What decision was recorded about invoice storage?' })!.structuredContent as any;
      expect(payload.requirements.flatMap((item: any) => item.verifiedFacts)).toEqual([]);
      expect(payload.canAssert).toBe(false);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
}, 15_000);
