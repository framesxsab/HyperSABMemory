/**
 * HyperSABMemory — Hyperfrequent Auto-Commit & Checkpoint System
 * Automatically commits uncommitted changes every 3-5 minutes for granular rollback capability.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execFileAsync = promisify(execFile);

export interface AutoCommitOptions {
  intervalMinutes?: number;
  workspaceDir?: string;
  authorName?: string;
  authorEmail?: string;
  onCommit?: (hash: string, message: string) => void;
  onError?: (error: Error) => void;
}

export interface WorkspaceSnapshot {
  gitBranch?: string;
  lastCommitHash?: string;
  lastCommitTime?: string;
  modifiedFiles: string[];
  recentDiff?: string;
}

export type CheckpointStatus = 'committed' | 'clean' | 'not-a-repo' | 'operation-in-progress' | 'subdir-of-repo' | 'failed';

export interface CheckpointResult {
  committed: boolean;
  status: CheckpointStatus;
  hash?: string;
}

export class AutoCommitEngine {
  private intervalMs: number;
  private workspaceDir: string;
  private authorName: string;
  private authorEmail: string;
  private timer: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private onCommit?: (hash: string, message: string) => void;
  private onError?: (error: Error) => void;

  constructor(options: AutoCommitOptions = {}) {
    const minutes = options.intervalMinutes || parseInt(process.env.HYPERSABMEMORY_COMMIT_INTERVAL || '3', 10);
    this.intervalMs = Math.max(1, minutes) * 60 * 1000;
    this.workspaceDir = options.workspaceDir || process.cwd();
    this.authorName = options.authorName || process.env.HYPERSABMEMORY_AUTHOR_NAME || process.env.GIT_AUTHOR_NAME || 'hypersabmemory-bot';
    this.authorEmail = options.authorEmail || process.env.HYPERSABMEMORY_AUTHOR_EMAIL || process.env.GIT_AUTHOR_EMAIL || 'hypersabmemory@users.noreply.github.com';
    this.onCommit = options.onCommit;
    this.onError = options.onError;
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    console.error(`[HyperSABMemory :: AutoCommit] Engine active (Interval: ${this.intervalMs / 60000}m | Author: ${this.authorName} <${this.authorEmail}>)`);
    this.createCheckpoint();
    this.timer = setInterval(() => {
      this.createCheckpoint();
    }, this.intervalMs);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
    console.log('[HyperSABMemory :: AutoCommit] Engine paused');
  }

  public async configureGitIdentity(): Promise<void> {
    try {
      await execFileAsync('git', ['config', 'user.name', this.authorName], { cwd: this.workspaceDir });
      await execFileAsync('git', ['config', 'user.email', this.authorEmail], { cwd: this.workspaceDir });
    } catch {
      // Ignore git config errors
    }
  }

  public async createCheckpoint(customReason?: string): Promise<CheckpointResult> {
    try {
      let gitDirRaw: string;
      try {
        ({ stdout: gitDirRaw } = await execFileAsync('git', ['rev-parse', '--git-dir'], { cwd: this.workspaceDir }));
      } catch {
        return { committed: false, status: 'not-a-repo' };
      }
      const gitDir = path.resolve(this.workspaceDir, gitDirRaw.trim());

      // Safety: staging mid-merge/rebase concludes the user's operation with conflict markers baked in.
      if (
        fs.existsSync(path.join(gitDir, 'MERGE_HEAD')) ||
        fs.existsSync(path.join(gitDir, 'rebase-merge')) ||
        fs.existsSync(path.join(gitDir, 'rebase-apply'))
      ) {
        return { committed: false, status: 'operation-in-progress' };
      }

      // Safety: whole-tree add from a monorepo subdir sweeps teammates' WIP.
      const normalize = (p: string): string => {
        const resolved = path.resolve(p);
        try {
          // native resolves symlinks AND 8.3 short names (CI runners expose
          // os.tmpdir() as C:\Users\RUNNER~1\... while git reports the long form).
          return process.platform === 'win32'
            ? fs.realpathSync.native(resolved)
            : fs.realpathSync(resolved);
        } catch {
          return resolved;
        }
      };
      const { stdout: toplevelRaw } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd: this.workspaceDir });
      const wsCanonical = normalize(this.workspaceDir);
      const topCanonical = normalize(toplevelRaw.trim());
      const sameRoot = process.platform === 'win32'
        ? wsCanonical.toLowerCase() === topCanonical.toLowerCase()
        : wsCanonical === topCanonical;
      if (!sameRoot) {
        return { committed: false, status: 'subdir-of-repo' };
      }

      const { stdout: status } = await execFileAsync('git', ['status', '--porcelain'], { cwd: this.workspaceDir });
      if (!status.trim()) {
        return { committed: false, status: 'clean' };
      }

      // Belt-and-braces: keep the memory store out of checkpoints even if ignore
      // rules are bypassed. An exclude pathspec on add cannot be used here: naming
      // the ignored dir trips advice.addIgnoredFile and git exits 1, aborting every
      // checkpoint in contained workspaces. Instead: stage all, then restore the
      // index to HEAD for store paths ONLY when a legacy tracked store exists
      // (post-untrack stores must keep their deletion staged so setup commits it).
      await execFileAsync('git', ['add', '-A'], { cwd: this.workspaceDir });
      try {
        const { stdout: trackedStore } = await execFileAsync('git', ['ls-files', '--', '.hypersabmemory'], { cwd: this.workspaceDir });
        if (trackedStore.trim()) {
          await execFileAsync('git', ['reset', '-q', 'HEAD', '--', '.hypersabmemory'], { cwd: this.workspaceDir });
        }
      } catch {
        // Index inspection is best-effort; staging itself already succeeded.
      }

      const fileFocus = this.workspaceDir ? path.basename(this.workspaceDir) : 'workspace';
      const commitMessage = customReason
        ? `feat: ${customReason.replace(/[\r\n]/g, ' ').slice(0, 200)}`
        : `checkpoint: auto snapshot (${fileFocus})`;

      const author = `${this.authorName} <${this.authorEmail}>`;
      await execFileAsync(
        'git',
        [
          '-c', `user.name=${this.authorName}`,
          '-c', `user.email=${this.authorEmail}`,
          'commit', `--author=${author}`, '-m', commitMessage, '--allow-empty'
        ],
        { cwd: this.workspaceDir }
      );

      const { stdout: hashRaw } = await execFileAsync('git', ['rev-parse', '--short', 'HEAD'], { cwd: this.workspaceDir });
      const hash = hashRaw.trim();

      if (this.onCommit) {
        this.onCommit(hash, commitMessage);
      }

      console.error(`[HyperSABMemory :: AutoCommit] Created checkpoint [${hash}] by ${this.authorName} -> ${commitMessage}`);
      return { committed: true, status: 'committed', hash };
    } catch (err) {
      if (this.onError && err instanceof Error) {
        this.onError(err);
      }
      return { committed: false, status: 'failed' };
    }
  }

  public async getHistory(limit: number = 10): Promise<Array<{ hash: string; message: string; date: string }>> {
    try {
      const n = Number.isFinite(limit) ? Math.min(Math.max(1, Math.floor(limit)), 100) : 10;
      const { stdout } = await execFileAsync(
        'git',
        ['log', '-n', String(n), '--pretty=format:%h|%s|%cd', '--date=short'],
        { cwd: this.workspaceDir }
      );
      return stdout.split('\n').filter(Boolean).map(line => {
        const [hash, message, date] = line.split('|');
        return { hash, message, date };
      });
    } catch {
      return [];
    }
  }

  /**
   * Gathers a lightweight live git snapshot for the context harness header.
   * Every call is independent (no shared state) and degrades to placeholders in
   * non-git or failed-git workspaces.
   */
  public async getSnapshot(): Promise<WorkspaceSnapshot> {
    const snapshot: WorkspaceSnapshot = { modifiedFiles: [] };

    try {
      const [{ stdout: branchRaw }, { stdout: hashRaw }, { stdout: timeRaw }] = await Promise.all([
        execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: this.workspaceDir }),
        execFileAsync('git', ['rev-parse', '--short', 'HEAD'], { cwd: this.workspaceDir }),
        execFileAsync('git', ['log', '-1', '--format=%cd', '--date=short'], { cwd: this.workspaceDir })
      ]);
      snapshot.gitBranch = branchRaw.trim();
      snapshot.lastCommitHash = hashRaw.trim();
      snapshot.lastCommitTime = timeRaw.trim();
    } catch {
      // Not a git repo or git unavailable — degrade to placeholders
    }

    try {
      const { stdout: statusRaw } = await execFileAsync('git', ['status', '--porcelain'], { cwd: this.workspaceDir });
      snapshot.modifiedFiles = statusRaw
        .split('\n')
        .filter(Boolean)
        .map(line => line.slice(3).trim());
    } catch {
      snapshot.modifiedFiles = [];
    }

    try {
      const { stdout: diffRaw } = await execFileAsync('git', ['diff', '--stat'], { cwd: this.workspaceDir });
      snapshot.recentDiff = diffRaw.trim().split('\n').slice(0, 10).join('\n') || undefined;
    } catch {
      snapshot.recentDiff = undefined;
    }

    return snapshot;
  }

  public async getDiffBetween(hashA: string, hashB: string = 'HEAD'): Promise<{ nameStatus: string; stat: string } | null> {
    try {
      const [{ stdout: nameStatus }, { stdout: statRaw }] = await Promise.all([
        execFileAsync('git', ['diff', '--name-status', hashA, hashB], { cwd: this.workspaceDir }),
        execFileAsync('git', ['diff', '--stat', hashA, hashB], { cwd: this.workspaceDir })
      ]);
      return {
        nameStatus: nameStatus.trim(),
        stat: statRaw.trim().split('\n').slice(0, 50).join('\n')
      };
    } catch {
      return null;
    }
  }

  public async rollback(hash: string): Promise<boolean> {
    if (!/^[0-9a-f]{4,40}$/i.test(hash)) {
      console.error('[HyperSABMemory :: AutoCommit] Rejected rollback: invalid hash');
      return false;
    }
    try {
      await execFileAsync('git', ['cat-file', '-e', `${hash}^{commit}`], { cwd: this.workspaceDir });
    } catch {
      console.error(`[HyperSABMemory :: AutoCommit] Rejected rollback: unknown commit ${hash}`);
      return false;
    }
    try {
      // Safety checkpoint runs BEFORE the destructive reset so uncommitted work
      // stays recoverable via the dangling commit (reflog/objects).
      try {
        await this.createCheckpoint('safety: pre-rollback snapshot');
      } catch (safetyErr) {
        console.warn('[HyperSABMemory :: AutoCommit] Safety checkpoint failed — proceeding with rollback.', safetyErr);
      }
      await execFileAsync('git', ['reset', '--hard', hash], { cwd: this.workspaceDir });
      console.error(`[HyperSABMemory :: AutoCommit] Successfully rolled back to ${hash}`);
      return true;
    } catch (err) {
      console.error(`[HyperSABMemory :: AutoCommit] Failed rollback to ${hash}:`, err);
      return false;
    }
  }
}
