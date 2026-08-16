import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { AutoCommitEngine } from '../src/hooks/autoCommit.js';
import { OhMyPiHarness } from '../src/harness/ohMyPi.js';

const execFileAsync = promisify(execFile);

describe('HyperMemory — Live-State get_context', () => {
  let dir: string;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-ctx-'));
    await execFileAsync('git', ['init'], { cwd: dir });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: dir });
    fs.writeFileSync(path.join(dir, 'initial.txt'), 'initial content\n');
    await execFileAsync('git', ['add', '-A'], { cwd: dir });
    await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: dir });
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('getSnapshot returns real branch, commit, and dirty files', async () => {
    fs.writeFileSync(path.join(dir, 'dirty.txt'), 'dirty change\n');
    const engine = new AutoCommitEngine({ workspaceDir: dir });
    const snapshot = await engine.getSnapshot();

    expect(snapshot.gitBranch).toBeTruthy();
    expect(snapshot.lastCommitHash).toBeTruthy();
    expect(snapshot.lastCommitTime).toBeTruthy();
    expect(snapshot.modifiedFiles).toContain('dirty.txt');
  });

  it('generated header contains real dirty filename and hashline, not placeholders', async () => {
    const content = 'function live() { return 1; }\n';
    fs.writeFileSync(path.join(dir, 'dirty.txt'), content);

    const engine = new AutoCommitEngine({ workspaceDir: dir });
    const snapshot = await engine.getSnapshot();

    const harness = new OhMyPiHarness(1500);
    const header = harness.generateHeader({
      workspaceName: path.basename(dir),
      activeFile: 'dirty.txt',
      cursorLine: 1,
      gitBranch: snapshot.gitBranch,
      lastCommitHash: snapshot.lastCommitHash,
      lastCommitTime: snapshot.lastCommitTime,
      modifiedFiles: snapshot.modifiedFiles,
      recentDiff: snapshot.recentDiff,
      activeFileContent: content
    });

    expect(header).toContain('dirty.txt');
    expect(header).toContain('#H dirty.txt');
    expect(header).not.toContain('Modified Files: [Clean]');
    expect(header).not.toContain('Hashline: n/a');
  });

  it('getSnapshot degrades gracefully outside a git repo', async () => {
    const plainDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-nogit-'));
    try {
      const engine = new AutoCommitEngine({ workspaceDir: plainDir });
      const snapshot = await engine.getSnapshot();
      expect(snapshot.gitBranch).toBeUndefined();
      expect(snapshot.modifiedFiles).toEqual([]);
    } finally {
      fs.rmSync(plainDir, { recursive: true, force: true });
    }
  });
});