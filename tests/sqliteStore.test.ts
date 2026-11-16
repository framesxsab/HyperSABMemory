import { describe, it, expect, vi, afterEach } from 'vitest';
import { SqliteStore } from '../src/memory/sqliteStore.js';
import * as fs from 'fs';
import { removeTestDirs } from './testUtils.js';
import * as os from 'os';
import * as path from 'path';

describe('HyperSABMemory — Crash-safe Memory Store (P8)', () => {
  const dirs: string[] = [];

  function tmpDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-store-'));
    dirs.push(dir);
    return dir;
  }

  afterEach(() => {
    vi.restoreAllMocks();
    removeTestDirs(dirs);
  });

  it('preserves existing data when a deferred store is saved before reading', () => {
    const dir = tmpDir();
    const writer = new SqliteStore(dir);
    writer.set({ id: 'a', category: 'decision', content: 'retained fact' });
    const deferred = new SqliteStore(dir, true);
    deferred.saveStore();
    expect(new SqliteStore(dir).get('a')?.content).toBe('retained fact');
  });

  it('reloads an external rewrite matching previously loaded bytes after a local write', () => {
    const dir = tmpDir();
    const file = path.join(dir, 'memory_store.json');
    const original = JSON.stringify([{ id: 'a', category: 'decision', content: 'old fact', status: 'forgotten', timestamp: '2026-01-01T00:00:00.000Z' }]);
    fs.writeFileSync(file, original);
    const store = new SqliteStore(dir);
    store.set({ id: 'a', category: 'decision', content: 'new fact', status: 'active' });
    fs.writeFileSync(file, original);
    expect(store.getActive()).toEqual([]);
  });

  it('refreshes direct reads and substring searches after another store forgets a record', () => {
    const dir = tmpDir();
    const writer = new SqliteStore(dir);
    writer.set({ id: 'a', category: 'decision', content: 'shared decision' });
    const reader = new SqliteStore(dir);
    writer.forget('a');
    expect(reader.get('a')?.status).toBe('forgotten');
    expect(reader.getAll()[0].status).toBe('forgotten');
    expect(reader.search('shared')[0].status).toBe('forgotten');
  });

  it('recovers the last good state from .bak when the primary store is corrupt', () => {
    const dir = tmpDir();
    const store = new SqliteStore(dir);
    store.set({ id: 'a', category: 'decision', content: 'Fact A' });
    store.set({ id: 'b', category: 'bug', content: 'Fact B' });

    fs.writeFileSync(path.join(dir, 'memory_store.json'), '{corrupt garbage', 'utf-8');

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const recovered = new SqliteStore(dir);
    expect(recovered.get('b')?.content).toBe('Fact B');
    expect(recovered.get('a')?.content).toBe('Fact A');
    expect(warnSpy).toHaveBeenCalled();
  });

  it('boots clean without throwing when nothing is readable', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'memory_store.json'), 'not json at all', 'utf-8');

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => new SqliteStore(dir)).not.toThrow();
    const store = new SqliteStore(dir);
    expect(store.getAll()).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('keeps the on-disk format byte-identical (array, 2-space indent)', () => {
    const dir = tmpDir();
    const store = new SqliteStore(dir);
    store.set({ id: 'fmt', category: 'general', content: 'format probe' });

    const raw = fs.readFileSync(path.join(dir, 'memory_store.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    expect(raw).toBe(JSON.stringify(parsed, null, 2));
    expect(Array.isArray(parsed)).toBe(true);
  });

  it('surfaces persistence failures without exposing an unpersisted record', () => {
    const dir = tmpDir();
    const store = new SqliteStore(dir);
    fs.mkdirSync(path.join(dir, 'memory_store.json.tmp'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => store.set({ id: 'failed', category: 'decision', content: 'Must not appear saved' })).toThrow();
    expect(store.get('failed')).toBeUndefined();
    expect(store.getAll()).toEqual([]);
    expect(fs.existsSync(path.join(dir, 'memory_store.json'))).toBe(false);
  });

  it('recovers from a complete .tmp when the primary is missing', () => {
    const dir = tmpDir();
    const store = new SqliteStore(dir);
    store.set({ id: 'tmp-fact', category: 'decision', content: 'Written but not renamed' });
    fs.rmSync(path.join(dir, 'memory_store.json'));

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const recovered = new SqliteStore(dir);
    expect(recovered.get('tmp-fact')?.content).toBe('Written but not renamed');
    expect(warnSpy).toHaveBeenCalled();
  });

  it('never resurrects forgotten facts after recovery (resurrection guard)', () => {
    const dir = tmpDir();
    const store = new SqliteStore(dir);
    store.set({ id: 'keep', category: 'decision', content: 'Still valid' });
    store.set({ id: 'kill', category: 'decision', content: 'Forgotten fact' });
    store.forget('kill');

    fs.writeFileSync(path.join(dir, 'memory_store.json'), '][ total garbage ][', 'utf-8');

    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const recovered = new SqliteStore(dir);
    expect(recovered.get('keep')?.status ?? 'active').toBe('active');
    expect(recovered.get('kill')?.status).toBe('forgotten');
    expect(recovered.getActive().map((r) => r.id)).toEqual(['keep']);
  });

  it('round-trips optional structured fields through save and reload', () => {
    const dir = tmpDir();
    const store = new SqliteStore(dir);
    store.set({
      id: 'structured-1',
      category: 'bug',
      content: 'Atomic rename failed on Windows',
      intent: 'Harden crash-safe saves',
      artifacts: ['src/memory/sqliteStore.ts'],
      errorsAndFixes: 'Added single EPERM/EBUSY retry before direct-write fallback',
      nextSteps: 'Fuzz the rename path under AV lock pressure'
    });

    const reloaded = new SqliteStore(dir);
    const record = reloaded.get('structured-1');
    expect(record?.intent).toBe('Harden crash-safe saves');
    expect(record?.artifacts).toEqual(['src/memory/sqliteStore.ts']);
    expect(record?.errorsAndFixes).toBe('Added single EPERM/EBUSY retry before direct-write fallback');
    expect(record?.nextSteps).toBe('Fuzz the rename path under AV lock pressure');
  });

  it('keeps legacy records without structured fields loadable and undefined-safe', () => {
    const dir = tmpDir();
    const store = new SqliteStore(dir);
    store.set({ id: 'legacy-1', category: 'general', content: 'Plain pre-structured fact' });

    const reloaded = new SqliteStore(dir);
    const record = reloaded.get('legacy-1');
    expect(record?.content).toBe('Plain pre-structured fact');
    expect(record?.intent).toBeUndefined();
    expect(record?.artifacts).toBeUndefined();
    expect(record?.errorsAndFixes).toBeUndefined();
    expect(record?.nextSteps).toBeUndefined();
  });
});
