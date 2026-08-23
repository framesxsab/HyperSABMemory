import { describe, it, expect, afterEach } from 'vitest';
import { execSync, execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildHandoffBrief } from '../src/cli/handoffCommand.js';
import { TokenCompressor } from '../src/harness/tokenCompressor.js';
import { TemporalMemoryEngine } from '../src/memory/temporalMemory.js';

const dirs: string[] = [];

function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-handoff-'));
  dirs.push(dir);
  return dir;
}

function initFixtureRepo(dir: string): void {
  execSync('git init', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email test@local', { cwd: dir });
  execSync('git config user.name test', { cwd: dir });
  execSync('git commit --allow-empty -m "checkpoint: auto snapshot (fixture one)"', { cwd: dir, stdio: 'ignore' });
  execSync('git commit --allow-empty -m "unrelated user commit"', { cwd: dir, stdio: 'ignore' });
  execSync('git commit --allow-empty -m "checkpoint: auto snapshot (fixture two)"', { cwd: dir, stdio: 'ignore' });
}

function seedStore(dir: string): void {
  const engine = new TemporalMemoryEngine(dir);
  engine.remember('architecture', 'Handoff fixture architecture fact about the store layout');
  engine.remember(
    'decision',
    'Handoff fixture decision fact about rollback guards',
    [],
    { nextSteps: 'Verify the rollback guard on a monorepo subdir' }
  );
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('HyperSABMemory — handoff command (F2)', () => {
  it('keeps the forward brief paste-ready and under the 600-token budget', async () => {
    const dir = tmpDir();
    initFixtureRepo(dir);
    seedStore(dir);

    const brief = await buildHandoffBrief(dir);

    expect(brief).toContain('# HyperSABMemory Handoff');
    expect(brief).toContain('Handoff fixture architecture fact');
    expect(brief).toContain('Verify the rollback guard on a monorepo subdir');
    // Repo token estimator (TokenCompressor, ~4 chars/token) is the documented heuristic.
    expect(TokenCompressor.estimateTokens(brief)).toBeLessThanOrEqual(600);
  });

  it('only cites checkpoint hashes that resolve in the fixture repo', async () => {
    const dir = tmpDir();
    initFixtureRepo(dir);
    seedStore(dir);

    const brief = await buildHandoffBrief(dir);
    const section = brief.split('## Recent checkpoints')[1] ?? '';
    const hashes = Array.from(section.matchAll(/^- ([0-9a-f]{7,40}) /gm)).map((m) => m[1]);

    expect(hashes.length).toBeGreaterThanOrEqual(1);
    const unresolvable: string[] = [];
    for (const hash of hashes) {
      try {
        execFileSync('git', ['cat-file', '-e', `${hash}^{commit}`], { cwd: dir, stdio: 'ignore' });
      } catch {
        unresolvable.push(hash);
      }
    }
    expect(unresolvable).toEqual([]);
    // The grep convention must exclude plain user commits.
    expect(section).not.toContain('unrelated user commit');
  });

  it('renders --story byte-identically across two runs on the same state', async () => {
    const dir = tmpDir();
    initFixtureRepo(dir);
    seedStore(dir);

    const first = await buildHandoffBrief(dir, { story: true });
    const second = await buildHandoffBrief(dir, { story: true });

    expect(first).toBe(second);
    expect(first).toContain("Captain's Log");
    expect(first).toContain('Facts learned today: 2');
    expect(first).toContain('Facts forgotten today: 0');
    expect(first).toContain('Checkpoints recorded: 2');
  });

  it('produces a valid minimal brief in an empty non-git workspace', async () => {
    const dir = tmpDir();

    const brief = await buildHandoffBrief(dir);
    const story = await buildHandoffBrief(dir, { story: true });

    expect(brief).toContain('# HyperSABMemory Handoff');
    expect(TokenCompressor.estimateTokens(brief)).toBeLessThanOrEqual(600);
    expect(story).toContain("Captain's Log");
    expect(story).toContain('Facts learned today: 0');
  });
});
