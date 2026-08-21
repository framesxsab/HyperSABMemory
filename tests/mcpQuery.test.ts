import { describe, it, expect, afterEach } from 'vitest';
import {
  HyperMemoryMcpServer,
  mapGraphHitsToRecords,
  selectQueryRecords,
  QuerySource
} from '../src/mcp/server.js';
import { SupermemoryEngine } from '../src/memory/supermemory.js';
import { HybridSearchEngine, HybridSearchResult } from '../src/memory/hybridSearch.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const dirs: string[] = [];

function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-mcpq-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function seedMemoryFixture(dir: string): { supermemory: SupermemoryEngine; hybrid: HybridSearchEngine } {
  const supermemory = new SupermemoryEngine(dir);
  supermemory.remember('decision', 'Use BM25 plus RRF fusion for hybrid search');
  supermemory.remember('bug', 'Watcher debounce was noisy before the fix');
  const hybrid = new HybridSearchEngine(dir, supermemory);
  return { supermemory, hybrid };
}

describe('HyperMemory — Hybrid MCP Query (P7)', () => {
  it('keeps source "memory" byte-identical to the pre-change searchRecords output', () => {
    const dir = tmpDir();
    const { hybrid } = seedMemoryFixture(dir);

    const viaHelper = selectQueryRecords(hybrid, 'hybrid search', 10, 'memory');
    const direct = hybrid.searchRecords('hybrid search', 10);

    expect(JSON.stringify(viaHelper, null, 2)).toBe(JSON.stringify(direct, null, 2));
  });

  it('defaults to "all" and stays byte-identical to "memory" when the graph is empty', () => {
    const dir = tmpDir();
    const { hybrid } = seedMemoryFixture(dir);

    const all = selectQueryRecords(hybrid, 'watcher debounce', 10, 'all');
    const memory = selectQueryRecords(hybrid, 'watcher debounce', 10, 'memory');

    expect(JSON.stringify(all)).toBe(JSON.stringify(memory));
  });

  it('maps graphify hits onto synthetic MemoryRecord shape with graph_ ids', () => {
    const hits: HybridSearchResult[] = [
      {
        score: 1,
        source: 'graphify',
        title: '[CLASS] SqliteStore',
        snippet: 'AST Node: SqliteStore (class) | Dependencies: fs',
        category: 'class'
      },
      { score: 1, source: 'supermemory', title: '[DECISION] m1', snippet: 'memory leg hit' }
    ];

    const records = mapGraphHitsToRecords(hits);
    expect(records).toHaveLength(1);
    expect(records[0].id).toBe('graph_SqliteStore');
    expect(records[0].category).toBe('symbol');
    expect(records[0].content).toContain('AST Node: SqliteStore');
    expect(typeof records[0].timestamp).toBe('string');
  });

  it('caps the combined array at limit with memory first, graph filling the rest', () => {
    const dir = tmpDir();
    const supermemory = new SupermemoryEngine(dir);
    supermemory.remember('decision', 'alpha symbol naming convention');
    const graphJson = path.join(dir, 'graph.json');
    fs.writeFileSync(graphJson, JSON.stringify({
      nodes: [{ id: 'n1', type: 'function', name: 'alphaSymbolHelper' }]
    }));

    const hybrid = new HybridSearchEngine(dir, supermemory);

    const combined = selectQueryRecords(hybrid, 'symbol', 2, 'all');
    expect(combined.length).toBeLessThanOrEqual(2);
    expect((combined[0].id ?? '').startsWith('graph_')).toBe(false);

    const graphOnly = selectQueryRecords(hybrid, 'symbol', 5, 'graph');
    expect(graphOnly.length).toBeGreaterThan(0);
    for (const record of graphOnly) {
      expect(record.id.startsWith('graph_')).toBe(true);
    }
  });

  it('constructs the MCP server over a temp workspace without throwing', () => {
    const dir = tmpDir();
    expect(() => new HyperMemoryMcpServer(dir)).not.toThrow();
  });
});
