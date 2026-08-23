import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { OneShotSetupEngine } from '../src/cli/oneShotSetup.js';

const dirs: string[] = [];

function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-contain-'));
  dirs.push(dir);
  return dir;
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' });
}

function excludeLines(dir: string): string[] {
  const raw = fs.readFileSync(path.join(dir, '.git', 'info', 'exclude'), 'utf-8');
  return raw.split(/\r?\n/).filter((line) => line.trim() === '.hypersabmemory/');
}

afterAll(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('HyperSABMemory — store containment via .git/info/exclude (B2)', () => {
  it('adds .hypersabmemory/ to .git/info/exclude exactly once across double setup', async () => {
    // Given: a target project that is a git repository
    const dir = tmpDir();
    git(dir, ['init']);

    // When: setup runs twice
    const first = await new OneShotSetupEngine(dir).executeSetup();
    const second = await new OneShotSetupEngine(dir).executeSetup();

    // Then: the exclude rule exists exactly once and setup still succeeds
    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(excludeLines(dir)).toHaveLength(1);
  }, 30000);

  it('succeeds silently when the target has no .git directory', async () => {
    // Given: a plain directory with no git repo
    const dir = tmpDir();

    // When: setup runs
    const result = await new OneShotSetupEngine(dir).executeSetup();

    // Then: it completes without crashing
    expect(result.success).toBe(true);
  }, 30000);

  it('untracks an already-committed .hypersabmemory directory', async () => {
    // Given: a repo where a dummy store file is already tracked
    const dir = tmpDir();
    git(dir, ['init']);
    fs.mkdirSync(path.join(dir, '.hypersabmemory'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.hypersabmemory', 'x.txt'), 'leak', 'utf-8');
    git(dir, ['add', '-A']);
    git(dir, ['-c', 'user.email=test@test', '-c', 'user.name=test', 'commit', '-m', 'seed']);
    expect(git(dir, ['ls-files', '--', '.hypersabmemory'])).toContain('x.txt');

    // When: setup runs
    const result = await new OneShotSetupEngine(dir).executeSetup();

    // Then: the store files are no longer tracked
    expect(result.success).toBe(true);
    expect(git(dir, ['ls-files', '--', '.hypersabmemory']).trim()).toBe('');
  }, 30000);
});
