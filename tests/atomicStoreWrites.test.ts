import { afterEach, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SqliteStore } from '../src/memory/sqliteStore.js';
import { SwarmMeshEngine } from '../src/memory/swarmMesh.js';
import {
  ATOMIC_RENAME_MAX_ATTEMPTS,
  ATOMIC_RENAME_RETRY_DELAYS_MS,
  writeAtomicText
} from '../src/memory/fileLock.js';
import { removeTestDirs } from './testUtils.js';

const faultState = vi.hoisted(() => ({ queue: [] as Error[] }));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    renameSync: vi.fn((oldPath: fs.PathLike, newPath: fs.PathLike) => {
      const nextErr = faultState.queue.shift();
      if (nextErr) throw nextErr;
      return actual.renameSync(oldPath, newPath);
    })
  };
});

const dirs: string[] = [];
const makeDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-atomic-write-'));
  dirs.push(dir);
  return dir;
};

function errnoError(code: string, message = `injected ${code}`): NodeJS.ErrnoException {
  return Object.assign(new Error(message), { code, syscall: 'rename' });
}

function queueRenameErrors(code: string, count: number, message?: string): void {
  for (let i = 0; i < count; i++) {
    faultState.queue.push(errnoError(code, message));
  }
}

afterEach(() => {
  faultState.queue.length = 0;
  vi.clearAllMocks();
  vi.restoreAllMocks();
  removeTestDirs(dirs);
});

it('commits an immediate successful rename in one attempt without leaving lock or temp artifacts', () => {
  const memoryDir = makeDir();
  const store = new SqliteStore(memoryDir);
  store.set({ id: 'immediate', category: 'general', content: 'clean write' });

  expect(fs.renameSync).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fs.readFileSync(path.join(memoryDir, 'memory_store.json'), 'utf8'))).toHaveLength(1);
  expect(fs.existsSync(path.join(memoryDir, 'memory_store.json.tmp'))).toBe(false);
  expect(fs.existsSync(path.join(memoryDir, 'memory_store.json.lock'))).toBe(false);
});

it.each(['EPERM', 'EBUSY'])('retries one transient %s rename for both memory and swarm writes', (code) => {
  const memoryDir = makeDir();
  const store = new SqliteStore(memoryDir);
  queueRenameErrors(code, 1, 'busy');
  store.set({ id: 'a', category: 'general', content: 'saved' });
  expect(JSON.parse(fs.readFileSync(path.join(memoryDir, 'memory_store.json'), 'utf8'))[0].content).toBe('saved');
  expect(fs.renameSync).toHaveBeenCalledTimes(2);
  expect(fs.existsSync(path.join(memoryDir, 'memory_store.json.tmp'))).toBe(false);
  expect(fs.existsSync(path.join(memoryDir, 'memory_store.json.lock'))).toBe(false);

  vi.mocked(fs.renameSync).mockClear();
  const swarmDir = makeDir();
  const swarm = new SwarmMeshEngine(swarmDir);
  queueRenameErrors(code, 1, 'busy');
  swarm.broadcast('agent', 'saved');
  const state = JSON.parse(fs.readFileSync(path.join(swarmDir, '.hypersabmemory', 'swarm_state.json'), 'utf8'));
  expect(state.broadcasts[0].message).toBe('saved');
  expect(fs.renameSync).toHaveBeenCalledTimes(2);
  expect(fs.existsSync(path.join(swarmDir, '.hypersabmemory', 'swarm_state.json.tmp'))).toBe(false);
  expect(fs.existsSync(path.join(swarmDir, '.hypersabmemory', 'swarm_state.json.lock'))).toBe(false);
});

it.each([
  { code: 'EPERM', transientFailures: 4 },
  { code: 'EBUSY', transientFailures: 3 }
])('recovers from $transientFailures consecutive transient $code rename errors up to the bounded retry limit', ({ code, transientFailures }) => {
  const memoryDir = makeDir();
  const store = new SqliteStore(memoryDir);
  store.set({ id: 'seed', category: 'decision', content: 'seeded fact' });
  vi.mocked(fs.renameSync).mockClear();

  queueRenameErrors(code, transientFailures, `transient ${code}`);
  store.setAndSupersede(
    { id: 'updated', category: 'decision', content: 'updated fact' },
    (existing) => existing.id === 'seed'
  );

  expect(fs.renameSync).toHaveBeenCalledTimes(transientFailures + 1);
  const persisted = JSON.parse(fs.readFileSync(path.join(memoryDir, 'memory_store.json'), 'utf8')) as Array<{
    id: string;
    content: string;
    status?: string;
    tags?: string[];
  }>;
  expect(persisted).toHaveLength(2);
  expect(persisted.filter((r) => r.id === 'seed' && r.status === 'superseded')).toHaveLength(1);
  expect(persisted.filter((r) => r.id === 'updated' && r.status === 'active')).toHaveLength(1);
  expect(fs.existsSync(path.join(memoryDir, 'memory_store.json.tmp'))).toBe(false);
  expect(fs.existsSync(path.join(memoryDir, 'memory_store.json.lock'))).toBe(false);
});

