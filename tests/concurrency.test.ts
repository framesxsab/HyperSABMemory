import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import { SqliteStore } from '../src/memory/sqliteStore.js';
import { spawn, execSync, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

// Non-literal specifier on purpose: until src/memory/fileLock.ts exists, only
// the test that imports it fails (module not found), not the whole file.
const FILE_LOCK_SPECIFIER = '../src/memory/fileLock.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const distCliEntry = path.join(repoRoot, 'dist', 'cli', 'index.js');
const distStoreEntry = path.join(repoRoot, 'dist', 'memory', 'sqliteStore.js');

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

function waitForExit(child: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    child.on('exit', (code) => resolve(code ?? -1));
    child.on('error', reject);
  });
}

function childScript(): string {
  return [
    "const { SqliteStore } = await import(process.argv[1]);",
    "const store = new SqliteStore(process.argv[2]);",
    "for (let i = 0; i < 5; i++) {",
    "  store.set({ id: process.argv[3] + '-' + i, category: 'general', content: process.argv[4] + '-' + i });",
    "}"
  ].join('\n');
}

function spawnDeadPid(): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', 'console.log(process.pid)'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout?.on('data', (chunk: Buffer) => { out += chunk.toString(); });
    child.on('exit', () => {
      const pid = Number.parseInt(out.trim(), 10);
      if (Number.isInteger(pid) && pid > 0) resolve(pid);
      else reject(new Error(`could not parse dead pid from output: '${out.trim()}'`));
    });
    child.on('error', reject);
  });
}

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
    vi.restoreAllMocks();
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  beforeAll(() => {
    if (!fs.existsSync(distCliEntry)) {
      execSync('npm run build', { cwd: repoRoot, stdio: 'ignore' });
    }
  }, 120_000);

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('(a-store) two store instances on one workspace dir both persist their facts', () => {
    const dir = tmpDir();
    const rand = uniqueSuffix();
    const alpha = `alpha-${rand}`;
    const beta = `beta-${rand}`;

    const engineA = new SqliteStore(dir);
    const engineB = new SqliteStore(dir);
    engineA.set({ id: `mem-a-${rand}`, category: 'decision', content: alpha });
    engineB.set({ id: `mem-b-${rand}`, category: 'decision', content: beta });

    const raw = readRawStore(dir);
    expect(raw).toContain(alpha);
    expect(raw).toContain(beta);
  });

  it('(b) two real child processes writing to one dir keep all 10 facts', async () => {
    const dir = tmpDir();
    const rand = uniqueSuffix();
    const script = childScript();

    const children = (['procA', 'procB'] as const).map((prefix) => spawn(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        script,
        pathToFileURL(distStoreEntry).href,
        dir,
        prefix,
        `${prefix}-content-${rand}`
      ],
      { stdio: 'ignore' }
    ));

    const exitCodes = await Promise.all(children.map(waitForExit));
    expect(exitCodes).toEqual([0, 0]);

    const raw = readRawStore(dir);
    for (let i = 0; i < 5; i++) {
      expect(raw).toContain(`procA-content-${rand}-${i}`);
      expect(raw).toContain(`procB-content-${rand}-${i}`);
    }
  }, 30_000);

  it('(c) evicts a lock sentinel held by a dead pid within the 2s budget', async () => {
    const lockModule = (await import(FILE_LOCK_SPECIFIER)) as {
      withFileLock: <T>(lockPath: string, fn: () => T) => T;
    };

    const deadPid = await spawnDeadPid();
    expect(() => process.kill(deadPid, 0)).toThrow();

    const dir = tmpDir();
    const lockPath = path.join(dir, 'memory_store.json.lock');
    fs.writeFileSync(lockPath, JSON.stringify({ pid: deadPid, acquiredAt: Date.now() }), 'utf-8');

    const started = Date.now();
    let ranInside = false;
    expect(() => lockModule.withFileLock(lockPath, () => { ranInside = true; })).not.toThrow();
    expect(ranInside).toBe(true);
    expect(Date.now() - started).toBeLessThan(2000);
  }, 10_000);

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
