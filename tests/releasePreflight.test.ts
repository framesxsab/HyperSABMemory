import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatPreflightSummary,
  inspectEvaluatorOutput,
  runReleasePreflight
} from '../scripts/release-preflight.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function makeReport(overrides: Record<string, unknown> = {}) {
  return {
    methodology: { staleSourceTested: true },
    staleProbe: { attempted: 20, candidates: 20, flagged: 20, leaks: 0 },
    retrieval: {
      maximumPrecisionAt5: 0.66,
      precisionAt5: 0.55,
      recallAt5: 0.9,
      meanReciprocalRank: 0.9,
      forgottenLeaks: 0
    },
    grounded: {
      precisionAt5: 0.52,
      recallAt5: 0.88,
      meanReciprocalRank: 0.86,
      noAnswerFalsePositives: 0,
      supportedAnswerCoverage: 0.5,
      unsupportedAssertions: 0
    },
    latencyMs: { samples: 150, p50: 19.5, p95: 33.2 },
    passed: true,
    ...overrides
  };
}

function withTempEvaluator(scriptBody: string, run: (scriptPath: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-release-preflight-'));
  const scriptPath = path.join(dir, 'evaluator.mjs');
  try {
    fs.writeFileSync(scriptPath, scriptBody, 'utf8');
    run(scriptPath);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('fail-closed release preflight guard', () => {
  it('passes only when evaluator exits 0 and reports passed: true with all frozen metrics satisfied', () => {
    withTempEvaluator(
      `process.stdout.write(${JSON.stringify(JSON.stringify(makeReport()))});`,
      (scriptPath) => {
        const result = runReleasePreflight({ evaluatorScript: scriptPath, checkBuildArtifact: false });
        expect(result.eligible).toBe(true);
        expect(result.verdict).toBe('RELEASE ELIGIBLE — PREFLIGHT PASSED');
        expect(result.exitCode).toBe(0);
        expect(result.failureReasons).toEqual([]);
        expect(result.failingCriteria).toEqual([]);
      }
    );
  });

  it('blocks when evaluator exits nonzero and reports passed: false, identifying exact failing metrics', () => {
    const failing = makeReport({
      passed: false,
      retrieval: {
        maximumPrecisionAt5: 0.66,
        precisionAt5: 0.47,
        recallAt5: 0.7208,
        meanReciprocalRank: 0.875,
        forgottenLeaks: 0
      },
      grounded: {
        precisionAt5: 0.42,
        recallAt5: 0.6417,
        meanReciprocalRank: 0.8292,
        noAnswerFalsePositives: 0,
        supportedAnswerCoverage: 0,
        unsupportedAssertions: 0
      }
    });
    withTempEvaluator(
      `process.stdout.write(${JSON.stringify(JSON.stringify(failing))}); process.exitCode = 1;`,
      (scriptPath) => {
        const result = runReleasePreflight({ evaluatorScript: scriptPath, checkBuildArtifact: false });
        expect(result.eligible).toBe(false);
        expect(result.verdict).toBe('RELEASE BLOCKED — NO-GO');
        expect(result.exitCode).toBe(1);
        expect(result.failureReasons.map((r: { code: string }) => r.code)).toEqual(
          expect.arrayContaining(['EVALUATOR_NONZERO_EXIT', 'RELEASE_GATES_FAILED'])
        );
        expect(result.failingCriteria.map((c: { id: string }) => c.id)).toEqual([
          'retrieval.precisionAt5',
          'retrieval.recallAt5',
          'grounded.recallAt5',
          'grounded.precisionAt5',
          'grounded.supportedAnswerCoverage'
        ]);
        const summary = formatPreflightSummary(result);
        expect(summary).toContain('RELEASE BLOCKED — NO-GO');
        expect(summary).toContain('retrieval.precisionAt5');
        expect(summary).toContain('grounded.supportedAnswerCoverage');
      }
    );
  });

  it('blocks when evaluator exits nonzero even if stdout claims passed: true', () => {
    withTempEvaluator(
      `process.stdout.write(${JSON.stringify(JSON.stringify(makeReport({ passed: true })))}); process.exit(2);`,
      (scriptPath) => {
        const result = runReleasePreflight({ evaluatorScript: scriptPath, checkBuildArtifact: false });
        expect(result.eligible).toBe(false);
        expect(result.verdict).toBe('RELEASE BLOCKED — NO-GO');
        expect(result.exitCode).toBe(2);
        expect(result.failureReasons.map((r: { code: string }) => r.code)).toContain('EVALUATOR_NONZERO_EXIT');
      }
    );
  });

  it('blocks when evaluator exits 0 but reports passed: false', () => {
    const failing = makeReport({
      passed: false,
      latencyMs: { samples: 150, p50: 55, p95: 145 }
    });
    withTempEvaluator(
      `process.stdout.write(${JSON.stringify(JSON.stringify(failing))}); process.exit(0);`,
      (scriptPath) => {
        const result = runReleasePreflight({ evaluatorScript: scriptPath, checkBuildArtifact: false });
        expect(result.eligible).toBe(false);
        expect(result.exitCode).toBe(0);
        expect(result.failureReasons.map((r: { code: string }) => r.code)).toEqual(['RELEASE_GATES_FAILED']);
        expect(result.failingCriteria.map((c: { id: string }) => c.id)).toEqual(['latencyMs.p95']);
      }
    );
  });

  it('blocks when evaluator exits 0 and claims passed: true despite an unmet metric', () => {
    const inconsistent = makeReport({
      passed: true,
      retrieval: {
        maximumPrecisionAt5: 0.66,
        precisionAt5: 0.55,
        recallAt5: 0.9,
        meanReciprocalRank: 0.9,
        forgottenLeaks: 1
      }
    });
    withTempEvaluator(
      `process.stdout.write(${JSON.stringify(JSON.stringify(inconsistent))});`,
      (scriptPath) => {
        const result = runReleasePreflight({ evaluatorScript: scriptPath, checkBuildArtifact: false });
        expect(result.eligible).toBe(false);
        expect(result.failureReasons.map((r: { code: string }) => r.code)).toContain('EVALUATOR_CONTRACT_MISMATCH');
        expect(result.failingCriteria.map((c: { id: string }) => c.id)).toEqual(['retrieval.forgottenLeaks']);
      }
    );
  });

  it('blocks when evaluator returns malformed JSON output', () => {
    withTempEvaluator(`process.stdout.write('{not valid json');`, (scriptPath) => {
      const result = runReleasePreflight({ evaluatorScript: scriptPath, checkBuildArtifact: false });
      expect(result.eligible).toBe(false);
      expect(result.failureReasons.map((r: { code: string }) => r.code)).toContain('EVALUATOR_MALFORMED_OUTPUT');
    });
  });

  it('blocks when evaluator produces no output', () => {
    withTempEvaluator(`process.exit(0);`, (scriptPath) => {
      const result = runReleasePreflight({ evaluatorScript: scriptPath, checkBuildArtifact: false });
      expect(result.eligible).toBe(false);
      expect(result.failureReasons.map((r: { code: string }) => r.code)).toContain('EVALUATOR_EMPTY_OUTPUT');
    });
  });

  it('blocks when evaluator times out', () => {
    withTempEvaluator(`setTimeout(() => {}, 10_000);`, (scriptPath) => {
      const result = runReleasePreflight({
        evaluatorScript: scriptPath,
        checkBuildArtifact: false,
        timeoutMs: 150
      });
      expect(result.eligible).toBe(false);
      expect(result.failureReasons.map((r: { code: string }) => r.code)).toContain('EVALUATOR_TIMEOUT');
    });
  });

  it('blocks when evaluator terminates unexpectedly by signal or uncaught crash', () => {
    const signalResult = inspectEvaluatorOutput({
      status: null,
      signal: 'SIGKILL',
      stdout: '',
      stderr: ''
    });
    expect(signalResult.eligible).toBe(false);
    expect(signalResult.failureReasons.map((r: { code: string }) => r.code)).toContain('EVALUATOR_SIGNAL');

    withTempEvaluator(`throw new Error('simulated crash');`, (scriptPath) => {
      const result = runReleasePreflight({ evaluatorScript: scriptPath, checkBuildArtifact: false });
      expect(result.eligible).toBe(false);
      expect(result.failureReasons.map((r: { code: string }) => r.code)).toContain('EVALUATOR_EMPTY_OUTPUT');
      expect(result.stderrPreview).toContain('simulated crash');
    });
  });

  it('enforces release preflight in package.json prepublishOnly', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(manifest.scripts['release:preflight']).toBe('node scripts/release-preflight.mjs');
    expect(manifest.scripts.prepublishOnly).toContain('npm run release:preflight');
    expect(manifest.scripts.prepublishOnly).not.toContain('option-b');
  });

  it('wires fail-closed release preflight across Linux, Windows, and macOS in GitHub Actions workflows', () => {
    const releaseWorkflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'release.yml'), 'utf8');
    expect(releaseWorkflow).toContain('npm run release:preflight');
    expect(releaseWorkflow).toContain('ubuntu-latest');
    expect(releaseWorkflow).toContain('windows-latest');
    expect(releaseWorkflow).toContain('macos-latest');
    expect(releaseWorkflow).not.toContain('continue-on-error: true');

    const ciWorkflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
    expect(ciWorkflow).toContain('release-readiness:');
    expect(ciWorkflow).toContain('npm run release:preflight');
    expect(ciWorkflow).not.toContain('continue-on-error: true');
  });
});
