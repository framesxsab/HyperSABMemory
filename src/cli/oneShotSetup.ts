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
import { AutoCommitEngine } from '../hooks/autoCommit.js';
import { UniversalAdaptersEngine } from '../harness/universalAdapters.js';
import { McpAccessEngine } from '../harness/mcpAccess.js';

const execFileAsync = promisify(execFile);

const STORE_DIR = '.hypersabmemory';
const EXCLUDE_LINE = `${STORE_DIR}/`;

/**
 * Keeps the memory store out of the user's commits: appends the store dir to
 * .git/info/exclude (idempotent) and untracks it if an older setup already
 * committed it. Silent no-op outside a git work tree.
 */
async function containStoreInGit(targetDir: string): Promise<void> {
  const gitDir = path.join(targetDir, '.git');
  if (!fs.existsSync(gitDir) || !fs.statSync(gitDir).isDirectory()) return;

  const infoDir = path.join(gitDir, 'info');
  fs.mkdirSync(infoDir, { recursive: true });
  const excludePath = path.join(infoDir, 'exclude');
  const current = fs.existsSync(excludePath) ? fs.readFileSync(excludePath, 'utf-8') : '';
  const alreadyListed = current.split(/\r?\n/).some((line) => line.trim() === EXCLUDE_LINE);
  if (!alreadyListed) {
    const separator = current.length > 0 && !current.endsWith('\n') ? '\n' : '';
    fs.writeFileSync(excludePath, `${current}${separator}${EXCLUDE_LINE}\n`, 'utf-8');
  }

  try {
    const { stdout } = await execFileAsync('git', ['ls-files', '--', STORE_DIR], { cwd: targetDir });
    if (stdout.trim().length > 0) {
      await execFileAsync('git', ['rm', '-r', '--cached', '--quiet', STORE_DIR], { cwd: targetDir });
    }
  } catch {
    // git unavailable or not a work tree — the exclude rule still guards future commits
  }
}

export interface SetupOutcome {
  success: boolean;
  createdFiles: string[];
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
  public async executeSetup(): Promise<SetupOutcome> {
    let createdFiles: string[] = [];

    try {
      // 1. Sync Universal IDE Adapters (Cursor, Claude Code, Windsurf, Copilot, Antigravity)
      const memory = new TemporalMemoryEngine(this.targetDir);
      memory.remember('architecture', 'Initialized HyperSABMemory one-shot setup with universal IDE adapters.');

      const adapters = new UniversalAdaptersEngine(this.targetDir);
      const adapterResult = adapters.syncAllAdapters({
        contextBlock: memory.getContextBlock()
      });
      createdFiles = createdFiles.concat(adapterResult.createdFiles);

      const access = new McpAccessEngine(this.targetDir);
      const connected = access.connect();
      createdFiles = createdFiles.concat(connected.written);

      await containStoreInGit(this.targetDir);

      const graph = new StructuralGraphEngine(this.targetDir);
      await graph.updateGraph();

      // 4. Trigger initial git checkpoint
      const autoCommit = new AutoCommitEngine({
        workspaceDir: this.targetDir
      });
      await autoCommit.createCheckpoint('HyperSABMemory One-Shot Setup Complete');

      return { success: true, createdFiles };
    } catch (err) {
      console.error('[HyperSABMemory :: OneShotSetup] Setup failed:', err);
      return { success: false, createdFiles, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

/**
 * Prints the setup result. Failures surface the real error message plus the
 * partial createdFiles list instead of a generic "check logs" pointer.
 */
export function printSetupOutcome(outcome: SetupOutcome, workspaceDir: string = process.cwd()): void {
  if (outcome.success) {
    console.log(picocolors.green('✔ Structural knowledge graph integrated.'));
    console.log(picocolors.green('✔ Temporal memory store initialized.'));
    console.log(picocolors.green('✔ Minimal-change rules installed (.agents/skills/hypersabmemory/SKILL.md).'));
    console.log(picocolors.green('✔ 3-5 Min Auto-Commit engine configured.'));
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
