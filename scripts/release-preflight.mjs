import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultEvaluatorScript = path.join(repoRoot, 'scripts', 'repository-task-eval.mjs');
const defaultBuildArtifact = path.join(repoRoot, 'dist', 'eval', 'repositoryTaskEvaluation.js');

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

export function extractGateEvaluations(report) {
  const failingCriteria = [];
  const passingCriteria = [];
  for (const gate of FROZEN_GATE_SPEC) {
    const observed = gate.read(report);
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
    evaluatorScript = defaultEvaluatorScript,
    buildArtifactPath = defaultBuildArtifact,
    checkBuildArtifact = evaluatorScript === defaultEvaluatorScript,
    timeoutMs = 120_000,
    nodePath = process.execPath
  } = options;

  if (!existsSync(evaluatorScript)) {
    return {
      eligible: false,
      verdict: 'RELEASE BLOCKED — NO-GO',
      exitCode: null,
      signal: null,
      failureReasons: [
        {
          code: 'EVALUATOR_MISSING',
          detail: `Release evaluator script not found at ${evaluatorScript}`
        }
      ],
      failingCriteria: [],
      passingCriteria: [],
      reportSummary: null,
      stderrPreview: ''
    };
  }

  if (checkBuildArtifact && !existsSync(buildArtifactPath)) {
    return {
      eligible: false,
      verdict: 'RELEASE BLOCKED — NO-GO',
      exitCode: null,
      signal: null,
      failureReasons: [
        {
          code: 'MISSING_BUILD_ARTIFACT',
          detail: `Compiled evaluator artifact not found at ${buildArtifactPath}; run "npm run build" first without modifying repository gates`
        }
      ],
      failingCriteria: [],
      passingCriteria: [],
      reportSummary: null,
      stderrPreview: ''
    };
  }

  const execution = spawnSync(nodePath, [evaluatorScript], {
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

  if (result.failingCriteria.length > 0) {
    lines.push('', `Failing frozen release criteria (${result.failingCriteria.length}/${FROZEN_GATE_SPEC.length}):`);
    for (const item of result.failingCriteria) {
      lines.push(`  - ${item.id} (${item.label}): observed ${formatMetricValue(item.observed)}, required ${item.requirement}`);
    }
  }

  if (result.passingCriteria.length > 0) {
    lines.push('', `Passing frozen release criteria (${result.passingCriteria.length}/${FROZEN_GATE_SPEC.length}):`);
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
