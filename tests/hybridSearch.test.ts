import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HybridSearchEngine, tokenizeSearchText } from '../src/memory/hybridSearch.js';
import { TemporalMemoryEngine } from '../src/memory/temporalMemory.js';

describe('HyperSABMemory — Hybrid Search (BM25 + RRF)', () => {
  it('keeps shared content separate by searchable metadata and refreshes same-size metadata rewrites', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-hybrid-metadata-cache-'));
    try {
      fs.mkdirSync(path.join(dir, '.hypersabmemory'));
      const file = path.join(dir, '.hypersabmemory', 'memory_store.json');
      const records = ['alpha', 'bravo'].map((tag, index) => ({ id: `${index}`, category: 'general', content: 'shared content', tags: [tag], status: 'active', timestamp: '2026-01-01T00:00:00.000Z' }));
      fs.writeFileSync(file, JSON.stringify(records));
      const hybrid = new HybridSearchEngine(dir);
      expect(hybrid.searchRecords('alpha').map(record => record.id)).toEqual(['0']);
      expect(hybrid.searchRecords('bravo').map(record => record.id)).toEqual(['1']);
      records[0].tags = ['gamma'];
      fs.writeFileSync(file, JSON.stringify(records));
      expect(hybrid.searchRecords('alpha')).toEqual([]);
      expect(hybrid.searchRecords('gamma').map(record => record.id)).toEqual(['0']);
      expect(hybrid.searchRecords('bravo').map(record => record.id)).toEqual(['1']);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  it('uses current static imports as ranking hints without inventing candidates', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-hybrid-import-links-'));
    try {
      const memoryDir = path.join(dir, '.hypersabmemory');
      fs.mkdirSync(memoryDir);
      const records = [
        { id: 'anchor', content: 'lease validation policy lease validation policy', artifacts: ['src/task.ts'] },
        { id: 'noise', content: 'lease validation policy', artifacts: ['src/noise.ts'] },
        { id: 'other', content: 'lease validation policy', artifacts: ['tests/other.ts'] },
        { id: 'linked', content: "import { task } from '../src/task.js';\nlease validation policy", artifacts: ['tests/check.ts'] },
        { id: 'absent', content: "import { task } from '../src/task.js';\nastronomy", artifacts: ['tests/absent.ts'] }
      ].map(record => ({ ...record, category: 'architecture', status: 'active', timestamp: '2026-01-01T00:00:00.000Z' }));
      const store = path.join(memoryDir, 'memory_store.json');
      fs.writeFileSync(store, JSON.stringify(records));
      const hybrid = new HybridSearchEngine(dir);
      const query = 'lease validation policy';
      let results = hybrid.searchRecords(query);
      expect(results.map(record => record.id).indexOf('linked')).toBeLessThan(results.map(record => record.id).indexOf('noise'));
      expect(results.some(record => record.id === 'absent')).toBe(false);
      const originalContent = records[3].content;
      records[3].content = originalContent.replace('task.js', 'nope.js');
      expect(records[3].content.length).toBe(originalContent.length);
      fs.writeFileSync(store, JSON.stringify(records));
      results = hybrid.searchRecords(query);
      expect(results.map(record => record.id).indexOf('noise')).toBeLessThan(results.map(record => record.id).indexOf('linked'));
      records[3].content = "/* import { task } from '../src/task.js'; */\nlease validation policy";
      fs.writeFileSync(store, JSON.stringify(records));
      results = hybrid.searchRecords(query);
      expect(results.map(record => record.id).indexOf('noise')).toBeLessThan(results.map(record => record.id).indexOf('linked'));
      records[3].content = "`\nimport { task } from '../src/task.js';\n`\nlease validation policy";
      fs.writeFileSync(store, JSON.stringify(records));
      results = hybrid.searchRecords(query);
      expect(results.map(record => record.id).indexOf('noise')).toBeLessThan(results.map(record => record.id).indexOf('linked'));
      records[3].content = "export {\n task\n} from '../src/task.js';\nlease validation policy";
      fs.writeFileSync(store, JSON.stringify(records));
      results = hybrid.searchRecords(query);
      expect(results.map(record => record.id).indexOf('linked')).toBeLessThan(results.map(record => record.id).indexOf('noise'));
      records[3].content = "import { task } from '../src/task.js';\nlease validation policy";
      records[3].status = 'forgotten';
      fs.writeFileSync(store, JSON.stringify(records));
      expect(hybrid.searchRecords(query).some(record => record.id === 'linked')).toBe(false);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  it('retains corpus statistics and phrase-only matches when skipping nonmatching records', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-hybrid-candidate-stats-'));
    try {
      const memoryDir = path.join(dir, '.hypersabmemory');
      fs.mkdirSync(memoryDir);
      const records = [
        { id: 'target', category: 'general', content: 'alpha alpha', status: 'active', timestamp: '2026-01-01T00:00:00.000Z' },
        { id: 'noise', category: 'general', content: 'unrelated note', status: 'active', timestamp: '2026-01-01T00:00:00.000Z' },
        { id: 'phrase', category: 'general', content: 'the', status: 'active', timestamp: '2026-01-01T00:00:00.000Z' }
      ];
      fs.writeFileSync(path.join(memoryDir, 'memory_store.json'), JSON.stringify(records));
      const hybrid = new HybridSearchEngine(dir);
      const result = hybrid.searchRecordsWithScores('alpha');
      expect(result.map(item => item.record.id)).toEqual(['target']);
      expect(result[0].queryTermEvidence[0].idf).toBeCloseTo(Math.log(1 + (3 - 1 + 0.5) / (1 + 0.5)));
      const expectedScore = Math.log(1 + (3 - 1 + 0.5) / (1 + 0.5)) * (2 * 2.2 / (2 + 1.2 * (0.25 + 0.75 * (3 / (8 / 3)))));
      expect(result[0].bm25Score).toBeCloseTo(expectedScore);
      expect(hybrid.searchRecordsWithScores('alpha alpha')[0].bm25Score).toBeCloseTo(2 * expectedScore);
      expect(hybrid.searchRecordsWithScores('alpha')[0].bm25Score).toBeCloseTo(expectedScore);
      expect(hybrid.searchRecordsWithScores('the')).toMatchObject([{ record: { id: 'phrase' }, bm25Score: 0, exactPhraseBoost: 0.5 }]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  it('normalizes action forms while retaining identifier splitting and numeric segments', () => {
    expect(tokenizeSearchText('validate validation')).toEqual(['valid', 'valid']);
    expect(tokenizeSearchText('restore restoration')).toEqual(['restor', 'restor']);
    expect(tokenizeSearchText('implement implementation')).toEqual(['implement', 'implement']);
    expect(tokenizeSearchText('validateInput validate_input src/validateInput.ts')).toEqual(['valid', 'input', 'valid', 'input', 'src', 'valid', 'input', 'ts']);
    expect(tokenizeSearchText('ABC123Def')).toEqual(['abc123', 'def']);
    expect(tokenizeSearchText('a'.repeat(200))).toEqual(['a'.repeat(200)]);
    expect(tokenizeSearchText('')).toEqual([]);
    expect(tokenizeSearchText('aBCd ABCd plain Text fooBAR_baz')).toEqual(['a', 'b', 'cd', 'ab', 'cd', 'plain', 'text', 'foo', 'bar', 'baz']);
  });
  it('refreshes cached tokens and active records after an external same-size rewrite', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-hybrid-refresh-'));
    try {
      const memoryDir = path.join(dir, '.hypersabmemory');
      fs.mkdirSync(memoryDir);
      const store = path.join(memoryDir, 'memory_store.json');
      const record = { id: '1', category: 'general', content: 'alpha', status: 'active', timestamp: '2026-01-01T00:00:00.000Z' };
      fs.writeFileSync(store, JSON.stringify([record]));
      const hybrid = new HybridSearchEngine(dir);
      expect(hybrid.searchRecords('alpha')).toHaveLength(1);
      fs.writeFileSync(store, JSON.stringify([{ ...record, content: 'bravo' }]));
      expect(hybrid.searchRecords('alpha')).toHaveLength(0);
      expect(hybrid.searchRecords('bravo')).toHaveLength(1);
      fs.writeFileSync(store, JSON.stringify([{ ...record, content: 'bravo', status: 'forgotten' }]));
      expect(hybrid.searchRecords('bravo')).toHaveLength(0);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  it('uses query terms in artifact paths to break otherwise equivalent rankings', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-hybrid-path-'));
    try {
      fs.mkdirSync(path.join(dir, '.hypersabmemory'));
      const records = ['src/other.ts', 'src/leaseCoordinator.ts'].map((artifact, i) => ({
        id: `${i}`, category: 'architecture', content: 'lease coordination handler', artifacts: [artifact], status: 'active', timestamp: '2026-01-01T00:00:00.000Z'
      }));
      fs.writeFileSync(path.join(dir, '.hypersabmemory', 'memory_store.json'), JSON.stringify(records));
      const results = new HybridSearchEngine(dir).searchRecords('lease coordinator', 2);
      expect(results[0].id).toBe('1');
      const diagnostics = new HybridSearchEngine(dir).searchRecordsWithScores('lease coordinator', 2);
      expect(diagnostics[0].pathCoverage).toBe(1);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
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

  it('exposes diagnostic score components without changing ranked record results', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-hybrid-scores-'));
    try {
      const memory = new TemporalMemoryEngine(dir);
      memory.remember('architecture', 'TaskLedger atomically writes the task ledger.');
      memory.remember('general', 'Coffee and tea are served here.');
      const hybrid = new HybridSearchEngine(dir, memory);
      const scored = hybrid.searchRecordsWithScores('TaskLedger task ledger', 5);
      expect(scored.map(item => item.record)).toEqual(hybrid.searchRecords('TaskLedger task ledger', 5));
      expect(scored[0].bm25Score).toBeGreaterThan(0);
      expect(scored[0].score).toBe(scored[0].bm25Score + scored[0].exactPhraseBoost);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('matches camelCase identifiers to separate query words and drops common-only queries', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-hybrid-code-identifiers-'));
    try {
      const memory = new TemporalMemoryEngine(dir);
      memory.remember('architecture', 'TaskLedger validates leaseGeneration and sourceRefs.', [], {
        artifacts: ['src/memory/taskLedger.ts']
      });
      const hybrid = new HybridSearchEngine(dir, memory);
      const result = hybrid.searchRecords('task ledger source refs');
      expect(result[0]?.artifacts).toContain('src/memory/taskLedger.ts');
      expect(hybrid.searchRecords('what is and the')).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('ranks an exact code declaration ahead of an import mention', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-hybrid-symbol-'));
    try {
      const memory = new TemporalMemoryEngine(dir);
      memory.remember('architecture', "import { McpAccessEngine } from './mcpAccess.js';", [], { artifacts: ['tests/harness.test.ts'] });
      memory.remember('architecture', 'export class McpAccessEngine {}', [], { artifacts: ['src/harness/mcpAccess.ts'] });
      const result = new HybridSearchEngine(dir, memory).searchRecordsWithScores('Which file defines `McpAccessEngine`?', 5);
      expect(result[0].record.artifacts).toContain('src/harness/mcpAccess.ts');
      expect(result[0].identifierDefinitions).toContain('McpAccessEngine');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
