/**
 * HyperSABMemory — MemoryBench-style local recall eval
 * OSS-safe: no AWS, no SageMaker, no paid APIs. Runs in CI via npm test / npm run eval.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MemoryRecord } from '../memory/sqliteStore.js';
import { TemporalMemoryEngine } from '../memory/temporalMemory.js';
import { HybridSearchEngine } from '../memory/hybridSearch.js';

export const RECALL_THRESHOLD = 0.8;

export interface MemoryBenchCase {
  id: string;
  category: MemoryRecord['category'];
  content: string;
  status: 'active' | 'forgotten';
  query: string;
}

/** Per-path score returned by the evaluate* helpers (recall + leak counts). */
export interface MemoryBenchScore {
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
  { id: 'f02', category: 'architecture', content: 'SNAPCOMPACT keeps context harness headers under 1500 tokens.', status: 'active', query: 'SNAPCOMPACT' },
  { id: 'f03', category: 'decision', content: 'Zep-style CONTEXTBLOCK packs dated active facts only.', status: 'active', query: 'CONTEXTBLOCK' },
  { id: 'f04', category: 'decision', content: 'FORGETGATE drops invalidated memories from query results.', status: 'active', query: 'FORGETGATE' },
  { id: 'f05', category: 'architecture', content: 'Minimal-change YAGNILITE intensity is the default for small diffs.', status: 'active', query: 'YAGNILITE' },
  { id: 'f06', category: 'decision', content: 'Adapters ingest MDINGEST formats already on disk.', status: 'active', query: 'MDINGEST' },
  { id: 'f07', category: 'architecture', content: 'AUTOINJECT writes a replaceable HyperSABMemory section marker.', status: 'active', query: 'AUTOINJECT' },
  { id: 'f08', category: 'decision', content: 'TOKENCEILING is 1500 tokens for injected harness headers.', status: 'active', query: 'TOKENCEILING' },
  { id: 'f09', category: 'symbol', content: 'STRUCTGRAPH nodes are preferred over dumping whole files.', status: 'active', query: 'STRUCTGRAPH' },
  { id: 'f10', category: 'architecture', content: 'SQLITEJSON is the local-first store until a real sqlite bind lands.', status: 'active', query: 'SQLITEJSON' },
  { id: 'f11', category: 'bug', content: 'STALEFACT said the token ceiling was 8000; this fact is forgotten.', status: 'forgotten', query: 'STALEFACT' }
];

export function scoreMemoryBench(
  queryFn: (searchTerm: string) => MemoryRecord[],
  contextBlock: string,
  cases: MemoryBenchCase[] = MEMORYBENCH_FIXTURE
): MemoryBenchScore {
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

export function seedMemoryBench(engine: TemporalMemoryEngine, cases: MemoryBenchCase[] = MEMORYBENCH_FIXTURE): void {
  for (const item of cases) {
    const record = engine.remember(item.category, item.content, [item.id]);
    if (item.status === 'forgotten') {
      engine.forget(record.id);
    }
  }
}

export function evaluateMemoryEngine(engine: TemporalMemoryEngine): MemoryBenchScore {
  return scoreMemoryBench((q) => engine.query(q), engine.getContextBlock());
}

/**
 * Gates the SHIPPED MCP query path (BM25 searchRecords), not just the
 * substring fallback — keeps the eval from testing a dead path.
 */
export function evaluateSearchRecordsPath(hybrid: HybridSearchEngine, contextBlock: string): MemoryBenchScore {
  return scoreMemoryBench((q) => hybrid.searchRecords(q), contextBlock);
}

export interface FusionPathReport {
  recall: number;
  forgottenLeaks: number;
  passed: boolean;
}

/**
 * Gates the fused memory+graph search() leg. Graph leg is empty in a
 * tmp fixture dir, so memory hits alone decide recall deterministically.
 */
export function evaluateFusionPath(hybrid: HybridSearchEngine): FusionPathReport {
  const active = MEMORYBENCH_FIXTURE.filter((c) => c.status === 'active');
  const forgotten = MEMORYBENCH_FIXTURE.filter((c) => c.status === 'forgotten');

  let recalled = 0;
  for (const item of active) {
    const hits = hybrid.search(item.query);
    if (hits.some((h) => h.source === 'memory' && h.snippet.toLowerCase().includes(item.query.toLowerCase()))) {
      recalled += 1;
    }
  }

  let forgottenLeaks = 0;
  for (const item of forgotten) {
    const hits = hybrid.search(item.query);
    if (hits.some((h) => h.source === 'memory')) forgottenLeaks += 1;
  }

  const recall = active.length === 0 ? 1 : recalled / active.length;
  return { recall, forgottenLeaks, passed: recall >= RECALL_THRESHOLD && forgottenLeaks === 0 };
}

export interface MemoryBenchPathResult {
  name: 'direct-engine' | 'keyword-bm25' | 'fused-memory-graph';
  recall: number;
  forgottenLeaks: number;
  contextBlockLeaks: number;
  passed: boolean;
}

export interface MemoryBenchReport {
  generatedAt: string;
  fixtureSize: number;
  threshold: number;
  paths: MemoryBenchPathResult[];
  allPassed: boolean;
}

/**
 * Runs all three retrieval-path gates on a throwaway fixture store and returns
 * the achieved numbers per path (not just pass/fail). The fused leg never
 * touches the Context Block, so its block-leak count is 0 by construction.
 */
export function runMemoryBenchReport(): MemoryBenchReport {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-bench-report-'));
  try {
    const engine = new TemporalMemoryEngine(dir);
    seedMemoryBench(engine);
    const hybrid = new HybridSearchEngine(dir, engine);

    const direct = evaluateMemoryEngine(engine);
    const searchRecords = evaluateSearchRecordsPath(hybrid, engine.getContextBlock());
    const fusion = evaluateFusionPath(hybrid);

    const paths: MemoryBenchPathResult[] = [
      {
        name: 'direct-engine',
        recall: direct.recall,
        forgottenLeaks: direct.forgottenLeaks,
        contextBlockLeaks: direct.contextBlockLeaks,
        passed: direct.passed
      },
      {
        name: 'keyword-bm25',
        recall: searchRecords.recall,
        forgottenLeaks: searchRecords.forgottenLeaks,
        contextBlockLeaks: searchRecords.contextBlockLeaks,
        passed: searchRecords.passed
      },
      {
        name: 'fused-memory-graph',
        recall: fusion.recall,
        forgottenLeaks: fusion.forgottenLeaks,
        contextBlockLeaks: 0,
        passed: fusion.passed
      }
    ];

    return {
      generatedAt: new Date().toISOString(),
      fixtureSize: MEMORYBENCH_FIXTURE.length,
      threshold: RECALL_THRESHOLD,
      paths,
      allPassed: paths.every((p) => p.passed)
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
