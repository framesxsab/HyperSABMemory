/**
 * HyperSABMemory — One-Shot Setup Engine
 * Configures the complete HyperSABMemory ecosystem (IDE adapters + temporal memory store +
 * structural knowledge graph + minimal-change rules + 3-5m auto-commits)
 * in a single command for instant deployment across any codebase.
 */

import { TemporalMemoryEngine } from '../memory/temporalMemory.js';
import { StructuralGraphEngine } from '../memory/structuralGraph.js';
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
      return { success: false, createdFiles };
    }
  }
}
