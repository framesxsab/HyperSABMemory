import { afterEach, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SqliteStore } from '../src/memory/sqliteStore.js';
import { SwarmMeshEngine } from '../src/memory/swarmMesh.js';

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, renameSync: vi.fn(actual.renameSync) };
});

const dirs: string[] = [];
const makeDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-atomic-write-'));
  dirs.push(dir);
  return dir;
};

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

it.each(['EPERM', 'EBUSY'])('retries a %s rename for both memory and swarm writes', (code) => {
  const memoryDir = makeDir();
  const store = new SqliteStore(memoryDir);
  vi.mocked(fs.renameSync).mockImplementationOnce(() => { throw Object.assign(new Error('busy'), { code }); });
  store.set({ id: 'a', category: 'general', content: 'saved' });
  expect(JSON.parse(fs.readFileSync(path.join(memoryDir, 'memory_store.json'), 'utf8'))[0].content).toBe('saved');
  expect(fs.renameSync).toHaveBeenCalledTimes(2);

  vi.mocked(fs.renameSync).mockClear();
  const swarmDir = makeDir();
  const swarm = new SwarmMeshEngine(swarmDir);
  vi.mocked(fs.renameSync).mockImplementationOnce(() => { throw Object.assign(new Error('busy'), { code }); });
  swarm.broadcast('agent', 'saved');
  const state = JSON.parse(fs.readFileSync(path.join(swarmDir, '.hypersabmemory', 'swarm_state.json'), 'utf8'));
  expect(state.broadcasts[0].message).toBe('saved');
  expect(fs.renameSync).toHaveBeenCalledTimes(2);
});

it('preserves each store’s existing behavior on a non-retryable rename error', () => {
  const memoryDir = makeDir();
  const store = new SqliteStore(memoryDir);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.mocked(fs.renameSync).mockImplementationOnce(() => { throw Object.assign(new Error('I/O failure'), { code: 'EIO' }); });
  expect(() => store.set({ id: 'a', category: 'general', content: 'unsaved' })).toThrow('I/O failure');
  expect(store.get('a')).toBeUndefined();
  expect(store.getActive()).toEqual([]);
  expect(fs.existsSync(path.join(memoryDir, 'memory_store.json.tmp'))).toBe(true);

  vi.mocked(fs.renameSync).mockClear();
  const swarmDir = makeDir();
  const swarm = new SwarmMeshEngine(swarmDir);
  vi.mocked(fs.renameSync).mockImplementationOnce(() => { throw Object.assign(new Error('I/O failure'), { code: 'EIO' }); });
  expect(swarm.broadcast('agent', 'unsaved').message).toBe('unsaved');
  expect(fs.existsSync(path.join(swarmDir, '.hypersabmemory', 'swarm_state.json.tmp'))).toBe(true);
  expect(fs.renameSync).toHaveBeenCalledTimes(1);
});
