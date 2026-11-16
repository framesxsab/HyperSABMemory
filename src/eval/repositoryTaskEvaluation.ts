import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { performance } from 'node:perf_hooks';
import { HybridSearchEngine, tokenizeSearchQuery, tokenizeSearchText } from '../memory/hybridSearch.js';
import { TemporalMemoryEngine } from '../memory/temporalMemory.js';
import { GROUNDED_SUPPORT_THRESHOLD, lexicalSupport, searchGrounded } from '../memory/groundedSearch.js';
import { captureTaskSources, discoverProjectSources, inspectTaskSources } from '../harness/taskSources.js';
import type { MemoryRecord } from '../memory/sqliteStore.js';
import { DEVELOPMENT, HELD_OUT, type RepositoryTaskCase } from './repositoryTaskFixture.js';

const mean = (numbers: number[]) => numbers.reduce((a, b) => a + b, 0) / numbers.length;

/** Held-out source-file benchmark. Development examples are selected by a separate call. */
export function runRepositoryTaskEvaluation(
  root: string,
  development = false,
  diagnostics = false,
  developmentCases?: readonly RepositoryTaskCase[]
) {
  if (developmentCases && !development) throw new Error('custom task cases may only replace the development fixture');
  const queries = developmentCases ?? (development ? DEVELOPMENT : HELD_OUT);
  const paths: string[] = [];
  const walk = (relative: string): void => {
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
      const filename = path.posix.join(relative, entry.name);
      if (entry.isSymbolicLink() || filename === 'src/eval') continue;
      if (entry.isDirectory()) walk(filename);
      else if (entry.isFile() && filename.endsWith('.ts') && !['tests/repositoryTaskEvaluation.test.ts', 'tests/groundedSearch.test.ts'].includes(filename)) paths.push(filename);
    }
  };
  walk('src');
  walk('tests');
  const projectDocuments = new Set(['Architecture.md']);
  for (const source of discoverProjectSources(root)) {
    if (projectDocuments.has(source.path) && source.status === 'current') paths.push(source.path);
  }
  paths.sort();
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-repo-tasks-'));
  try {
    const directory = path.join(workspace, '.hypersabmemory');
    fs.mkdirSync(directory);
    const records: MemoryRecord[] = paths.map(filename => ({
      id: filename,
      category: 'architecture',
      content: fs.readFileSync(path.join(root, filename), 'utf8'),
      artifacts: [filename],
      status: 'active',
      timestamp: '2026-10-27T00:00:00.000Z'
    }));
    records.push({
      id: 'forgotten-fixture',
      category: 'general',
      content: 'Confidential enterprise contract production database password',
      status: 'forgotten',
      timestamp: '2026-10-27T00:00:00.000Z'
    });
    fs.writeFileSync(path.join(directory, 'memory_store.json'), JSON.stringify(records));
    const hybrid = new HybridSearchEngine(workspace, new TemporalMemoryEngine(workspace));
    const sources = paths.flatMap(filename => captureTaskSources(root, [filename]));
    const results = queries.map(item => ({
      ...item,
      returnedIds: hybrid.searchRecords(item.query, 5).map(record => record.id),
      grounded: searchGrounded(hybrid, root, item.query, sources)
    }));
    const diagnosticsByQuery = diagnostics ? queries.map(item => {
      const candidates = hybrid.searchRecordsWithScores(item.query, 50);
      const sourceByPath = new Map(sources.map(source => [source.path, source]));
      const gold = item.relevantPaths.map(filename => {
        const rank = candidates.findIndex(candidate => candidate.record.artifacts?.includes(filename));
        const candidate = rank < 0 ? undefined : candidates[rank];
        const source = sourceByPath.get(filename);
        const freshness = source ? inspectTaskSources(root, [source])[0] : undefined;
        const support = fs.existsSync(path.join(root, filename))
          ? lexicalSupport(item.query, fs.readFileSync(path.join(root, filename), 'utf8'), candidate?.queryTermEvidence)
          : 0;
        return {
          path: filename,
          indexed: paths.includes(filename),
          rank: rank < 0 ? null : rank + 1,
          bm25Score: candidate?.bm25Score ?? null,
          queryTermEvidence: candidate?.queryTermEvidence ?? [],
          exactPathMatch: candidate?.exactPathMatch ?? false,
          identifierDefinitions: candidate?.identifierDefinitions ?? [],
          exactPhraseBoost: candidate?.exactPhraseBoost ?? null,
          pathCoverage: candidate?.pathCoverage ?? null,
          rankingScore: candidate?.rankingScore ?? null,
          totalScore: candidate?.score ?? null,
          freshness: freshness?.status ?? 'missing_reference',
          lexicalCoverage: support,
          groundedEvidenceReturned: results.find(result => result.query === item.query)?.grounded.evidence.some(evidence => evidence.source.path === filename) ?? false,
          groundedEvidenceExcerpt: results.find(result => result.query === item.query)?.grounded.evidence.find(evidence => evidence.source.path === filename)?.excerpt ?? null,
          missedBecause: !paths.includes(filename) ? 'missing_from_index' : !candidate ? 'no_positive_lexical_match_within_top50' : freshness?.status !== 'current' ? 'stale_or_invalid_source' : results.find(result => result.query === item.query)?.grounded.evidence.some(evidence => evidence.source.path === filename) ? 'emitted_by_grounder' : support < GROUNDED_SUPPORT_THRESHOLD ? 'grounding_threshold_rejected_candidate' : 'not_in_first_five_valid_evidence'
        };
      });
      return {
        query: item.query,
        indexCoverage: gold.filter(source => source.indexed).length / Math.max(1, gold.length),
        candidatePool: candidates.map(candidate => ({
          path: candidate.record.artifacts?.[0] ?? candidate.record.id,
          bm25Score: candidate.bm25Score,
          queryTermEvidence: candidate.queryTermEvidence,
          exactPathMatch: candidate.exactPathMatch,
          identifierDefinitions: candidate.identifierDefinitions,
          exactPhraseBoost: candidate.exactPhraseBoost
        })),
        top5: candidates.slice(0, 5).map(candidate => ({ path: candidate.record.artifacts?.[0] ?? candidate.record.id, bm25Score: candidate.bm25Score, queryTermEvidence: candidate.queryTermEvidence, exactPathMatch: candidate.exactPathMatch, identifierDefinitions: candidate.identifierDefinitions, exactPhraseBoost: candidate.exactPhraseBoost, pathCoverage: candidate.pathCoverage, rankingScore: candidate.rankingScore, totalScore: candidate.score })),
        top20Recall: gold.filter(source => source.rank !== null && source.rank <= 20).length / Math.max(1, gold.length),
        top50Recall: gold.filter(source => source.rank !== null).length / Math.max(1, gold.length),
        gold
      };
    }) : undefined;
    const rankSummary = diagnosticsByQuery ? Object.fromEntries([5, 20, 50].map(k => {
      const recalls = diagnosticsByQuery.filter(item => item.gold.length).map(item => item.gold.filter(source => source.rank !== null && source.rank <= k).length / item.gold.length);
      const found = diagnosticsByQuery.flatMap(item => item.gold).filter(source => source.rank !== null && source.rank <= k).length;
      const total = diagnosticsByQuery.flatMap(item => item.gold).length;
      return [`recallAt${k}`, { macro: mean(recalls), micro: found / total, relevantFound: found, relevantTotal: total }];
    })) : undefined;
    const noAnswerDiagnostics = diagnostics ? results.filter(item => item.relevantPaths.length === 0).map(item => ({
      query: item.query,
      queryTerms: tokenizeSearchQuery(item.query),
      top5: hybrid.searchRecordsWithScores(item.query, 5).map(candidate => {
        const documentTerms = new Set(tokenizeSearchText(candidate.record.content));
        return {
          path: candidate.record.artifacts?.[0] ?? candidate.record.id,
          score: candidate.score,
          bm25Score: candidate.bm25Score,
          matchedTerms: tokenizeSearchQuery(item.query).filter(term => documentTerms.has(term))
        };
      }),
      grounded: item.grounded.status,
      evidence: item.grounded.evidence.map(entry => ({
        path: entry.source.path,
        lexicalCoverage: entry.lexicalSupport,
        excerpt: entry.excerpt,
        matchedTerms: tokenizeSearchQuery(item.query).filter(term => new Set(tokenizeSearchText(fs.readFileSync(path.join(root, entry.source.path), 'utf8'))).has(term))
      }))
    })) : undefined;
    const answerable = results.filter(item => item.relevantPaths.length);
    const noAnswer = results.filter(item => !item.relevantPaths.length);
    const precision = answerable.map(item => item.returnedIds.filter(id => item.relevantPaths.includes(id)).length / 5);
    const recall = answerable.map(item => item.returnedIds.filter(id => item.relevantPaths.includes(id)).length / item.relevantPaths.length);
    const reciprocalRank = (items: typeof answerable, getIds: (item: typeof answerable[number]) => string[]) => mean(items.map(item => {
      const rank = getIds(item).findIndex(id => item.relevantPaths.includes(id));
      return rank < 0 ? 0 : 1 / (rank + 1);
    }));
    const maximumPrecisionAt5 = answerable.reduce((sum, item) => sum + Math.min(5, item.relevantPaths.length) / 5, 0) / answerable.length;
    const groundedPrecisionAt5 = mean(answerable.map(item => item.grounded.evidence.filter(entry => item.relevantPaths.includes(entry.record.id)).length / 5));
    const groundedRecallAt5 = mean(answerable.map(item => item.grounded.evidence.filter(entry => item.relevantPaths.includes(entry.record.id)).length / item.relevantPaths.length));
    const groundedNoAnswerFalsePositives = noAnswer.filter(item => item.grounded.canAssert).length;
    const groundedNoAnswerCandidateEvidence = noAnswer.filter(item => item.grounded.evidence.length > 0).length;
    const forgottenLeaks = results.flatMap(item => item.returnedIds).filter(id => id === 'forgotten-fixture').length;
    const totalRelevant = answerable.reduce((sum, item) => sum + item.relevantPaths.length, 0);
    const rawRelevantFound = answerable.reduce((sum, item) => sum + item.returnedIds.filter(id => item.relevantPaths.includes(id)).length, 0);
    const groundedRelevantFound = answerable.reduce((sum, item) => sum + item.grounded.evidence.filter(evidence => item.relevantPaths.includes(evidence.record.id)).length, 0);
    const rawMeanReciprocalRank = reciprocalRank(answerable, item => item.returnedIds);
    const groundedMeanReciprocalRank = reciprocalRank(answerable, item => item.grounded.evidence.map(evidence => evidence.record.id));
    const supportedResults = results.filter(item => item.grounded.canAssert);
    const supportedAssertions = supportedResults.flatMap(item => item.grounded.assertions.map(assertion => ({ ...assertion, relevant: item.relevantPaths.includes(assertion.sourcePath) })));
    const supportedAnswerCoverage = answerable.filter(item => item.grounded.canAssert).length / answerable.length;
    const correctSupportedAnswers = supportedAssertions.filter(assertion => assertion.relevant).length;
    const staleProbe = { attempted: 0, candidates: 0, flagged: 0, leaks: 0 };
    for (const item of answerable) {
      const candidates = hybrid.searchRecordsWithScores(item.query, 50);
      const filename = item.relevantPaths.find(source => candidates.some(candidate => candidate.record.artifacts?.includes(source)));
      staleProbe.attempted++;
      if (!filename) continue;
      staleProbe.candidates++;
      const destination = path.join(workspace, filename);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      const original = fs.readFileSync(path.join(root, filename));
      fs.writeFileSync(destination, original);
      const reference = captureTaskSources(workspace, [filename]);
      const changed = Buffer.from(original);
      if (!changed.length) continue;
      changed[0] ^= 1;
      fs.writeFileSync(destination, changed);
      const result = searchGrounded(hybrid, workspace, item.query, reference);
      if (result.staleSources.some(source => source.path === filename && source.status === 'modified')) staleProbe.flagged++;
      staleProbe.leaks += result.evidence.filter(evidence => evidence.source.path === filename).length;
      staleProbe.leaks += result.assertions.filter(assertion => assertion.sourcePath === filename).length;
    }
    const staleSourceTested = staleProbe.attempted > 0 && staleProbe.flagged === staleProbe.attempted;
    const samples: number[] = [];
    for (const item of queries) {
      searchGrounded(hybrid, root, item.query, sources);
      for (let i = 0; i < 5; i++) {
        const start = performance.now();
        searchGrounded(hybrid, root, item.query, sources);
        samples.push(performance.now() - start);
      }
    }
    samples.sort((a, b) => a - b);
    const percentile = (p: number) => samples[Math.ceil(samples.length * p) - 1];
    return {
      environment: { node: process.version, platform: process.platform, arch: process.arch },
      corpus: { records: records.length, realSourceFiles: paths.length, syntheticDistractors: 0 },
      methodology: { reviewed: !development, warmupsPerQuery: 1, samplesPerQuery: 5, answerability: 'experimental lexical heuristic; not semantic proof', staleSourceTested },
      staleProbe,
      retrieval: {
        answerableQueries: answerable.length,
        noAnswerQueries: noAnswer.length,
        precisionAt5: mean(precision),
        recallAt5: mean(recall),
        microPrecisionAt5: rawRelevantFound / (answerable.length * 5),
        microRecallAt5: rawRelevantFound / totalRelevant,
        meanReciprocalRank: rawMeanReciprocalRank,
        relevantReturned: rawRelevantFound,
        relevantTotal: totalRelevant,
        maximumPrecisionAt5,
        precisionGateValid: maximumPrecisionAt5 >= 0.5,
        noAnswerFalsePositives: noAnswer.filter(item => item.returnedIds.length > 0).length,
        answerableCoverage: answerable.filter(item => item.returnedIds.length > 0).length / answerable.length,
        incorrectFirstResultRate: results.filter(item => item.returnedIds.length > 0 && !item.relevantPaths.includes(item.returnedIds[0])).length / results.length,
        forgottenLeaks
      },
      grounded: {
        precisionAt5: groundedPrecisionAt5,
        recallAt5: groundedRecallAt5,
        microPrecisionAt5: groundedRelevantFound / (answerable.length * 5),
        microRecallAt5: groundedRelevantFound / totalRelevant,
        meanReciprocalRank: groundedMeanReciprocalRank,
        relevantReturned: groundedRelevantFound,
        relevantTotal: totalRelevant,
        noAnswerCandidateRate: groundedNoAnswerCandidateEvidence / noAnswer.length,
        noAnswerUnsupportedAssertionRate: groundedNoAnswerFalsePositives / noAnswer.length,
        noAnswerFalsePositives: groundedNoAnswerFalsePositives,
        noAnswerCandidateEvidence: groundedNoAnswerCandidateEvidence,
        answerableCandidateCoverage: answerable.filter(item => item.grounded.evidence.length > 0).length / answerable.length,
        supportedAnswerCoverage,
        verifiedSupportedAssertions: supportedAssertions.length,
        correctSupportedAnswers,
        correctSupportedAnswerRate: supportedAssertions.length ? correctSupportedAnswers / supportedAssertions.length : null,
        unsupportedAssertions: supportedAssertions.length - correctSupportedAnswers,
        unsupportedCandidateRate: results.filter(item => item.grounded.evidence.length > 0 && !item.grounded.evidence.some(entry => item.relevantPaths.includes(entry.record.id))).length / results.length
      },
      latencyMs: { samples: samples.length, p50: percentile(0.5), p95: percentile(0.95) },
      passed: maximumPrecisionAt5 >= 0.5 && mean(precision) >= 0.5 && mean(recall) >= 0.85 && groundedRecallAt5 >= 0.85 && groundedPrecisionAt5 >= 0.5 && groundedNoAnswerFalsePositives <= 1 && supportedAnswerCoverage > 0 && forgottenLeaks === 0 && staleSourceTested && staleProbe.leaks === 0 && samples.length > 0 && percentile(0.95) < 100,
      ...(rankSummary ? { candidatePoolRecall: rankSummary } : {}),
      ...(diagnosticsByQuery ? { diagnostics: diagnosticsByQuery } : {}),
      ...(noAnswerDiagnostics ? { noAnswerDiagnostics } : {}),
      results: results.map(item => ({
        ...item,
        grounded: {
          ...item.grounded,
          candidates: item.grounded.candidates.map(candidate => ({ ...candidate })),
          evidence: item.grounded.evidence.map(({ record, source, lexicalSupport, excerpt }) => ({
            recordId: record.id,
            source,
            lexicalSupport,
            excerpt
          }))
        }
      }))
    };
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

/** Tune only on separate development cases; outputs an unvalidated lexical diagnostic. */
export function calibrateRepositoryTasks(root: string) {
  const report = runRepositoryTaskEvaluation(root, true, true);
  const candidatePoolRecall = report.candidatePoolRecall!;
  const points = report.results.map(item => {
    const pool = report.diagnostics!.find(diagnostic => diagnostic.query === item.query)!.candidatePool;
    return {
      query: item.query,
      answerable: item.relevantPaths.length > 0,
      support: Math.max(0, ...pool.filter(candidate => fs.existsSync(path.join(root, candidate.path)))
        .map(candidate => lexicalSupport(item.query, fs.readFileSync(path.join(root, candidate.path), 'utf8'), candidate.queryTermEvidence)))
    };
  });
  const candidates = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8].map(threshold => ({
    threshold,
    falsePositives: points.filter(point => !point.answerable && point.support >= threshold).length,
    coverage: points.filter(point => point.answerable && point.support >= threshold).length / points.filter(point => point.answerable).length
  }));
  const candidateFalsePositiveBudget = Math.ceil(report.retrieval.noAnswerQueries * 0.1);
  const evidencePools = report.results.map(item => {
    const pool = report.diagnostics!.find(diagnostic => diagnostic.query === item.query)!.candidatePool;
    const candidates = pool.filter(candidate => fs.existsSync(path.join(root, candidate.path))).map(candidate => ({
      path: candidate.path,
      score: candidate.bm25Score + candidate.exactPhraseBoost,
      support: lexicalSupport(item.query, fs.readFileSync(path.join(root, candidate.path), 'utf8'), candidate.queryTermEvidence)
    }));
    return { item, candidates: candidates.filter(candidate => candidate.support >= GROUNDED_SUPPORT_THRESHOLD) };
  });
  const evidenceRanking = [0, 0.25, 0.5, 1, 2, 4].map(supportWeight => {
    const ranked = evidencePools.map(({ item, candidates }) => {
      const maxScore = Math.max(1, ...candidates.map(candidate => candidate.score));
      const top = [...candidates].sort((a, b) =>
        ((b.score / maxScore) + supportWeight * b.support) - ((a.score / maxScore) + supportWeight * a.support)
      ).slice(0, 5).map(candidate => candidate.path);
      const found = top.filter(filename => item.relevantPaths.includes(filename)).length;
      const first = top.findIndex(filename => item.relevantPaths.includes(filename));
      return {
        answerable: item.relevantPaths.length > 0,
        precision: item.relevantPaths.length ? found / 5 : 0,
        recall: item.relevantPaths.length ? found / item.relevantPaths.length : 0,
        reciprocalRank: first < 0 ? 0 : 1 / (first + 1),
        hasEvidence: top.length > 0
      };
    });
    const answerable = ranked.filter(item => item.answerable);
    const precision = mean(answerable.map(item => item.precision));
    const recall = mean(answerable.map(item => item.recall));
    return {
      supportWeight,
      precisionAt5: precision,
      recallAt5: recall,
      meanReciprocalRank: mean(answerable.map(item => item.reciprocalRank)),
      answerableCoverage: answerable.filter(item => item.hasEvidence).length / answerable.length,
      noAnswerEvidenceRate: ranked.filter(item => !item.answerable && item.hasEvidence).length / ranked.filter(item => !item.answerable).length,
      harmonicMean: precision + recall ? 2 * precision * recall / (precision + recall) : 0
    };
  });
  const selectedEvidenceRanking = [...evidenceRanking].sort((a, b) => b.harmonicMean - a.harmonicMean || b.recallAt5 - a.recallAt5 || a.supportWeight - b.supportWeight)[0];
  return {
    developmentCases: report.results.length,
    answerable: report.retrieval.answerableQueries,
    noAnswer: report.retrieval.noAnswerQueries,
    precisionAt5: report.retrieval.precisionAt5,
    recallAt5: report.retrieval.recallAt5,
    meanReciprocalRank: report.retrieval.meanReciprocalRank,
    recallAt20: candidatePoolRecall.recallAt20,
    recallAt50: candidatePoolRecall.recallAt50,
    evidenceRanking,
    selectedEvidenceRanking,
    points,
    candidates,
    candidateFalsePositiveBudget,
    selected: candidates.filter(row => row.falsePositives <= candidateFalsePositiveBudget).sort((a, b) => b.coverage - a.coverage || a.falsePositives - b.falsePositives || b.threshold - a.threshold)[0] ?? null,
    verifiedSupportedAssertions: report.grounded.verifiedSupportedAssertions,
    supportedAnswerCoverage: report.grounded.supportedAnswerCoverage
  };
}
