import { describe, it, expect } from 'vitest';
import {
  buildContextBlock,
  formatFileEventFact,
  FILE_EVENT_FACT_PATTERN
} from '../src/memory/contextBlock.js';
import { TokenCompressor } from '../src/harness/tokenCompressor.js';
import { MemoryRecord } from '../src/memory/sqliteStore.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function iso(msAgo: number): string {
  return new Date(Date.now() - msAgo).toISOString();
}

function noiseFact(i: number, msAgo: number): MemoryRecord {
  return {
    id: `noise-${i}`,
    category: 'architecture',
    content: formatFileEventFact('change', `src/file-${i}.ts`),
    timestamp: iso(msAgo),
    status: 'active'
  };
}

describe('HyperMemory — Noise-aware Context Block (P6)', () => {
  it('ranks a fresh decision above fresh watcher noise and evicts noise, not the decision', () => {
    const records: MemoryRecord[] = [
      ...Array.from({ length: 8 }, (_, i) => noiseFact(i, HOUR_MS)),
      {
        id: 'decision-1',
        category: 'decision',
        content: 'Ship BM25+RRF hybrid search',
        timestamp: iso(HOUR_MS),
        status: 'active'
      }
    ];

    const block = buildContextBlock(records);
    expect(block).toContain('Ship BM25+RRF hybrid search');
    // 9 candidates, 8 slots: exactly one low-scored noise fact is evicted.
    const factLines = block.split('\n').filter((line) => line.startsWith('- '));
    expect(factLines.length).toBe(8);
  });

  it('keeps a fresh decision even against thirty-day-old watcher noise', () => {
    const records: MemoryRecord[] = [
      ...Array.from({ length: 8 }, (_, i) => noiseFact(i, 30 * DAY_MS)),
      {
        id: 'decision-old-noise',
        category: 'decision',
        content: 'Local-first store stays the default',
        timestamp: iso(HOUR_MS),
        status: 'active'
      }
    ];

    const block = buildContextBlock(records);
    expect(block).toContain('Local-first store stays the default');
  });

  it('respects the 400-token budget under heavy fact load', () => {
    const longContent = 'x'.repeat(200);
    const records: MemoryRecord[] = Array.from({ length: 20 }, (_, i) => ({
      id: `long-${i}`,
      category: 'decision' as const,
      content: longContent,
      timestamp: iso((i + 1) * HOUR_MS),
      status: 'active' as const
    }));

    const block = buildContextBlock(records);
    expect(TokenCompressor.estimateTokens(block)).toBeLessThanOrEqual(400);
  });

  it('never leaks forgotten facts', () => {
    const records: MemoryRecord[] = [
      {
        id: 'kept',
        category: 'bug',
        content: 'Watcher debounce fixed at 30s',
        timestamp: iso(HOUR_MS),
        status: 'active'
      },
      {
        id: 'gone',
        category: 'bug',
        content: 'SECRET-FORGOTTEN-FACT should never render',
        timestamp: iso(HOUR_MS),
        status: 'forgotten',
        invalidAt: iso(0)
      }
    ];

    const block = buildContextBlock(records);
    expect(block).toContain('Watcher debounce fixed at 30s');
    expect(block).not.toContain('SECRET-FORGOTTEN-FACT');
  });

  it('pins the watcher fact format against drift and renders chronologically', () => {
    for (const type of ['change', 'add', 'unlink'] as const) {
      expect(FILE_EVENT_FACT_PATTERN.test(formatFileEventFact(type, 'src/a.ts'))).toBe(true);
    }
    expect(FILE_EVENT_FACT_PATTERN.test('Edited src/a.ts')).toBe(false);

    const older = {
      id: 'old',
      category: 'general' as const,
      content: 'older general fact',
      timestamp: iso(5 * DAY_MS),
      status: 'active' as const
    };
    const newer = {
      id: 'new',
      category: 'general' as const,
      content: 'newer general fact',
      timestamp: iso(DAY_MS),
      status: 'active' as const
    };

    const fromNewestFirst = buildContextBlock([newer, older]);
    const fromOldestFirst = buildContextBlock([older, newer]);
    const orderOf = (block: string, needle: string) => block.indexOf(needle);
    expect(
      orderOf(fromNewestFirst, 'older general fact') < orderOf(fromNewestFirst, 'newer general fact')
    ).toBe(true);
    expect(fromNewestFirst).toBe(fromOldestFirst);
  });
});
