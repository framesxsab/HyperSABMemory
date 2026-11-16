import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import assert from 'node:assert/strict';
import { captureTaskSources } from '../dist/harness/taskSources.js';
import { HybridSearchEngine } from '../dist/memory/hybridSearch.js';
import { TemporalMemoryEngine } from '../dist/memory/temporalMemory.js';
import { searchGrounded } from '../dist/memory/groundedSearch.js';

const cases = [
  { symbol: 'HybridSearchEngine', source: 'src/memory/hybridSearch.ts' },
  { symbol: 'TaskLedger', source: 'src/memory/taskLedger.ts' },
  { symbol: 'TemporalMemoryEngine', source: 'src/memory/temporalMemory.ts' },
  { symbol: 'TaskSourceError', source: 'src/harness/taskSources.ts' }
];
const root = process.cwd();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-assert-eval-'));
try {
  fs.mkdirSync(path.join(dir, '.hypersabmemory'));
  const records = cases.map(({ source }) => ({ id: source, category: 'architecture', content: fs.readFileSync(path.join(root, source), 'utf8'), artifacts: [source], status: 'active', timestamp: '2026-10-27T00:00:00.000Z' }));
  fs.writeFileSync(path.join(dir, '.hypersabmemory', 'memory_store.json'), JSON.stringify(records));
  const refs = captureTaskSources(root, cases.map(item => item.source));
  const hybrid = new HybridSearchEngine(dir, new TemporalMemoryEngine(dir));
  const results = cases.map(({ symbol, source }) => {
    const result = searchGrounded(hybrid, root, `Which file defines \`${symbol}\`?`, refs);
    return { symbol, expected: source, canAssert: result.canAssert, actual: result.assertions.map(item => item.sourcePath), correct: result.assertions.length === 1 && result.assertions[0].sourcePath === source && result.assertions[0].excerpt.includes(symbol) };
  });
  const missing = searchGrounded(hybrid, root, 'Which file defines `DefinitelyAbsentWidget`?', refs);
  const conflict = searchGrounded(hybrid, root, 'Which file defines `TaskLedger`?', refs, ['src/memory/taskLedger.ts']);
  assert(results.every(result => result.correct));
  assert.equal(missing.canAssert, false);
  assert.equal(conflict.canAssert, false);
  assert.equal(conflict.status, 'CONFLICTING_EVIDENCE');
  console.log(JSON.stringify({ eligibleCases: results.length, correct: results.filter(item => item.correct).length, unsupportedAssertions: Number(missing.canAssert) + Number(conflict.canAssert), missingAbstained: !missing.canAssert, callerDeclaredConflictDetected: conflict.status === 'CONFLICTING_EVIDENCE', results }, null, 2));
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
