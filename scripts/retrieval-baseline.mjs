import { runRepositoryBaseline } from '../dist/eval/repositoryBaseline.js';

const report = runRepositoryBaseline(process.argv[2] === undefined ? undefined : Number(process.argv[2]), process.argv.includes('--30'));
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.passed) process.exitCode = 1;
