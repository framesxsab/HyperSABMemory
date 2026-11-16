import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqliteStore } from '../src/memory/sqliteStore.js';
import { SwarmMeshEngine } from '../src/memory/swarmMesh.js';
import { spawn, execFileSync, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import { removeTestDirs } from './testUtils.js';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

// Non-literal specifier on purpose: until src/memory/fileLock.ts exists, only
// the test that imports it fails (module not found), not the whole file.
const FILE_LOCK_SPECIFIER = '../src/memory/fileLock.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const distStoreEntry = path.join(repoRoot, 'dist', 'memory', 'sqliteStore.js');
const distTemporalMemoryEntry = path.join(repoRoot, 'dist', 'memory', 'temporalMemory.js');

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
    removeTestDirs(dirs);
  });

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

  it('(a-swarm) two swarm engines on one dir: exactly one file-claim holder, no lost updates', () => {
    const dir = tmpDir();
    const engineA = new SwarmMeshEngine(dir);
    const engineB = new SwarmMeshEngine(dir);

    // Lost-update probe: A mutates after B cached its construction-time state.
    engineA.broadcast('agent-a', 'alpha finding');
    const claimB = engineB.claimFile('agent-b', 'src/foo.ts');
    expect(claimB.ok).toBe(true);

    const raw = fs.readFileSync(path.join(dir, '.hypersabmemory', 'swarm_state.json'), 'utf-8');
    const persisted = JSON.parse(raw) as { broadcasts: Array<{ message: string }>; fileLocks: unknown[] };
    expect(persisted.broadcasts.some((b) => b.message === 'alpha finding')).toBe(true); // B's claim must not clobber A's broadcast
    expect(persisted.fileLocks).toHaveLength(1);

    // Double-acquire of the same path: second claimant is denied.
    const claimA = engineA.claimFile('agent-a', 'src/foo.ts');
    expect(claimA.ok).toBe(false);
    expect(claimA.heldBy).toBe('agent-b');
    expect(claimA.reason).toBe('locked');

    // Case-insensitive variant collides on win32 (canonical lock keys).
    if (process.platform === 'win32') {
      const upper = engineA.claimFile('agent-a', 'src/Foo.ts');
      expect(upper.ok).toBe(false);
      expect(upper.reason).toBe('locked');
      expect(upper.heldBy).toBe('agent-b');
    }
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

  it('(b2) concurrent remember operations persist complete supersede transactions', async () => {
    const dir = tmpDir();
    const prefix = `Shared concurrency memory fact ${uniqueSuffix()} with a common long prefix to serialize the writes safely: `;
    const contents = [`${prefix}first version`, `${prefix}second version`];
    const script = [
      "const { TemporalMemoryEngine } = await import(process.argv[1]);",
      "new TemporalMemoryEngine(process.argv[2]).remember('architecture', process.argv[3]);"
    ].join('\n');

    const children = contents.map((content) => spawn(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        script,
        pathToFileURL(distTemporalMemoryEntry).href,
        dir,
        content
      ],
      { stdio: 'ignore' }
    ));

    expect(await Promise.all(children.map(waitForExit))).toEqual([0, 0]);
    const records = JSON.parse(readRawStore(path.join(dir, '.hypersabmemory'))) as Array<{
      id: string;
      content: string;
      status?: string;
      tags?: string[];
    }>;
    const matching = records.filter(({ content }) => contents.includes(content));
    expect(matching).toHaveLength(2);
    expect(matching.filter(({ status }) => status === 'active')).toHaveLength(1);
    expect(matching.filter(({ status }) => status === 'superseded')).toHaveLength(1);
    const active = matching.find(({ status }) => status === 'active');
    const superseded = matching.find(({ status }) => status === 'superseded');
    expect(active).toBeDefined();
    expect(superseded?.tags).toContain(`superseded-by:${active?.id}`);
  }, 30_000);

  it('serializes checkpoints from separate processes on the same repository', async () => {
    const dir = tmpDir();
    const git = (args: string[]): string => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
    git(['init']);
    git(['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-m', 'initial']);
    fs.writeFileSync(path.join(dir, 'work.txt'), 'shared change');
    const entry = pathToFileURL(path.join(repoRoot, 'dist/hooks/autoCommit.js')).href;
    const script = "const { AutoCommitEngine } = await import(process.argv[1]); const result = await new AutoCommitEngine({ workspaceDir: process.argv[2] }).createCheckpoint(); if (result.status === 'failed') process.exitCode = 1;";
    const children = Array.from({ length: 2 }, () => spawn(process.execPath,
      ['--input-type=module', '-e', script, entry, dir], { stdio: 'ignore' }));

    expect(await Promise.all(children.map(waitForExit))).toEqual([0, 0]);
    expect(git(['rev-list', '--count', 'HEAD']).trim()).toBe('2');
    expect(git(['status', '--porcelain']).trim()).toBe('');
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
