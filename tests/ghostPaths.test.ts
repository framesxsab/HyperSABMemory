/**
 * HyperSABMemory — Ghost Paths (F8)
 * Warns when currently-edited files overlap files captured in rolled-back
 * safety snapshots ('feat: safety: pre-rollback snapshot' commits).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { ContextHarness } from '../src/harness/contextHarness.js';
import {
  detectGhostCollision,
  formatGhostLine,
  resolveGhostLine,
  GHOST_PATHS_ENV,
  GHOST_SNAPSHOT_SUBJECT
} from '../src/harness/ghostPaths.js';

const execFileAsync = promisify(execFile);

const GHOST_LINE_RE = /^\[GHOST\] files in this session match a rolled-back checkpoint \([0-9a-f]{7,}\)$/;

async function initFixtureRepo(prefix: string): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  await execFileAsync('git', ['init'], { cwd: dir });
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'base.txt'), 'base\n');
  await execFileAsync('git', ['add', '-A'], { cwd: dir });
  await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: dir });
  return dir;
}

/** Simulates the exact commit AutoCommitEngine.rollback's safety checkpoint writes. */
async function commitSnapshot(dir: string, file: string, content: string): Promise<void> {
  fs.writeFileSync(path.join(dir, file), content);
  await execFileAsync('git', ['add', '-A'], { cwd: dir });
  await execFileAsync('git', ['commit', '-m', GHOST_SNAPSHOT_SUBJECT], { cwd: dir });
}

describe('HyperSABMemory — Ghost Paths (F8)', () => {
  let dir: string;
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env[GHOST_PATHS_ENV];
    delete process.env[GHOST_PATHS_ENV];
  });

  afterEach(() => {
    if (savedEnv === undefined) delete process.env[GHOST_PATHS_ENV];
    else process.env[GHOST_PATHS_ENV] = savedEnv;
  });

  beforeAll(async () => {
    dir = await initFixtureRepo('hm-ghost-');
    // Rolled-back timeline: snapshot commit touching ghosted.txt + a decoy
    // checkpoint that must NOT be scanned.
    await commitSnapshot(dir, 'ghosted.txt', 'v1\n');
    fs.writeFileSync(path.join(dir, 'decoy.txt'), 'decoy\n');
    await execFileAsync('git', ['add', '-A'], { cwd: dir });
    await execFileAsync('git', ['commit', '-m', 'checkpoint: auto snapshot (decoy)'], { cwd: dir });
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('formatGhostLine renders the exact locked format', () => {
    expect(formatGhostLine({ shortHash: 'abc1234' })).toBe(
      '[GHOST] files in this session match a rolled-back checkpoint (abc1234)'
    );
  });

  it('detectGhostCollision matches an edited file against the snapshot changed-file list', () => {
    const hit = detectGhostCollision(dir, ['ghosted.txt']);
    expect(hit).not.toBeNull();
    expect(hit?.shortHash).toMatch(/^[0-9a-f]{7,}$/);
  });

  it('detectGhostCollision returns null when no live file overlaps the snapshot', () => {
    expect(detectGhostCollision(dir, ['unrelated.ts'])).toBeNull();
  });

  it('detectGhostCollision returns null outside a git repo', () => {
    const plainDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-ghost-nogit-'));
    try {
      expect(detectGhostCollision(plainDir, ['x.txt'])).toBeNull();
      expect(resolveGhostLine({ workspaceDir: plainDir, activeFile: 'x.txt' })).toBe('');
    } finally {
      fs.rmSync(plainDir, { recursive: true, force: true });
    }
  });

  it('RED: header appends exactly one [GHOST] line when activeFile collides (modifiedFiles empty)', () => {
    const harness = new ContextHarness(1500);
    const header = harness.generateHeader({
      workspaceName: path.basename(dir),
      activeFile: 'ghosted.txt',
      modifiedFiles: [],
      workspaceDir: dir
    });
    const ghostLines = header.split('\n').filter((l) => l.startsWith('[GHOST]'));
    expect(ghostLines).toHaveLength(1);
    expect(ghostLines[0]).toMatch(GHOST_LINE_RE);
  });

  it('header appends exactly one [GHOST] line when modifiedFiles collide', () => {
    const harness = new ContextHarness(1500);
    const header = harness.generateHeader({
      workspaceName: path.basename(dir),
      activeFile: 'other-live.ts',
      modifiedFiles: ['decoy.txt', 'ghosted.txt'],
      workspaceDir: dir
    });
    const ghostLines = header.split('\n').filter((l) => l.startsWith('[GHOST]'));
    expect(ghostLines).toHaveLength(1);
    expect(ghostLines[0]).toMatch(GHOST_LINE_RE);
  });

  it('GREEN-by-design safety net: non-collision header is byte-identical with and without the scan enabled', () => {
    const harness = new ContextHarness(1500);
    const state = {
      workspaceName: path.basename(dir),
      activeFile: 'unrelated.ts',
      modifiedFiles: ['also-unrelated.ts'],
      workspaceDir: dir
    };
    process.env[GHOST_PATHS_ENV] = 'off';
    const disabled = harness.generateHeader(state);
    delete process.env[GHOST_PATHS_ENV];
    const enabled = harness.generateHeader(state);
    // Passes pre-change by construction; post-change it locks zero-token silence.
    expect(enabled).toBe(disabled);
    expect(enabled).not.toContain('[GHOST]');
  });

  it('HYPERSABMEMORY_GHOST_PATHS=off disables the warning even on collision', () => {
    const harness = new ContextHarness(1500);
    process.env[GHOST_PATHS_ENV] = 'off';
    const header = harness.generateHeader({
      workspaceName: path.basename(dir),
      activeFile: 'ghosted.txt',
      modifiedFiles: [],
      workspaceDir: dir
    });
    expect(header).not.toContain('[GHOST]');
  });

  it('scan is bounded to the 3 most recent snapshots (4th-oldest collision stays silent)', async () => {
    const boundedDir = await initFixtureRepo('hm-ghost-bounded-');
    try {
      // Oldest snapshot touches ghosted.txt, then 3 newer snapshot-subject
      // commits push it outside the bounded window.
      await commitSnapshot(boundedDir, 'ghosted.txt', 'v1\n');
      for (let i = 0; i < 3; i++) {
        await commitSnapshot(boundedDir, `filler${i}.txt`, `filler ${i}\n`);
      }
      const harness = new ContextHarness(1500);
      const header = harness.generateHeader({
        workspaceName: path.basename(boundedDir),
        activeFile: 'ghosted.txt',
        modifiedFiles: [],
        workspaceDir: boundedDir
      });
      expect(header).not.toContain('[GHOST]');
    } finally {
      fs.rmSync(boundedDir, { recursive: true, force: true });
    }
  });
});
