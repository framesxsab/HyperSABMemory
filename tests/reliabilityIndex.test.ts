
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { captureTaskSources } from '../src/harness/taskSources.js';
import { searchGrounded } from '../src/memory/groundedSearch.js';
import { HybridSearchEngine } from '../src/memory/hybridSearch.js';
import { TemporalMemoryEngine } from '../src/memory/temporalMemory.js';

it('indexes a configurable source corpus and suppresses a changed high-ranking source', () => {
  const count = Number(process.env.HM_STRESS_FILES ?? 32);
  expect(Number.isSafeInteger(count) && count >= 2 && count <= 10000).toBe(true);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-stress-index-'));
  try {
    fs.mkdirSync(path.join(dir, 'src'));
    fs.mkdirSync(path.join(dir, '.hypersabmemory'));
    const last = 'src/module-' + (count - 1) + '.ts';
    const records = Array.from({ length: count }, (_, index) => {
      const file = 'src/module-' + index + '.ts';
      const symbol = file === last ? 'computeUniqueTariff' : 'computeOrdinaryTariff' + index;
      fs.writeFileSync(path.join(dir, file), 'export function ' + symbol + '() { return 100; }\n');
      return { id: String(index), timestamp: '2026-01-01T00:00:00.000Z', category: 'symbol', content: symbol, artifacts: [file] };
    });
    fs.writeFileSync(path.join(dir, '.hypersabmemory', 'memory_store.json'), JSON.stringify(records));
    const memory = new TemporalMemoryEngine(dir);
    expect(memory.getActive()).toHaveLength(count);
    const hybrid = new HybridSearchEngine(dir, memory);
    const query = 'Where is computeUniqueTariff defined?';
    expect(hybrid.searchRecords(query, 5)[0].artifacts).toEqual([last]);
    const refs = captureTaskSources(dir, [last]);
    expect(searchGrounded(hybrid, dir, query, refs).canAssert).toBe(true);
    const file = path.join(dir, last);
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('computeUniqueTariff', 'computeSecretTariff'));
    const after = searchGrounded(hybrid, dir, query, refs);
    expect(after.canAssert).toBe(false);
    expect(after.staleSources).toEqual(expect.arrayContaining([expect.objectContaining({ path: last, status: 'modified' })]));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
}, 30_000);
