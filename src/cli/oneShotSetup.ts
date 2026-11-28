/**
 * HyperSABMemory — One-Shot Setup Engine
 * Configures the complete HyperSABMemory ecosystem (IDE adapters + temporal memory store +
 * structural knowledge graph + minimal-change rules + 3-5m auto-commits)
 * in a single command for instant deployment across any codebase.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import picocolors from 'picocolors';
import { TemporalMemoryEngine } from '../memory/temporalMemory.js';
import { StructuralGraphEngine } from '../memory/structuralGraph.js';
import { seedWorkspace, writeGenesisRecord } from '../memory/seeding.js';
import { AutoCommitEngine } from '../hooks/autoCommit.js';
import { UniversalAdaptersEngine } from '../harness/universalAdapters.js';
import { McpAccessEngine } from '../harness/mcpAccess.js';
import { canonicalPath, isPathContained, resolveVerifiedGitWorktree } from '../harness/gitWorktree.js';
import { withFileLock } from '../memory/fileLock.js';

const execFileAsync = promisify(execFile);

const STORE_DIR = '.hypersabmemory';
const EXCLUDE_LINE = `${STORE_DIR}/`;

function assertSafeTarget(baseDir: string, targetPath: string, expectedKind: 'dir' | 'file'): boolean {
  try {
    const lstat = fs.lstatSync(targetPath);
    if (lstat.isSymbolicLink()) return false;
    if (expectedKind === 'dir' ? !lstat.isDirectory() : !lstat.isFile()) return false;
    return isPathContained(baseDir, canonicalPath(targetPath));
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ENOENT';
  }
}

/**
 * Keeps the memory store out of the user's commits: appends the store dir to
 * the repository's common info/exclude (works across both normal repos and
 * linked git worktrees, idempotent) and untracks an older committed store.
 */
async function containStoreInGit(targetDir: string): Promise<boolean> {
  const resolved = await resolveVerifiedGitWorktree(targetDir);
  if (resolved.status !== 'valid') return false;

  const commonDir = resolved.worktree.commonDir;
  const infoDir = path.join(commonDir, 'info');
  if (!assertSafeTarget(commonDir, infoDir, 'dir')) return false;
  fs.mkdirSync(infoDir, { recursive: true });

  const excludePath = path.join(infoDir, 'exclude');
  if (!assertSafeTarget(commonDir, excludePath, 'file')) return false;

  const excludeLock = path.join(infoDir, 'hypersabmemory-exclude.lock');
  withFileLock(excludeLock, () => {
    if (!assertSafeTarget(commonDir, excludePath, 'file')) return;
    const current = fs.existsSync(excludePath) ? fs.readFileSync(excludePath, 'utf-8') : '';
    const alreadyListed = current.split(/\r?\n/).some((line) => line.trim() === EXCLUDE_LINE);
    if (!alreadyListed) {
      const separator = current.length > 0 && !current.endsWith('\n') ? '\n' : '';
      fs.writeFileSync(excludePath, `${current}${separator}${EXCLUDE_LINE}\n`, 'utf-8');
    }
  });

  try {
    const { stdout } = await execFileAsync('git', ['ls-files', '--', STORE_DIR], { cwd: targetDir });
    if (stdout.trim().length > 0) {
      await execFileAsync('git', ['rm', '-r', '--cached', '--quiet', STORE_DIR], { cwd: targetDir });
    }
  } catch {
    // git unavailable or not a work tree — the exclude rule still guards future commits
  }
  return true;
}

export interface SetupOutcome {
  success: boolean;
  createdFiles: string[];
  skippedTrackedFiles?: string[];
  genesisHash?: string;
  error?: string;
}

export class OneShotSetupEngine {
  private targetDir: string;

  constructor(targetDir: string = process.cwd()) {
    this.targetDir = targetDir;
  }

