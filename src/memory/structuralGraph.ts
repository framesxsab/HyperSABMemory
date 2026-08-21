/**
 * HyperSABMemory — Structural Knowledge Graph Integration
 * Integrates codebase structural knowledge graphs (graph.json, GRAPH_REPORT.md)
 * with temporal decisions into a unified AI agent context harness.
 */

import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface GraphNode {
  id: string;
  type: 'file' | 'class' | 'function' | 'module';
  name: string;
  dependencies?: string[];
}

export interface StructuralGraphData {
  nodes: GraphNode[];
  reportSummary?: string;
  lastUpdated?: string;
}

export class StructuralGraphEngine {
  private workspaceDir: string;
  private graphJsonPath: string;
  private reportPath: string;

  constructor(workspaceDir: string = process.cwd()) {
    this.workspaceDir = workspaceDir;
    this.graphJsonPath = path.join(workspaceDir, 'graph.json');
    this.reportPath = path.join(workspaceDir, 'GRAPH_REPORT.md');
  }

  /**
   * Checks if structural graph data exists in the current workspace.
   */
  public hasGraph(): boolean {
    return fs.existsSync(this.graphJsonPath) || fs.existsSync(this.reportPath);
  }

  /**
   * Reads and parses local graph.json or GRAPH_REPORT.md.
   */
  public getGraphData(): StructuralGraphData {
    const data: StructuralGraphData = { nodes: [] };

    try {
      if (fs.existsSync(this.graphJsonPath)) {
        const raw = fs.readFileSync(this.graphJsonPath, 'utf-8');
        const parsed = JSON.parse(raw);
        data.nodes = parsed.nodes || parsed.elements || [];
        data.lastUpdated = new Date().toISOString();
      }

      if (fs.existsSync(this.reportPath)) {
        const reportRaw = fs.readFileSync(this.reportPath, 'utf-8');
        data.reportSummary = reportRaw.slice(0, 500); // Truncate for prompt budget
      }
    } catch {
      // Fallback cleanly
    }

    return data;
  }

  /**
   * Generates a compact structural graph summary string for the context harness header.
   */
  public getGraphSummary(): string {
    if (!this.hasGraph()) {
      return 'Structural knowledge graph: not initialized (no graph.json found yet)';
    }

    const data = this.getGraphData();
    const nodeCount = data.nodes.length;
    return `Structural knowledge graph: ${nodeCount} nodes mapped | ${data.reportSummary ? 'Report indexed' : 'Graph active'}`;
  }

  /**
   * Attempts a best-effort external structural graph index refresh.
   * The indexer command can be provided via HYPERSABMEMORY_GRAPH_INDEX_CMD;
   * without it this degrades to false (graph.json stays as-is).
   */
  public async updateGraph(): Promise<boolean> {
    const command = process.env.HYPERSABMEMORY_GRAPH_INDEX_CMD;
    if (!command) {
      return false;
    }
    try {
      await execAsync(command, { cwd: this.workspaceDir });
      return true;
    } catch {
      // Return false if the configured indexer is not available
      return false;
    }
  }
}
