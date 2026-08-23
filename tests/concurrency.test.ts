import { describe, it, expect, afterEach } from 'vitest';
import { SqliteStore } from '../src/memory/sqliteStore.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('HyperSABMemory — Concurrent store access (C2/C3)', () => {
  const dirs: string[] = [];

  function tmpDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-conc-'));
    dirs.push(dir);
    return dir;
  }

  function readRawStore(dir: string): string {
    return fs.readFileSync(path.join(dir, 'memory_store.json'), 'utf-8');
  }

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('(d) golden: memory_store.json stays an array of MemoryRecord-shaped records after forget', () => {
    const dir = tmpDir();
    const store = new SqliteStore(dir);
    store.set({ id: 'golden-active', category: 'decision', content: 'Active fact' });
    store.set({ id: 'golden-old', category: 'bug', content: 'Old fact' });
    store.forget('golden-old');

    const parsed: unknown = JSON.parse(readRawStore(dir));
    expect(Array.isArray(parsed)).toBe(true);

    // Exact current MemoryRecord field vocabulary (src/memory/sqliteStore.ts).
    const allowedKeys = [
      'id', 'category', 'content', 'timestamp',
      'tags', 'status', 'invalidAt', 'supersedes',
      'intent', 'artifacts', 'errorsAndFixes', 'nextSteps'
    ];
    const records = parsed as Array<Record<string, unknown>>;
    for (const record of records) {
      for (const key of Object.keys(record)) {
        expect(allowedKeys).toContain(key);
      }
      expect(record.id).toEqual(expect.any(String));
      expect(record.category).toEqual(expect.any(String));
      expect(record.content).toEqual(expect.any(String));
      expect(record.timestamp).toEqual(expect.any(String));
    }

    const byId = new Map(records.map((r) => [String(r.id), r]));

    const active = byId.get('golden-active');
    expect(active).toBeDefined();
    expect(active?.category).toBe('decision');
    expect(active?.content).toBe('Active fact');
    expect(active?.status).toBe('active');

    // Forgotten record keeps its fields; only status flips + invalidAt set.
    const forgotten = byId.get('golden-old');
    expect(forgotten).toBeDefined();
    expect(forgotten?.category).toBe('bug');
    expect(forgotten?.content).toBe('Old fact');
    expect(forgotten?.timestamp).toEqual(expect.any(String));
    expect(forgotten?.status).toBe('forgotten');
    expect(forgotten?.invalidAt).toEqual(expect.any(String));
  });
});
