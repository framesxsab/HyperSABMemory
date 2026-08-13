import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SupermemoryEngine } from '../src/memory/supermemory.js';
import {
  MEMORYBENCH_FIXTURE,
  RECALL_THRESHOLD,
  evaluateMemoryEngine,
  seedMemoryBench
} from '../src/eval/memoryBench.js';

describe('HyperMemory — MemoryBench local eval (OSS)', () => {
  it('meets recall ≥ 0.8 on active facts and leaks zero forgotten facts', () => {
    expect(MEMORYBENCH_FIXTURE.length).toBeGreaterThanOrEqual(10);
    expect(MEMORYBENCH_FIXTURE.some((c) => c.status === 'forgotten')).toBe(true);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-bench-'));
    const engine = new SupermemoryEngine(dir);
    seedMemoryBench(engine);
    const report = evaluateMemoryEngine(engine);

    expect(report.activeCases).toBeGreaterThanOrEqual(10);
    expect(report.recall).toBeGreaterThanOrEqual(RECALL_THRESHOLD);
    expect(report.forgottenLeaks).toBe(0);
    expect(report.contextBlockLeaks).toBe(0);
    expect(report.passed).toBe(true);

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
