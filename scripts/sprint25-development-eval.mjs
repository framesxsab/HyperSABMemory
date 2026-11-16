import { runRepositoryTaskEvaluation } from '../dist/eval/repositoryTaskEvaluation.js';
import { SPRINT25_DEVELOPMENT } from '../dist/eval/sprint25DevelopmentFixture.js';

const report = runRepositoryTaskEvaluation(process.cwd(), true, true, SPRINT25_DEVELOPMENT);
const answerable = SPRINT25_DEVELOPMENT.filter(item => item.relevantPaths.length);
const maximumPrecisionAt5 = answerable.reduce((sum, item) => sum + Math.min(5, item.relevantPaths.length) / 5, 0) / answerable.length;
process.stdout.write(`${JSON.stringify({ maximumPrecisionAt5, methodology: report.methodology, staleProbe: report.staleProbe, retrieval: report.retrieval, grounded: report.grounded, latencyMs: report.latencyMs, passed: report.passed, diagnostics: report.diagnostics.map(item => ({ query: item.query, maximumRelevantRank: Math.max(...item.gold.map(source => source.rank ?? 0)), gold: item.gold.map(source => ({ path: source.path, rank: source.rank, missedBecause: source.missedBecause })) })) }, null, 2)}\n`);
