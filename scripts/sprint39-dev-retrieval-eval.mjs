import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  rmdirSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baselineRef = '653ea07';

const workerScript = `
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

const distDir = process.env.HM_DIST_DIR;
const evalRoot = process.env.HM_EVAL_ROOT;

const { runRepositoryTaskEvaluation } = await import(pathToFileURL(path.join(distDir, 'eval', 'repositoryTaskEvaluation.js')).href);
const { DEVELOPMENT } = await import(pathToFileURL(path.join(distDir, 'eval', 'repositoryTaskFixture.js')).href);
const { SPRINT25_DEVELOPMENT } = await import(pathToFileURL(path.join(distDir, 'eval', 'sprint25DevelopmentFixture.js')).href);
const { TemporalMemoryEngine } = await import(pathToFileURL(path.join(distDir, 'memory', 'temporalMemory.js')).href);
const { HybridSearchEngine } = await import(pathToFileURL(path.join(distDir, 'memory', 'hybridSearch.js')).href);
const { captureTaskSources } = await import(pathToFileURL(path.join(distDir, 'harness', 'taskSources.js')).href);
const { searchGrounded } = await import(pathToFileURL(path.join(distDir, 'memory', 'groundedSearch.js')).href);

function evaluateDevelopmentSet(cases) {
  const report = runRepositoryTaskEvaluation(evalRoot, true, true, cases);
  const answerable = report.results.filter(r => r.relevantPaths.length > 0);
  let duplicatesInTop5 = 0;
  let top1Hits = 0;
  for (const r of answerable) {
    const evPaths = r.grounded.evidence.map(e => e.source.path);
    if (new Set(evPaths).size !== evPaths.length) duplicatesInTop5 += evPaths.length - new Set(evPaths).size;
    if (evPaths.length > 0 && r.relevantPaths.includes(evPaths[0])) top1Hits++;
  }
  return {
    queries: cases.length,
    answerableQueries: answerable.length,
    noAnswerQueries: cases.length - answerable.length,
    raw: {
      precisionAt5: +report.retrieval.precisionAt5.toFixed(4),
      recallAt5: +report.retrieval.recallAt5.toFixed(4),
      mrr: +report.retrieval.meanReciprocalRank.toFixed(4),
      relevantReturned: report.retrieval.relevantReturned,
      relevantTotal: report.retrieval.relevantTotal,
      forgottenLeaks: report.retrieval.forgottenLeaks
    },
    grounded: {
      precisionAt5: +report.grounded.precisionAt5.toFixed(4),
      recallAt5: +report.grounded.recallAt5.toFixed(4),
      mrr: +report.grounded.meanReciprocalRank.toFixed(4),
      relevantReturned: report.grounded.relevantReturned,
      relevantTotal: report.grounded.relevantTotal,
      duplicatesInTop5,
      top1HitRate: +(top1Hits / Math.max(1, answerable.length)).toFixed(4),
      answerableCandidateCoverage: +report.grounded.answerableCandidateCoverage.toFixed(4),
      noAnswerCandidateRate: +report.grounded.noAnswerCandidateRate.toFixed(4),
      unsupportedCandidateRate: +report.grounded.unsupportedCandidateRate.toFixed(4),
      unsupportedAssertions: report.grounded.unsupportedAssertions
    },
    freshness: {
      staleSourceTested: report.methodology.staleSourceTested,
      staleProbe: report.staleProbe
    },
    latencyMs: {
      samples: report.latencyMs.samples,
      p50: +report.latencyMs.p50.toFixed(2),
      p95: +report.latencyMs.p95.toFixed(2)
    },
    perQuery: report.results.map((r, index) => {
      const evPaths = r.grounded.evidence.map(e => e.source.path);
      const hits = evPaths.filter(p => r.relevantPaths.includes(p));
      const firstRank = evPaths.findIndex(p => r.relevantPaths.includes(p));
      return {
        index,
        query: r.query,
        answerable: r.relevantPaths.length > 0,
        evidencePaths: evPaths,
        relevantHits: hits,
        hitCount: hits.length,
        relevantTotal: r.relevantPaths.length,
        mrr: firstRank >= 0 ? +(1 / (firstRank + 1)).toFixed(4) : 0
      };
    })
  };
}

// Explicit relationship retrieval check on isolated fixture
function checkExplicitRelationship() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-s39-rel-'));
  try {
    fs.mkdirSync(path.join(dir, 'decisions'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'architecture'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'decisions', 'storage.md'), 'Decision: Use SQLite for task coordination.\\nRationale: Preserve atomic task transitions.\\n');
    fs.writeFileSync(path.join(dir, 'architecture', 'rules.md'), 'Decision-Source: decisions/storage.md\\nConstraint: Task updates must use a transactional coordinator.\\n');
    for (let i = 0; i < 6; i++) {
      fs.writeFileSync(path.join(dir, 'architecture', 'noise' + i + '.md'), 'storage decision rationale task update constraint overview ' + i + '\\n');
    }
    const files = ['decisions/storage.md', 'architecture/rules.md', ...Array.from({ length: 6 }, (_, i) => 'architecture/noise' + i + '.md')];
    const refs = captureTaskSources(dir, files);
    const memory = new TemporalMemoryEngine(dir);
    memory.remember('decision', 'SQLite task coordination decision and rationale', [], { artifacts: ['decisions/storage.md'] });
    memory.remember('architecture', 'Task update constraint follows storage decision', [], { artifacts: ['architecture/rules.md'] });
    for (let i = 0; i < 6; i++) {
      memory.remember('general', 'storage decision rationale task update constraint overview ' + i, [], { artifacts: ['architecture/noise' + i + '.md'] });
    }
    const hybrid = new HybridSearchEngine(dir, memory);
    const res = searchGrounded(hybrid, dir, 'What storage decision was recorded, why, and what task update constraint explicitly follows?', refs);
    return {
      status: res.status,
      canAssert: res.canAssert,
      verifiedRelationships: res.relationships?.filter(r => r.status === 'verified').length ?? 0,
      verifiedClaims: res.claims?.length ?? 0
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const combined = [...DEVELOPMENT, ...SPRINT25_DEVELOPMENT];
process.stdout.write(JSON.stringify({
  development21: evaluateDevelopmentSet(DEVELOPMENT),
  sprint25Dev21: evaluateDevelopmentSet(SPRINT25_DEVELOPMENT),
  combinedDev42: evaluateDevelopmentSet(combined),
  explicitRelationshipCheck: checkExplicitRelationship()
}));
`;

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'hm-sprint39-dev-eval-'));
const baselineRepo = path.join(tempRoot, 'baseline-repo');
const workerPath = path.join(tempRoot, 'worker.mjs');

