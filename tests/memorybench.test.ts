import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TemporalMemoryEngine } from '../src/memory/temporalMemory.js';
import { HybridSearchEngine } from '../src/memory/hybridSearch.js';
import { ContextHarness, HarnessState } from '../src/harness/contextHarness.js';
import { TokenCompressor } from '../src/harness/tokenCompressor.js';
import {
  MEMORYBENCH_FIXTURE,
  RECALL_THRESHOLD,
  evaluateMemoryEngine,
  evaluateSearchRecordsPath,
  evaluateFusionPath,
  seedMemoryBench,
  ADVERSARIAL_CLASSES,
  scoreAdversarialClass,
  seedAdversarialClasses,
  runMemoryBenchReport
} from '../src/eval/memoryBench.js';
import type { MemoryRecord } from '../src/memory/sqliteStore.js';

describe('HyperSABMemory — MemoryBench local eval (OSS)', () => {
  it('meets recall ≥ 0.8 on active facts and leaks zero forgotten facts', () => {
    expect(MEMORYBENCH_FIXTURE.length).toBeGreaterThanOrEqual(10);
    expect(MEMORYBENCH_FIXTURE.some((c) => c.status === 'forgotten')).toBe(true);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-bench-'));
    const engine = new TemporalMemoryEngine(dir);
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
    const engine = new TemporalMemoryEngine(dir);
    seedMemoryBench(engine);
    const hybrid = new HybridSearchEngine(dir, engine);

    const report = evaluateSearchRecordsPath(hybrid, engine.getContextBlock());
    expect(report.recall).toBeGreaterThanOrEqual(RECALL_THRESHOLD);
    expect(report.forgottenLeaks).toBe(0);
    expect(report.contextBlockLeaks).toBe(0);
    expect(report.passed).toBe(true);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('gates the fused memory+graph search path deterministically', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-bench-fuse-'));
    const engine = new TemporalMemoryEngine(dir);
    seedMemoryBench(engine);
    const hybrid = new HybridSearchEngine(dir, engine);

    const report = evaluateFusionPath(hybrid);
    expect(report.recall).toBeGreaterThanOrEqual(RECALL_THRESHOLD);
    expect(report.forgottenLeaks).toBe(0);
    expect(report.passed).toBe(true);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('holds the hard 1500-token header ceiling across empty, typical and worst-case states', () => {
    const harness = new ContextHarness(1500);

    const empty: HarnessState = { workspaceName: 'hypersabmemory', modifiedFiles: [] };

    const typical: HarnessState = {
      workspaceName: 'hypersabmemory',
      activeFile: 'src/mcp/server.ts',
      cursorLine: 42,
      gitBranch: 'main',
      lastCommitHash: 'ab12cd34',
      lastCommitTime: '2026-08-21',
      modifiedFiles: ['src/mcp/server.ts', 'src/hooks/autoCommit.ts'],
      recentDiff: ' src/mcp/server.ts | 12 ++++++++\n 1 file changed',
      memorySummary: 'Harness decisions and bug facts.',
      contextBlock: '[CONTEXT BLOCK]\nSummary: HyperSABMemory local-first harness\nFacts:\n- 2026-08-21 [decision] Ship P10 eval gates',
      structuralGraphSummary: 'Structural knowledge graph: 128 nodes mapped | Graph active'
    };

    const worst: HarnessState = {
      workspaceName: 'hypersabmemory-worst-case-workspace',
      activeFile: 'src/deeply/nested/path/worst-case-file.ts',
      cursorLine: 9999,
      gitBranch: 'feature/very-long-branch-name',
      lastCommitHash: 'ffff0000',
      lastCommitTime: '2026-08-21',
      modifiedFiles: Array.from({ length: 50 }, (_, i) => `src/module${i}/file${i}.ts`),
      recentDiff: 'd'.repeat(10000),
      memorySummary: 'm'.repeat(2000),
      contextBlock: 'c'.repeat(4000),
      structuralGraphSummary: 'g'.repeat(2000),
      activeFileContent: Array.from({ length: 200 }, (_, i) => `line ${i} ${'x'.repeat(40)}`).join('\n')
    };

    for (const state of [empty, typical, worst]) {
      const header = harness.generateHeader(state);
      expect(TokenCompressor.estimateTokens(header)).toBeLessThanOrEqual(1500);
    }
  });
});

describe('HyperSABMemory — F4 adversarial eval classes', () => {
  function seedAll(dir: string): { engine: TemporalMemoryEngine; hybrid: HybridSearchEngine } {
    const engine = new TemporalMemoryEngine(dir);
    seedMemoryBench(engine);
    seedAdversarialClasses(engine);
    const hybrid = new HybridSearchEngine(dir, engine);
    return { engine, hybrid };
  }

  function fusionQueryFn(hybrid: HybridSearchEngine): (q: string) => MemoryRecord[] {
    return (q) => hybrid.search(q).filter((h) => h.source === 'memory').map((h) => ({ content: h.snippet }));
  }

  it('negation class: migration facts recalled on all three paths with zero stale pure-X leaks', () => {
    expect(ADVERSARIAL_CLASSES.negation.length).toBeGreaterThanOrEqual(2);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-bench-neg-'));
    const { engine, hybrid } = seedAll(dir);
    try {
      const scores = [
        scoreAdversarialClass('negation', (q) => engine.query(q), engine.getContextBlock()),
        scoreAdversarialClass('negation', (q) => hybrid.searchRecords(q), engine.getContextBlock()),
        scoreAdversarialClass('negation', fusionQueryFn(hybrid), '')
      ];
      for (const score of scores) {
        expect(score.recall).toBeGreaterThanOrEqual(RECALL_THRESHOLD);
        expect(score.staleLeaks).toBe(0);
        expect(score.contextBlockLeaks).toBe(0);
        expect(score.passed).toBe(true);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('superseded-stale class: chain tip C is top hit on all three paths with zero A/B stale leaks', () => {
    expect(ADVERSARIAL_CLASSES['superseded-stale'].length).toBeGreaterThanOrEqual(2);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-bench-sup-'));
    const { engine, hybrid } = seedAll(dir);
    try {
      const scores = [
        scoreAdversarialClass('superseded-stale', (q) => engine.query(q), engine.getContextBlock()),
        scoreAdversarialClass('superseded-stale', (q) => hybrid.searchRecords(q), engine.getContextBlock()),
        scoreAdversarialClass('superseded-stale', fusionQueryFn(hybrid), '')
      ];
      for (const score of scores) {
        expect(score.recall).toBeGreaterThanOrEqual(RECALL_THRESHOLD);
        expect(score.staleLeaks).toBe(0);
        expect(score.contextBlockLeaks).toBe(0);
        expect(score.passed).toBe(true);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('artifact-linked class: file-path queries recall linked facts on all three paths', () => {
    expect(ADVERSARIAL_CLASSES['artifact-linked'].length).toBeGreaterThanOrEqual(3);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-bench-art-'));
    const { engine, hybrid } = seedAll(dir);
    try {
      const scores = [
        scoreAdversarialClass('artifact-linked', (q) => engine.query(q), engine.getContextBlock()),
        scoreAdversarialClass('artifact-linked', (q) => hybrid.searchRecords(q), engine.getContextBlock()),
        scoreAdversarialClass('artifact-linked', fusionQueryFn(hybrid), '')
      ];
      for (const score of scores) {
        expect(score.recall).toBeGreaterThanOrEqual(RECALL_THRESHOLD);
        expect(score.passed).toBe(true);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('report adds per-class breakdown across all three paths while keeping legacy fields intact', () => {
    const report = runMemoryBenchReport();

    expect(report.paths).toHaveLength(3);
    expect(report.threshold).toBe(RECALL_THRESHOLD);
    expect(report.allPassed).toBe(true);

    expect(report.classes).toHaveLength(3);
    expect(report.classes?.map((c) => c.name)).toEqual(['negation', 'superseded-stale', 'artifact-linked']);
    for (const cls of report.classes ?? []) {
      expect(cls.paths.map((p) => p.name)).toEqual(['direct-engine', 'keyword-bm25', 'fused-memory-graph']);
      for (const path of cls.paths) {
        expect(path.recall).toBeGreaterThanOrEqual(RECALL_THRESHOLD);
        expect(path.staleLeaks).toBe(0);
        expect(path.passed).toBe(true);
      }
      expect(cls.passed).toBe(true);
    }
  });
});
