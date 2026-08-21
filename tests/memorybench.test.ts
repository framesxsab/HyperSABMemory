import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SupermemoryEngine } from '../src/memory/supermemory.js';
import { HybridSearchEngine } from '../src/memory/hybridSearch.js';
import { OhMyPiHarness, HarnessState } from '../src/harness/ohMyPi.js';
import { TokenCompressor } from '../src/harness/tokenCompressor.js';
import {
  MEMORYBENCH_FIXTURE,
  RECALL_THRESHOLD,
  evaluateMemoryEngine,
  evaluateSearchRecordsPath,
  evaluateFusionPath,
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

  it('gates the shipped BM25 searchRecords path with the same fixture and threshold', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-bench-sr-'));
    const engine = new SupermemoryEngine(dir);
    seedMemoryBench(engine);
    const hybrid = new HybridSearchEngine(dir, engine);

    const report = evaluateSearchRecordsPath(hybrid, engine.getContextBlock());
    expect(report.recall).toBeGreaterThanOrEqual(RECALL_THRESHOLD);
    expect(report.forgottenLeaks).toBe(0);
    expect(report.contextBlockLeaks).toBe(0);
    expect(report.passed).toBe(true);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('gates the fused supermemory+graphify search path deterministically', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-bench-fuse-'));
    const engine = new SupermemoryEngine(dir);
    seedMemoryBench(engine);
    const hybrid = new HybridSearchEngine(dir, engine);

    const report = evaluateFusionPath(hybrid);
    expect(report.recall).toBeGreaterThanOrEqual(RECALL_THRESHOLD);
    expect(report.forgottenLeaks).toBe(0);
    expect(report.passed).toBe(true);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('holds the hard 1500-token header ceiling across empty, typical and worst-case states', () => {
    const harness = new OhMyPiHarness(1500);

    const empty: HarnessState = { workspaceName: 'hypermemory', modifiedFiles: [] };

    const typical: HarnessState = {
      workspaceName: 'hypermemory',
      activeFile: 'src/mcp/server.ts',
      cursorLine: 42,
      gitBranch: 'main',
      lastCommitHash: 'ab12cd34',
      lastCommitTime: '2026-08-21',
      modifiedFiles: ['src/mcp/server.ts', 'src/hooks/autoCommit.ts'],
      recentDiff: ' src/mcp/server.ts | 12 ++++++++\n 1 file changed',
      memorySummary: 'Harness decisions and bug facts.',
      contextBlock: '[CONTEXT BLOCK]\nSummary: HyperMemory local-first harness\nFacts:\n- 2026-08-21 [decision] Ship P10 eval gates',
      graphifySummary: 'Graphify: 128 structural nodes mapped | Graph active'
    };

    const worst: HarnessState = {
      workspaceName: 'hypermemory-worst-case-workspace',
      activeFile: 'src/deeply/nested/path/worst-case-file.ts',
      cursorLine: 9999,
      gitBranch: 'feature/very-long-branch-name',
      lastCommitHash: 'ffff0000',
      lastCommitTime: '2026-08-21',
      modifiedFiles: Array.from({ length: 50 }, (_, i) => `src/module${i}/file${i}.ts`),
      recentDiff: 'd'.repeat(10000),
      memorySummary: 'm'.repeat(2000),
      contextBlock: 'c'.repeat(4000),
      graphifySummary: 'g'.repeat(2000),
      activeFileContent: Array.from({ length: 200 }, (_, i) => `line ${i} ${'x'.repeat(40)}`).join('\n')
    };

    for (const state of [empty, typical, worst]) {
      const header = harness.generateHeader(state);
      expect(TokenCompressor.estimateTokens(header)).toBeLessThanOrEqual(1500);
    }
  });
});
