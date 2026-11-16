import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'fs';
import { removeTestDirs } from './testUtils.js';
import * as os from 'os';
import * as path from 'path';
import { TemporalMemoryEngine } from '../src/memory/temporalMemory.js';
import {
  MEMORYBENCH_FIXTURE,
  RECALL_THRESHOLD,
  runMemoryBenchReport,
  type MemoryBenchReport
} from '../src/eval/memoryBench.js';
import { computeTokenEfficiency } from '../src/eval/tokenEfficiency.js';
import { runEvalCommand } from '../src/cli/evalCommand.js';

const dirs: string[] = [];

function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-benchreport-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  vi.restoreAllMocks();
  removeTestDirs(dirs);
});

describe('HyperSABMemory — benchmark report + token efficiency', () => {
  it('reports achieved numbers for all three retrieval paths on the deterministic fixture', () => {
    const report = runMemoryBenchReport();

    expect(report.paths.map((p) => p.name)).toEqual(['direct-engine', 'keyword-bm25', 'fused-memory-graph']);
    for (const row of report.paths) {
      expect(row.recall).toBe(1);
      expect(row.forgottenLeaks).toBe(0);
      expect(row.contextBlockLeaks).toBe(0);
      expect(row.passed).toBe(true);
    }
    expect(report.allPassed).toBe(true);
    expect(report.threshold).toBe(RECALL_THRESHOLD);
    expect(report.fixtureSize).toBe(MEMORYBENCH_FIXTURE.length);
    expect(Number.isNaN(Date.parse(report.generatedAt))).toBe(false);
  });

  it('computes token efficiency deterministically, including the empty-store edge', () => {
    const dir = tmpDir();
    const engine = new TemporalMemoryEngine(dir);
    engine.remember('architecture', 'Alpha fact about hashline anchors.', ['alpha']);
    engine.remember('decision', 'Beta decision about context blocks.', ['beta']);
    engine.remember('bug', 'Gamma bug fact about atomic saves.', ['gamma']);

    const eff = computeTokenEfficiency(engine);
    expect(eff.naiveCorpusTokens).toBeGreaterThan(0);
    expect(eff.deliveredTokens).toBeGreaterThan(0);
    expect(eff.savingsPct).toBeGreaterThanOrEqual(0);
    expect(eff.savingsPct).toBeLessThanOrEqual(100);
    expect(Math.abs(eff.compressionRatio - eff.deliveredTokens / eff.naiveCorpusTokens)).toBeLessThanOrEqual(0.001);

    const emptyEff = computeTokenEfficiency(new TemporalMemoryEngine(tmpDir()));
    expect(emptyEff.naiveCorpusTokens).toBe(0);
    expect(emptyEff.savingsPct).toBe(0);
    expect(emptyEff.compressionRatio).toBe(1);
  });

  it('survives a JSON.stringify round-trip with every field preserved', () => {
    const report = runMemoryBenchReport();
    const round: MemoryBenchReport = JSON.parse(JSON.stringify(report)) as MemoryBenchReport;
    expect(round).toEqual(report);
  });

  it('prints the eval table with percent and savings through the command runner', () => {
    const cwd = process.cwd();
    process.chdir(tmpDir());
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });
    const prevExitCode = process.exitCode;
    try {
      runEvalCommand();
      const out = logs.join('\n');
      expect(out).toContain('%');
      expect(out).toContain('saved');
      expect(out).toContain('[PASS]');
      expect(process.exitCode).toBe(0);
    } finally {
      process.exitCode = prevExitCode;
      process.chdir(cwd);
    }
  });

  it('emits machine-readable { bench, efficiency } JSON via --json', () => {
    const cwd = process.cwd();
    process.chdir(tmpDir());
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });
    const prevExitCode = process.exitCode;
    try {
      runEvalCommand({ json: true });
      const parsed = JSON.parse(logs.join('\n')) as {
        bench: MemoryBenchReport;
        efficiency: { deliveredTokens: number; naiveCorpusTokens: number; savingsPct: number; compressionRatio: number };
      };
      expect(parsed.bench.paths).toHaveLength(3);
      expect(parsed.bench.allPassed).toBe(true);
      expect(typeof parsed.efficiency.compressionRatio).toBe('number');
      expect(process.exitCode).toBe(0);
    } finally {
      process.exitCode = prevExitCode;
      process.chdir(cwd);
    }
  });
});
