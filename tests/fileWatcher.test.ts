import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import chokidar from 'chokidar';
import type { FSWatcher } from 'chokidar';
import { FileWatcherHook } from '../src/hooks/fileWatcher.js';
import { TemporalMemoryEngine } from '../src/memory/temporalMemory.js';

vi.mock('chokidar', () => ({
  default: { watch: vi.fn(), FSWatcher: class {} },
  FSWatcher: class {}
}));

// The real AutoCommitEngine spawns fire-and-forget git children whose cwd is
// the workspace; on Windows that briefly locks the tmp dir (EBUSY on cleanup).
vi.mock('../src/hooks/autoCommit.js', () => ({
  AutoCommitEngine: class {
    constructor(_options?: unknown) {}
    start(): void {}
    stop(): void {}
  }
}));

const dirs: string[] = [];
const hooks: FileWatcherHook[] = [];
let fakeWatcher: { on: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };

beforeEach(() => {
  fakeWatcher = { on: vi.fn().mockReturnThis(), close: vi.fn() };
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  for (const hook of hooks.splice(0)) hook.stop();
  vi.restoreAllMocks();
  // maxRetries: the hook's fire-and-forget initial git checkpoint can briefly
  // hold the tmp dir as its cwd on Windows (EBUSY) after stop().
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

function tmpWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-c4b-'));
  dirs.push(dir);
  return dir;
}

function startHook(options: ConstructorParameters<typeof FileWatcherHook>[0] = {}): string {
  const watchMock = vi.mocked(chokidar.watch);
  watchMock.mockReset();
  watchMock.mockReturnValue(fakeWatcher as unknown as FSWatcher);
  const workspace = tmpWorkspace();
  hooks.push(new FileWatcherHook({ workspaceDir: workspace, ...options }));
  hooks[hooks.length - 1].start();
  return workspace;
}

function watcherOptions(): chokidar.ChokidarOptions {
  const call = vi.mocked(chokidar.watch).mock.calls[0];
  if (!call) throw new Error('chokidar.watch was not called');
  return call[1] as chokidar.ChokidarOptions;
}

describe('FileWatcherHook — event flood taming (C4b)', () => {
  it('reports a persistence failure and retries the next event without crashing', () => {
    const workspace = startHook();
    const remember = vi.spyOn(TemporalMemoryEngine.prototype, 'remember')
      .mockImplementationOnce(() => { throw new Error('disk unavailable'); });
    const onChange = fakeWatcher.on.mock.calls.find(([event]) => event === 'change')?.[1] as (file: string) => void;
    const file = path.join(workspace, 'src', 'app.ts');

    expect(() => onChange(file)).not.toThrow();
    expect(console.error).toHaveBeenCalled();
    onChange(file);
    expect(remember).toHaveBeenCalledTimes(2);
    expect(hooks[0].getLatestHeader()).toContain('src');
  });

  it('ignores .venv, build, target, out, coverage and vendor directories', () => {
    // Given: a started watcher with the default ignore configuration
    const workspace = startHook();
    const ignored = watcherOptions().ignored;
    if (typeof ignored !== 'function') throw new Error('ignored must stay a function matcher');

    // When: paths inside dependency/build output directories are checked
    // Then: every flood-prone directory is ignored (OS-native separators)
    const ignoredDirs = ['.venv', 'build', 'target', 'out', 'coverage', 'vendor'];
    for (const dir of ignoredDirs) {
      expect(ignored(path.join(workspace, dir, 'somefile.txt'))).toBe(true);
    }

    // And: regular sources still pass through
    expect(ignored(path.join(workspace, 'src', 'app.ts'))).toBe(false);
  });

  it('keeps node_modules ignored and honors user-supplied patterns (Windows separator regression guard)', () => {
    // Given: a watcher with an extra user pattern
    const workspace = startHook({ ignoredPatterns: ['scratch-space'] });
    const ignored = watcherOptions().ignored;
    if (typeof ignored !== 'function') throw new Error('ignored must stay a function matcher');

    // When: Windows-style backslash paths are normalized through the matcher
    // Then: existing defaults and custom patterns still match
    expect(ignored(path.join(workspace, 'node_modules', 'pkg', 'index.js'))).toBe(true);
    expect(ignored(path.join(workspace, '.git', 'HEAD'))).toBe(true);
    expect(ignored(path.join(workspace, 'scratch-space', 'notes.md'))).toBe(true);
    expect(ignored(path.join(workspace, 'README.md'))).toBe(false);
  });

  it('configures awaitWriteFinish to debounce rapid successive writes', () => {
    // Given: a started watcher
    startHook();

    // When: the options passed to chokidar.watch are inspected
    const awf = watcherOptions().awaitWriteFinish;

    // Then: write-finish debouncing is configured within the agreed bounds
    if (typeof awf !== 'object' || awf === null) throw new Error('awaitWriteFinish must be an options object');
    expect(awf.stabilityThreshold).toBeGreaterThanOrEqual(300);
    expect(awf.stabilityThreshold).toBeLessThanOrEqual(500);
    expect(awf.pollInterval).toBe(100);
  });

  it('emits at most one remember per file within the cooldown window', () => {
    // Given: a started watcher and a spy on the memory engine
    const workspace = startHook();
    const rememberSpy = vi.spyOn(TemporalMemoryEngine.prototype, 'remember');
    const changeCall = fakeWatcher.on.mock.calls.find((args) => args[0] === 'change');
    if (!changeCall) throw new Error('watcher did not subscribe to change events');
    const onChange = changeCall[1] as (filePath: string) => void;

    // When: two rapid change events arrive for one file, then one for another
    const fileA = path.join(workspace, 'src', 'a.ts');
    const fileB = path.join(workspace, 'src', 'b.ts');
    onChange(fileA);
    onChange(fileA);
    onChange(fileB);

    // Then: the second burst on fileA is suppressed by the per-file cooldown
    expect(rememberSpy).toHaveBeenCalledTimes(2);
  });
});
