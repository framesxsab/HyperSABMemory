import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { OneShotSetupEngine } from '../src/cli/oneShotSetup.js';
import { runDoctor } from '../src/cli/doctor.js';
import { AutoCommitEngine } from '../src/hooks/autoCommit.js';
import { HyperSABMemoryMcpServer, resolveActiveFilePath } from '../src/mcp/server.js';
import { executeTaskTool } from '../src/mcp/taskTools.js';
import { captureTaskSources, inspectTaskSources } from '../src/harness/taskSources.js';
import { TaskError, TaskLedger } from '../src/memory/taskLedger.js';
import { TemporalMemoryEngine } from '../src/memory/temporalMemory.js';
import { HybridSearchEngine } from '../src/memory/hybridSearch.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const builtCli = path.join(repoRoot, 'dist', 'cli', 'index.js');

const createdDirs: string[] = [];

function makeTempDir(prefix = 'hm-wt-test-'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}

function sha256Text(text: string): string {
  return createHash('sha256').update(Buffer.from(text, 'utf-8')).digest('hex');
}

function canSymlink(target: string, linkPath: string, type: 'file' | 'dir' | 'junction'): boolean {
  try {
    fs.symlinkSync(target, linkPath, type);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (process.platform === 'win32' && (code === 'EPERM' || code === 'EACCES')) {
      return false;
    }
    throw err;
  }
}

