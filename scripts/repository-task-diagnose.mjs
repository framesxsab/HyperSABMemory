import { runRepositoryTaskEvaluation } from '../dist/eval/repositoryTaskEvaluation.js';
import * as fs from 'node:fs';

const report = runRepositoryTaskEvaluation(process.cwd(), false, true);
const output = `${JSON.stringify({
  environment: report.environment,
  corpus: report.corpus,
  retrieval: report.retrieval,
  grounded: report.grounded,
  latencyMs: report.latencyMs,
  candidatePoolRecall: report.candidatePoolRecall,
  noAnswerDiagnostics: report.noAnswerDiagnostics,
  diagnostics: report.diagnostics.filter(item => item.gold.length > 0).map(item => ({
    query: item.query,
    indexCoverage: item.indexCoverage,
    top5: item.top5.map(candidate => ({ path: candidate.path, bm25: candidate.bm25Score, exactPath: candidate.exactPathMatch, definedSymbols: candidate.identifierDefinitions, queryTermEvidence: candidate.queryTermEvidence, phraseBoost: candidate.exactPhraseBoost, pathCoverage: candidate.pathCoverage, rankingScore: candidate.rankingScore, score: candidate.totalScore })),
    recallAt20: item.top20Recall,
    recallAt50: item.top50Recall,
    gold: item.gold.map(source => ({
      path: source.path, rank: source.rank, bm25: source.bm25Score,
      exactPath: source.exactPathMatch, definedSymbols: source.identifierDefinitions,
      queryTermEvidence: source.queryTermEvidence, phraseBoost: source.exactPhraseBoost, pathCoverage: source.pathCoverage, rankingScore: source.rankingScore, freshness: source.freshness,
      lexicalCoverage: source.lexicalCoverage, grounded: source.groundedEvidenceReturned,
      excerpt: source.groundedEvidenceExcerpt,
      miss: source.missedBecause
    }))
  }))
}, null, 2)}\n`;
if (process.argv.includes('--write-report')) {
  fs.writeFileSync('docs/SPRINT_2_4_RETRIEVAL_DIAGNOSIS.json', output);
} else {
  process.stdout.write(output);
}
