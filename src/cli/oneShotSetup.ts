/**
 * HyperMemory — One-Shot Setup Engine & Ponytail Installer
 * Configures complete HyperMemory ecosystem (Graphify + Supermemory + Oh-My-Pi + Ponytail + 3-5m Auto-Commits)
 * in a single command for instant deployment across any codebase.
 */

import { SupermemoryEngine } from '../memory/supermemory.js';
import { GraphifyEngine } from '../memory/graphify.js';
import { AutoCommitEngine } from '../hooks/autoCommit.js';
import { UniversalAdaptersEngine } from '../harness/universalAdapters.js';
import { McpAccessEngine } from '../harness/mcpAccess.js';

export class OneShotSetupEngine {
  private targetDir: string;

  constructor(targetDir: string = process.cwd()) {
    this.targetDir = targetDir;
  }

  /**
   * Executes the full one-shot setup sequence.
   */
  public async executeSetup(): Promise<{ success: boolean; createdFiles: string[] }> {
    let createdFiles: string[] = [];

    try {
      // 1. Sync Universal IDE Adapters (Cursor, Claude Code, Windsurf, Copilot, Antigravity)
      const supermemory = new SupermemoryEngine(this.targetDir);
      supermemory.remember('architecture', 'Initialized HyperMemory One-Shot Setup with Ponytail, Graphify & Universal IDE Adapters.');

      const adapters = new UniversalAdaptersEngine(this.targetDir);
      const adapterResult = adapters.syncAllAdapters({
        contextBlock: supermemory.getContextBlock()
      });
      createdFiles = createdFiles.concat(adapterResult.createdFiles);

      const access = new McpAccessEngine(this.targetDir);
      const connected = access.connect();
      createdFiles = createdFiles.concat(connected.written);

      const graphify = new GraphifyEngine(this.targetDir);
      await graphify.updateGraph();

      // 4. Trigger initial git checkpoint
      const autoCommit = new AutoCommitEngine({
        workspaceDir: this.targetDir
      });
      await autoCommit.createCheckpoint('HyperMemory One-Shot Setup Complete');

      return { success: true, createdFiles };
    } catch (err) {
      console.error('[HyperMemory :: OneShotSetup] Setup failed:', err);
      return { success: false, createdFiles };
    }
  }
}
