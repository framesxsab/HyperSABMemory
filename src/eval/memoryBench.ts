/**
 * HyperMemory — MemoryBench-style local recall eval
 * OSS-safe: no AWS, no SageMaker, no paid APIs. Runs in CI via npm test / npm run eval.
 */

import { MemoryRecord } from '../memory/sqliteStore.js';
import { SupermemoryEngine } from '../memory/supermemory.js';

export const RECALL_THRESHOLD = 0.8;

export interface MemoryBenchCase {
  id: string;
  category: MemoryRecord['category'];
  content: string;
  status: 'active' | 'forgotten';
  query: string;
}

export interface MemoryBenchReport {
  activeCases: number;
  recalled: number;
  recall: number;
  forgottenLeaks: number;
  contextBlockLeaks: number;
  passed: boolean;
}

/** ≥10 dated facts, ≥1 forgotten. Distinct queries so substring search is unambiguous. */
export const MEMORYBENCH_FIXTURE: MemoryBenchCase[] = [
  { id: 'f01', category: 'architecture', content: 'Harness uses HASHLINE anchors for patch targeting.', status: 'active', query: 'HASHLINE' },
  { id: 'f02', category: 'architecture', content: 'SNAPCOMPACT keeps Oh-My-Pi headers under 1500 tokens.', status: 'active', query: 'SNAPCOMPACT' },
  { id: 'f03', category: 'decision', content: 'Zep-style CONTEXTBLOCK packs dated active facts only.', status: 'active', query: 'CONTEXTBLOCK' },
  { id: 'f04', category: 'decision', content: 'FORGETGATE drops invalidated memories from query results.', status: 'active', query: 'FORGETGATE' },
  { id: 'f05', category: 'architecture', content: 'Ponytail YAGNILITE intensity is the default for small diffs.', status: 'active', query: 'YAGNILITE' },
  { id: 'f06', category: 'decision', content: 'Adapters ingest MDINGEST formats already on disk.', status: 'active', query: 'MDINGEST' },
  { id: 'f07', category: 'architecture', content: 'AUTOINJECT writes a replaceable HyperMemory section marker.', status: 'active', query: 'AUTOINJECT' },
  { id: 'f08', category: 'decision', content: 'TOKENCEILING is 1500 tokens for injected harness headers.', status: 'active', query: 'TOKENCEILING' },
  { id: 'f09', category: 'symbol', content: 'GRAPHIFYAST nodes are preferred over dumping whole files.', status: 'active', query: 'GRAPHIFYAST' },
  { id: 'f10', category: 'architecture', content: 'SQLITEJSON is the local-first store until a real sqlite bind lands.', status: 'active', query: 'SQLITEJSON' },
  { id: 'f11', category: 'bug', content: 'STALEFACT said the token ceiling was 8000; this fact is forgotten.', status: 'forgotten', query: 'STALEFACT' }
];

export function scoreMemoryBench(
  queryFn: (searchTerm: string) => MemoryRecord[],
  contextBlock: string,
  cases: MemoryBenchCase[] = MEMORYBENCH_FIXTURE
): MemoryBenchReport {
  const active = cases.filter((c) => c.status === 'active');
  const forgotten = cases.filter((c) => c.status === 'forgotten');
  const blockLower = contextBlock.toLowerCase();

  let recalled = 0;
  for (const item of active) {
    const hits = queryFn(item.query);
    if (hits.some((record) => record.content.toLowerCase().includes(item.query.toLowerCase()))) {
      recalled += 1;
    }
  }

  let forgottenLeaks = 0;
  let contextBlockLeaks = 0;
  for (const item of forgotten) {
    const hits = queryFn(item.query);
    if (hits.length > 0) forgottenLeaks += 1;
    if (blockLower.includes(item.query.toLowerCase())) contextBlockLeaks += 1;
  }

  const recall = active.length === 0 ? 1 : recalled / active.length;
  const passed =
    recall >= RECALL_THRESHOLD && forgottenLeaks === 0 && contextBlockLeaks === 0;

  return {
    activeCases: active.length,
    recalled,
    recall,
    forgottenLeaks,
    contextBlockLeaks,
    passed
  };
}

export function seedMemoryBench(engine: SupermemoryEngine, cases: MemoryBenchCase[] = MEMORYBENCH_FIXTURE): void {
  for (const item of cases) {
    const record = engine.remember(item.category, item.content, [item.id]);
    if (item.status === 'forgotten') {
      engine.forget(record.id);
    }
  }
}

export function evaluateMemoryEngine(engine: SupermemoryEngine): MemoryBenchReport {
  return scoreMemoryBench((q) => engine.query(q), engine.getContextBlock());
}
