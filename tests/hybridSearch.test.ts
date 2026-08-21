import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HybridSearchEngine } from '../src/memory/hybridSearch.js';
import { TemporalMemoryEngine } from '../src/memory/temporalMemory.js';

describe('HyperSABMemory — Hybrid Search (BM25 + RRF)', () => {
  it('ranks exact-match records above partial matches', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-hybrid-'));
    try {
      const engine = new TemporalMemoryEngine(dir);
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
      const engine = new TemporalMemoryEngine(dir);
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
      const engine = new TemporalMemoryEngine(dir);
      engine.remember('decision', 'CONTEXTBLOCK packs dated active facts only.');

      const hybrid = new HybridSearchEngine(dir);
      const results = hybrid.search('CONTEXTBLOCK');

      expect(Array.isArray(results)).toBe(true);
      if (results.length > 0) {
        expect(results[0]).toHaveProperty('score');
        expect(results[0]).toHaveProperty('source');
        expect(results[0]).toHaveProperty('title');
        expect(results[0]).toHaveProperty('snippet');
        expect(['graph', 'memory']).toContain(results[0].source);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('matches artifact filenames and fix keywords in both BM25 and fusion paths', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-hybrid-structured-'));
    try {
      const engine = new TemporalMemoryEngine(dir);
      engine.remember('bug', 'Watcher debounce was noisy before the fix.', [], {
        intent: 'Cut watcher log spam',
        artifacts: ['src/hooks/fileWatcher.ts'],
        errorsAndFixes: 'Raised the debounce window to thirty seconds',
        nextSteps: 'Tune per-OS debounce values'
      });
      engine.remember('general', 'Some unrelated note about coffee.');

      const hybrid = new HybridSearchEngine(dir);

      const byArtifact = hybrid.searchRecords('fileWatcher', 10);
      expect(byArtifact.length).toBeGreaterThanOrEqual(1);
      expect(byArtifact[0].content).toContain('Watcher debounce');

      const byFixKeyword = hybrid.searchRecords('debounce window', 10);
      expect(byFixKeyword.length).toBeGreaterThanOrEqual(1);
      expect(byFixKeyword[0].content).toContain('Watcher debounce');

      const fused = hybrid.search('fileWatcher', 10);
      expect(fused.some((hit) => hit.source === 'memory' && hit.snippet.includes('Watcher debounce'))).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});