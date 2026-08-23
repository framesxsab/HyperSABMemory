import * as fs from 'fs';
import * as path from 'path';
import type { MemoryRecord } from '../memory/sqliteStore.js';

/**
 * Parses the --interval CLI option. Returns null for anything that is not a
 * number >= 1 (floats are floored) so it can never become a 0ms rapid-fire timer.
 */
export function parseIntervalMinutes(raw: string): number | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 1) return null;
  return Math.floor(value);
}

/**
 * Read-only peek at the local memory store. Returns [] when the store is
 * absent or unreadable; never creates files or instantiates engines.
 */
export function readStoreRecords(workspaceDir: string): MemoryRecord[] {
  const storePath = path.join(workspaceDir, '.hypersabmemory', 'memory_store.json');
  if (!fs.existsSync(storePath)) return [];
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(storePath, 'utf-8'));
    return Array.isArray(parsed) ? (parsed as MemoryRecord[]) : [];
  } catch {
    return [];
  }
}
