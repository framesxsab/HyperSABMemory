import { describe, it, expect, vi, afterEach } from 'vitest';
import { SqliteStore } from '../src/memory/sqliteStore.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('HyperMemory — Crash-safe Memory Store (P8)', () => {
  const dirs: string[] = [];

  function tmpDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-store-'));
    dirs.push(dir);
    return dir;
  }

  afterEach(() => {
    vi.restoreAllMocks();
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
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
});
