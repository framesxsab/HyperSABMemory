/**
 * HyperSABMemory — Eval Command Implementation
 * Prints the local benchmark report (achieved recall per retrieval path) plus
 * token economics for the current workspace store. Lives outside index.ts so
 * tests can invoke it in-process, mirroring runDoctor.
 */

import picocolors from 'picocolors';
import { TemporalMemoryEngine } from '../memory/temporalMemory.js';
import { runMemoryBenchReport } from '../eval/memoryBench.js';
import { computeTokenEfficiency } from '../eval/tokenEfficiency.js';

export function runEvalCommand(options: { json?: boolean } = {}): void {
  const bench = runMemoryBenchReport();
  const efficiency = computeTokenEfficiency(new TemporalMemoryEngine(process.cwd()));

  if (options.json) {
    console.log(JSON.stringify({ bench, efficiency }, null, 2));
    process.exitCode = bench.allPassed ? 0 : 1;
    return;
  }

  console.log(picocolors.cyan('\nHyperSABMemory - local benchmark report\n'));
  for (const row of bench.paths) {
    const mark = row.passed ? picocolors.green('[PASS]') : picocolors.red('[FAIL]');
    const recall = `${(row.recall * 100).toFixed(1)}%`;
    console.log(
      `  ${mark} ${row.name.padEnd(19)} recall ${recall}  forgotten-leaks ${row.forgottenLeaks}  context-block-leaks ${row.contextBlockLeaks}`
    );
  }

  const failed = bench.paths.filter((p) => !p.passed).length;
  if (failed === 0) {
    console.log(picocolors.green(`\nVerdict: all ${bench.paths.length} retrieval paths passed (threshold ${bench.threshold}).`));
  } else {
    console.log(picocolors.red(`\nVerdict: ${failed} of ${bench.paths.length} retrieval paths failed (threshold ${bench.threshold}).`));
  }

  console.log(
    `Token economics: ${efficiency.deliveredTokens} delivered / ${efficiency.naiveCorpusTokens} naive corpus tokens (${efficiency.savingsPct}% saved, ratio ${efficiency.compressionRatio})`
  );

  process.exitCode = bench.allPassed ? 0 : 1;
}
