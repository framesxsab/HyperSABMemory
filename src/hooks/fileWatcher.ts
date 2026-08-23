/**
 * HyperSABMemory — Real-Time File Watcher & Event Hook
 * Automatically triggers state re-synthesis, context harness header update,
 * and Memory.md syncing after every file edit or save.
 */

import chokidar, { FSWatcher } from 'chokidar';
import * as path from 'path';
import { TemporalMemoryEngine } from '../memory/temporalMemory.js';
import { StructuralGraphEngine } from '../memory/structuralGraph.js';
import { formatFileEventFact } from '../memory/contextBlock.js';
import { ContextHarness, HarnessState } from '../harness/contextHarness.js';
import { AutoCommitEngine } from './autoCommit.js';

export interface FileWatcherOptions {
  workspaceDir?: string;
  ignoredPatterns?: Array<string | RegExp>;
  autoCommitIntervalMinutes?: number;
}

export class FileWatcherHook {
  private workspaceDir: string;
  private options: FileWatcherOptions;
  private watcher: FSWatcher | null = null;
  private memory: TemporalMemoryEngine;
  private graph: StructuralGraphEngine;
  private harness: ContextHarness;
  private autoCommit: AutoCommitEngine;
  private modifiedFiles: Set<string> = new Set();
  private lastStateHeader: string = '';
  private lastRememberAt: Map<string, number> = new Map();
  private static readonly REMEMBER_COOLDOWN_MS = 30_000;

  constructor(options: FileWatcherOptions = {}) {
    this.options = options;
    this.workspaceDir = options.workspaceDir || process.cwd();
    this.memory = new TemporalMemoryEngine(this.workspaceDir);
    this.graph = new StructuralGraphEngine(this.workspaceDir);
    this.harness = new ContextHarness(1500);
    this.autoCommit = new AutoCommitEngine({
      workspaceDir: this.workspaceDir,
      intervalMinutes: options.autoCommitIntervalMinutes || parseInt(process.env.HYPERSABMEMORY_COMMIT_INTERVAL || '3', 10)
    });
  }

  /**
   * Matches a normalized (forward-slash) path against an ignore glob such as node_modules under any directory.
   */
  private matchesGlob(normalized: string, pattern: string): boolean {
    const core = pattern.replace(/^\*\*\//, '').replace(/\/\*\*$/, '');
    return normalized.includes(`/${core}/`) || normalized.endsWith(`/${core}`);
  }

  /**
   * Starts watching workspace for file changes.
   */
  public start(): void {
    const defaultIgnored = [
      '**/node_modules/**',
      '**/.git/**',
      '**/dist/**',
      '**/.hypersabmemory/**',
      '**/Memory.md',
      '**/.venv/**',
      '**/target/**',
      '**/build/**',
      '**/out/**',
      '**/coverage/**',
      '**/vendor/**'
    ];

    this.watcher = chokidar.watch(this.workspaceDir, {
      // Function matcher normalizes Windows backslashes so ignore globs actually match.
      ignored: (filePath: string) => {
        const normalized = filePath.split(path.sep).join('/');
        if (defaultIgnored.some((pattern) => this.matchesGlob(normalized, pattern))) return true;
        return (this.options.ignoredPatterns ?? []).some((pattern) =>
          typeof pattern === 'string' ? normalized.includes(pattern) : pattern.test(normalized)
        );
      },
      awaitWriteFinish: {
        stabilityThreshold: 400,
        pollInterval: 100
      },
      persistent: true,
      ignoreInitial: true
    });

    this.watcher
      .on('change', (filePath: string) => this.onFileEvent('change', filePath))
      .on('add', (filePath: string) => this.onFileEvent('add', filePath))
      .on('unlink', (filePath: string) => this.onFileEvent('unlink', filePath));

    // Start 3-5 min hyperfrequent auto-commit engine
    this.autoCommit.start();

    console.log(`[HyperSABMemory :: FileWatcher] Active on ${this.workspaceDir}`);
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

    // Debounce memory records: one architecture fact per file per 30s window
    const now = Date.now();
    const lastRemember = this.lastRememberAt.get(relativePath) ?? 0;
    if (now - lastRemember >= FileWatcherHook.REMEMBER_COOLDOWN_MS) {
      this.memory.remember('architecture', formatFileEventFact(type, relativePath));
      this.lastRememberAt.set(relativePath, now);
    }

    // Update state header
    const state: HarnessState = {
      workspaceName: path.basename(this.workspaceDir),
      activeFile: relativePath,
      modifiedFiles: Array.from(this.modifiedFiles),
      memorySummary: this.memory.getSummary(),
      structuralGraphSummary: this.graph.getGraphSummary()
    };

    this.lastStateHeader = this.harness.generateHeader(state);
    console.log(`[HyperSABMemory :: Hook] Re-synthesized state after edit on [${relativePath}]`);
  }

  /**
   * Gets the latest context harness header snapshot.
   */
  public getLatestHeader(): string {
    return this.lastStateHeader;
  }
}
