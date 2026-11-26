import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { OneShotSetupEngine } from '../src/cli/oneShotSetup.js';
import { UniversalAdaptersEngine } from '../src/harness/universalAdapters.js';
import { removeTestDirs } from './testUtils.js';

const dirs: string[] = [];

function makeTempDir(prefix = 'hm-nondest-'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function initRepo(dir: string): void {
  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.name', 'Test User']);
  git(dir, ['config', 'user.email', 'test@example.com']);
}

afterEach(() => {
  removeTestDirs(dirs);
});

describe('HyperSABMemory — Non-Destructive Setup & Tracked Instruction Preservation', () => {
  it('preserves pre-existing tracked AGENTS.md and equivalent instruction files by default while wiring MCP and store', async () => {
    const dir = makeTempDir();
    initRepo(dir);

    const trackedAgents = '# Existing Agents Guide\n\nDo not overwrite tracked project instructions.\n';
    const trackedClaude = '# Claude Instructions\n\nUse project conventions.\n';
    const trackedWindsurf = 'Keep TypeScript strict.\n';
    const trackedCopilot = '# Copilot Guide\n\nFollow tests.\n';
    const trackedClaudeJson = `${JSON.stringify({ customKey: 'keep-me', instructions: 'Existing instructions' }, null, 2)}\n`;

    fs.writeFileSync(path.join(dir, 'AGENTS.md'), trackedAgents, 'utf8');
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), trackedClaude, 'utf8');
    fs.writeFileSync(path.join(dir, '.windsurfrules'), trackedWindsurf, 'utf8');
    fs.mkdirSync(path.join(dir, '.github'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.github', 'copilot-instructions.md'), trackedCopilot, 'utf8');
    fs.writeFileSync(path.join(dir, '.claude.json'), trackedClaudeJson, 'utf8');
    fs.writeFileSync(path.join(dir, 'README.md'), '# Sample Repo\n', 'utf8');
    git(dir, ['add', '.']);
    git(dir, ['commit', '-m', 'initial tracked instruction files']);

    const outcome = await new OneShotSetupEngine(dir).executeSetup();
    expect(outcome.success).toBe(true);
    expect(outcome.skippedTrackedFiles?.length).toBeGreaterThanOrEqual(5);

    // Byte-for-byte preservation of all tracked instruction files + zero git diff
    expect(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8')).toBe(trackedAgents);
    expect(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8')).toBe(trackedClaude);
    expect(fs.readFileSync(path.join(dir, '.windsurfrules'), 'utf8')).toBe(trackedWindsurf);
    expect(fs.readFileSync(path.join(dir, '.github', 'copilot-instructions.md'), 'utf8')).toBe(trackedCopilot);
    expect(fs.readFileSync(path.join(dir, '.claude.json'), 'utf8')).toBe(trackedClaudeJson);
    expect(git(dir, ['diff'])).toBe('');

    // Functional MCP configs and local store still created cleanly
    expect(fs.existsSync(path.join(dir, '.mcp.json'))).toBe(true);
    expect(fs.existsSync(path.join(dir, '.cursor', 'mcp.json'))).toBe(true);
    expect(fs.existsSync(path.join(dir, '.vscode', 'mcp.json'))).toBe(true);
    expect(fs.existsSync(path.join(dir, '.hypersabmemory', 'memory_store.json'))).toBe(true);

    // Repeated setup remains idempotent and leaves tracked files clean
    const repeat = await new OneShotSetupEngine(dir).executeSetup();
    expect(repeat.success).toBe(true);
    expect(git(dir, ['diff'])).toBe('');
    expect(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8')).toBe(trackedAgents);
  }, 30_000);

  it('supports explicit opt-in tracked injection while preserving user-authored content idempotently', async () => {
    const dir = makeTempDir();
    initRepo(dir);

    const trackedAgents = '# Custom AGENTS\n\nKeep user instructions intact.\n';
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), trackedAgents, 'utf8');
    git(dir, ['add', 'AGENTS.md']);
    git(dir, ['commit', '-m', 'add tracked AGENTS.md']);

    const optedIn = await new OneShotSetupEngine(dir).executeSetup({ injectTracked: true });
    expect(optedIn.success).toBe(true);
    expect(optedIn.skippedTrackedFiles ?? []).toEqual([]);

    const afterOptIn = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
    expect(afterOptIn).toContain('# Custom AGENTS');
    expect(afterOptIn).toContain('Keep user instructions intact.');
    expect(afterOptIn).toContain('<!-- HYPERSABMEMORY:START -->');

    // Re-running opt-in stays idempotent without duplicating markers
    await new OneShotSetupEngine(dir).executeSetup({ injectTracked: true });
    const afterRepeat = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
    expect(afterRepeat.split('<!-- HYPERSABMEMORY:START -->')).toHaveLength(2);
    expect(afterRepeat).toContain('Keep user instructions intact.');
  }, 30_000);

  it('works cleanly on new repos without tracked instructions and preserves existing MCP server entries', async () => {
    const dir = makeTempDir();
    initRepo(dir);
    fs.writeFileSync(path.join(dir, 'README.md'), '# New Repo\n', 'utf8');
    git(dir, ['add', 'README.md']);
    git(dir, ['commit', '-m', 'init']);

    fs.writeFileSync(
      path.join(dir, '.mcp.json'),
      `${JSON.stringify({ mcpServers: { existingTool: { command: 'node', args: ['tool.js'] } } }, null, 2)}\n`
    );

    const outcome = await new OneShotSetupEngine(dir).executeSetup();
    expect(outcome.success).toBe(true);
    expect(fs.existsSync(path.join(dir, 'AGENTS.md'))).toBe(true);
    expect(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8')).toContain('<!-- HYPERSABMEMORY:START -->');
    expect(git(dir, ['diff'])).toBe('');

    const mcp = JSON.parse(fs.readFileSync(path.join(dir, '.mcp.json'), 'utf8')) as { mcpServers: Record<string, unknown> };
    expect(mcp.mcpServers.existingTool).toEqual({ command: 'node', args: ['tool.js'] });
    expect(mcp.mcpServers.hypersabmemory).toBeDefined();
  }, 30_000);

  it('preserves tracked AGENTS.md across both main repo and linked worktrees', async () => {
    const base = makeTempDir('hm-nondest-wt-');
    const mainDir = path.join(base, 'main');
    const wtDir = path.join(base, 'wt');
    fs.mkdirSync(mainDir, { recursive: true });
    initRepo(mainDir);

    const agentsBody = '# Shared Repo AGENTS\n\nTracked across branches.\n';
    fs.writeFileSync(path.join(mainDir, 'AGENTS.md'), agentsBody, 'utf8');
    git(mainDir, ['add', 'AGENTS.md']);
    git(mainDir, ['commit', '-m', 'seed AGENTS.md']);
    git(mainDir, ['worktree', 'add', '-b', 'feature-wt', wtDir]);

    const mainRes = await new OneShotSetupEngine(mainDir).executeSetup();
    const beforeWtBytes = fs.readFileSync(path.join(wtDir, 'AGENTS.md'), 'utf8');
    const wtRes = await new OneShotSetupEngine(wtDir).executeSetup();
    expect(mainRes.success).toBe(true);
    expect(wtRes.success).toBe(true);
    expect(git(mainDir, ['diff'])).toBe('');
    expect(git(wtDir, ['diff'])).toBe('');
    expect(fs.readFileSync(path.join(wtDir, 'AGENTS.md'), 'utf8')).toBe(beforeWtBytes);

    // Direct UniversalAdaptersEngine default also preserves tracked files
    const adapterRes = new UniversalAdaptersEngine(wtDir).syncAllAdapters({ contextBlock: 'hello' });
    expect(adapterRes.skippedTrackedFiles.length).toBeGreaterThanOrEqual(1);
    expect(git(wtDir, ['diff'])).toBe('');
  }, 30_000);

  it('supports CLI setup / inject non-destructive default and --inject-tracked opt-in', () => {
    const dir = makeTempDir('hm-cli-nondest-');
    initRepo(dir);
    const cli = path.resolve(process.cwd(), 'dist', 'cli', 'index.js');
    const original = '# Repo CLI AGENTS\n\nKeep clean by default.\n';
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), original, 'utf8');
    git(dir, ['add', 'AGENTS.md']);
    git(dir, ['commit', '-m', 'seed AGENTS.md']);

    execFileSync(process.execPath, [cli, 'setup'], { cwd: dir, encoding: 'utf8' });
    expect(git(dir, ['diff'])).toBe('');

    execFileSync(process.execPath, [cli, 'inject'], { cwd: dir, encoding: 'utf8' });
    expect(git(dir, ['diff'])).toBe('');

    execFileSync(process.execPath, [cli, 'setup', '--inject-tracked'], { cwd: dir, encoding: 'utf8' });
    const updated = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
    expect(updated).toContain('Keep clean by default.');
    expect(updated).toContain('<!-- HYPERSABMEMORY:START -->');
  }, 30_000);
});