it('propagates EPERM after 5 bounded rename attempts while preserving the prior store and cleaning the lock', () => {
  const memoryDir = makeDir();
  const store = new SqliteStore(memoryDir);
  store.set({ id: 'committed', category: 'general', content: 'previous good value' });
  vi.mocked(fs.renameSync).mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => {});

  queueRenameErrors('EPERM', 6, 'persistent EPERM lock');
  const startedAt = Date.now();
  expect(() => store.set({ id: 'uncommitted', category: 'general', content: 'failed update' })).toThrow('persistent EPERM lock');
  const elapsedMs = Date.now() - startedAt;

  expect(fs.renameSync).toHaveBeenCalledTimes(5);
  expect(elapsedMs).toBeGreaterThanOrEqual(200);
  expect(elapsedMs).toBeLessThan(2000);
  expect(store.get('uncommitted')).toBeUndefined();
  expect(store.getActive().map((r) => r.id)).toEqual(['committed']);

  const diskRecords = JSON.parse(fs.readFileSync(path.join(memoryDir, 'memory_store.json'), 'utf8')) as Array<{ id: string }>;
  expect(diskRecords.map((r) => r.id)).toEqual(['committed']);
  expect(fs.existsSync(path.join(memoryDir, 'memory_store.json.tmp'))).toBe(true);
  const tmpRecords = JSON.parse(fs.readFileSync(path.join(memoryDir, 'memory_store.json.tmp'), 'utf8')) as Array<{ id: string }>;
  expect(tmpRecords.map((r) => r.id)).toEqual(['committed', 'uncommitted']);
  expect(fs.existsSync(path.join(memoryDir, 'memory_store.json.lock'))).toBe(false);
});

it('preserves each store’s existing behavior on a non-retryable rename error', () => {
  const memoryDir = makeDir();
  const store = new SqliteStore(memoryDir);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  queueRenameErrors('EIO', 1, 'I/O failure');
  expect(() => store.set({ id: 'a', category: 'general', content: 'unsaved' })).toThrow('I/O failure');
  expect(store.get('a')).toBeUndefined();
  expect(store.getActive()).toEqual([]);
  expect(fs.renameSync).toHaveBeenCalledTimes(1);
  expect(fs.existsSync(path.join(memoryDir, 'memory_store.json.tmp'))).toBe(true);
  expect(fs.existsSync(path.join(memoryDir, 'memory_store.json.lock'))).toBe(false);

  vi.mocked(fs.renameSync).mockClear();
  const swarmDir = makeDir();
  const swarm = new SwarmMeshEngine(swarmDir);
  queueRenameErrors('EIO', 1, 'I/O failure');
  expect(swarm.broadcast('agent', 'unsaved').message).toBe('unsaved');
  expect(fs.existsSync(path.join(swarmDir, '.hypersabmemory', 'swarm_state.json.tmp'))).toBe(true);
  expect(fs.existsSync(path.join(swarmDir, '.hypersabmemory', 'swarm_state.json.lock'))).toBe(false);
  expect(fs.renameSync).toHaveBeenCalledTimes(1);
});

it('uses bounded [20, 40, 80, 160] ms backoff and keeps temporary file contents intact across retries', () => {
  const dir = makeDir();
  const target = path.join(dir, 'target.json');
  const tmpPath = `${target}.tmp`;
  fs.writeFileSync(target, '{"state":"original"}', 'utf8');

  expect(ATOMIC_RENAME_RETRY_DELAYS_MS).toEqual([20, 40, 80, 160]);
  expect(ATOMIC_RENAME_MAX_ATTEMPTS).toBe(5);

  const delays: number[] = [];
  queueRenameErrors('EPERM', 5, 'locked');
  expect(() =>
    writeAtomicText(target, '{"state":"next"}', {
      sleep: (ms) => {
        expect(fs.readFileSync(tmpPath, 'utf8')).toBe('{"state":"next"}');
        expect(fs.readFileSync(target, 'utf8')).toBe('{"state":"original"}');
        delays.push(ms);
      }
    })
  ).toThrow('locked');

  expect(delays).toEqual([20, 40, 80, 160]);
  expect(fs.renameSync).toHaveBeenCalledTimes(5);
  expect(fs.readFileSync(target, 'utf8')).toBe('{"state":"original"}');
  expect(fs.readFileSync(tmpPath, 'utf8')).toBe('{"state":"next"}');
});
