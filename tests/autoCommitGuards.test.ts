import { describe, it, expect, vi } from 'vitest';

/**
 * Argv-level guard tests for AutoCommitEngine.
 * child_process.execFile is mocked here so we can assert the EXACT git argv
 * the engine issues (real-git functional tests live in autoCommit.test.ts).
 */

const { calls } = vi.hoisted(() => ({
  calls: [] as Array<{ file: string; args: string[] }>
}));

vi.mock('child_process', () => ({
  execFile: (
    file: string,
    args: string[],
    _opts: unknown,
    cb: (err: unknown, out: { stdout: string; stderr: string }) => void
  ) => {
    let stdout = '';
    if (args[0] === 'status') stdout = ' M tracked.txt\n';
    else if (args.includes('--short')) stdout = 'abc1234\n';
    else if (args.includes('--git-dir')) stdout = '.git\n';
    else if (args.includes('--show-toplevel')) stdout = 'X:\\does-not-matter\n';
    calls.push({ file, args: [...args] });
    cb(null, { stdout, stderr: '' });
  }
}));

// eslint-disable-next-line import/first
import { AutoCommitEngine } from '../src/hooks/autoCommit.js';

describe('AutoCommitEngine — git argv guards', () => {
  it('B1: never runs `git config`; signs the commit via leading -c identity flags, keeps --author', async () => {
    calls.length = 0;
    const engine = new AutoCommitEngine({ workspaceDir: 'X:\\does-not-matter' });
    const result = await engine.createCheckpoint();

    expect(result.status).toBe('committed');

    // Identity hijack must be gone: no repo-local `git config user.*` writes.
    expect(calls.some((c) => c.args[0] === 'config')).toBe(false);

    // Commit carries bot identity per-invocation via -c pairs (leading args).
    const commit = calls.find((c) => c.args.includes('commit'));
    expect(commit).toBeDefined();
    expect(commit!.args.slice(0, 4)).toEqual([
      '-c',
      'user.name=hypersabmemory-bot',
      '-c',
      'user.email=hypersabmemory@users.noreply.github.com'
    ]);

    // Existing --author flag stays untouched.
    expect(commit!.args.some((a) => a.startsWith('--author='))).toBe(true);
  });

  it('B2: staging uses an exclude pathspec so .hypersabmemory can never be added', async () => {
    calls.length = 0;
    const engine = new AutoCommitEngine({ workspaceDir: 'X:\\does-not-matter' });
    await engine.createCheckpoint();

    const add = calls.find((c) => c.args[0] === 'add');
    expect(add).toBeDefined();
    expect(add!.args).toEqual(['add', '-A', '--', ':(exclude).hypersabmemory']);
  });
});
