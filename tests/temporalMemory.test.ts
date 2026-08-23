import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SqliteStore } from '../src/memory/sqliteStore.js';
import { TemporalMemoryEngine } from '../src/memory/temporalMemory.js';

const dirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tmpWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-c4a-'));
  dirs.push(dir);
  return dir;
}

describe('TemporalMemoryEngine.remember — batched persistence (C4a)', () => {
  it('saves the store exactly once for all supersedes when one remember supersedes multiple records', () => {
    // Given: three active architecture facts that all duplicate the incoming content
    const workspace = tmpWorkspace();
    const seeder = new SqliteStore(path.join(workspace, '.hypersabmemory'));
    for (let i = 0; i < 3; i++) {
      seeder.set({
        id: `old_${i}`,
        category: 'architecture',
        content: `Watcher floods the store with architecture facts per changed file (variant ${i})`,
        status: 'active'
      });
    }
    const engine = new TemporalMemoryEngine(workspace);
    const saveSpy = vi.spyOn(SqliteStore.prototype, 'saveStore');

    // When: a single remember() call supersedes all three duplicates
    const record = engine.remember(
      'architecture',
      'Watcher floods the store with architecture facts per changed file'
    );

    // Then: exactly ONE save happens after the supersede loop completes.
    // The first call is set()'s own inherent persist (pinned contract: set()
    // keeps persisting on every call); everything after the loop must be one
    // batched save, not one save per superseded record.
    expect(saveSpy.mock.calls.length - 1).toBe(1);

    // And semantics are preserved: the single batched save persisted every flip
    const persisted = new SqliteStore(path.join(workspace, '.hypersabmemory'));
    for (let i = 0; i < 3; i++) {
      const old = persisted.get(`old_${i}`);
      expect(old?.status).toBe('superseded');
      expect(old?.tags).toContain(`superseded-by:${record.id}`);
      expect(old?.invalidAt).toBeTruthy();
    }
    expect(persisted.get(record.id)?.status).toBe('active');
  });

  it('keeps set() as the only save when remember finds no duplicates', () => {
    // Given: an empty store and a fresh engine
    const workspace = tmpWorkspace();
    const engine = new TemporalMemoryEngine(workspace);
    const saveSpy = vi.spyOn(SqliteStore.prototype, 'saveStore');

    // When: a remember() with no duplicate/contradiction matches runs
    const record = engine.remember('decision', 'Unique QUANTUMWIDGET routing fact with no twins');

    // Then: only set()'s own save happened and the record is active
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(record.status).toBe('active');
  });
});
