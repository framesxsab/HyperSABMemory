import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HybridSearchEngine } from '../src/memory/hybridSearch.js';
import { SupermemoryEngine } from '../src/memory/supermemory.js';

describe('HyperMemory — Hybrid Search (BM25 + RRF)', () => {
  it('ranks exact-match records above partial matches', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-hybrid-'));
    try {
      const engine = new SupermemoryEngine(dir);
      engine.remember('architecture', 'HASHLINE anchors are used for patch targeting in the harness.');
      engine.remember('decision', 'Token ceiling is 1500 tokens for injected harness headers.');
      engine.remember('general', 'Some unrelated note about coffee.');

      const hybrid = new HybridSearchEngine(dir);
      const results = hybrid.searchRecords('HASHLINE harness', 10);

      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].content).toContain('HASHLINE');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('respects the limit cap', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-hybrid-limit-'));
    try {
      const engine = new SupermemoryEngine(dir);
      for (let i = 0; i < 5; i++) {
        engine.remember('architecture', `SNAPCOMPACT compress ${i} token budgeting rule number ${i}`);
      }

      const hybrid = new HybridSearchEngine(dir);
      const results = hybrid.searchRecords('SNAPCOMPACT', 2);
      expect(results.length).toBe(2);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns the HybridSearchResult shape from search()', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-hybrid-shape-'));
    try {
      const engine = new SupermemoryEngine(dir);
      engine.remember('decision', 'CONTEXTBLOCK packs dated active facts only.');

      const hybrid = new HybridSearchEngine(dir);
      const results = hybrid.search('CONTEXTBLOCK');

      expect(Array.isArray(results)).toBe(true);
      if (results.length > 0) {
        expect(results[0]).toHaveProperty('score');
        expect(results[0]).toHaveProperty('source');
        expect(results[0]).toHaveProperty('title');
        expect(results[0]).toHaveProperty('snippet');
        expect(['graphify', 'supermemory']).toContain(results[0].source);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});