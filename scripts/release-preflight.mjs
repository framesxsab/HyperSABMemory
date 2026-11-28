import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultEvaluatorScript = path.join(repoRoot, 'scripts', 'repository-task-eval.mjs');
const defaultBuildArtifact = path.join(repoRoot, 'dist', 'eval', 'repositoryTaskEvaluation.js');
const PREVIEW_VERSION_RE = /-preview\.\d+$/;
const SHA256_RE = /^[a-f0-9]{64}$/;
const COMMIT_SHA_RE = /^[a-f0-9]{40}$/;

export const PROTECTED_RUNTIME_PREFIXES = [
  'src/memory/',
  'src/mcp/',
  'src/hooks/',
  'src/server/',
  'src/eval/'
];

export const PROTECTED_RUNTIME_FILES = new Set([
  'src/harness/taskContext.ts',
  'src/harness/taskSources.ts',
  'src/harness/ghostPaths.ts',
  'src/harness/contextEngine.ts',
  'src/harness/adapters.ts',
  'src/index.ts',
  'src/version.ts'
]);

/**
 * Exact release criteria frozen in src/eval/repositoryTaskEvaluation.ts (line 238).
 * This preflight inspects the evaluator's structured output directly and fails closed
 * on any missing metric, malformed payload, process error, or unmet threshold.
 */
export const FROZEN_GATE_SPEC = [
  {
    id: 'retrieval.maximumPrecisionAt5',
    label: 'Raw maximum precision@5 ceiling',
    requirement: '>= 0.5',
    read: (report) => report?.retrieval?.maximumPrecisionAt5,
    test: (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0.5
  },
  {
    id: 'retrieval.precisionAt5',
    label: 'Raw retrieval precision@5',
    requirement: '>= 0.5',
    read: (report) => report?.retrieval?.precisionAt5,
    test: (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0.5
  },
  {
    id: 'retrieval.recallAt5',
    label: 'Raw retrieval recall@5',
    requirement: '>= 0.85',
    read: (report) => report?.retrieval?.recallAt5,
    test: (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0.85
  },
  {
    id: 'grounded.recallAt5',
    label: 'Grounded retrieval recall@5',
    requirement: '>= 0.85',
    read: (report) => report?.grounded?.recallAt5,
    test: (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0.85
  },
  {
    id: 'grounded.precisionAt5',
    label: 'Grounded retrieval precision@5',
    requirement: '>= 0.5',
    read: (report) => report?.grounded?.precisionAt5,
    test: (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0.5
  },
  {
    id: 'grounded.noAnswerFalsePositives',
    label: 'Grounded no-answer false positives',
    requirement: '<= 1',
    read: (report) => report?.grounded?.noAnswerFalsePositives,
    test: (value) => typeof value === 'number' && Number.isFinite(value) && value <= 1
  },
  {
    id: 'grounded.supportedAnswerCoverage',
    label: 'Grounded supported answer coverage',
    requirement: '> 0',
    read: (report) => report?.grounded?.supportedAnswerCoverage,
    test: (value) => typeof value === 'number' && Number.isFinite(value) && value > 0
  },
  {
    id: 'retrieval.forgottenLeaks',
    label: 'Forgotten-memory leaks',
    requirement: '=== 0',
    read: (report) => report?.retrieval?.forgottenLeaks,
    test: (value) => value === 0
  },
  {
    id: 'methodology.staleSourceTested',
    label: 'Stale-source probe executed',
    requirement: '=== true',
    read: (report) => report?.methodology?.staleSourceTested,
    test: (value) => value === true
  },
  {
    id: 'staleProbe.leaks',
    label: 'Stale-source leaks',
    requirement: '=== 0',
    read: (report) => report?.staleProbe?.leaks,
    test: (value) => value === 0
  },
  {
    id: 'latencyMs.samples',
    label: 'Latency sample count',
    requirement: '> 0',
    read: (report) => report?.latencyMs?.samples,
    test: (value) => typeof value === 'number' && Number.isFinite(value) && value > 0
  },
  {
    id: 'latencyMs.p95',
    label: 'Grounded search p95 latency (ms)',
    requirement: '< 100',
    read: (report) => report?.latencyMs?.p95,
    test: (value) => typeof value === 'number' && Number.isFinite(value) && value < 100
  }
];

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function summarizeReport(report) {
  if (!isPlainObject(report)) return null;
  return {
    passed: typeof report.passed === 'boolean' ? report.passed : null,
    corpus: isPlainObject(report.corpus) ? report.corpus : null,
    retrieval: isPlainObject(report.retrieval)
      ? {
          precisionAt5: report.retrieval.precisionAt5,
          recallAt5: report.retrieval.recallAt5,
          meanReciprocalRank: report.retrieval.meanReciprocalRank,
          maximumPrecisionAt5: report.retrieval.maximumPrecisionAt5,
          forgottenLeaks: report.retrieval.forgottenLeaks
        }
      : null,
    grounded: isPlainObject(report.grounded)
      ? {
          precisionAt5: report.grounded.precisionAt5,
          recallAt5: report.grounded.recallAt5,
          meanReciprocalRank: report.grounded.meanReciprocalRank,
          noAnswerFalsePositives: report.grounded.noAnswerFalsePositives,
          supportedAnswerCoverage: report.grounded.supportedAnswerCoverage,
          unsupportedAssertions: report.grounded.unsupportedAssertions
        }
      : null,
    staleProbe: isPlainObject(report.staleProbe) ? report.staleProbe : null,
    latencyMs: isPlainObject(report.latencyMs) ? report.latencyMs : null
  };
}

function hashNormalizedEntries(entries) {
  const sorted = [...entries].sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  const hash = createHash('sha256');
  const files = {};
  for (const entry of sorted) {
    const normalized = entry.content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
    const buf = Buffer.from(normalized, 'utf8');
    hash.update(entry.rel);
    hash.update('\0');
    hash.update(buf);
    hash.update('\0');
    files[entry.rel] = createHash('sha256').update(buf).digest('hex');
  }
  return { fileCount: sorted.length, sha256: hash.digest('hex'), files };
}

export function computeSrcFileHashes(rootDir = repoRoot) {
  const srcDir = path.join(rootDir, 'src');
  if (!existsSync(srcDir)) {
    return { fileCount: 0, sha256: null, files: {} };
  }
  const entries = [];
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const rel = path.relative(rootDir, fullPath).replaceAll('\\', '/');
        entries.push({ rel, content: readFileSync(fullPath, 'utf8') });
      }
    }
  }
  walk(srcDir);
  return hashNormalizedEntries(entries);
}

export function computeSrcTreeHash(rootDir = repoRoot) {
  const { fileCount, sha256 } = computeSrcFileHashes(rootDir);
  return { fileCount, sha256 };
}

export function computeProtectedSubtreeHash(rootDir = repoRoot, excludedPaths = []) {
  const srcDir = path.join(rootDir, 'src');
  if (!existsSync(srcDir)) {
    return { fileCount: 0, sha256: null, files: {} };
  }
  const excluded = new Set(excludedPaths);
  const entries = [];
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const rel = path.relative(rootDir, fullPath).replaceAll('\\', '/');
        if (!excluded.has(rel)) {
          entries.push({ rel, content: readFileSync(fullPath, 'utf8') });
        }
      }
    }
  }
  walk(srcDir);
  return hashNormalizedEntries(entries);
}

