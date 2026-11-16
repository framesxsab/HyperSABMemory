import { describe, it, expect, afterEach } from 'vitest';
import {
  HyperSABMemoryMcpServer,
  mapGraphHitsToRecords,
  parseRememberArgs,
  selectQueryRecords,
  QuerySource
} from '../src/mcp/server.js';
import { TemporalMemoryEngine } from '../src/memory/temporalMemory.js';
import { HybridSearchEngine, HybridSearchResult } from '../src/memory/hybridSearch.js';
import * as fs from 'fs';
import { removeTestDirs } from './testUtils.js';
import * as os from 'os';
import * as path from 'path';

const dirs: string[] = [];

function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-mcpq-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  removeTestDirs(dirs);
});

function seedMemoryFixture(dir: string): { memory: TemporalMemoryEngine; hybrid: HybridSearchEngine } {
  const memory = new TemporalMemoryEngine(dir);
  memory.remember('decision', 'Use BM25 plus RRF fusion for hybrid search');
  memory.remember('bug', 'Watcher debounce was noisy before the fix');
  const hybrid = new HybridSearchEngine(dir, memory);
  return { memory, hybrid };
}

describe('HyperSABMemory — Hybrid MCP Query (P7)', () => {
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

  it('maps graph hits onto synthetic MemoryRecord shape with graph_ ids', () => {
    const hits: HybridSearchResult[] = [
      {
        score: 1,
        source: 'graph',
        title: '[CLASS] SqliteStore',
        snippet: 'AST Node: SqliteStore (class) | Dependencies: fs',
        category: 'class'
      },
      { score: 1, source: 'memory', title: '[DECISION] m1', snippet: 'memory leg hit' }
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
    const memory = new TemporalMemoryEngine(dir);
    memory.remember('decision', 'alpha symbol naming convention');
    const graphJson = path.join(dir, 'graph.json');
    fs.writeFileSync(graphJson, JSON.stringify({
      nodes: [{ id: 'n1', type: 'function', name: 'alphaSymbolHelper' }]
    }));

    const hybrid = new HybridSearchEngine(dir, memory);

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
    expect(() => new HyperSABMemoryMcpServer(dir)).not.toThrow();
  });

  it('parses all four structured remember props from MCP tool args', () => {
    const parsed = parseRememberArgs({
      category: 'bug',
      content: 'Rename failed under AV lock',
      tags: ['windows'],
      intent: 'Make saves crash-safe',
      artifacts: ['src/memory/sqliteStore.ts', 'tests/sqliteStore.test.ts'],
      errorsAndFixes: 'Single retry before direct-write fallback',
      nextSteps: 'Fuzz the rename path'
    });

    expect(parsed.category).toBe('bug');
    expect(parsed.content).toBe('Rename failed under AV lock');
    expect(parsed.tags).toEqual(['windows']);
    expect(parsed.structured).toEqual({
      intent: 'Make saves crash-safe',
      artifacts: ['src/memory/sqliteStore.ts', 'tests/sqliteStore.test.ts'],
      errorsAndFixes: 'Single retry before direct-write fallback',
      nextSteps: 'Fuzz the rename path'
    });
  });

  it('leaves structured undefined for plain remembers (back-compat)', () => {
    const plain = parseRememberArgs({ category: 'general', content: 'plain fact' });
    expect(plain.structured).toBeUndefined();

    const noArgs = parseRememberArgs(undefined);
    expect(noArgs.category).toBe('general');
    expect(noArgs.content).toBe('');
    expect(noArgs.tags).toEqual([]);
    expect(noArgs.structured).toBeUndefined();
  });

  it('persists structured props end-to-end through engine.remember', () => {
    const dir = tmpDir();
    const memory = new TemporalMemoryEngine(dir);
    memory.remember('bug', 'Watcher debounce noisy', [], {
      intent: 'Cut watcher noise',
      artifacts: ['src/hooks/fileWatcher.ts'],
      errorsAndFixes: 'Raised debounce to 30s',
      nextSteps: 'Tune per-OS debounce'
    });

    const record = memory.getActive().find((r) => r.content === 'Watcher debounce noisy');
    expect(record?.intent).toBe('Cut watcher noise');
    expect(record?.artifacts).toEqual(['src/hooks/fileWatcher.ts']);
    expect(record?.errorsAndFixes).toBe('Raised debounce to 30s');
    expect(record?.nextSteps).toBe('Tune per-OS debounce');
  });
});
