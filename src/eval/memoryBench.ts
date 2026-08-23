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

export type AdversarialClassName = 'negation' | 'superseded-stale' | 'artifact-linked';

export interface AdversarialRecord {
  id: string;
  category: MemoryRecord['category'];
  content: string;
  query: string;
  role: 'expected' | 'stale' | 'chain';
  artifacts?: string[];
}

/**
 * F4 adversarial fixtures. negation: active "X dropped, migrated to Y" facts
 * plus a forgotten pure-X companion per query. superseded-stale: A←B←C chains
 * (shared >48-char prefix triggers remember()'s auto-supersede in seed order;
 * the last record per query is the chain tip C). artifact-linked: file-path
 * queries over facts carrying artifacts entries (path also in content so the
 * substring-based direct-engine path can match it).
 */
// allow: SIZE_OK — benchmark module is dominated by pure fixture data tables;
// splitting would break the single-module eval contract (concurrent-agent ownership).
export const ADVERSARIAL_CLASSES: Record<AdversarialClassName, AdversarialRecord[]> = {
  negation: [
    { id: 'n01', category: 'decision', content: 'GRPCOLD was dropped: we no longer use GRPCOLD, migrated to QUICSTREAM for transport.', query: 'GRPCOLD', role: 'expected' },
    { id: 'n01-stale', category: 'architecture', content: 'GRPCOLD powers the realtime transport layer.', query: 'GRPCOLD', role: 'stale' },
    { id: 'n02', category: 'decision', content: 'WEBPACKBUNDLE is dropped: we no longer use WEBPACKBUNDLE, migrated to ESBUILDKIT for bundling.', query: 'WEBPACKBUNDLE', role: 'expected' },
    { id: 'n02-stale', category: 'bug', content: 'WEBPACKBUNDLE rebuilds take ninety seconds.', query: 'WEBPACKBUNDLE', role: 'stale' }
  ],
  'superseded-stale': [
    { id: 's01-a', category: 'decision', content: 'STATESTORE keeps harness state in JSON files since day one; v1 wrote flat snapshots.', query: 'STATESTORE', role: 'chain' },
    { id: 's01-b', category: 'decision', content: 'STATESTORE keeps harness state in JSON files since day one; v2 moved sessions to sqlite.', query: 'STATESTORE', role: 'chain' },
    { id: 's01-c', category: 'decision', content: 'STATESTORE keeps harness state in JSON files since day one; v3 moved sessions to duckdb.', query: 'STATESTORE', role: 'chain' },
    { id: 's02-a', category: 'symbol', content: 'LOGBRIDGE routes agent logs into a single sink since day one; v1 wrote plain text files.', query: 'LOGBRIDGE', role: 'chain' },
    { id: 's02-b', category: 'symbol', content: 'LOGBRIDGE routes agent logs into a single sink since day one; v2 rotated files hourly.', query: 'LOGBRIDGE', role: 'chain' },
    { id: 's02-c', category: 'symbol', content: 'LOGBRIDGE routes agent logs into a single sink since day one; v3 ships to ducklog.', query: 'LOGBRIDGE', role: 'chain' }
  ],
  'artifact-linked': [
    { id: 'a01', category: 'architecture', content: 'REPORTBUILDER streams eval JSON from src/eval/reportBuilder.ts without buffering.', query: 'src/eval/reportBuilder.ts', role: 'expected', artifacts: ['src/eval/reportBuilder.ts'] },
    { id: 'a02', category: 'symbol', content: 'TOKENMETER renders live usage from src/dashboard/tokenMeter.ts bindings.', query: 'src/dashboard/tokenMeter.ts', role: 'expected', artifacts: ['src/dashboard/tokenMeter.ts'] },
    { id: 'a03', category: 'general', content: 'SWARMLOCK guards store writes through src/memory/fileLock.ts helpers.', query: 'src/memory/fileLock.ts', role: 'expected', artifacts: ['src/memory/fileLock.ts'] }
  ]
};

export function seedAdversarialClasses(engine: TemporalMemoryEngine): void {
  for (const records of Object.values(ADVERSARIAL_CLASSES)) {
    for (const record of records) {
      if (record.role === 'stale') continue;
      engine.remember(record.category, record.content, [record.id], record.artifacts?.length ? { artifacts: record.artifacts } : undefined);
    }
  }
  for (const records of Object.values(ADVERSARIAL_CLASSES)) {
    for (const record of records) {
      if (record.role === 'stale') engine.forget(engine.remember(record.category, record.content, [record.id]).id);
    }
  }
}

interface AdversarialExpectation {
  query: string;
  expected: string;
  stale: string[];
  requireTop: boolean;
}

