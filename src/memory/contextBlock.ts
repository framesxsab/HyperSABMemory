/**
 * HyperSABMemory — Zep-style Context Block
 * Packs dated active facts into one string for the context harness token budget.
 * Selection is relevance-ranked (recency decay x category weight x noise penalty),
 * rendered chronologically.
 */

import { TokenCompressor } from '../harness/tokenCompressor.js';
import { MemoryRecord } from './sqliteStore.js';

const MAX_FACTS = 8;
const BLOCK_TOKEN_BUDGET = 400;

/** Exponential half-life for fact recency decay (7 days). */
export const HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;

/** Category importance weights used during Context Block ranking. */
export const CATEGORY_WEIGHTS: Record<MemoryRecord['category'], number> = {
  decision: 1.2,
  bug: 1.1,
  architecture: 1.0,
  symbol: 1.0,
  general: 1.0
};

/** Matches ephemeral file-watcher facts so they can be down-ranked. */
export const FILE_EVENT_FACT_PATTERN = /^File (change|add|unlink): /;

/** Single source of truth for watcher fact strings (pinned against drift). */
export function formatFileEventFact(
  type: 'change' | 'add' | 'unlink',
  relativePath: string
): string {
  return `File ${type}: ${relativePath}`;
}

function recencyDecay(timestamp: string): number {
  const ts = Date.parse(timestamp);
  if (Number.isNaN(ts)) return 0;
  const ageMs = Math.max(0, Date.now() - ts);
  return 0.5 ** (ageMs / HALF_LIFE_MS);
}

function noisePenalty(content: string): number {
  return FILE_EVENT_FACT_PATTERN.test(content) ? 0.1 : 1.0;
}

function scoreRecord(record: MemoryRecord): number {
  const weight = CATEGORY_WEIGHTS[record.category] ?? 1.0;
  return recencyDecay(record.timestamp) * weight * noisePenalty(record.content);
}

export function buildContextBlock(records: MemoryRecord[], projectSummary?: string): string {
  const ranked = records
    .filter((record) => (record.status ?? 'active') === 'active')
    .map((record) => ({ record, score: scoreRecord(record) }))
    .sort((a, b) =>
      b.score - a.score || a.record.timestamp.localeCompare(b.record.timestamp)
    )
    .slice(0, MAX_FACTS)
    // Render chronological regardless of ranking order.
    .sort((a, b) => a.record.timestamp.localeCompare(b.record.timestamp));

  const summary = projectSummary?.trim() || 'HyperSABMemory local-first harness';
  const facts = ranked.length === 0
    ? '- (none)'
    : ranked
        .map(({ record }) => {
          const day = record.timestamp.slice(0, 10);
          return `- ${day} [${record.category}] ${record.content}`;
        })
        .join('\n');

  const raw = `[CONTEXT BLOCK]
Summary: ${summary}
Facts:
${facts}`;

  return TokenCompressor.compressText(raw, BLOCK_TOKEN_BUDGET);
}
