import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import fsDefault from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { removeTestDirs } from './testUtils.js';
import * as os from 'os';
import * as path from 'path';
import { SqliteStore } from '../src/memory/sqliteStore.js';
import { TemporalMemoryEngine } from '../src/memory/temporalMemory.js';

const dirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  removeTestDirs(dirs);
});

function tmpWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-c4a-'));
  dirs.push(dir);
  return dir;
}

it('reads the current store once on first use and detects later same-size rewrites', () => {
  const workspace = tmpWorkspace();
  const dir = path.join(workspace, '.hypersabmemory');
  fs.mkdirSync(dir);
  const filename = path.join(dir, 'memory_store.json');
  const record = { id: 'a', category: 'general', content: 'alpha', status: 'active', timestamp: '2026-01-01T00:00:00.000Z' };
  fs.writeFileSync(filename, JSON.stringify([record]));
  const read = fsDefault.readFileSync;
  let reads = 0;
  try {
    vi.spyOn(fsDefault, 'readFileSync').mockImplementation(((file: fs.PathOrFileDescriptor, options?: unknown) => {
      if (String(file) === filename) reads++;
      return read(file, options as never);
    }) as typeof fs.readFileSync);
    syncBuiltinESMExports();
    const engine = new TemporalMemoryEngine(workspace);
    expect(reads).toBe(0);
    fs.writeFileSync(filename, JSON.stringify([{ ...record, content: 'bravo' }]));
    expect(engine.getActive()[0].content).toBe('bravo');
    expect(reads).toBe(1);
    fs.writeFileSync(filename, JSON.stringify([{ ...record, content: 'delta' }]));
    expect(engine.getActive()[0].content).toBe('delta');
    expect(reads).toBe(2);
  } finally { vi.restoreAllMocks(); syncBuiltinESMExports(); }
});

it('recovers a backup on first use of a deferred memory engine', () => {
  const workspace = tmpWorkspace();
  const dir = path.join(workspace, '.hypersabmemory');
  const writer = new SqliteStore(dir);
  writer.set({ id: 'a', category: 'decision', content: 'recoverable fact' });
  fs.writeFileSync(path.join(dir, 'memory_store.json'), '{invalid');
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const memory = new TemporalMemoryEngine(workspace);
  expect(memory.getActive().map(item => item.content)).toEqual(['recoverable fact']);
  expect(warn).toHaveBeenCalled();
});

describe('TemporalMemoryEngine.remember — seeded facts are never superseded (F1)', () => {
  it('keeps an active seeded fact untouched when a near-duplicate user fact arrives', () => {
    // Given: a seeded architecture fact about topic X in the store
    const workspace = tmpWorkspace();
    const seeder = new SqliteStore(path.join(workspace, '.hypersabmemory'));
    seeder.set({
      id: 'seed_1',
      category: 'architecture',
      content: 'Watcher floods the store with architecture facts per changed file',
      tags: ['seeded'],
      source: 'seed',
      status: 'active'
    });
    const engine = new TemporalMemoryEngine(workspace);

    // When: a near-duplicate user fact about the same topic is remembered
    const user = engine.remember(
      'architecture',
      'Watcher floods the store with architecture facts per changed file (v2)'
    );

    // Then: the seed stays ACTIVE and untouched; the user fact sits alongside it
    const persisted = new SqliteStore(path.join(workspace, '.hypersabmemory'));
    const seed = persisted.get('seed_1');
    expect(seed?.status).toBe('active');
    expect(seed?.tags).toEqual(['seeded']);
    expect(seed?.invalidAt).toBeUndefined();
    expect(persisted.get(user.id)?.status).toBe('active');
  });
});

describe('TemporalMemoryEngine.remember — transactional persistence', () => {
  it('writes one transaction for every matching supersede', () => {
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
    const transactionSpy = vi.spyOn(SqliteStore.prototype, 'setAndSupersede');

    // When: a single remember() call supersedes all three duplicates
    const record = engine.remember(
      'architecture',
      'Watcher floods the store with architecture facts per changed file'
    );

    // Then: the new fact and every supersede use one store transaction.
    expect(transactionSpy).toHaveBeenCalledTimes(1);

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

  it('uses one transaction when remember finds no duplicates', () => {
    // Given: an empty store and a fresh engine
    const workspace = tmpWorkspace();
    const engine = new TemporalMemoryEngine(workspace);
    const transactionSpy = vi.spyOn(SqliteStore.prototype, 'setAndSupersede');

    // When: a remember() with no duplicate/contradiction matches runs
    const record = engine.remember('decision', 'Unique QUANTUMWIDGET routing fact with no twins');

    // Then: one atomic store transaction happened and the record is active
    expect(transactionSpy).toHaveBeenCalledTimes(1);
    expect(record.status).toBe('active');
  });

  it('does not expose a new fact or supersede old facts when the atomic write fails', () => {
    const workspace = tmpWorkspace();
    const storeDir = path.join(workspace, '.hypersabmemory');
    const seeder = new SqliteStore(storeDir);
    seeder.set({ id: 'old', category: 'architecture', content: 'The stable widget route uses local state.' });
    const engine = new TemporalMemoryEngine(workspace);
    fs.mkdirSync(path.join(storeDir, 'memory_store.json.tmp'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => engine.remember('architecture', 'The stable widget route uses local state. Updated.')).toThrow();

    const persisted = new SqliteStore(storeDir);
    expect(persisted.get('old')?.status).toBe('active');
    expect(persisted.getAll()).toHaveLength(1);
    expect(engine.getActive().map(({ id }) => id)).toEqual(['old']);
  });
});