try {
  mkdirSync(baselineRepo, { recursive: true });
  writeFileSync(workerPath, workerScript, 'utf8');

  const tarPath = path.join(tempRoot, 'baseline.tar');
  execFileSync('git', ['archive', '--format=tar', '--output', tarPath, baselineRef], { cwd: repoRoot });
  execFileSync('tar', ['-xf', tarPath, '-C', baselineRepo], { cwd: tempRoot });
  symlinkSync(path.join(repoRoot, 'node_modules'), path.join(baselineRepo, 'node_modules'), 'junction');
  execFileSync(process.execPath, [path.join(baselineRepo, 'scripts', 'build.mjs')], { cwd: baselineRepo, stdio: 'pipe' });

  const runWorker = (distDir) => {
    const out = execFileSync(process.execPath, [workerPath], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, HM_DIST_DIR: distDir, HM_EVAL_ROOT: baselineRepo },
      stdio: ['ignore', 'pipe', 'ignore']
    });
    return JSON.parse(out);
  };

  const before = runWorker(path.join(baselineRepo, 'dist'));
  const after = runWorker(path.join(repoRoot, 'dist'));

  const perQueryDiffs = [];
  for (let i = 0; i < before.combinedDev42.perQuery.length; i++) {
    const b = before.combinedDev42.perQuery[i];
    const a = after.combinedDev42.perQuery[i];
    if (b.hitCount !== a.hitCount || b.mrr !== a.mrr) {
      perQueryDiffs.push({
        index: i,
        query: b.query,
        hitsBefore: b.hitCount,
        hitsAfter: a.hitCount,
        mrrBefore: b.mrr,
        mrrAfter: a.mrr,
        gained: a.relevantHits.filter(p => !b.relevantHits.includes(p)),
        lost: b.relevantHits.filter(p => !a.relevantHits.includes(p))
      });
    }
  }

  assert.equal(after.explicitRelationshipCheck.status, 'SUPPORTED');
  assert.equal(after.explicitRelationshipCheck.canAssert, true);
  assert.equal(after.explicitRelationshipCheck.verifiedRelationships, 1);
  assert.equal(after.combinedDev42.grounded.duplicatesInTop5, 0);
  assert.equal(after.combinedDev42.raw.forgottenLeaks, 0);
  assert.equal(after.combinedDev42.freshness.staleProbe.leaks, 0);

  const stripPerQuery = (obj) => {
    const { perQuery: _p, ...rest } = obj;
    return rest;
  };

  console.log(JSON.stringify({
    baselineRef,
    matchedSnapshot: 'baselineRepo (653ea07 source snapshot, development-only queries)',
    development21: { before: stripPerQuery(before.development21), after: stripPerQuery(after.development21) },
    sprint25Dev21: { before: stripPerQuery(before.sprint25Dev21), after: stripPerQuery(after.sprint25Dev21) },
    combinedDev42: {
      before: stripPerQuery(before.combinedDev42),
      after: stripPerQuery(after.combinedDev42),
      delta: {
        groundedPrecisionAt5: +(after.combinedDev42.grounded.precisionAt5 - before.combinedDev42.grounded.precisionAt5).toFixed(4),
        groundedRecallAt5: +(after.combinedDev42.grounded.recallAt5 - before.combinedDev42.grounded.recallAt5).toFixed(4),
        groundedMrr: +(after.combinedDev42.grounded.mrr - before.combinedDev42.grounded.mrr).toFixed(4),
        groundedRelevantReturned: after.combinedDev42.grounded.relevantReturned - before.combinedDev42.grounded.relevantReturned,
        top1HitRate: +(after.combinedDev42.grounded.top1HitRate - before.combinedDev42.grounded.top1HitRate).toFixed(4)
      }
    },
    explicitRelationshipCheck: {
      before: before.explicitRelationshipCheck,
      after: after.explicitRelationshipCheck
    },
    perQueryDiffs
  }, null, 2));
} finally {
  const junction = path.join(baselineRepo, 'node_modules');
  if (existsSync(junction)) {
    try { rmdirSync(junction); } catch { try { unlinkSync(junction); } catch {} }
  }
  rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
