/**
 * HyperSABMemory — Token Efficiency Metric
 * Quantifies the core value prop: tokens delivered by the Context Block vs a
 * naive uncompressed corpus (every active record's full content + tags).
 */

import { TokenCompressor } from '../harness/tokenCompressor.js';
import { TemporalMemoryEngine } from '../memory/temporalMemory.js';
import type { MemoryRecord } from '../memory/sqliteStore.js';

export interface TokenEfficiency {
  deliveredTokens: number;
  naiveCorpusTokens: number;
  savingsPct: number;
  compressionRatio: number;
}

export function estimateNaiveCorpusTokens(records: MemoryRecord[]): number {
  return records.reduce(
    (sum, record) =>
      sum + TokenCompressor.estimateTokens([record.content, (record.tags ?? []).join(' ')].filter(Boolean).join(' ')),
    0
  );
}

export function computeTokenEfficiency(engine: TemporalMemoryEngine): TokenEfficiency {
  const deliveredTokens = TokenCompressor.estimateTokens(engine.getContextBlock());
  const naiveCorpusTokens = estimateNaiveCorpusTokens(engine.getActive());

  const savingsPct =
    naiveCorpusTokens === 0 ? 0 : Math.max(0, Math.round((1 - deliveredTokens / naiveCorpusTokens) * 1000) / 10);
  const compressionRatio = naiveCorpusTokens === 0 ? 1 : Math.round((deliveredTokens / naiveCorpusTokens) * 1000) / 1000;

  return { deliveredTokens, naiveCorpusTokens, savingsPct, compressionRatio };
}
