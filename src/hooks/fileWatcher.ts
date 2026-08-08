/**
 * HyperMemory — Real-Time File Watcher & Event Hook
 * Automatically triggers state re-synthesis, Oh-My-Pi harness header update,
 * and Memory.md syncing after every file edit or save.
 */

import chokidar, { FSWatcher } from 'chokidar';
import * as path from 'path';
import { SupermemoryEngine } from '../memory/supermemory.js';
import { GraphifyEngine } from '../memory/graphify.js';
import { OhMyPiHarness, HarnessState } from '../harness/ohMyPi.js';
import { AutoCommitEngine } from './autoCommit.js';

export interface FileWatcherOptions {
  workspaceDir?: string;
  ignoredPatterns?: Array<string | RegExp>;
  autoCommitIntervalMinutes?: number;
}

export class FileWatcherHook {
  private workspaceDir: string;
  private watcher: FSWatcher | null = null;
  private supermemory: SupermemoryEngine;
  private graphify: GraphifyEngine;
  private harness: OhMyPiHarness;
  private autoCommit: AutoCommitEngine;
  private modifiedFiles: Set<string> = new Set();
  private lastStateHeader: string = '';

  constructor(options: FileWatcherOptions = {}) {
    this.workspaceDir = options.workspaceDir || process.cwd();
    this.supermemory = new SupermemoryEngine(this.workspaceDir);
    this.graphify = new GraphifyEngine(this.workspaceDir);
    this.harness = new OhMyPiHarness(1500);
    this.autoCommit = new AutoCommitEngine({
      workspaceDir: this.workspaceDir,
      intervalMinutes: options.autoCommitIntervalMinutes || parseInt(process.env.HYPERMEMORY_COMMIT_INTERVAL || '3', 10)
    });
  }

  /**
   * Starts watching workspace for file changes.
   */
  public start(): void {
    const defaultIgnored = [
      '**/node_modules/**',
      '**/.git/**',
      '**/dist/**',
      '**/.hypermemory/**',
      '**/Memory.md'
    ];

    this.watcher = chokidar.watch(this.workspaceDir, {
      ignored: defaultIgnored,
      persistent: true,
      ignoreInitial: true
    });

    this.watcher
      .on('change', (filePath: string) => this.onFileEvent('change', filePath))
      .on('add', (filePath: string) => this.onFileEvent('add', filePath))
      .on('unlink', (filePath: string) => this.onFileEvent('unlink', filePath));

    // Start 3-5 min hyperfrequent auto-commit engine
    this.autoCommit.start();

    console.log(`⚡ [HyperMemory :: FileWatcher] Active on ${this.workspaceDir}`);
  }

  /**
   * Stops the watcher and auto-commit engine.
   */
  public stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    this.autoCommit.stop();
  }

  /**
   * Triggered after every file edit/create/delete event.
   */
  private onFileEvent(type: 'change' | 'add' | 'unlink', filePath: string): void {
    const relativePath = path.relative(this.workspaceDir, filePath);
    this.modifiedFiles.add(relativePath);

    // Record event in Supermemory
    this.supermemory.remember('architecture', `File ${type}: ${relativePath}`);

    // Update state header
    const state: HarnessState = {
      workspaceName: path.basename(this.workspaceDir),
      activeFile: relativePath,
      modifiedFiles: Array.from(this.modifiedFiles),
      memorySummary: this.supermemory.getSummary(),
      graphifySummary: this.graphify.getGraphSummary()
    };

    this.lastStateHeader = this.harness.generateHeader(state);
    console.log(`⚡ [HyperMemory :: Hook] Re-synthesized state after edit on [${relativePath}]`);
  }

  /**
   * Gets the latest Oh-My-Pi context header snapshot.
   */
  public getLatestHeader(): string {
    return this.lastStateHeader;
  }
}
