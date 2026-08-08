/**
 * HyperMemory — Hyperfrequent Auto-Commit & Checkpoint System
 * Automatically commits uncommitted changes every 3-5 minutes for granular rollback capability.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';

const execAsync = promisify(exec);

export interface AutoCommitOptions {
  intervalMinutes?: number; // Default: 3 to 5 minutes
  workspaceDir?: string;
  authorName?: string;
  authorEmail?: string;
  onCommit?: (hash: string, message: string) => void;
  onError?: (error: Error) => void;
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
    const minutes = options.intervalMinutes || parseInt(process.env.HYPERMEMORY_COMMIT_INTERVAL || '3', 10);
    this.intervalMs = Math.max(1, minutes) * 60 * 1000;
    this.workspaceDir = options.workspaceDir || process.cwd();
    this.authorName = options.authorName || process.env.HYPERMEMORY_AUTHOR_NAME || process.env.GIT_AUTHOR_NAME || 'hypermemory-bot';
    this.authorEmail = options.authorEmail || process.env.HYPERMEMORY_AUTHOR_EMAIL || process.env.GIT_AUTHOR_EMAIL || 'hypermemory@users.noreply.github.com';
    this.onCommit = options.onCommit;
    this.onError = options.onError;
  }

  /**
   * Starts the background auto-commit timer.
   */
  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log(`⚡ [HyperMemory :: AutoCommit] Engine active (Interval: ${this.intervalMs / 60000}m | Author: ${this.authorName} <${this.authorEmail}>)`);

    // Initial check
    this.createCheckpoint();

    // Set recurring timer
    this.timer = setInterval(() => {
      this.createCheckpoint();
    }, this.intervalMs);
  }

  /**
   * Stops the auto-commit timer.
   */
  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
    console.log('⚡ [HyperMemory :: AutoCommit] Engine paused');
  }

  /**
   * Configures git author identity locally.
   */
  public async configureGitIdentity(): Promise<void> {
    try {
      await execAsync(`git config user.name "${this.authorName}"`, { cwd: this.workspaceDir });
      await execAsync(`git config user.email "${this.authorEmail}"`, { cwd: this.workspaceDir });
    } catch {
      // Ignore git config errors
    }
  }

  /**
   * Executes a git checkpoint commit if uncommitted changes exist.
   */
  public async createCheckpoint(customReason?: string): Promise<{ committed: boolean; hash?: string }> {
    try {
      await this.configureGitIdentity();

      // Check status
      const { stdout: status } = await execAsync('git status --porcelain', { cwd: this.workspaceDir });
      if (!status.trim()) {
        return { committed: false };
      }

      // Stage all changes
      await execAsync('git add -A', { cwd: this.workspaceDir });

      const fileFocus = this.workspaceDir ? path.basename(this.workspaceDir) : 'workspace';
      const commitMessage = customReason ? `feat: ${customReason}` : `checkpoint: auto snapshot`;

      // Commit changes with explicit author
      const gitAuthorStr = `"${this.authorName} <${this.authorEmail}>"`;
      await execAsync(`git commit --author=${gitAuthorStr} -m "${commitMessage}" --allow-empty`, { cwd: this.workspaceDir });

      // Get hash
      const { stdout: hashRaw } = await execAsync('git rev-parse --short HEAD', { cwd: this.workspaceDir });
      const hash = hashRaw.trim();

      if (this.onCommit) {
        this.onCommit(hash, commitMessage);
      }

      console.log(`⚡ [HyperMemory :: AutoCommit] Created checkpoint [${hash}] by ${this.authorName} -> ${commitMessage}`);
      return { committed: true, hash };
    } catch (err) {
      if (this.onError && err instanceof Error) {
        this.onError(err);
      }
      return { committed: false };
    }
  }

  /**
   * Returns commit history for state rollbacks.
   */
  public async getHistory(limit: number = 10): Promise<Array<{ hash: string; message: string; date: string }>> {
    try {
      const { stdout } = await execAsync(`git log -n ${limit} --pretty=format:"%h|%s|%cd" --date=short`, { cwd: this.workspaceDir });
      return stdout.split('\n').filter(Boolean).map(line => {
        const [hash, message, date] = line.split('|');
        return { hash, message, date };
      });
    } catch {
      return [];
    }
  }

  /**
   * Rollback to a specific commit hash or recent checkpoint.
   */
  public async rollback(hash: string): Promise<boolean> {
    try {
      await execAsync(`git reset --hard ${hash}`, { cwd: this.workspaceDir });
      console.log(`⚡ [HyperMemory :: AutoCommit] Successfully rolled back to ${hash}`);
      return true;
    } catch (err) {
      console.error(`⚡ [HyperMemory :: AutoCommit] Failed rollback to ${hash}:`, err);
      return false;
    }
  }
}