function buildAdversarialExpectations(name: AdversarialClassName): AdversarialExpectation[] {
  const records = ADVERSARIAL_CLASSES[name];
  switch (name) {
    case 'negation':
    case 'artifact-linked':
      return records
        .filter((r) => r.role === 'expected')
        .map((r) => ({
          query: r.query,
          expected: r.content,
          stale: records.filter((s) => s.role === 'stale' && s.query === r.query).map((s) => s.content),
          requireTop: false
        }));
    case 'superseded-stale': {
      const chains = new Map<string, AdversarialRecord[]>();
      for (const r of records) {
        const chain = chains.get(r.query) ?? [];
        chain.push(r);
        chains.set(r.query, chain);
      }
      return Array.from(chains.values()).map((chain) => ({
        query: chain[0].query,
        expected: chain[chain.length - 1].content,
        stale: chain.slice(0, -1).map((r) => r.content),
        requireTop: true
      }));
    }
  }
}

export interface AdversarialClassScore {
  className: AdversarialClassName;
  activeCases: number;
  recalled: number;
  recall: number;
  staleLeaks: number;
  contextBlockLeaks: number;
  passed: boolean;
}

export function scoreAdversarialClass(
  name: AdversarialClassName,
  queryFn: (q: string) => Array<Pick<MemoryRecord, 'content'>>,
  contextBlock: string
): AdversarialClassScore {
  const expectations = buildAdversarialExpectations(name);
  const blockLower = contextBlock.toLowerCase();

  let recalled = 0;
  let staleLeaks = 0;
  let contextBlockLeaks = 0;
  for (const exp of expectations) {
    const hitContents = queryFn(exp.query).map((h) => h.content.toLowerCase().trim());
    const topIsExpected = hitContents.length > 0 && hitContents[0] === exp.expected.toLowerCase().trim();
    const queryPresent = hitContents.some((h) => h.includes(exp.query.toLowerCase()));
    if (exp.requireTop ? topIsExpected : queryPresent) recalled += 1;

    for (const stale of exp.stale) {
      if (hitContents.includes(stale.toLowerCase().trim())) staleLeaks += 1;
      if (blockLower.includes(stale.toLowerCase())) contextBlockLeaks += 1;
    }
  }

  const recall = expectations.length === 0 ? 1 : recalled / expectations.length;
  return {
    className: name,
    activeCases: expectations.length,
    recalled,
    recall,
    staleLeaks,
    contextBlockLeaks,
    passed: recall >= RECALL_THRESHOLD && staleLeaks === 0 && contextBlockLeaks === 0
  };
}

export interface MemoryBenchPathResult {
  name: 'direct-engine' | 'keyword-bm25' | 'fused-memory-graph';
  recall: number;
  forgottenLeaks: number;
  contextBlockLeaks: number;
  passed: boolean;
}

export interface MemoryBenchClassPathResult {
  name: MemoryBenchPathResult['name'];
  recall: number;
  staleLeaks: number;
  contextBlockLeaks: number;
  passed: boolean;
}

export interface MemoryBenchClassResult {
  name: AdversarialClassName;
  paths: MemoryBenchClassPathResult[];
  passed: boolean;
}

export interface MemoryBenchReport {
  generatedAt: string;
  fixtureSize: number;
  threshold: number;
  paths: MemoryBenchPathResult[];
  /**
   * --json only: F4 adversarial per-class breakdown. Each class reports the
   * same three retrieval paths as `paths` (recall / staleLeaks /
   * contextBlockLeaks / passed per path). Optional so legacy report
   * constructors stay valid.
   */
  classes?: MemoryBenchClassResult[];
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
    seedAdversarialClasses(engine);
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

    const classNames: AdversarialClassName[] = ['negation', 'superseded-stale', 'artifact-linked'];
    const classes: MemoryBenchClassResult[] = classNames.map((name) => {
      const direct = scoreAdversarialClass(name, (q) => engine.query(q), engine.getContextBlock());
      const bm25 = scoreAdversarialClass(name, (q) => hybrid.searchRecords(q), engine.getContextBlock());
      const fusion = scoreAdversarialClass(
        name,
        (q) => hybrid.search(q).filter((h) => h.source === 'memory').map((h) => ({ content: h.snippet })),
        ''
      );
      const classPaths: MemoryBenchClassPathResult[] = [
        { name: 'direct-engine', recall: direct.recall, staleLeaks: direct.staleLeaks, contextBlockLeaks: direct.contextBlockLeaks, passed: direct.passed },
        { name: 'keyword-bm25', recall: bm25.recall, staleLeaks: bm25.staleLeaks, contextBlockLeaks: bm25.contextBlockLeaks, passed: bm25.passed },
        { name: 'fused-memory-graph', recall: fusion.recall, staleLeaks: fusion.staleLeaks, contextBlockLeaks: 0, passed: fusion.passed }
      ];
      return { name, paths: classPaths, passed: classPaths.every((p) => p.passed) };
    });

    return {
      generatedAt: new Date().toISOString(),
      fixtureSize: MEMORYBENCH_FIXTURE.length,
      threshold: RECALL_THRESHOLD,
      paths,
      classes,
      allPassed: paths.every((p) => p.passed) && classes.every((c) => c.passed)
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
