
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const iterations = Number(process.argv[2] ?? 2);
const files = Number(process.argv[3] ?? 64);
assert.ok(Number.isSafeInteger(iterations) && iterations >= 1 && iterations <= 1000, 'iterations must be 1 to 1000');
assert.ok(Number.isSafeInteger(files) && files >= 2 && files <= 10000, 'indexed files must be 2 to 10000');

const suites = [
  'concurrency', 'atomicStoreWrites', 'taskProcesses', 'taskSources',
  'storeContainment', 'groundedSearch', 'reliabilityIndex'
].map(suite => 'tests/' + suite + '.test.ts');
const temp = mkdtempSync(path.join(os.tmpdir(), 'hm-stress-'));
const report = { schemaVersion: 1, fixture: 'synthetic', iterations, files, suites, runs: [], passed: false };
try {
  for (let iteration = 1; iteration <= iterations; iteration++) {
    const output = path.join(temp, iteration + '.json');
    const started = performance.now();
    const result = spawnSync(process.execPath, [
      path.join(root, 'node_modules/vitest/vitest.mjs'), 'run', '--maxWorkers=2',
      '--reporter=json', '--outputFile=' + output, ...suites
    ], { cwd: root, env: { ...process.env, HM_STRESS_FILES: String(files) }, encoding: 'utf8', timeout: 180_000, maxBuffer: 8 * 1024 * 1024 });
    const run = { iteration, durationMs: Math.round(performance.now() - started), exitCode: result.status, signal: result.signal, passed: false };
    report.runs.push(run);
    try {
      const parsed = existsSync(output) ? JSON.parse(readFileSync(output, 'utf8')) : {};
      run.tests = parsed.numTotalTests;
      run.passing = parsed.numPassedTests;
      run.failures = parsed.testResults?.flatMap(suite => {
        const failures = suite.assertionResults.filter(test => test.status === 'failed')
          .map(test => ({ test: test.fullName, messages: test.failureMessages }));
        return failures.length || suite.status !== 'failed'
          ? failures
          : [{ test: suite.name, messages: [suite.message] }];
      }) ?? [];
      run.passed = result.status === 0 && parsed.success === true && parsed.numTotalTests > 0;
      if (!run.passed) {
        run.error = result.error?.message ?? result.stderr?.trim() ?? '';
        if (!run.failures.length) run.output = result.stdout?.trim();
      }
    } catch (error) {
      run.error = error.message;
    }
  }
  report.passed = report.runs.every(run => run.passed);
} finally {
  rmSync(temp, { recursive: true, force: true, maxRetries: 5 });
}
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
if (!report.passed) process.exitCode = 1;
