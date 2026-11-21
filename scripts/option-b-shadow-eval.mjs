import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evalModulePath = path.join(repoRoot, 'dist', 'eval', 'repositoryTaskEvaluation.js');

if (!existsSync(evalModulePath)) {
  process.stderr.write(`Missing compiled evaluator at ${evalModulePath}. Run "npm run build" first.\n`);
  process.exit(1);
}

const { runRepositoryTaskEvaluation } = await import(pathToFileURL(evalModulePath).href);
const manifest = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const report = runRepositoryTaskEvaluation(repoRoot);

/**
 * Shadow-mode candidate evaluation for proposed Option B (evidence-harness contract).
 * INFORMATIONAL ONLY: does not modify official release gates and NEVER authorizes release.
 */
const assessment = {
  mode: 'SHADOW_CANDIDATE_INFORMATIONAL_ONLY',
  authorizesRelease: false,
  officialReleaseStatus: 'NO-GO',
  governanceNotice:
    'Option B is NOT approved by the product owner. This shadow report is diagnostic only and cannot override scripts/release-preflight.mjs.',
  package: {
    name: manifest.name,
    version: manifest.version
  },
  environment: report.environment,
  officialFrozenEvaluator: {
    passed: report.passed,
    corpus: report.corpus,
    latencyMs: report.latencyMs
  },
  separatedSignals: {
    rawRetrieval: {
      precisionAt5: report.retrieval.precisionAt5,
      recallAt5: report.retrieval.recallAt5,
      microPrecisionAt5: report.retrieval.microPrecisionAt5,
      microRecallAt5: report.retrieval.microRecallAt5,
      meanReciprocalRank: report.retrieval.meanReciprocalRank,
      relevantReturned: report.retrieval.relevantReturned,
      relevantTotal: report.retrieval.relevantTotal,
      noAnswerFalsePositives: report.retrieval.noAnswerFalsePositives,
      noAnswerQueries: report.retrieval.noAnswerQueries,
      answerableCoverage: report.retrieval.answerableCoverage,
      incorrectFirstResultRate: report.retrieval.incorrectFirstResultRate,
      forgottenLeaks: report.retrieval.forgottenLeaks
    },
    groundedRetrieval: {
      precisionAt5: report.grounded.precisionAt5,
      recallAt5: report.grounded.recallAt5,
      microPrecisionAt5: report.grounded.microPrecisionAt5,
      microRecallAt5: report.grounded.microRecallAt5,
      meanReciprocalRank: report.grounded.meanReciprocalRank,
      relevantReturned: report.grounded.relevantReturned,
      relevantTotal: report.grounded.relevantTotal,
      answerableCandidateCoverage: report.grounded.answerableCandidateCoverage,
      noAnswerCandidateRate: report.grounded.noAnswerCandidateRate,
      noAnswerCandidateEvidence: report.grounded.noAnswerCandidateEvidence,
      unsupportedCandidateRate: report.grounded.unsupportedCandidateRate
    },
    answerSynthesis: {
      supportedAnswerCoverage: report.grounded.supportedAnswerCoverage,
      verifiedSupportedAssertions: report.grounded.verifiedSupportedAssertions,
      unsupportedAssertions: report.grounded.unsupportedAssertions,
      noAnswerFalsePositives: report.grounded.noAnswerFalsePositives,
      noAnswerUnsupportedAssertionRate: report.grounded.noAnswerUnsupportedAssertionRate
    }
  },
  candidateDimensions: [
    {
      dimension: 'deterministic_claim_correctness',
      scope: 'harness_verification',
      status: 'SUPPORTED_BY_LOCAL_TESTS',
      evidenceSource: 'tests/groundedSearch.test.ts + scripts/sprint37-grounding-bench.mjs (9/9 MCP checks)',
      observed: {
        unsupportedAssertionsOnHeldOut: report.grounded.unsupportedAssertions,
        noAnswerUnsupportedAssertionRate: report.grounded.noAnswerUnsupportedAssertionRate
      },
      thresholdApproval: 'PROPOSED_CANDIDATE (0 unsupported assertions, 100% deterministic claim suite)'
    },
    {
      dimension: 'source_provenance',
      scope: 'harness_verification',
      status: 'SUPPORTED_BY_LOCAL_TESTS',
      evidenceSource: 'tests/groundedSearch.test.ts + scripts/package-smoke.mjs + scripts/sprint37-grounding-bench.mjs',
      observed: 'Citations carry 64-hex current sha256, freshness status, and verified line/excerpt when unique',
      thresholdApproval: 'PROPOSED_CANDIDATE'
    },
    {
      dimension: 'freshness_and_same_size_rewrite_protection',
      scope: 'harness_verification',
      status: 'SUPPORTED_BY_LOCAL_TESTS',
      evidenceSource: 'repositoryTaskEvaluation staleProbe + tests/groundedSearch.test.ts + tests/temporalMemory.test.ts',
      observed: {
        staleSourceTested: report.methodology.staleSourceTested,
        staleProbe: report.staleProbe
      },
      thresholdApproval: 'PROPOSED_CANDIDATE (100% stale flagged, 0 stale leaks, same-size rewrite detected)'
    },
    {
      dimension: 'forgotten_memory_exclusion',
      scope: 'harness_verification',
      status: 'SUPPORTED_BY_LOCAL_TESTS',
      evidenceSource: 'repositoryTaskEvaluation + tests/memorybench.test.ts + scripts/sprint37-grounding-bench.mjs',
      observed: {
        forgottenLeaks: report.retrieval.forgottenLeaks
      },
      thresholdApproval: 'PROPOSED_CANDIDATE (0 forgotten leaks across all paths)'
    },
    {
      dimension: 'conflict_abstention',
      scope: 'harness_verification',
      status: 'SUPPORTED_BY_LOCAL_TESTS',
      evidenceSource: 'tests/groundedSearch.test.ts + scripts/package-smoke.mjs',
      observed: 'Caller-declared conflicts, duplicate hash mismatches, and conflicting constraints return CONFLICTING_EVIDENCE with canAssert=false',
      thresholdApproval: 'PROPOSED_CANDIDATE'
    },
    {
      dimension: 'explicit_cross_file_relationships',
      scope: 'harness_verification',
      status: 'SUPPORTED_BY_LOCAL_TESTS',
      evidenceSource: 'tests/groundedSearch.test.ts + scripts/package-smoke.mjs + scripts/sprint37-grounding-bench.mjs',
      observed: 'Explicit Decision-Source markdown links verified only when both endpoints are current and unambiguous',
      thresholdApproval: 'PROPOSED_CANDIDATE'
    },
    {
      dimension: 'implementation_and_test_evidence',
      scope: 'harness_verification',
      status: 'SUPPORTED_BY_LOCAL_TESTS',
      evidenceSource: 'tests/implementationEvidence.test.ts + tests/groundedSearch.test.ts + scripts/package-smoke.mjs',
      observed: 'AST + TypeScript TypeChecker value-import linking with execution="unverified" and mid-check mutation rejection',
      thresholdApproval: 'PROPOSED_CANDIDATE'
    },
    {
      dimension: 'task_restoration',
      scope: 'harness_verification',
      status: 'SUPPORTED_BY_LOCAL_TESTS',
      evidenceSource: 'tests/taskLedger.test.ts + tests/taskProcesses.test.ts + tests/taskAnswerBundle.test.ts + scripts/sprint36-handoff-bench.mjs',
      observed: 'Lease-fenced checkpointing and one-call compact task_context restoration (~15.9-16.4 ms p95, 65.3-65.4% payload reduction)',
      thresholdApproval: 'PROPOSED_CANDIDATE'
    },
    {
      dimension: 'mcp_packaging_and_cross_platform',
      scope: 'packaging_and_portability',
      status: 'PARTIALLY_VERIFIED_LOCAL_WINDOWS_ONLY',
      evidenceSource: 'scripts/package-smoke.mjs + .github/workflows/ci.yml + .github/workflows/release.yml',
      observed: 'Local Windows packed tarball smoke and 9/9 MCP regression pass; Linux and macOS native better-sqlite3 portability not executed remotely in this sprint',
      thresholdApproval: 'UNAPPROVED (requires remote Linux/Windows/macOS CI verification before any release)'
    },
    {
      dimension: 'search_and_handoff_latency',
      scope: 'harness_verification',
      status: 'SUPPORTED_BY_LOCAL_BENCHMARKS',
      evidenceSource: 'repositoryTaskEvaluation + scripts/sprint36-handoff-bench.mjs + scripts/sprint37-grounding-bench.mjs',
      observed: {
        repositoryTaskEvalP50Ms: +report.latencyMs.p50.toFixed(2),
        repositoryTaskEvalP95Ms: +report.latencyMs.p95.toFixed(2),
        meets100MsTarget: report.latencyMs.p95 < 100
      },
      thresholdApproval: 'PROPOSED_CANDIDATE (p95 < 100 ms on held-out workload)'
    },
    {
      dimension: 'retrieval_quality_bounded_top5',
      scope: 'retrieval_quality',
      status: 'UNAPPROVED',
      evidenceSource: 'repositoryTaskEvaluation (30 HELD_OUT queries)',
      observed: {
        note: 'answerableCandidateCoverage=1.0 is NOT sufficient to certify retrieval quality; bounded top-5 recall/precision and unanswerable noise remain weak',
        rawPrecisionAt5: +report.retrieval.precisionAt5.toFixed(4),
        rawRecallAt5: +report.retrieval.recallAt5.toFixed(4),
        rawMrr: +report.retrieval.meanReciprocalRank.toFixed(4),
        rawNoAnswerFalsePositives: report.retrieval.noAnswerFalsePositives,
        groundedPrecisionAt5: +report.grounded.precisionAt5.toFixed(4),
        groundedRecallAt5: +report.grounded.recallAt5.toFixed(4),
        groundedMrr: +report.grounded.meanReciprocalRank.toFixed(4),
        groundedNoAnswerCandidateRate: +report.grounded.noAnswerCandidateRate.toFixed(4),
        groundedUnsupportedCandidateRate: +report.grounded.unsupportedCandidateRate.toFixed(4)
      },
      thresholdApproval:
        `UNAPPROVED — grounded recall@5 (${report.grounded.recallAt5.toFixed(4)}) still omits ~${Math.round((1 - report.grounded.recallAt5) * 100)}% of relevant files in top-5 and surfaces candidate evidence on ${Math.round(report.grounded.noAnswerCandidateRate * 100)}% (${report.grounded.noAnswerCandidateEvidence}/${report.retrieval.noAnswerQueries}) of unanswerable queries; lowering thresholds without product-owner approval or further retrieval improvement is rejected`
    },
    {
      dimension: 'end_to_end_agent_use',
      scope: 'agent_reasoning',
      status: 'UNAPPROVED',
      evidenceSource: 'docs/SPRINT_3_5_CROSS_SESSION_VALUE.md + docs/SPRINT_3_6_HANDOFF_EFFICIENCY.md',
      observed: {
        historicalContextAcceptedPatches: '2/2 (vs 0/2 repository-only) on Sprint 3.5 tasks; 1/1 compact handoff on Sprint 3.6',
        limitations: 'Small sample (n=2 tasks), post-hoc scorer corrections in Sprint 3.5, and initial deadline hit on Task B'
      },
      thresholdApproval:
        'UNAPPROVED — sample size (n=2) is insufficient to establish general agent reliability or justify production release'
    }
  ],
  summary: {
    candidateContractPassing: false,
    unapprovedOrUnverifiedDimensions: [
      'mcp_packaging_and_cross_platform',
      'retrieval_quality_bounded_top5',
      'end_to_end_agent_use'
    ],
    blockingNote:
      'Even under shadow Option B evaluation, retrieval quality thresholds, cross-platform remote CI, and multi-task agent reliability remain UNAPPROVED/UNVERIFIED. Official release status remains NO-GO.'
  }
};

process.stdout.write(`${JSON.stringify(assessment, null, 2)}\n`);
