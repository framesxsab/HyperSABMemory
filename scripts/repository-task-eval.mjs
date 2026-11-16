import { runRepositoryTaskEvaluation } from '../dist/eval/repositoryTaskEvaluation.js';

const report = runRepositoryTaskEvaluation(process.cwd());
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.passed) process.exitCode = 1;
