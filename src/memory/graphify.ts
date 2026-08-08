/**
 * HyperMemory — Graphify Structural Knowledge Integration (Graphify-Labs/graphify)
 * Integrates Graphify codebase structural knowledge graphs (graph.json, GRAPH_REPORT.md)
 * with Supermemory temporal decisions into a unified AI agent context harness.
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

export interface GraphifyData {
  nodes: GraphNode[];
  reportSummary?: string;
  lastUpdated?: string;
}

export class GraphifyEngine {
  private workspaceDir: string;
  private graphJsonPath: string;
  private reportPath: string;

  constructor(workspaceDir: string = process.cwd()) {
    this.workspaceDir = workspaceDir;
    this.graphJsonPath = path.join(workspaceDir, 'graph.json');
    this.reportPath = path.join(workspaceDir, 'GRAPH_REPORT.md');
  }

  /**
   * Checks if Graphify data exists in the current workspace.
   */
  public hasGraph(): boolean {
    return fs.existsSync(this.graphJsonPath) || fs.existsSync(this.reportPath);
  }

  /**
   * Reads and parses local Graphify graph.json or GRAPH_REPORT.md.
   */
  public getGraphData(): GraphifyData {
    const data: GraphifyData = { nodes: [] };

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
   * Generates a compact structural graph summary string for Oh-My-Pi context header.
   */
  public getGraphSummary(): string {
    if (!this.hasGraph()) {
      return 'Graphify: Not initialized (Run `graphify .` to generate structural graph)';
    }

    const data = this.getGraphData();
    const nodeCount = data.nodes.length;
    return `Graphify: ${nodeCount} structural nodes mapped | ${data.reportSummary ? 'Report indexed' : 'Graph active'}`;
  }

  /**
   * Attempts to execute Graphify CLI update.
   */
  public async updateGraph(): Promise<boolean> {
    try {
      await execAsync('graphify .', { cwd: this.workspaceDir });
      return true;
    } catch {
      // Return false if graphify CLI is not installed globally
      return false;
    }
  }
}
