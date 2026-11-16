import { it, expect } from 'vitest';
import { HybridSearchEngine } from '../src/memory/hybridSearch.js';
import type { MemoryRecord } from '../src/memory/sqliteStore.js';

it('does not mark a filename suffix or different directory as the requested path', () => {
  const examples = [
    { query: 'Where is src/data.ts data storage implementation?', target: 'src/data.ts', other: 'src/a.ts' },
    { query: 'Inspect src/routes/user.ts handler routing.', target: 'src/routes/user.ts', other: 'src/models/user.ts' },
    { query: 'Show docs/README.md documentation.', target: 'docs/README.md', other: 'README.md' },
    { query: 'Find src\\jobs\\retry-policy.ts.', target: 'src/jobs/retry-policy.ts', other: 'src/http/retry-policy.ts' },
    { query: 'Inspect \"lib/codec/reader.spec.ts\", please.', target: 'lib/codec/reader.spec.ts', other: 'lib/codec/reader.ts' }
  ];
  for (const example of examples) {
    const records: MemoryRecord[] = [
      { id: 'other', category: 'general', content: example.query, artifacts: [example.other], status: 'active', timestamp: '2026-01-01T00:00:00Z' },
      { id: 'target', category: 'general', content: 'minimal source', artifacts: [example.target], status: 'active', timestamp: '2026-01-01T00:00:00Z' }
    ];
    const engine = new HybridSearchEngine(process.cwd(), { getActive: () => records });
    const result = engine.searchRecordsWithScores(example.query, 5);
    expect(result.find(item => item.record.id === 'target')?.exactPathMatch).toBe(true);
    expect(result.find(item => item.record.id === 'other')?.exactPathMatch).toBe(false);
    expect(result[0].record.id).toBe('target');
  }
});