  /**
   * Executes the full one-shot setup sequence.
   */
  public async executeSetup(options: { checkpoint?: boolean; injectTracked?: boolean } = {}): Promise<SetupOutcome> {
    let createdFiles: string[] = [];

    try {
      let targetStat: fs.Stats | undefined;
      try {
        targetStat = fs.statSync(this.targetDir);
      } catch {
        targetStat = undefined;
      }
      if (!targetStat || !targetStat.isDirectory()) {
        return { success: false, createdFiles: [], error: 'Target workspace must be an existing directory.' };
      }

      const access = new McpAccessEngine(this.targetDir);
      const connected = access.connect();
      createdFiles = createdFiles.concat(connected.written);

      // 0. Cold-start bootstrap: seed first-boot facts before the engine loads the store.
      const seedResult = await seedWorkspace(this.targetDir);

      // 1. Sync Universal IDE Adapters (preserving Git-tracked instruction files unless explicitly opted in)
      const memory = new TemporalMemoryEngine(this.targetDir);
      memory.remember('architecture', 'Initialized HyperSABMemory one-shot setup with universal IDE adapters.');

      const adapters = new UniversalAdaptersEngine(this.targetDir);
      const adapterResult = adapters.syncAllAdapters({
        contextBlock: memory.getContextBlock(),
        preserveTrackedFiles: options.injectTracked !== true
      });
      createdFiles = createdFiles.concat(adapterResult.createdFiles);

      const contained = await containStoreInGit(this.targetDir);

      const graph = new StructuralGraphEngine(this.targetDir);
      await graph.updateGraph();

      let genesisHash: string | undefined;
      if (options.checkpoint) {
        const autoCommit = new AutoCommitEngine({ workspaceDir: this.targetDir });
        if (contained && seedResult.seeded > 0) {
          genesisHash = await this.runGenesisRitual(memory, autoCommit);
        } else {
          await autoCommit.createCheckpoint('HyperSABMemory One-Shot Setup Complete');
        }
      }

      return {
        success: true,
        createdFiles,
        skippedTrackedFiles: adapterResult.skippedTrackedFiles,
        ...(genesisHash ? { genesisHash } : {})
      };
    } catch (err) {
      console.error('[HyperSABMemory :: OneShotSetup] Setup failed:', err);
      return { success: false, createdFiles, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Writes the single genesis record via direct set, bootstraps Memory.md so the
   * named checkpoint has a tracked artifact (the store itself is git-excluded),
   * then prints the final GENESIS line with the checkpoint's short hash.
   */
  private async runGenesisRitual(
    memory: TemporalMemoryEngine,
    autoCommit: AutoCommitEngine
  ): Promise<string> {
    writeGenesisRecord(this.targetDir);

    const memoryMd = path.join(this.targetDir, 'Memory.md');
    if (!fs.existsSync(memoryMd)) {
      fs.writeFileSync(memoryMd, '# Memory\n', 'utf-8');
    }
    memory.syncToMemoryFile();

    const checkpoint = await autoCommit.createCheckpoint('genesis: workspace memory baseline');
    let hash = checkpoint.hash;
    if (!hash) {
      try {
        const { stdout } = await execFileAsync('git', ['rev-parse', '--short', 'HEAD'], { cwd: this.targetDir });
        hash = stdout.trim();
      } catch {
        hash = 'unknown';
      }
    }
    console.log(`GENESIS ${hash} - this workspace now remembers.`);
    return hash;
  }
}

/**
 * Prints the setup result. Failures surface the real error message plus the
 * partial createdFiles list instead of a generic "check logs" pointer.
 */
export function printSetupOutcome(outcome: SetupOutcome, workspaceDir: string = process.cwd()): void {
  if (outcome.success) {
    console.log(picocolors.green('✔ Structural graph support ready (uses local graph inputs when present).'));
    console.log(picocolors.green('✔ Temporal memory store initialized.'));
    console.log(picocolors.green('✔ Minimal-change rules installed (.agents/skills/hypersabmemory/SKILL.md).'));
    if (outcome.skippedTrackedFiles && outcome.skippedTrackedFiles.length > 0) {
      console.log(
        picocolors.yellow(
          `ℹ Preserved ${outcome.skippedTrackedFiles.length} Git-tracked instruction file(s) without modification: ${outcome.skippedTrackedFiles.join(', ')} (pass --inject-tracked to opt in).`
        )
      );
    }
    console.log(picocolors.green('✔ Auto-checkpoints configured (3-minute default).'));
    console.log(picocolors.yellow('Setup does not create Git commits unless run with --checkpoint.'));
    console.log(picocolors.yellow('Note: checkpoints stage all trackable changes at the repository root; review ignore rules for private/generated files.'));
    console.log(picocolors.green('✔ Direct MCP access written (Cursor, Claude Code, VS Code).'));
    console.log(picocolors.cyan('\nFlow: reload the IDE → enable the hypersabmemory MCP server → call hypersabmemory_get_context.'));
    return;
  }

  console.log(picocolors.red(`✖ Setup failed: ${outcome.error ?? 'unknown error'}`));
  if (outcome.createdFiles.length > 0) {
    console.log(picocolors.yellow(`Partially created files before failure (${outcome.createdFiles.length}):`));
    for (const file of outcome.createdFiles) {
      console.log(picocolors.gray(`  ${path.relative(workspaceDir, file) || file}`));
    }
  }
}
