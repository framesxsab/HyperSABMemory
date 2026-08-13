/**
 * HyperMemory — Zep-style Context Block
 * Packs dated active facts into one string for the Oh-My-Pi token budget.
 */

import { TokenCompressor } from '../harness/tokenCompressor.js';
import { MemoryRecord } from './sqliteStore.js';

const MAX_FACTS = 8;
const BLOCK_TOKEN_BUDGET = 400;

export function buildContextBlock(records: MemoryRecord[], projectSummary?: string): string {
  const active = records
    .filter((record) => (record.status ?? 'active') === 'active')
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .slice(-MAX_FACTS);

  const summary = projectSummary?.trim() || 'HyperMemory local-first harness';
  const facts = active.length === 0
    ? '- (none)'
    : active
        .map((record) => {
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
