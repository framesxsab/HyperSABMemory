import { calibrateRepositoryTasks } from '../dist/eval/repositoryTaskEvaluation.js';

process.stdout.write(`${JSON.stringify(calibrateRepositoryTasks(process.cwd()), null, 2)}\n`);