export function isProtectedRuntimePath(relPath) {
  return PROTECTED_RUNTIME_FILES.has(relPath) || PROTECTED_RUNTIME_PREFIXES.some((prefix) => relPath.startsWith(prefix));
}

function stableEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== typeof b) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, idx) => stableEqual(item, b[idx]));
  }
  if (typeof a === 'object') {
    const keysA = Object.keys(a).sort();
    const keysB = Object.keys(b).sort();
    return stableEqual(keysA, keysB) && keysA.every((key) => stableEqual(a[key], b[key]));
  }
  return false;
}

function computeGitCommitSrcHashes(cwd, commitSha) {
  const listed = spawnSync('git', ['ls-tree', '-r', '--name-only', commitSha, '--', 'src'], {
    cwd,
    encoding: 'utf8'
  });
  if (listed.status !== 0) return null;
  const relPaths = listed.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const entries = [];
  for (const rel of relPaths) {
    const shown = spawnSync('git', ['show', `${commitSha}:${rel}`], { cwd, encoding: 'utf8' });
    if (shown.status !== 0) return null;
    entries.push({ rel, content: shown.stdout });
  }
  return hashNormalizedEntries(entries);
}

export const PREVIEW_GATE_SPEC = [
  {
    id: 'preview.retrieval.queriesTotal',
    label: 'Unseen retrieval queries attempted',
    requirement: '=== 45',
    read: (l) => l?.retrieval?.queriesTotal,
    test: (v) => v === 45
  },
  {
    id: 'preview.retrieval.rawMacroRecallAt5',
    label: 'Raw macro recall@5',
    requirement: '>= 0.80',
    read: (l) => l?.retrieval?.rawMacroRecallAt5,
    test: (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0.8
  },
  {
    id: 'preview.retrieval.groundedMacroRecallAt5',
    label: 'Grounded macro recall@5',
    requirement: '>= 0.80',
    read: (l) => l?.retrieval?.groundedMacroRecallAt5,
    test: (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0.8
  },
  {
    id: 'preview.retrieval.rawNormalizedPrecisionAt5',
    label: 'Raw normalized precision@5',
    requirement: '>= 0.45',
    read: (l) => l?.retrieval?.rawNormalizedPrecisionAt5,
    test: (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0.45
  },
  {
    id: 'preview.retrieval.groundedNormalizedPrecisionAt5',
    label: 'Grounded normalized precision@5',
    requirement: '>= 0.45',
    read: (l) => l?.retrieval?.groundedNormalizedPrecisionAt5,
    test: (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0.45
  },
  {
    id: 'preview.retrieval.groundedMrrAt5',
    label: 'Grounded MRR@5',
    requirement: '>= 0.80',
    read: (l) => l?.retrieval?.groundedMrrAt5,
    test: (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0.8
  },
  {
    id: 'preview.retrieval.groundedTop1Precision',
    label: 'Grounded Top-1 precision',
    requirement: '>= 0.70',
    read: (l) => l?.retrieval?.groundedTop1Precision,
    test: (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0.7
  },
  {
    id: 'preview.retrieval.unanswerableStrictEmitRate',
    label: 'Unanswerable strict emit rate',
    requirement: '<= 0.50',
    read: (l) => l?.retrieval?.unanswerableStrictEmitRate,
    test: (v) => typeof v === 'number' && Number.isFinite(v) && v <= 0.5
  },
  {
    id: 'preview.safety.unsupportedAssertionsTotal',
    label: 'Unsupported assertions total',
    requirement: '=== 0',
    read: (l) => l?.safety?.unsupportedAssertionsTotal,
    test: (v) => v === 0
  },
  {
    id: 'preview.safety.forgottenCanaryLeaks',
    label: 'Forgotten-canary leaks',
    requirement: '=== 0',
    read: (l) => l?.safety?.forgottenCanaryLeaks,
    test: (v) => v === 0
  },
  {
    id: 'preview.safety.populatedMemoryMdLeaks',
    label: 'Populated Memory.md / restarted MCP leaks',
    requirement: '=== 0',
    read: (l) => l?.safety?.populatedMemoryMdLeaks,
    test: (v) => v === 0
  },
  {
    id: 'preview.safety.emptyAfterLastForgetEdgePassed',
    label: 'Memory.md cleared after final forget edge',
    requirement: '=== true',
    read: (l) => l?.safety?.emptyAfterLastForgetEdgePassed,
    test: (v) => v === true
  },
  {
    id: 'preview.safety.sameSizeStaleRate',
    label: 'Same-size stale detection rate',
    requirement: '=== 1',
    read: (l) => l?.safety?.sameSizeStaleRate,
    test: (v) => v === 1
  },
  {
    id: 'preview.safety.sameSizeStaleLeaks',
    label: 'Same-size stale leaks',
    requirement: '=== 0',
    read: (l) => l?.safety?.sameSizeStaleLeaks,
    test: (v) => v === 0
  },
  {
    id: 'preview.safety.midVerificationMutationPassed',
    label: 'Deterministic mid-verification mutation probes',
    requirement: '=== 3',
    read: (l) => l?.safety?.midVerificationMutationPassed,
    test: (v) => v === 3
  },
  {
    id: 'preview.safety.workspaceContainmentViolations',
    label: 'Workspace containment violations',
    requirement: '=== 0',
    read: (l) => l?.safety?.workspaceContainmentViolations,
    test: (v) => v === 0
  },
  {
    id: 'preview.safety.junctionEscapeBlocked',
    label: 'NTFS junction escape blocked',
    requirement: '=== true',
    read: (l) => l?.safety?.junctionEscapeBlocked,
    test: (v) => v === true
  },
  {
    id: 'preview.safety.falseStaticTestLinks',
    label: 'False static test links',
    requirement: '=== 0',
    read: (l) => l?.safety?.falseStaticTestLinks,
    test: (v) => v === 0
  },
  {
    id: 'preview.safety.positiveDeterministicRate',
    label: 'Positive deterministic accuracy',
    requirement: '>= 0.90',
    read: (l) => l?.safety?.positiveDeterministicRate,
    test: (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0.9
  },
  {
    id: 'preview.safety.unsupportedDeterministicRate',
    label: 'Unsupported deterministic abstention',
    requirement: '=== 1',
    read: (l) => l?.safety?.unsupportedDeterministicRate,
    test: (v) => v === 1
  },
  {
    id: 'preview.safety.conflictingEvidenceRate',
    label: 'Conflicting evidence abstention',
    requirement: '=== 1',
    read: (l) => l?.safety?.conflictingEvidenceRate,
    test: (v) => v === 1
  },
  {
    id: 'preview.safety.setupCleanDiffVerified',
    label: 'Installed setup non-destructive clean diff',
    requirement: '=== true',
    read: (l) => l?.safety?.setupCleanDiffVerified,
    test: (v) => v === true
  },
  {
    id: 'preview.performance.warmMcpP95Ms',
    label: 'Warm MCP retrieval p95 latency (ms)',
    requirement: '<= 100',
    read: (l) => l?.performance?.warmMcpP95Ms,
    test: (v) => typeof v === 'number' && Number.isFinite(v) && v <= 100
  },
  {
    id: 'preview.performance.coldTsP95MsExcludingStartup',
    label: 'Cold subprocess evidence p95 latency (ms)',
    requirement: '<= 500',
    read: (l) => l?.performance?.coldTsP95MsExcludingStartup,
    test: (v) => typeof v === 'number' && Number.isFinite(v) && v <= 500
  },
  {
    id: 'preview.performance.compactHandoffP95Ms',
    label: 'Compact task handoff p95 latency (ms)',
    requirement: '<= 50',
    read: (l) => l?.performance?.compactHandoffP95Ms,
    test: (v) => typeof v === 'number' && Number.isFinite(v) && v <= 50
  },
  {
    id: 'preview.performance.compactByteReductionMinObserved',
    label: 'Minimum compact byte reduction ratio',
    requirement: '>= 0.50',
    read: (l) => l?.performance?.compactByteReductionMinObserved,
    test: (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0.5
  },
  {
    id: 'preview.performance.compactCompletenessVerified',
    label: 'Compact payload semantic completeness',
    requirement: '=== true',
    read: (l) => l?.performance?.compactCompletenessVerified,
    test: (v) => v === true
  },
  {
    id: 'preview.continuation.passedTasks',
    label: 'Live unseen continuation tasks passed',
    requirement: '=== 3',
    read: (l) => l?.continuation?.passedTasks,
    test: (v) => v === 3
  },
  {
    id: 'preview.continuation.allPassed',
    label: 'All 3 continuation tasks passed',
    requirement: '=== true',
    read: (l) => l?.continuation?.allPassed,
    test: (v) => v === true
  }
];

function evaluateSpec(subject, spec) {
  const failingCriteria = [];
  const passingCriteria = [];
  for (const gate of spec) {
    const observed = gate.read(subject);
    const passed = gate.test(observed);
    const entry = {
      id: gate.id,
      label: gate.label,
      requirement: gate.requirement,
      observed: observed === undefined ? null : observed,
      passed
    };
    if (passed) passingCriteria.push(entry);
    else failingCriteria.push(entry);
  }
  return { failingCriteria, passingCriteria };
}

export function runPreviewAcceptancePreflight(options = {}) {
  const {
    cwd = repoRoot,
    version,
    acceptanceLedgerPath = path.join(cwd, 'docs', 'acceptance', `v${version}-acceptance.json`),
    buildArtifactPath = defaultBuildArtifact,
    checkBuildArtifact = cwd === repoRoot
  } = options;

  const failureReasons = [];

  if (checkBuildArtifact && !existsSync(buildArtifactPath)) {
    failureReasons.push({
      code: 'MISSING_BUILD_ARTIFACT',
      detail: `Compiled evaluator artifact not found at ${buildArtifactPath}; run "npm run build" first without modifying repository gates`
    });
  }

  if (!existsSync(acceptanceLedgerPath)) {
    failureReasons.push({
      code: 'PREVIEW_ACCEPTANCE_LEDGER_MISSING',
      detail: `Preview acceptance ledger not found at ${acceptanceLedgerPath}`
    });
    return {
      eligible: false,
      verdict: 'RELEASE BLOCKED — NO-GO',
      exitCode: 1,
      signal: null,
      failureReasons,
      failingCriteria: [],
      passingCriteria: [],
      criteriaTotal: PREVIEW_GATE_SPEC.length,
      reportSummary: null,
      stderrPreview: ''
    };
  }

  let ledger;
  try {
    ledger = JSON.parse(readFileSync(acceptanceLedgerPath, 'utf8'));
  } catch (error) {
    failureReasons.push({
      code: 'PREVIEW_ACCEPTANCE_LEDGER_MALFORMED',
      detail: `Invalid JSON in preview acceptance ledger: ${error instanceof Error ? error.message : String(error)}`
    });
    return {
      eligible: false,
      verdict: 'RELEASE BLOCKED — NO-GO',
      exitCode: 1,
      signal: null,
      failureReasons,
      failingCriteria: [],
      passingCriteria: [],
      criteriaTotal: PREVIEW_GATE_SPEC.length,
      reportSummary: null,
      stderrPreview: ''
    };
  }

  if (!isPlainObject(ledger) || ledger.profile !== 'Option B Profile 1 (Developer Preview)') {
    failureReasons.push({
      code: 'PREVIEW_ACCEPTANCE_INVALID_PROFILE',
      detail: 'Acceptance ledger must declare profile="Option B Profile 1 (Developer Preview)"'
    });
  }

  if (ledger?.targetVersion !== version) {
    failureReasons.push({
      code: 'PREVIEW_ACCEPTANCE_VERSION_MISMATCH',
      detail: `Ledger targetVersion=${String(ledger?.targetVersion)} does not match package version=${String(version)}`
    });
  }

  if (!/^[a-f0-9]{40}$/.test(String(ledger?.candidateCommit ?? '')) || ledger?.ciJobsPassed !== 9 || ledger?.ciJobsTotal !== 9) {
    failureReasons.push({
      code: 'PREVIEW_ACCEPTANCE_CI_INCOMPLETE',
      detail: 'Acceptance ledger must record a 40-char candidateCommit with 9/9 CI jobs passed'
    });
  }

  const liveSrc = computeSrcFileHashes(cwd);
  if (!liveSrc.sha256 || ledger?.srcTreeSha256 !== liveSrc.sha256 || ledger?.srcFileCount !== liveSrc.fileCount) {
    failureReasons.push({
      code: 'SRC_TREE_HASH_MISMATCH',
      detail: `Live src/ hash (${liveSrc.sha256}, ${liveSrc.fileCount} files) does not match evaluated ledger (${String(ledger?.srcTreeSha256)}, ${String(ledger?.srcFileCount)} files)`
    });
  }

  const mode = ledger?.acceptanceMode;
  if (mode !== undefined && mode !== 'scoped_delta') {
    failureReasons.push({
      code: 'PREVIEW_ACCEPTANCE_INVALID_MODE',
      detail: `Unsupported acceptanceMode=${String(mode)}`
    });
  } else if (mode === undefined && (ledger?.scopedDelta !== undefined || ledger?.baselineAcceptance !== undefined)) {
    failureReasons.push({
      code: 'SCOPED_DELTA_MALFORMED',
      detail: 'scopedDelta / baselineAcceptance fields require acceptanceMode="scoped_delta"'
    });
  } else if (mode === 'scoped_delta') {
    validateScopedDeltaLedger({ cwd, ledger, liveSrc, failureReasons });
  }

  const { failingCriteria, passingCriteria } = evaluateSpec(ledger, PREVIEW_GATE_SPEC);
  if (failingCriteria.length > 0) {
    failureReasons.push({
      code: 'PREVIEW_PROFILE_1_GATES_FAILED',
      detail: `${failingCriteria.length} Profile 1 preview acceptance criterion/criteria unmet`
    });
  }

  const eligible = failureReasons.length === 0 && failingCriteria.length === 0;
  return {
    eligible,
    verdict: eligible ? 'RELEASE ELIGIBLE — PREFLIGHT PASSED (OPTION B PROFILE 1 PREVIEW)' : 'RELEASE BLOCKED — NO-GO',
    exitCode: eligible ? 0 : 1,
    signal: null,
    failureReasons,
    failingCriteria,
    passingCriteria,
    criteriaTotal: PREVIEW_GATE_SPEC.length,
    reportSummary: {
      profile: ledger?.profile ?? null,
      targetVersion: ledger?.targetVersion ?? null,
      candidateCommit: ledger?.candidateCommit ?? null,
      srcTreeSha256: liveSrc.sha256,
      retrieval: ledger?.retrieval ?? null,
      safety: ledger?.safety ?? null,
      performance: ledger?.performance ?? null,
      continuation: ledger?.continuation ?? null
    },
    stderrPreview: ''
  };
}

function validateScopedDeltaLedger({ cwd, ledger, liveSrc, failureReasons }) {
  const baseline = ledger?.baselineAcceptance;
  const delta = ledger?.scopedDelta;
  if (!isPlainObject(baseline) || !isPlainObject(delta)) {
    failureReasons.push({
      code: 'SCOPED_DELTA_MALFORMED',
      detail: 'scoped_delta mode requires baselineAcceptance and scopedDelta objects'
    });
    return;
  }

  if (baseline.historicalWaiverInherited !== false) {
    failureReasons.push({
      code: 'SCOPED_DELTA_WAIVER_EXTENDED',
      detail: 'baselineAcceptance.historicalWaiverInherited must be explicitly false for preview.2+'
    });
  }

  if (
    typeof baseline.ledgerPath !== 'string' ||
    !baseline.ledgerPath ||
    path.isAbsolute(baseline.ledgerPath) ||
    !SHA256_RE.test(String(baseline.ledgerSha256 ?? '')) ||
    !COMMIT_SHA_RE.test(String(baseline.evaluatedCommit ?? '')) ||
    !SHA256_RE.test(String(baseline.srcTreeSha256 ?? '')) ||
    !Number.isInteger(baseline.srcFileCount)
  ) {
    failureReasons.push({
      code: 'SCOPED_DELTA_BASELINE_INVALID',
      detail: 'baselineAcceptance must declare relative ledgerPath, 64-char ledgerSha256, 40-char evaluatedCommit, srcTreeSha256, and srcFileCount'
    });
  } else {
    const resolvedRoot = path.resolve(cwd);
    const baselineAbs = path.resolve(resolvedRoot, baseline.ledgerPath);
    if (!baselineAbs.startsWith(resolvedRoot + path.sep) || !existsSync(baselineAbs)) {
      failureReasons.push({
        code: 'SCOPED_DELTA_BASELINE_INVALID',
        detail: `Referenced baseline ledger not found at ${baseline.ledgerPath}`
      });
    } else {
      const rawBaseline = readFileSync(baselineAbs, 'utf8');
      const actualDigest = createHash('sha256').update(Buffer.from(rawBaseline, 'utf8')).digest('hex');
      if (actualDigest !== baseline.ledgerSha256) {
        failureReasons.push({
          code: 'SCOPED_DELTA_BASELINE_INVALID',
          detail: `Baseline ledger SHA-256 mismatch (${actualDigest} !== ${baseline.ledgerSha256})`
        });
      }
      try {
        const parsedBaseline = JSON.parse(rawBaseline);
        const baselineSpec = evaluateSpec(parsedBaseline, PREVIEW_GATE_SPEC);
        const inheritedMatch =
          parsedBaseline?.profile === 'Option B Profile 1 (Developer Preview)' &&
          parsedBaseline?.candidateCommit === baseline.evaluatedCommit &&
          parsedBaseline?.srcTreeSha256 === baseline.srcTreeSha256 &&
          parsedBaseline?.srcFileCount === baseline.srcFileCount &&
          baselineSpec.failingCriteria.length === 0 &&
          stableEqual(ledger?.retrieval, parsedBaseline?.retrieval) &&
          stableEqual(ledger?.safety, parsedBaseline?.safety) &&
          stableEqual(ledger?.performance, parsedBaseline?.performance) &&
          stableEqual(ledger?.continuation, parsedBaseline?.continuation);
        if (!inheritedMatch) {
          failureReasons.push({
            code: 'SCOPED_DELTA_BASELINE_INVALID',
            detail: 'Baseline ledger metadata or inherited Profile 1 metrics do not match referenced baseline file'
          });
        }
      } catch {
        failureReasons.push({
          code: 'SCOPED_DELTA_BASELINE_INVALID',
          detail: 'Referenced baseline ledger is not valid JSON'
        });
      }
    }
  }

  const allowed = delta.allowedChangedSrcPaths;
  if (
    !Array.isArray(allowed) ||
    allowed.length === 0 ||
    allowed.some((item) => typeof item !== 'string' || !item.startsWith('src/') || item.includes('\\') || item.includes('..')) ||
    new Set(allowed).size !== allowed.length
  ) {
    failureReasons.push({
      code: 'SCOPED_DELTA_MALFORMED',
      detail: 'scopedDelta.allowedChangedSrcPaths must be a non-empty unique array of relative src/ paths'
    });
    return;
  }

  const forbidden = allowed.filter((rel) => isProtectedRuntimePath(rel));
  if (forbidden.length > 0) {
    failureReasons.push({
      code: 'SCOPED_DELTA_PROTECTED_PATH_FORBIDDEN',
      detail: `Protected runtime paths cannot appear in allowedChangedSrcPaths: ${forbidden.join(', ')}`
    });
  }

  const protectedSubtree = computeProtectedSubtreeHash(cwd, allowed);
  if (
    !SHA256_RE.test(String(delta.protectedSubtreeSha256 ?? '')) ||
    delta.protectedSubtreeSha256 !== protectedSubtree.sha256 ||
    delta.protectedSubtreeFileCount !== protectedSubtree.fileCount
  ) {
    failureReasons.push({
      code: 'SCOPED_DELTA_PROTECTED_SUBTREE_MISMATCH',
      detail: `Protected src/ subtree mismatch (live ${protectedSubtree.sha256}, ${protectedSubtree.fileCount} files vs ledger ${String(delta.protectedSubtreeSha256)}, ${String(delta.protectedSubtreeFileCount)} files)`
    });
  }

  if (!isPlainObject(delta.changedSrcFiles)) {
    failureReasons.push({
      code: 'SCOPED_DELTA_MALFORMED',
      detail: 'scopedDelta.changedSrcFiles must be an object mapping allowed paths to SHA-256 hashes'
    });
  } else {
    const expectedKeys = [...allowed].sort();
    const actualKeys = Object.keys(delta.changedSrcFiles).sort();
    if (!stableEqual(expectedKeys, actualKeys)) {
      failureReasons.push({
        code: 'SCOPED_DELTA_CHANGED_FILE_HASH_MISMATCH',
        detail: 'scopedDelta.changedSrcFiles keys must match allowedChangedSrcPaths exactly'
      });
    } else {
      for (const rel of expectedKeys) {
        const expectedHash = delta.changedSrcFiles[rel];
        const liveHash = liveSrc.files[rel];
        if (!liveHash || expectedHash !== liveHash) {
          failureReasons.push({
            code: 'SCOPED_DELTA_CHANGED_FILE_HASH_MISMATCH',
            detail: `Changed src file hash mismatch for ${rel}`
          });
        }
      }
    }
  }

  if (COMMIT_SHA_RE.test(String(baseline?.evaluatedCommit ?? ''))) {
    const revCheck = spawnSync('git', ['rev-parse', '--verify', `${baseline.evaluatedCommit}^{commit}`], {
      cwd,
      encoding: 'utf8'
    });
    if (revCheck.status === 0) {
      const ancestor = spawnSync('git', ['merge-base', '--is-ancestor', baseline.evaluatedCommit, 'HEAD'], {
        cwd,
        encoding: 'utf8'
      });
      if (ancestor.status !== 0) {
        failureReasons.push({
          code: 'SCOPED_DELTA_BASELINE_NOT_ANCESTOR',
          detail: `Baseline commit ${baseline.evaluatedCommit} is not an ancestor of HEAD`
        });
      } else {
        const baselineSrc = computeGitCommitSrcHashes(cwd, baseline.evaluatedCommit);
        if (!baselineSrc) {
          failureReasons.push({
            code: 'SCOPED_DELTA_BASELINE_INVALID',
            detail: `Unable to inspect baseline src/ tree at ${baseline.evaluatedCommit}`
          });
        } else {
          const allRelPaths = new Set([...Object.keys(baselineSrc.files), ...Object.keys(liveSrc.files)]);
          const allowedSet = new Set(allowed);
          const unapproved = [];
          for (const rel of allRelPaths) {
            if (baselineSrc.files[rel] !== liveSrc.files[rel] && !allowedSet.has(rel)) {
              unapproved.push(rel);
            }
          }
          if (unapproved.length > 0) {
            failureReasons.push({
              code: 'SCOPED_DELTA_UNAPPROVED_SRC_CHANGE',
              detail: `Unapproved src/ delta relative to ${baseline.evaluatedCommit}: ${unapproved.sort().join(', ')}`
            });
          }
        }
      }
    }
  }

  const tv = delta.targetedVerification;
  const upgradeVersions = Array.isArray(tv?.upgradeMatrixVersions) ? tv.upgradeMatrixVersions : [];
  const hasAllUpgrades = ['1.4.0', '1.4.1', '1.5.0-preview.1'].every((v) => upgradeVersions.includes(v));
  const evidenceValid =
    delta.runtimeDependenciesChanged === false &&
    isPlainObject(tv) &&
    tv.typecheckPassed === true &&
    tv.targetedSetupTestsPassed === true &&
    typeof tv.fullRegressionTestsPassed === 'number' &&
    typeof tv.fullRegressionTestsTotal === 'number' &&
    tv.fullRegressionTestsPassed >= 375 &&
    tv.fullRegressionTestsPassed === tv.fullRegressionTestsTotal &&
    typeof tv.reliabilityStressIterations === 'number' &&
    tv.reliabilityStressIterations >= 2 &&
    tv.reliabilityStressAllPassed === true &&
    hasAllUpgrades &&
    tv.upgradeMatrixAllPassed === true &&
    tv.lateWriteRollbackVerified === true &&
    tv.packageSmokePassed === true;

  if (!evidenceValid) {
    failureReasons.push({
      code: 'SCOPED_DELTA_EVIDENCE_INCOMPLETE',
      detail: 'scopedDelta targetedVerification evidence is incomplete or unmet'
    });
  }
}

export function extractGateEvaluations(report) {
  return evaluateSpec(report, FROZEN_GATE_SPEC);
}

/**
 * Fail-closed inspection of an evaluator execution result.
 * Does not rely on process exit code alone and rejects missing, malformed,
 * timed-out, signal-terminated, or internally inconsistent outputs.
 */
export function inspectEvaluatorOutput(execution) {
  const {
    status = null,
    signal = null,
    stdout = '',
    stderr = '',
    error = undefined
  } = execution ?? {};

  const failureReasons = [];

  if (error) {
    const code = error.code === 'ETIMEDOUT' ? 'EVALUATOR_TIMEOUT' : 'EVALUATOR_SPAWN_ERROR';
    failureReasons.push({
      code,
      detail: error.message || String(error)
    });
  }

  if (signal) {
    failureReasons.push({
      code: 'EVALUATOR_SIGNAL',
      detail: `Evaluator terminated unexpectedly by signal ${signal}`
    });
  }

  const trimmed = typeof stdout === 'string' ? stdout.trim() : '';
  if (!trimmed) {
    failureReasons.push({
      code: 'EVALUATOR_EMPTY_OUTPUT',
      detail: 'Evaluator produced no structured JSON output on stdout'
    });
    return {
      eligible: false,
      verdict: 'RELEASE BLOCKED — NO-GO',
      exitCode: status,
      signal,
      failureReasons,
      failingCriteria: [],
      passingCriteria: [],
      reportSummary: null,
      stderrPreview: typeof stderr === 'string' ? stderr.trim().slice(0, 400) : ''
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (parseError) {
    failureReasons.push({
      code: 'EVALUATOR_MALFORMED_OUTPUT',
      detail: `Evaluator stdout is not valid JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}`
    });
    return {
      eligible: false,
      verdict: 'RELEASE BLOCKED — NO-GO',
      exitCode: status,
      signal,
      failureReasons,
      failingCriteria: [],
      passingCriteria: [],
      reportSummary: null,
      stderrPreview: typeof stderr === 'string' ? stderr.trim().slice(0, 400) : ''
    };
  }

  if (!isPlainObject(parsed) || typeof parsed.passed !== 'boolean') {
    failureReasons.push({
      code: 'EVALUATOR_INVALID_SCHEMA',
      detail: 'Evaluator output must be a JSON object with a boolean `passed` field'
    });
    return {
      eligible: false,
      verdict: 'RELEASE BLOCKED — NO-GO',
      exitCode: status,
      signal,
      failureReasons,
      failingCriteria: [],
      passingCriteria: [],
      reportSummary: null,
      stderrPreview: typeof stderr === 'string' ? stderr.trim().slice(0, 400) : ''
    };
  }

  const { failingCriteria, passingCriteria } = extractGateEvaluations(parsed);

  if (status !== 0) {
    failureReasons.push({
      code: 'EVALUATOR_NONZERO_EXIT',
      detail: `Evaluator exited with status ${status}`
    });
  }

  if (parsed.passed !== true) {
    failureReasons.push({
      code: 'RELEASE_GATES_FAILED',
      detail: `Evaluator reported passed=${String(parsed.passed)} (${failingCriteria.length} failing criterion/criteria)`
    });
  } else if (failingCriteria.length > 0) {
    failureReasons.push({
      code: 'EVALUATOR_CONTRACT_MISMATCH',
      detail: `Evaluator reported passed=true despite ${failingCriteria.length} unmet or missing frozen release criterion/criteria`
    });
  }

  const eligible =
    failureReasons.length === 0 &&
    status === 0 &&
    signal === null &&
    parsed.passed === true &&
    failingCriteria.length === 0;

  return {
    eligible,
    verdict: eligible ? 'RELEASE ELIGIBLE — PREFLIGHT PASSED' : 'RELEASE BLOCKED — NO-GO',
    exitCode: status,
    signal,
    failureReasons,
    failingCriteria,
    passingCriteria,
    reportSummary: summarizeReport(parsed),
    stderrPreview: typeof stderr === 'string' ? stderr.trim().slice(0, 400) : ''
  };
}

export function runReleasePreflight(options = {}) {
  const {
    cwd = repoRoot,
    evaluatorScript,
    buildArtifactPath = defaultBuildArtifact,
    checkBuildArtifact = (evaluatorScript ?? defaultEvaluatorScript) === defaultEvaluatorScript,
    timeoutMs = 120_000,
    nodePath = process.execPath,
    versionOverride,
    acceptanceLedgerPath
  } = options;

  let pkgVersion = typeof versionOverride === 'string' ? versionOverride : '';
  if (!pkgVersion) {
    const pkgPath = path.join(cwd, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        pkgVersion = String(JSON.parse(readFileSync(pkgPath, 'utf8')).version ?? '');
      } catch {
        pkgVersion = '';
      }
    }
  }

  // Option B Profile 1 preview path applies strictly to -preview.N versions when no synthetic evaluator script is injected.
  if (PREVIEW_VERSION_RE.test(pkgVersion) && evaluatorScript === undefined) {
    return runPreviewAcceptancePreflight({
      cwd,
      version: pkgVersion,
      acceptanceLedgerPath: acceptanceLedgerPath ?? path.join(cwd, 'docs', 'acceptance', `v${pkgVersion}-acceptance.json`),
      buildArtifactPath,
      checkBuildArtifact
    });
  }

  const effectiveEvaluatorScript = evaluatorScript ?? path.join(cwd, 'scripts', 'repository-task-eval.mjs');
  const effectiveBuildArtifact = options.buildArtifactPath ?? path.join(cwd, 'dist', 'eval', 'repositoryTaskEvaluation.js');

  if (!existsSync(effectiveEvaluatorScript)) {
    return {
      eligible: false,
      verdict: 'RELEASE BLOCKED — NO-GO',
      exitCode: null,
      signal: null,
      failureReasons: [
        {
          code: 'EVALUATOR_MISSING',
          detail: `Release evaluator script not found at ${effectiveEvaluatorScript}`
        }
      ],
      failingCriteria: [],
      passingCriteria: [],
      reportSummary: null,
      stderrPreview: ''
    };
  }

  if (checkBuildArtifact && !existsSync(effectiveBuildArtifact)) {
    return {
      eligible: false,
      verdict: 'RELEASE BLOCKED — NO-GO',
      exitCode: null,
      signal: null,
      failureReasons: [
        {
          code: 'MISSING_BUILD_ARTIFACT',
          detail: `Compiled evaluator artifact not found at ${effectiveBuildArtifact}; run "npm run build" first without modifying repository gates`
        }
      ],
      failingCriteria: [],
      passingCriteria: [],
      reportSummary: null,
      stderrPreview: ''
    };
  }

  const execution = spawnSync(nodePath, [effectiveEvaluatorScript], {
    cwd,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 32 * 1024 * 1024
  });

  return inspectEvaluatorOutput({
    status: execution.status,
    signal: execution.signal,
    stdout: execution.stdout,
    stderr: execution.stderr,
    error: execution.error
  });
}

function formatMetricValue(value) {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : value.toFixed(4);
  }
  return String(value);
}

export function formatPreflightSummary(result) {
  const lines = [
    `=== HyperSABMemory Release Preflight ===`,
    `Verdict: ${result.verdict}`,
    `Eligible for publication: ${result.eligible ? 'YES' : 'NO'}`,
    `Evaluator exit code: ${result.exitCode === null ? 'none' : result.exitCode}${result.signal ? ` (signal ${result.signal})` : ''}`
  ];

  if (result.failureReasons.length > 0) {
    lines.push('', 'Failure reasons:');
    for (const reason of result.failureReasons) {
      lines.push(`  - [${reason.code}] ${reason.detail}`);
    }
  }

  const totalCriteria = result.criteriaTotal ?? FROZEN_GATE_SPEC.length;

  if (result.failingCriteria.length > 0) {
    lines.push('', `Failing release criteria (${result.failingCriteria.length}/${totalCriteria}):`);
    for (const item of result.failingCriteria) {
      lines.push(`  - ${item.id} (${item.label}): observed ${formatMetricValue(item.observed)}, required ${item.requirement}`);
    }
  }

  if (result.passingCriteria.length > 0) {
    lines.push('', `Passing release criteria (${result.passingCriteria.length}/${totalCriteria}):`);
    for (const item of result.passingCriteria) {
      lines.push(`  - ${item.id}: ${formatMetricValue(item.observed)} (required ${item.requirement})`);
    }
  }

  if (result.stderrPreview) {
    lines.push('', `Evaluator stderr preview: ${result.stderrPreview}`);
  }

  return lines.join('\n');
}

const isDirectExecution =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  const asJson = process.argv.includes('--json');
  const result = runReleasePreflight();
  if (asJson) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatPreflightSummary(result)}\n`);
  }
  if (!result.eligible) {
    process.exitCode = 1;
  }
}
