import { describe, it, expect, vi, afterEach } from 'vitest';
import { AutoCommitEngine } from '../src/hooks/autoCommit.js';
import { execSync, execFileSync } from 'child_process';
import * as fs from 'fs';
import { removeTestDirs } from './testUtils.js';
import * as os from 'os';
import * as path from 'path';

function run(dir: string, command: string): string {
  return execSync(command, { cwd: dir, encoding: 'utf-8' });
}

// Shell-less git call: needed for formats containing % (cmd.exe mangles them).
function runGit(dir: string, args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf-8' });
}

function initRepo(withIdentity: boolean = true): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-ac-'));
  run(dir, 'git init');
  if (withIdentity) {
    run(dir, 'git config user.email test@example.com');
    run(dir, 'git config user.name test');
  }
  return dir;
}

function commitFile(dir: string, name: string, content: string, message: string): void {
  fs.writeFileSync(path.join(dir, name), content, 'utf-8');
  run(dir, 'git add -A');
  // Per-invocation identity: fixtures must commit even with no git identity configured (CI).
  run(dir, `git -c user.name=seed -c user.email=seed@example.com commit -m "${message}"`);
}

function shortHead(dir: string): string {
  return run(dir, 'git rev-parse --short HEAD').trim();
}

const dirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  removeTestDirs(dirs);
});

