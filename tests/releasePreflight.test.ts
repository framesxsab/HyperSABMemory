import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  computeProtectedSubtreeHash,
  computeSrcFileHashes,
  computeSrcTreeHash,
  formatPreflightSummary,
  inspectEvaluatorOutput,
  runPreviewAcceptancePreflight,
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

  it('separates development CI checks from mandatory cross-platform release gates in GitHub Actions', () => {
    const releaseWorkflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'release.yml'), 'utf8');
    expect(releaseWorkflow).toContain('workflow_dispatch:');
    expect(releaseWorkflow).toContain('npm run release:preflight');
    expect(releaseWorkflow).toContain('ubuntu-latest');
    expect(releaseWorkflow).toContain('windows-latest');
    expect(releaseWorkflow).toContain('macos-latest');
    expect(releaseWorkflow).toContain('needs: gates');
    expect(releaseWorkflow).toContain("if: github.event_name == 'push' && github.ref_type == 'tag'");
    expect(releaseWorkflow).toContain('id-token: write');
    expect(releaseWorkflow).toContain('test "$RELEASE_TAG" = preview');
    expect(releaseWorkflow).toContain('npm publish "$RELEASE_TARBALL" --tag "$RELEASE_TAG"');
    expect(releaseWorkflow).toContain('needs: publish');
    expect(releaseWorkflow).not.toContain('secrets.');
    expect(releaseWorkflow).not.toContain('continue-on-error: true');

    const ciWorkflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
    expect(ciWorkflow).toContain('pull_request:');
    expect(ciWorkflow).toContain('npm test');
    expect(ciWorkflow).toContain('npm run package:smoke');
    expect(ciWorkflow).not.toContain('release-readiness:');
    expect(ciWorkflow).not.toContain('run: npm run release:preflight');
    expect(ciWorkflow).not.toContain('continue-on-error: true');
  });
});