function createRepoWithWorktrees(): { base: string; mainDir: string; wtADir: string; wtBDir: string; mainHead: string } {
  const base = makeTempDir('hm-wt-suite-');
  const mainDir = path.join(base, 'main repo');
  const wtADir = path.join(base, 'linked wt alpha');
  const wtBDir = path.join(base, 'linked wt beta');
  fs.mkdirSync(mainDir, { recursive: true });

  git(mainDir, ['init', '-b', 'main']);
  fs.mkdirSync(path.join(mainDir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(mainDir, 'README.md'), '# Sample Worktree Repo\n\nPrimary checkout docs.\n', 'utf-8');
  fs.writeFileSync(path.join(mainDir, 'src', 'worker.ts'), 'export const tokenValue = "alpha123";\n', 'utf-8');
  git(mainDir, ['add', '-A']);
  git(mainDir, ['-c', 'user.name=seed', '-c', 'user.email=seed@example.com', 'commit', '-m', 'initial commit']);
  const mainHead = git(mainDir, ['rev-parse', 'HEAD']);

  git(mainDir, ['worktree', 'add', '-b', 'wt-alpha', wtADir]);
  git(mainDir, ['worktree', 'add', '-b', 'wt-beta', wtBDir]);

  return { base, mainDir, wtADir, wtBDir, mainHead };
}

async function connectMcpProcess(cwd: string, name: string): Promise<Client> {
  const client = new Client({ name, version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [builtCli, 'mcp'],
    cwd,
    stderr: 'pipe'
  });
  await client.connect(transport);
  return client;
}

afterAll(() => {
  for (const dir of createdDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

describe('HyperSABMemory — Git Worktree & Cross-Platform Portability (Sprint 4.2)', () => {
  it('contains stores via common info/exclude in both normal .git dirs and linked .git worktrees (with spaces)', async () => {
    const { mainDir, wtADir, wtBDir, mainHead } = createRepoWithWorktrees();

    expect(fs.statSync(path.join(mainDir, '.git')).isDirectory()).toBe(true);
    expect(fs.statSync(path.join(wtADir, '.git')).isFile()).toBe(true);

    // Default setup in linked worktree is idempotent, contains store, and creates zero commits.
    const wtSetup1 = await new OneShotSetupEngine(wtADir).executeSetup();
    const wtSetup2 = await new OneShotSetupEngine(wtADir).executeSetup();
    expect(wtSetup1.success).toBe(true);
    expect(wtSetup2.success).toBe(true);
    expect(git(wtADir, ['rev-parse', 'HEAD'])).toBe(mainHead);
    expect(git(wtADir, ['check-ignore', '.hypersabmemory'])).toBe('.hypersabmemory');
    expect(git(wtADir, ['status', '--porcelain', '--untracked-files=all'])).not.toContain('.hypersabmemory');

    // Legacy committed store inside linked worktree is untracked cleanly without touching normal repo HEAD.
    fs.writeFileSync(path.join(wtADir, '.hypersabmemory', 'legacy.json'), '{}', 'utf-8');
    git(wtADir, ['add', '-f', '.hypersabmemory/legacy.json']);
    git(wtADir, ['-c', 'user.name=seed', '-c', 'user.email=seed@example.com', 'commit', '-m', 'legacy store']);
    expect(git(wtADir, ['ls-files', '--', '.hypersabmemory'])).toContain('legacy.json');

    const cleanedSetup = await new OneShotSetupEngine(wtADir).executeSetup();
    expect(cleanedSetup.success).toBe(true);
    expect(git(wtADir, ['ls-files', '--', '.hypersabmemory'])).toBe('');

    // Shared common info/exclude stays deduplicated even under concurrent setups on main + multiple linked worktrees.
    const parallel = await Promise.all([
      new OneShotSetupEngine(mainDir).executeSetup(),
      new OneShotSetupEngine(wtADir).executeSetup(),
      new OneShotSetupEngine(wtBDir).executeSetup()
    ]);
    expect(parallel.every((item) => item.success)).toBe(true);

    const commonDir = path.resolve(wtADir, git(wtADir, ['rev-parse', '--git-common-dir']));
    const excludeLines = fs
      .readFileSync(path.join(commonDir, 'info', 'exclude'), 'utf-8')
      .split(/\r?\n/)
      .filter((line) => line.trim() === '.hypersabmemory/');
    expect(excludeLines).toHaveLength(1);
    expect(git(mainDir, ['check-ignore', '.hypersabmemory'])).toBe('.hypersabmemory');
    expect(git(wtBDir, ['check-ignore', '.hypersabmemory'])).toBe('.hypersabmemory');
  }, 45_000);

  it('runs genesis checkpoint ritual in a freshly setup linked worktree', async () => {
    const { mainDir, wtADir, mainHead } = createRepoWithWorktrees();

    const outcome = await new OneShotSetupEngine(wtADir).executeSetup({ checkpoint: true });
    expect(outcome.success).toBe(true);
    expect(outcome.genesisHash).toMatch(/^[0-9a-f]{4,}$/i);
    expect(git(wtADir, ['log', '-1', '--format=%s'])).toBe('feat: genesis: workspace memory baseline');
    expect(git(mainDir, ['rev-parse', 'HEAD'])).toBe(mainHead);
  }, 30_000);

  it('isolates checkpoints, rollbacks, MERGE_HEAD guards, and git config across multiple linked worktrees', async () => {
    const { mainDir, wtADir, wtBDir, mainHead } = createRepoWithWorktrees();
    await Promise.all([
      new OneShotSetupEngine(mainDir).executeSetup(),
      new OneShotSetupEngine(wtADir).executeSetup(),
      new OneShotSetupEngine(wtBDir).executeSetup()
    ]);

    const mainTarget = git(mainDir, ['rev-parse', '--short', 'HEAD']);
    fs.writeFileSync(path.join(wtADir, 'src', 'worker.ts'), 'export const tokenValue = "wt-alpha-v2";\n', 'utf-8');
    fs.writeFileSync(path.join(wtBDir, 'src', 'worker.ts'), 'export const tokenValue = "wt-beta-dirty";\n', 'utf-8');

    const wtAEngine = new AutoCommitEngine({ workspaceDir: wtADir });
    const wtBEngine = new AutoCommitEngine({ workspaceDir: wtBDir });
    const cpA = await wtAEngine.createCheckpoint('alpha change');
    expect(cpA.committed).toBe(true);
    expect(git(mainDir, ['rev-parse', 'HEAD'])).toBe(mainHead);
    expect(git(wtBDir, ['rev-parse', 'HEAD'])).toBe(mainHead);
    expect(git(wtADir, ['show', '--name-only', '--format=', 'HEAD'])).not.toContain('.hypersabmemory');

    // Repo identity stays unset in both main and worktree local config.
    expect(() => git(mainDir, ['config', '--local', 'user.name'])).toThrow();
    expect(() => git(wtADir, ['config', '--local', 'user.email'])).toThrow();
    expect(git(wtADir, ['log', '-1', '--format=%cn|%ce'])).toBe('hypersabmemory-bot|hypersabmemory@users.noreply.github.com');

    // Per-worktree MERGE_HEAD pauses only wtA, not wtB.
    const wtAGitDir = path.resolve(wtADir, git(wtADir, ['rev-parse', '--git-dir']));
    fs.writeFileSync(path.join(wtADir, 'conflict.txt'), 'dirty during merge', 'utf-8');
    fs.writeFileSync(path.join(wtAGitDir, 'MERGE_HEAD'), mainHead, 'utf-8');
    const blockedMerge = await wtAEngine.createCheckpoint();
    expect(blockedMerge.committed).toBe(false);
    expect(blockedMerge.status).toBe('operation-in-progress');

    const cpB = await wtBEngine.createCheckpoint('beta independent');
    expect(cpB.committed).toBe(true);
    expect(git(wtBDir, ['log', '-1', '--format=%s'])).toBe('feat: beta independent');
    fs.unlinkSync(path.join(wtAGitDir, 'MERGE_HEAD'));

    // Rollback in wtA resets only wtA, leaving main and wtB untouched.
    const wtBHeadBeforeRollback = git(wtBDir, ['rev-parse', 'HEAD']);
    expect(await wtAEngine.rollback(mainTarget)).toBe(true);
    expect(git(wtADir, ['rev-parse', '--short', 'HEAD'])).toBe(mainTarget);
    expect(git(mainDir, ['rev-parse', 'HEAD'])).toBe(mainHead);
    expect(git(wtBDir, ['rev-parse', 'HEAD'])).toBe(wtBHeadBeforeRollback);
  }, 45_000);

  it('rejects missing, malformed, and forged/escaping .git pointers without writing outside', async () => {
    const { base, mainDir, wtADir, mainHead } = createRepoWithWorktrees();
    const excludePath = path.join(mainDir, '.git', 'info', 'exclude');
    const wtAGitDir = path.resolve(wtADir, git(wtADir, ['rev-parse', '--git-dir']));

    const missingGit = path.join(base, 'no-git dir');
    const emptyDotGit = path.join(base, 'empty-dot-git');
    const malformedGit = path.join(base, 'malformed-dot-git');
    const forgedMain = path.join(base, 'forged-main-ptr');
    const forgedWt = path.join(base, 'forged-wt-ptr');
    const forgedOutside = path.join(base, 'forged-outside-ptr');
    const outsideTarget = path.join(base, 'outside target');

    for (const d of [missingGit, emptyDotGit, malformedGit, forgedMain, forgedWt, forgedOutside, outsideTarget]) {
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, 'file.txt'), 'untrusted', 'utf-8');
    }

    fs.writeFileSync(path.join(emptyDotGit, '.git'), '', 'utf-8');
    fs.writeFileSync(path.join(malformedGit, '.git'), 'not-a-gitdir-line\n\0extra', 'utf-8');
    fs.writeFileSync(path.join(forgedMain, '.git'), `gitdir: ${path.join(mainDir, '.git')}\n`, 'utf-8');
    fs.writeFileSync(path.join(forgedWt, '.git'), `gitdir: ${wtAGitDir}\n`, 'utf-8');
    fs.writeFileSync(path.join(forgedOutside, '.git'), `gitdir: ${outsideTarget}\n`, 'utf-8');

    for (const untrusted of [missingGit, emptyDotGit, malformedGit, forgedMain, forgedWt, forgedOutside]) {
      const setupRes = await new OneShotSetupEngine(untrusted).executeSetup();
      expect(setupRes.success).toBe(true);
      const cp = await new AutoCommitEngine({ workspaceDir: untrusted }).createCheckpoint();
      expect(cp.committed).toBe(false);
      expect(cp.status).toBe('not-a-repo');
      expect(await new AutoCommitEngine({ workspaceDir: untrusted }).rollback(mainHead.slice(0, 7))).toBe(false);
    }

    // Symlinked .git file/directory pointing to another repo is rejected if symlinks are allowed by OS.
    const symlinkDotGitDir = path.join(base, 'symlink-dot-git');
    fs.mkdirSync(symlinkDotGitDir, { recursive: true });
    fs.writeFileSync(path.join(symlinkDotGitDir, 'file.txt'), 'untrusted', 'utf-8');
    if (canSymlink(path.join(mainDir, '.git'), path.join(symlinkDotGitDir, '.git'), 'dir')) {
      const setupSym = await new OneShotSetupEngine(symlinkDotGitDir).executeSetup();
      expect(setupSym.success).toBe(true);
      const cpSym = await new AutoCommitEngine({ workspaceDir: symlinkDotGitDir }).createCheckpoint();
      expect(cpSym.committed).toBe(false);
      expect(cpSym.status).toBe('not-a-repo');
    }

    // Neither main nor wtA received info/exclude entries, checkpoint locks, or commits from any forged dir.
    if (fs.existsSync(excludePath)) {
      expect(fs.readFileSync(excludePath, 'utf-8')).not.toContain('.hypersabmemory');
    }
    expect(fs.existsSync(path.join(mainDir, '.git', 'hypersabmemory-checkpoint.lock'))).toBe(false);
    expect(fs.existsSync(path.join(wtAGitDir, 'hypersabmemory-checkpoint.lock'))).toBe(false);
    expect(git(mainDir, ['rev-parse', 'HEAD'])).toBe(mainHead);
    expect(git(wtADir, ['rev-parse', 'HEAD'])).toBe(mainHead);

    const forgedDoctor = await runDoctor(forgedMain);
    const worktreeCheck = forgedDoctor.checks.find((check) => check.name === 'worktree');
    expect(worktreeCheck?.ok).toBe(false);
  }, 45_000);

  it('supports symlinked workspace roots while blocking cross-worktree symlink and path escapes', async () => {
    const { base, wtADir, wtBDir } = createRepoWithWorktrees();
    const wsLink = path.join(base, 'wt-alpha-symlink');
    const linkType = process.platform === 'win32' ? 'junction' : 'dir';
    if (canSymlink(wtADir, wsLink, linkType)) {
      const setupViaLink = await new OneShotSetupEngine(wsLink).executeSetup();
      expect(setupViaLink.success).toBe(true);
      expect(fs.existsSync(path.join(wtADir, '.hypersabmemory', 'memory_store.json'))).toBe(true);

      const cpViaLink = await new AutoCommitEngine({ workspaceDir: wsLink }).createCheckpoint('via symlink workspace');
      expect(cpViaLink.committed).toBe(true);
      expect(git(wtADir, ['show', '--name-only', '--format=', 'HEAD'])).not.toContain('.hypersabmemory');
      const cpClean = await new AutoCommitEngine({ workspaceDir: wsLink }).createCheckpoint('clean check');
      expect(cpClean.committed).toBe(false);
      expect(cpClean.status).toBe('clean');

      const ledgerViaLink = new TaskLedger(wsLink);
      const task = ledgerViaLink.create({ goal: 'Verify symlinked workspace root', acceptanceCriteria: ['ok'], sourceRefs: ['src/worker.ts'] });
      expect(new TaskLedger(wtADir).get(task.id).goal).toBe('Verify symlinked workspace root');
    }

    // Non-existent workspace paths must fail cleanly without creating directories on disk.
    const missingWs = path.join(base, 'does-not-exist-workspace');
    const missingSetup = await new OneShotSetupEngine(missingWs).executeSetup();
    expect(missingSetup.success).toBe(false);
    expect(fs.existsSync(missingWs)).toBe(false);
    expect(() => new HyperSABMemoryMcpServer(missingWs)).toThrowError(TaskError);
    expect(fs.existsSync(missingWs)).toBe(false);

    // Lexical traversal rejection + filename starting with `..` allowed + cross-worktree symlink blocked.
    fs.writeFileSync(path.join(wtADir, '..notes.txt'), 'ok leading double-dot name', 'utf-8');
    expect(resolveActiveFilePath(wtADir, '..notes.txt')).toBe(path.resolve(wtADir, '..notes.txt'));
    expect(resolveActiveFilePath(wtADir, '../linked wt beta/src/worker.ts')).toBeUndefined();
    expect(resolveActiveFilePath(wtADir, path.join(wtBDir, 'src', 'worker.ts'))).toBeUndefined();

    const escapingLink = path.join(wtADir, 'src', 'escape-to-beta.ts');
    if (canSymlink(path.join(wtBDir, 'src', 'worker.ts'), escapingLink, 'file')) {
      expect(resolveActiveFilePath(wtADir, 'src/escape-to-beta.ts')).toBeUndefined();
      expect(() => captureTaskSources(wtADir, ['src/escape-to-beta.ts'])).toThrow();
    }
  }, 30_000);

  it('isolates tasks, memories, same-size source checks, forgotten records, concurrent claims, and MCP restarts across worktrees', async () => {
    const { mainDir, wtADir, wtBDir, mainHead } = createRepoWithWorktrees();
    await new OneShotSetupEngine(mainDir).executeSetup();
    await new OneShotSetupEngine(wtADir).executeSetup();

    // Concurrent task claim + revision/lease fencing in wtADir, invisible to mainDir & wtBDir.
    const wtLedger1 = new TaskLedger(wtADir);
    const wtLedger2 = new TaskLedger(wtADir);
    const task = wtLedger1.create({
      goal: 'Protect linked worktree state',
      acceptanceCriteria: ['verify source hash', 'check isolation'],
      sourceRefs: ['src/worker.ts'],
      nextAction: 'Keep alpha123 validated in wt-alpha'
    });
    const claimed = wtLedger1.claim({ taskId: task.id, agentId: 'worker-1' });
    expect(() => wtLedger2.claim({ taskId: task.id, agentId: 'worker-2' })).toThrow(/already claimed/i);
    expect(() => wtLedger2.checkpoint({
      taskId: task.id,
      agentId: 'worker-2',
      expectedRevision: claimed.revision,
      leaseGeneration: claimed.leaseGeneration,
      summary: 'stale owner'
    })).toThrow();

    expect(new TaskLedger(mainDir).list()).toHaveLength(0);
    expect(new TaskLedger(wtBDir).list()).toHaveLength(0);

    // Forgotten memory exclusion inside linked worktree across reload.
    const wtMem = new TemporalMemoryEngine(wtADir);
    const secretFact = wtMem.remember('decision', 'wtalphaopaque991 secret token must stay forgotten', ['wt'], {
      artifacts: ['src/worker.ts']
    });
    const activeFact = wtMem.remember('decision', 'Keep worker tokenValue isolated inside wt-alpha.', ['wt'], {
      artifacts: ['src/worker.ts']
    });
    wtMem.forget(secretFact.id);
    const reloadedMem = new TemporalMemoryEngine(wtADir);
    const hybrid = new HybridSearchEngine(wtADir, reloadedMem);
    expect(reloadedMem.getActive().some((item) => item.id === secretFact.id)).toBe(false);
    expect(hybrid.searchRecords('wtalphaopaque991', 10)).toHaveLength(0);
    expect(new TemporalMemoryEngine(mainDir).getActive().some((item) => item.id === activeFact.id)).toBe(false);

    // Same-size source rewrite inside linked worktree flagged as modified.
    const workerAbs = path.join(wtADir, 'src', 'worker.ts');
    const originalWorker = fs.readFileSync(workerAbs, 'utf-8');
    const captured = captureTaskSources(wtADir, ['src/worker.ts']);
    expect(captured[0].sha256).toBe(sha256Text(originalWorker));
    const sameSizeRewritten = originalWorker.replace('alpha123', 'ALPHA123');
    expect(Buffer.byteLength(sameSizeRewritten)).toBe(Buffer.byteLength(originalWorker));
    fs.writeFileSync(workerAbs, sameSizeRewritten, 'utf-8');
    expect(inspectTaskSources(wtADir, captured)[0].status).toBe('modified');
    // Restore original file before live MCP restart test.
    fs.writeFileSync(workerAbs, originalWorker, 'utf-8');

    // Checkpoint updated task and close; restart via real MCP stdio process in wtADir.
    wtLedger1.checkpoint({
      taskId: task.id,
      agentId: 'worker-1',
      expectedRevision: claimed.revision,
      leaseGeneration: claimed.leaseGeneration,
      decisions: ['Keep worker tokenValue isolated inside wt-alpha.']
    });
    const updatedRes = executeTaskTool(wtADir, wtLedger1, 'hypersabmemory_task_context', { compact: true });
    expect(updatedRes?.isError).not.toBe(true);

    const mcp1 = await connectMcpProcess(wtADir, 'wt-session-1');
    try {
      const remembered = await mcp1.callTool({
        name: 'hypersabmemory_remember',
        arguments: {
          category: 'decision',
          content: 'Verify alpha123 across linked worktree MCP restart.',
          artifacts: ['src/worker.ts']
        }
      });
      expect(remembered.isError).not.toBe(true);
    } finally {
      await mcp1.close();
    }

    const mcp2 = await connectMcpProcess(wtADir, 'wt-session-2');
    try {
      const restored = await mcp2.callTool({ name: 'hypersabmemory_task_context', arguments: { compact: true } });
      expect(restored.isError).not.toBe(true);
      const bundle = restored.structuredContent as { taskId: string; sources: Array<{ path: string; sha256: string; status: string }>; relatedMemories: Array<{ statement: string }> };
      expect(bundle.taskId).toBe(task.id);
      expect(bundle.sources[0]).toMatchObject({ path: 'src/worker.ts', sha256: captured[0].sha256, status: 'current' });
      expect(bundle.relatedMemories.some((m) => m.statement.includes('MCP restart'))).toBe(true);

      const evidence = await mcp2.callTool({
        name: 'hypersabmemory_query_evidence',
        arguments: { query: 'Where is `tokenValue` defined?' }
      });
      expect(evidence.isError).not.toBe(true);
      const packet = JSON.parse((evidence.content as Array<{ text: string }>)[0].text) as {
        answerVerified: boolean;
        assertions: Array<{ sourcePath: string }>;
        records: Array<{ statement: string }>;
      };
      expect(packet.answerVerified).toBe(true);
      expect(packet.assertions[0].sourcePath).toBe('src/worker.ts');
      expect(packet.records.some((r) => r.statement.includes('wtalphaopaque991'))).toBe(false);
    } finally {
      await mcp2.close();
    }

    // Confirm mainDir MCP process still has zero tasks and zero wtADir memories, and doctor created 0 commits.
    const mainMcp = await connectMcpProcess(mainDir, 'main-check');
    try {
      const mainCtx = await mainMcp.callTool({ name: 'hypersabmemory_task_context', arguments: { compact: true } });
      expect(mainCtx.isError).toBe(true);
      expect((mainCtx.structuredContent as { error: { code: string } }).error.code).toBe('TASK_NOT_FOUND');
    } finally {
      await mainMcp.close();
    }

    const doctorWt = await runDoctor(wtADir);
    expect(doctorWt.ok).toBe(true);
    expect(git(wtADir, ['rev-parse', 'HEAD'])).toBe(mainHead);
    expect(git(mainDir, ['rev-parse', 'HEAD'])).toBe(mainHead);
  }, 45_000);
});