describe('HyperSABMemory — Safe Rollback + History + Diff (P11)', () => {
  it('creates a safety checkpoint before reset and lands exactly on the target', async () => {
    const dir = initRepo();
    dirs.push(dir);
    commitFile(dir, 'a.txt', 'v1', 'first');
    const target = shortHead(dir);

    const safetyCommits: Array<{ hash: string; message: string }> = [];
    const engine = new AutoCommitEngine({
      workspaceDir: dir,
      onCommit: (hash, message) => safetyCommits.push({ hash, message })
    });

    fs.writeFileSync(path.join(dir, 'b.txt'), 'uncommitted work', 'utf-8');
    const ok = await engine.rollback(target);

    expect(ok).toBe(true);
    expect(shortHead(dir)).toBe(target);
    expect(fs.existsSync(path.join(dir, 'b.txt'))).toBe(false);
    expect(safetyCommits.some((c) => c.message.includes('safety: pre-rollback snapshot'))).toBe(true);
    const safety = safetyCommits.find((c) => c.message.includes('safety: pre-rollback snapshot'));
    expect(run(dir, `git cat-file -t ${safety!.hash}`).trim()).toBe('commit');
  }, 30_000);

  it('rejects regex-valid hashes that do not exist', async () => {
    const dir = initRepo();
    dirs.push(dir);
    commitFile(dir, 'a.txt', 'v1', 'first');

    const engine = new AutoCommitEngine({ workspaceDir: dir });
    expect(await engine.rollback('deadbeef')).toBe(false);
  });

  it('reports clean trees and non-repo directories honestly', async () => {
    const dir = initRepo();
    dirs.push(dir);
    commitFile(dir, 'a.txt', 'v1', 'first');

    const clean = await new AutoCommitEngine({ workspaceDir: dir }).createCheckpoint();
    expect(clean.committed).toBe(false);
    expect(clean.status).toBe('clean');

    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-ac-bare-'));
    dirs.push(bare);
    const outside = await new AutoCommitEngine({ workspaceDir: bare }).createCheckpoint();
    expect(outside.committed).toBe(false);
    expect(outside.status).toBe('not-a-repo');
  });

  it('coalesces overlapping timer/manual checkpoint requests into one commit', async () => {
    const dir = initRepo();
    dirs.push(dir);
    commitFile(dir, 'a.txt', 'v1', 'first');
    fs.writeFileSync(path.join(dir, 'b.txt'), 'shared work', 'utf-8');
    const before = Number(runGit(dir, ['rev-list', '--count', 'HEAD']).trim());
    const engine = new AutoCommitEngine({ workspaceDir: dir });

    const [first, overlapping] = await Promise.all([
      engine.createCheckpoint('first request'),
      engine.createCheckpoint('overlapping request')
    ]);

    expect(first).toBe(overlapping);
    expect(first.committed).toBe(true);
    expect(Number(runGit(dir, ['rev-list', '--count', 'HEAD']).trim())).toBe(before + 1);
    expect(runGit(dir, ['show', '-s', '--format=%s', 'HEAD']).trim()).toBe('feat: first request');
  });

  it('serializes independent engines sharing one repository', async () => {
    const dir = initRepo();
    dirs.push(dir);
    commitFile(dir, 'a.txt', 'v1', 'first');
    fs.writeFileSync(path.join(dir, 'b.txt'), 'shared work', 'utf-8');
    const results = await Promise.all([
      new AutoCommitEngine({ workspaceDir: dir }).createCheckpoint(),
      new AutoCommitEngine({ workspaceDir: dir }).createCheckpoint()
    ]);

    expect(results.map(({ status }) => status).sort()).toEqual(['clean', 'committed']);
    expect(runGit(dir, ['rev-list', '--count', 'HEAD']).trim()).toBe('2');
  });

  it('still rolls back when the safety checkpoint itself fails', async () => {
    const dir = initRepo();
    dirs.push(dir);
    commitFile(dir, 'a.txt', 'v1', 'first');
    const target = shortHead(dir);
    commitFile(dir, 'a.txt', 'v2', 'second');

    const engine = new AutoCommitEngine({ workspaceDir: dir });
    vi.spyOn(engine, 'createCheckpoint').mockRejectedValue(new Error('safety boom'));

    expect(await engine.rollback(target)).toBe(true);
    expect(shortHead(dir)).toBe(target);
  });

  it('lists checkpoint history with hash, message and date', async () => {
    const dir = initRepo();
    dirs.push(dir);
    commitFile(dir, 'a.txt', 'v1', 'alpha commit');
    commitFile(dir, 'b.txt', 'v1', 'beta commit');

    const history = await new AutoCommitEngine({ workspaceDir: dir }).getHistory(2);
    expect(history).toHaveLength(2);
    expect(history[0].message).toBe('beta commit');
    expect(history[1].message).toBe('alpha commit');
    expect(history[0].hash).toBeTruthy();
    expect(history[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('previews the exact files a rollback would touch via getDiffBetween', async () => {
    const dir = initRepo();
    dirs.push(dir);
    commitFile(dir, 'a.txt', 'v1', 'first');
    const base = shortHead(dir);
    commitFile(dir, 'a.txt', 'v2', 'second');

    const diff = await new AutoCommitEngine({ workspaceDir: dir }).getDiffBetween(base);
    expect(diff).not.toBeNull();
    expect(diff!.nameStatus).toContain('a.txt');
    expect(diff!.stat).toContain('a.txt');
  });
});

describe('HyperSABMemory — Checkpoint hygiene (v1.4.0 repair floor)', () => {
  function localConfig(dir: string, key: string): string | undefined {
    try {
      return run(dir, `git config --local ${key}`).trim();
    } catch {
      return undefined;
    }
  }

  it('B1: checkpoint leaves repo-local git identity unset and signs via per-invocation -c flags', async () => {
    const dir = initRepo(false);
    dirs.push(dir);
    commitFile(dir, 'a.txt', 'v1', 'first');

    fs.writeFileSync(path.join(dir, 'b.txt'), 'dirty', 'utf-8');
    const result = await new AutoCommitEngine({ workspaceDir: dir }).createCheckpoint();

    expect(result.committed).toBe(true);
    expect(localConfig(dir, 'user.name')).toBeUndefined();
    expect(localConfig(dir, 'user.email')).toBeUndefined();
    expect(runGit(dir, ['log', '-1', '--format=%cn|%ce']).trim()).toBe(
      'hypersabmemory-bot|hypersabmemory@users.noreply.github.com'
    );
  });

  it('B3: checkpoint logging never writes to stdio stdout (MCP JSON-RPC safety)', async () => {
    const dir = initRepo();
    dirs.push(dir);
    commitFile(dir, 'a.txt', 'v1', 'first');
    fs.writeFileSync(path.join(dir, 'b.txt'), 'dirty', 'utf-8');

    // Vitest intercepts console.* before raw streams, so assert both layers (raw stdout = production invariant).
    const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await new AutoCommitEngine({ workspaceDir: dir }).createCheckpoint();

    expect(result.committed).toBe(true);
    expect(outSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy.mock.calls.some((c) => String(c[0]).includes('Created checkpoint'))).toBe(true);
  });

  it('B5: refuses to checkpoint while a merge is in progress (MERGE_HEAD present)', async () => {
    const dir = initRepo();
    dirs.push(dir);
    commitFile(dir, 'a.txt', 'v1', 'first');
    const before = shortHead(dir);

    fs.writeFileSync(path.join(dir, '.git', 'MERGE_HEAD'), '1234567890abcdef1234567890abcdef12345678', 'utf-8');
    fs.writeFileSync(path.join(dir, 'conflicted.txt'), '<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> other\n', 'utf-8');

    const result = await new AutoCommitEngine({ workspaceDir: dir }).createCheckpoint();

    expect(result.committed).toBe(false);
    expect(result.status).toBe('operation-in-progress');
    expect(shortHead(dir)).toBe(before);
  });

  it('B5: refuses to sweep the whole tree when workspace is a subdir of the repo', async () => {
    const dir = initRepo();
    dirs.push(dir);
    commitFile(dir, 'a.txt', 'v1', 'first');
    const before = shortHead(dir);

    const sub = path.join(dir, 'packages', 'app');
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(sub, 'wip.ts'), 'teammate wip', 'utf-8');

    const result = await new AutoCommitEngine({ workspaceDir: sub }).createCheckpoint();

    expect(result.committed).toBe(false);
    expect(result.status).toBe('subdir-of-repo');
    expect(shortHead(dir)).toBe(before);
  });

  it('B5: same repo root spelled with different case or separators is not a subdir', async () => {
    const dir = initRepo();
    dirs.push(dir);
    commitFile(dir, 'a.txt', 'v1', 'first');
    fs.writeFileSync(path.join(dir, 'b.txt'), 'v2', 'utf-8');

    const variant = process.platform === 'win32'
      ? dir.replace(/\\/g, '/').toLowerCase()
      : path.join(dir, 'nested', '..');

    const result = await new AutoCommitEngine({ workspaceDir: variant }).createCheckpoint();

    expect(result.status).not.toBe('subdir-of-repo');
    expect(result.committed).toBe(true);
  });

  it('B2: tracked .hypersabmemory files are never staged into checkpoints', async () => {
    const dir = initRepo();
    dirs.push(dir);
    commitFile(dir, 'a.txt', 'v1', 'first');
    fs.mkdirSync(path.join(dir, '.hypersabmemory'), { recursive: true });
    commitFile(dir, path.join('.hypersabmemory', 'memory.json'), '{"facts":[]}', 'seed memory store');

    fs.writeFileSync(path.join(dir, '.hypersabmemory', 'memory.json'), '{"facts":["x"]}', 'utf-8');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'v2', 'utf-8');

    const result = await new AutoCommitEngine({ workspaceDir: dir }).createCheckpoint();

    expect(result.committed).toBe(true);
    const changed = runGit(dir, ['show', '--name-only', '--format=', 'HEAD']);
    expect(changed).toContain('a.txt');
    expect(changed).not.toContain('.hypersabmemory');
  });
});