describe('Option B Profile 1 preview acceptance gate', () => {
  function withPreviewWorkspace(
    opts: {
      packageVersion?: string;
      writeLedger?: (srcInfo: { fileCount: number; sha256: string }) => unknown;
      rawLedgerText?: string;
    },
    run: (ws: string) => void
  ): void {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-preview-preflight-'));
    try {
      const version = opts.packageVersion ?? '1.5.0-preview.1';
      fs.writeFileSync(path.join(ws, 'package.json'), JSON.stringify({ name: 'hypersabmemory', version }), 'utf8');
      fs.mkdirSync(path.join(ws, 'src'), { recursive: true });
      fs.writeFileSync(path.join(ws, 'src', 'index.ts'), 'export const ok = true;\n', 'utf8');
      const srcInfo = computeSrcTreeHash(ws);

      const ledgerPath = path.join(ws, 'docs', 'acceptance', `v${version}-acceptance.json`);
      if (opts.rawLedgerText !== undefined) {
        fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
        fs.writeFileSync(ledgerPath, opts.rawLedgerText, 'utf8');
      } else if (opts.writeLedger) {
        const payload = opts.writeLedger(srcInfo);
        if (payload !== null && payload !== undefined) {
          fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
          fs.writeFileSync(ledgerPath, JSON.stringify(payload, null, 2), 'utf8');
        }
      }
      run(ws);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  }

  function makePassingPreviewLedger(srcInfo: { fileCount: number; sha256: string }, overrides: Record<string, unknown> = {}) {
    return {
      schemaVersion: 1,
      profile: 'Option B Profile 1 (Developer Preview)',
      targetVersion: '1.5.0-preview.1',
      candidateCommit: 'fc0d3c6fe4476c9c62363b1926e0e7122ddb0aae',
      ciRunUrl: 'https://github.com/framesxsab/HyperSABMemory/actions/runs/45784340050',
      ciJobsPassed: 9,
      ciJobsTotal: 9,
      srcFileCount: srcInfo.fileCount,
      srcTreeSha256: srcInfo.sha256,
      retrieval: {
        queriesTotal: 45,
        rawMacroRecallAt5: 0.85,
        groundedMacroRecallAt5: 0.8,
        rawNormalizedPrecisionAt5: 0.7917,
        groundedNormalizedPrecisionAt5: 0.75,
        groundedMrrAt5: 0.9,
        groundedTop1Precision: 0.8667,
        unanswerableStrictEmitRate: 0.4
      },
      safety: {
        unsupportedAssertionsTotal: 0,
        forgottenCanaryLeaks: 0,
        populatedMemoryMdLeaks: 0,
        emptyAfterLastForgetEdgePassed: true,
        sameSizeStaleLeaks: 0,
        sameSizeStaleRate: 1,
        midVerificationMutationPassed: 3,
        midVerificationMutationTotal: 3,
        workspaceContainmentViolations: 0,
        junctionEscapeBlocked: true,
        falseStaticTestLinks: 0,
        positiveDeterministicRate: 0.9333,
        unsupportedDeterministicRate: 1,
        conflictingEvidenceRate: 1,
        setupCleanDiffVerified: true
      },
      performance: {
        warmMcpP95Ms: 34.13,
        coldTsP95MsExcludingStartup: 220.44,
        compactHandoffP95Ms: 21.54,
        compactByteReductionMinObserved: 0.5993,
        compactCompletenessVerified: true
      },
      continuation: {
        passedTasks: 3,
        totalTasks: 3,
        allPassed: true
      },
      ...overrides
    };
  }

  it('enforces the committed preview ledger against the current source tree', () => {
    const repoLedgerPath = path.join(repoRoot, 'docs', 'acceptance', 'v1.5.0-preview.1-acceptance.json');
    const repoLedger = JSON.parse(fs.readFileSync(repoLedgerPath, 'utf8')) as { srcTreeSha256: string; srcFileCount: number };
    const liveSrc = computeSrcTreeHash(repoRoot);
    const unchanged = repoLedger.srcTreeSha256 === liveSrc.sha256 && repoLedger.srcFileCount === liveSrc.fileCount;
    const result = runPreviewAcceptancePreflight({ cwd: repoRoot, version: '1.5.0-preview.1', checkBuildArtifact: false });
    expect(result.eligible).toBe(unchanged);
    expect(result.exitCode).toBe(unchanged ? 0 : 1);
    expect(result.failureReasons.map(reason => reason.code)).toEqual(unchanged ? [] : ['SRC_TREE_HASH_MISMATCH']);
  });

  it('tolerates documentation-only changes when src/ hash remains identical', () => {
    withPreviewWorkspace(
      { writeLedger: (srcInfo) => makePassingPreviewLedger(srcInfo) },
      (ws) => {
        fs.writeFileSync(path.join(ws, 'README.md'), '# Updated Docs Only\n', 'utf8');
        fs.writeFileSync(path.join(ws, 'CHANGELOG.md'), '## 1.5.0-preview.1\n', 'utf8');
        const res = runReleasePreflight({ cwd: ws, checkBuildArtifact: false });
        expect(res.eligible).toBe(true);
        expect(res.exitCode).toBe(0);
      }
    );
  });

  it('blocks NO-GO on missing or malformed acceptance ledger, src/ tree mismatch, unmet metrics, safety leak, or latency regression', () => {
    withPreviewWorkspace({}, (ws) => {
      const res = runReleasePreflight({ cwd: ws, checkBuildArtifact: false });
      expect(res.eligible).toBe(false);
      expect(res.failureReasons.map((r: { code: string }) => r.code)).toContain('PREVIEW_ACCEPTANCE_LEDGER_MISSING');
    });

    withPreviewWorkspace({ rawLedgerText: '{broken-json' }, (ws) => {
      const res = runReleasePreflight({ cwd: ws, checkBuildArtifact: false });
      expect(res.eligible).toBe(false);
      expect(res.failureReasons.map((r: { code: string }) => r.code)).toContain('PREVIEW_ACCEPTANCE_LEDGER_MALFORMED');
    });

    withPreviewWorkspace(
      { writeLedger: (srcInfo) => makePassingPreviewLedger(srcInfo) },
      (ws) => {
        fs.writeFileSync(path.join(ws, 'src', 'index.ts'), 'export const modified = true;\n', 'utf8');
        const res = runReleasePreflight({ cwd: ws, checkBuildArtifact: false });
        expect(res.eligible).toBe(false);
        expect(res.failureReasons.map((r: { code: string }) => r.code)).toContain('SRC_TREE_HASH_MISMATCH');
      }
    );

    withPreviewWorkspace(
      {
        writeLedger: (srcInfo) => makePassingPreviewLedger(srcInfo, {
          continuation: { passedTasks: 2, totalTasks: 3, allPassed: false },
          safety: { ...makePassingPreviewLedger(srcInfo).safety, forgottenCanaryLeaks: 1 },
          performance: { ...makePassingPreviewLedger(srcInfo).performance, compactHandoffP95Ms: 88 }
        })
      },
      (ws) => {
        const res = runReleasePreflight({ cwd: ws, checkBuildArtifact: false });
        expect(res.eligible).toBe(false);
        const failIds = res.failingCriteria.map((c: { id: string }) => c.id);
        expect(failIds).toContain('preview.continuation.passedTasks');
        expect(failIds).toContain('preview.safety.forgottenCanaryLeaks');
        expect(failIds).toContain('preview.performance.compactHandoffP95Ms');
      }
    );
  });

  it('normalizes LF/CRLF and leading UTF-8 BOM identically in computeSrcTreeHash across platforms', () => {
    const dirLf = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-hash-lf-'));
    const dirCrlf = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-hash-crlf-'));
    try {
      fs.mkdirSync(path.join(dirLf, 'src'), { recursive: true });
      fs.mkdirSync(path.join(dirCrlf, 'src'), { recursive: true });
      fs.writeFileSync(path.join(dirLf, 'src', 'a.ts'), 'export const a = 1;\nexport const b = 2;\n', 'utf8');
      fs.writeFileSync(path.join(dirCrlf, 'src', 'a.ts'), '\uFEFFexport const a = 1;\r\nexport const b = 2;\r\n', 'utf8');
      expect(computeSrcTreeHash(dirCrlf)).toEqual(computeSrcTreeHash(dirLf));
    } finally {
      fs.rmSync(dirLf, { recursive: true, force: true });
      fs.rmSync(dirCrlf, { recursive: true, force: true });
    }
  });

  it('keeps stable X.Y.Z releases fail-closed NO-GO even if a preview ledger exists', () => {
    withPreviewWorkspace(
      {
        packageVersion: '1.5.0',
        writeLedger: (srcInfo) => ({
          ...makePassingPreviewLedger(srcInfo),
          targetVersion: '1.5.0'
        })
      },
      (ws) => {
        const res = runReleasePreflight({ cwd: ws, checkBuildArtifact: false });
        expect(res.eligible).toBe(false);
        expect(res.failureReasons.map((r: { code: string }) => r.code)).toContain('EVALUATOR_MISSING');
      }
    );
  });
});

describe('Path B scoped delta preview acceptance gate', () => {
  function initScopedWorkspace(mutateAfterBaseline?: (ws: string) => void) {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-scoped-delta-'));
    const git = (...args: string[]) =>
      execFileSync('git', args, { cwd: ws, encoding: 'utf8', stdio: 'pipe' }).trim();

    git('init', '-b', 'main');
    git('config', 'user.name', 'Test Bot');
    git('config', 'user.email', 'test@example.invalid');

    fs.mkdirSync(path.join(ws, 'src', 'cli'), { recursive: true });
    fs.mkdirSync(path.join(ws, 'src', 'memory'), { recursive: true });
    fs.mkdirSync(path.join(ws, 'docs', 'acceptance'), { recursive: true });

    fs.writeFileSync(path.join(ws, 'src', 'cli', 'index.ts'), 'export const cli = 1;\n', 'utf8');
    fs.writeFileSync(path.join(ws, 'src', 'memory', 'core.ts'), 'export const core = 1;\n', 'utf8');
    fs.writeFileSync(path.join(ws, 'package.json'), JSON.stringify({ name: 'hypersabmemory', version: '1.5.0-preview.1' }), 'utf8');
    git('add', '.');
    git('commit', '-m', 'baseline');
    const baselineCommit = git('rev-parse', 'HEAD');
    const baseSrc = computeSrcFileHashes(ws);

    const baselineLedger = {
      schemaVersion: 1,
      profile: 'Option B Profile 1 (Developer Preview)',
      targetVersion: '1.5.0-preview.1',
      candidateCommit: baselineCommit,
      ciJobsPassed: 9,
      ciJobsTotal: 9,
      srcFileCount: baseSrc.fileCount,
      srcTreeSha256: baseSrc.sha256,
      retrieval: {
        queriesTotal: 45,
        rawMacroRecallAt5: 0.85,
        groundedMacroRecallAt5: 0.8,
        rawNormalizedPrecisionAt5: 0.7917,
        groundedNormalizedPrecisionAt5: 0.75,
        groundedMrrAt5: 0.9,
        groundedTop1Precision: 0.8667,
        unanswerableStrictEmitRate: 0.4
      },
      safety: {
        unsupportedAssertionsTotal: 0,
        forgottenCanaryLeaks: 0,
        populatedMemoryMdLeaks: 0,
        emptyAfterLastForgetEdgePassed: true,
        sameSizeStaleLeaks: 0,
        sameSizeStaleRate: 1,
        midVerificationMutationPassed: 3,
        midVerificationMutationTotal: 3,
        workspaceContainmentViolations: 0,
        junctionEscapeBlocked: true,
        falseStaticTestLinks: 0,
        positiveDeterministicRate: 0.9333,
        unsupportedDeterministicRate: 1,
        conflictingEvidenceRate: 1,
        setupCleanDiffVerified: true
      },
      performance: {
        warmMcpP95Ms: 34.13,
        coldTsP95MsExcludingStartup: 220.44,
        compactHandoffP95Ms: 21.54,
        compactByteReductionMinObserved: 0.5993,
        compactCompletenessVerified: true
      },
      continuation: { passedTasks: 3, totalTasks: 3, allPassed: true }
    };
    const baselineLedgerRel = 'docs/acceptance/v1.5.0-preview.1-acceptance.json';
    const baselineLedgerText = JSON.stringify(baselineLedger, null, 2);
    fs.writeFileSync(path.join(ws, baselineLedgerRel), baselineLedgerText, 'utf8');
    const baselineLedgerSha = createHash('sha256').update(Buffer.from(baselineLedgerText, 'utf8')).digest('hex');

    fs.writeFileSync(path.join(ws, 'src', 'cli', 'index.ts'), 'export const cli = 2;\n', 'utf8');
    if (mutateAfterBaseline) mutateAfterBaseline(ws);

    fs.writeFileSync(path.join(ws, 'package.json'), JSON.stringify({ name: 'hypersabmemory', version: '1.5.0-preview.2' }), 'utf8');
    git('add', '.');
    git('commit', '-m', 'preview2');
    const candidateCommit = git('rev-parse', 'HEAD');

    const liveSrc = computeSrcFileHashes(ws);
    const allowed = ['src/cli/index.ts'];
    const protectedInfo = computeProtectedSubtreeHash(ws, allowed);

    const ledger = {
      ...baselineLedger,
      targetVersion: '1.5.0-preview.2',
      candidateCommit,
      srcFileCount: liveSrc.fileCount,
      srcTreeSha256: liveSrc.sha256,
      acceptanceMode: 'scoped_delta',
      baselineAcceptance: {
        ledgerPath: baselineLedgerRel,
        ledgerSha256: baselineLedgerSha,
        evaluatedCommit: baselineCommit,
        srcFileCount: baseSrc.fileCount,
        srcTreeSha256: baseSrc.sha256,
        historicalWaiverInherited: false
      },
      scopedDelta: {
        allowedChangedSrcPaths: allowed,
        changedSrcFiles: { 'src/cli/index.ts': liveSrc.files['src/cli/index.ts'] },
        protectedSubtreeFileCount: protectedInfo.fileCount,
        protectedSubtreeSha256: protectedInfo.sha256,
        runtimeDependenciesChanged: false,
        targetedVerification: {
          typecheckPassed: true,
          targetedSetupTestsPassed: true,
          fullRegressionTestsPassed: 387,
          fullRegressionTestsTotal: 387,
          reliabilityStressIterations: 2,
          reliabilityStressAllPassed: true,
          upgradeMatrixVersions: ['1.4.0', '1.4.1', '1.5.0-preview.1'],
          upgradeMatrixAllPassed: true,
          lateWriteRollbackVerified: true,
          packageSmokePassed: true
        }
      }
    };

    return { ws, ledgerPath: path.join(ws, 'docs', 'acceptance', 'v1.5.0-preview.2-acceptance.json'), ledger };
  }

  it('passes only when baseline ledger, protected subtree, allowed delta, and targeted evidence are intact', () => {
    const { ws, ledgerPath, ledger } = initScopedWorkspace();
    try {
      fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2), 'utf8');
      const res = runReleasePreflight({ cwd: ws, checkBuildArtifact: false });
      expect(res.eligible).toBe(true);
      expect(res.exitCode).toBe(0);

      // Verify CRLF checkout of baseline ledger produces identical normalized digest
      const basePath = path.join(ws, ledger.baselineAcceptance.ledgerPath);
      const lfText = fs.readFileSync(basePath, 'utf8');
      fs.writeFileSync(basePath, '\uFEFF' + lfText.replace(/\n/g, '\r\n'), 'utf8');
      const crlfRes = runReleasePreflight({ cwd: ws, checkBuildArtifact: false });
      expect(crlfRes.eligible).toBe(true);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it('rejects unapproved src changes outside allowedChangedSrcPaths and protected runtime paths', () => {
    const { ws, ledgerPath, ledger } = initScopedWorkspace((dir) => {
      fs.writeFileSync(path.join(dir, 'src', 'cli', 'extra.ts'), 'export const unapproved = true;\n', 'utf8');
    });
    try {
      fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2), 'utf8');
      const res = runReleasePreflight({ cwd: ws, checkBuildArtifact: false });
      expect(res.eligible).toBe(false);
      expect(res.failureReasons.map((r: { code: string }) => r.code)).toContain('SCOPED_DELTA_UNAPPROVED_SRC_CHANGE');

      ledger.scopedDelta.allowedChangedSrcPaths = ['src/cli/index.ts', 'src/memory/core.ts'];
      fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2), 'utf8');
      const protectedRes = runReleasePreflight({ cwd: ws, checkBuildArtifact: false });
      expect(protectedRes.eligible).toBe(false);
      expect(protectedRes.failureReasons.map((r: { code: string }) => r.code)).toContain('SCOPED_DELTA_PROTECTED_PATH_FORBIDDEN');
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it('rejects modified protected components, incorrect hashes, inherited waivers, incomplete evidence, and malformed modes', () => {
    const { ws, ledgerPath, ledger } = initScopedWorkspace();
    try {
      // Tamper protected subtree hash
      const badProtected = structuredClone(ledger);
      badProtected.scopedDelta.protectedSubtreeSha256 = '0'.repeat(64);
      fs.writeFileSync(ledgerPath, JSON.stringify(badProtected, null, 2), 'utf8');
      expect(runReleasePreflight({ cwd: ws, checkBuildArtifact: false }).failureReasons.map((r: { code: string }) => r.code)).toContain(
        'SCOPED_DELTA_PROTECTED_SUBTREE_MISMATCH'
      );

      // Tamper changedSrcFiles hash
      const badChanged = structuredClone(ledger);
      badChanged.scopedDelta.changedSrcFiles['src/cli/index.ts'] = 'f'.repeat(64);
      fs.writeFileSync(ledgerPath, JSON.stringify(badChanged, null, 2), 'utf8');
      expect(runReleasePreflight({ cwd: ws, checkBuildArtifact: false }).failureReasons.map((r: { code: string }) => r.code)).toContain(
        'SCOPED_DELTA_CHANGED_FILE_HASH_MISMATCH'
      );

      // Inherited historical waiver
      const badWaiver = structuredClone(ledger);
      badWaiver.baselineAcceptance.historicalWaiverInherited = true;
      fs.writeFileSync(ledgerPath, JSON.stringify(badWaiver, null, 2), 'utf8');
      expect(runReleasePreflight({ cwd: ws, checkBuildArtifact: false }).failureReasons.map((r: { code: string }) => r.code)).toContain(
        'SCOPED_DELTA_WAIVER_EXTENDED'
      );

      // Incomplete targeted evidence (missing 1.5.0-preview.1 upgrade)
      const badEvidence = structuredClone(ledger);
      badEvidence.scopedDelta.targetedVerification.upgradeMatrixVersions = ['1.4.0', '1.4.1'];
      fs.writeFileSync(ledgerPath, JSON.stringify(badEvidence, null, 2), 'utf8');
      expect(runReleasePreflight({ cwd: ws, checkBuildArtifact: false }).failureReasons.map((r: { code: string }) => r.code)).toContain(
        'SCOPED_DELTA_EVIDENCE_INCOMPLETE'
      );

      // Tampered inherited metric vs baseline file
      const badBaselineMetric = structuredClone(ledger);
      badBaselineMetric.retrieval.rawMacroRecallAt5 = 0.99;
      fs.writeFileSync(ledgerPath, JSON.stringify(badBaselineMetric, null, 2), 'utf8');
      expect(runReleasePreflight({ cwd: ws, checkBuildArtifact: false }).failureReasons.map((r: { code: string }) => r.code)).toContain(
        'SCOPED_DELTA_BASELINE_INVALID'
      );

      // Invalid acceptanceMode
      const badMode = { ...ledger, acceptanceMode: 'bypass' };
      fs.writeFileSync(ledgerPath, JSON.stringify(badMode, null, 2), 'utf8');
      expect(runReleasePreflight({ cwd: ws, checkBuildArtifact: false }).failureReasons.map((r: { code: string }) => r.code)).toContain(
        'PREVIEW_ACCEPTANCE_INVALID_MODE'
      );

      // Stable 1.5.0 remains NO-GO even with a valid scoped_delta preview ledger
      const stableRes = runReleasePreflight({
        cwd: ws,
        versionOverride: '1.5.0',
        acceptanceLedgerPath: ledgerPath,
        checkBuildArtifact: false
      });
      expect(stableRes.eligible).toBe(false);
      expect(stableRes.failureReasons.map((r: { code: string }) => r.code)).toContain('EVALUATOR_MISSING');
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });
});
