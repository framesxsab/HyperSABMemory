import { runRepositoryTaskEvaluation } from '../dist/eval/repositoryTaskEvaluation.js';
import { tokenizeSearchText, tokenizeSearchQuery } from '../dist/memory/hybridSearch.js';

// Development labels only; this script does not consume held-out judgments.
const report = runRepositoryTaskEvaluation(process.cwd(), true, true);
const answerable = report.diagnostics.filter(row => row.gold.length);
const cases = answerable.map(row => {
  const terms = [...new Set(tokenizeSearchQuery(row.query))];
  const maxBm25 = Math.max(1, ...row.candidatePool.map(item => item.bm25Score + item.exactPhraseBoost));
  return { gold: new Set(row.gold.map(item => item.path)), candidates: row.candidatePool.map((item, originalRank) => {
    const pathTokens = new Set(tokenizeSearchText(item.path));
    const weights = item.queryTermEvidence;
    const total = weights.reduce((sum, term) => sum + term.idf, 0) || 1;
    return { ...item, originalRank, base: (item.bm25Score + item.exactPhraseBoost) / maxBm25,
      coverage: weights.reduce((sum, term) => sum + (term.matched ? term.idf : 0), 0) / total,
      pathCoverage: terms.filter(term => pathTokens.has(term)).length / Math.max(1, terms.length) };
  }) };
});
const results = [];
for (const coverageWeight of [0, 0.25, 0.5, 1]) for (const pathWeight of [0, 0.25, 0.5, 1]) {
  let found = 0, recall = 0, reciprocal = 0;
  for (const row of cases) {
    const top = [...row.candidates].sort((a, b) => Number(b.exactPathMatch) - Number(a.exactPathMatch) || b.identifierDefinitions.length - a.identifierDefinitions.length || (b.base + coverageWeight * b.coverage + pathWeight * b.pathCoverage) - (a.base + coverageWeight * a.coverage + pathWeight * a.pathCoverage) || a.originalRank - b.originalRank).slice(0, 5);
    const count = top.filter(item => row.gold.has(item.path)).length;
    const rank = top.findIndex(item => row.gold.has(item.path));
    found += count;
    recall += count / row.gold.size;
    reciprocal += rank < 0 ? 0 : 1 / (rank + 1);
  }
  results.push({ coverageWeight, pathWeight, precisionAt5: found / (cases.length * 5), macroRecallAt5: recall / cases.length, mrr: reciprocal / cases.length });
}
console.log(JSON.stringify({ cases: cases.length, methodology: 'development queries only, normalized BM25 plus IDF coverage and path token coverage', results }, null, 2));
