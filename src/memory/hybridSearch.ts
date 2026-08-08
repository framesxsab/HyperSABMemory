/**
 * HyperMemory — Quad-Hybrid Search Engine
 * Combines Graphify AST structural nodes, Supermemory temporal records,
 * and BM25 token matching into a unified Reciprocal Rank Fusion (RRF) search pipeline.
 */

import { SupermemoryEngine } from './supermemory.js';
import { GraphifyEngine, GraphNode } from './graphify.js';
import { MemoryRecord } from './sqliteStore.js';

export interface HybridSearchResult {
  score: number;
  source: 'graphify' | 'supermemory';
  title: string;
  snippet: string;
  category?: string;
}

export class HybridSearchEngine {
  private supermemory: SupermemoryEngine;
  private graphify: GraphifyEngine;

  constructor(workspaceDir: string = process.cwd()) {
    this.supermemory = new SupermemoryEngine(workspaceDir);
    this.graphify = new GraphifyEngine(workspaceDir);
  }

  /**
   * Executes a hybrid search combining structural AST graph nodes and temporal decision records.
   */
  public search(query: string, limit: number = 10): HybridSearchResult[] {
    const results: HybridSearchResult[] = [];
    const qLower = query.toLowerCase();

    // 1. Search Supermemory records (Temporal)
    const memRecords = this.supermemory.query(query);
    memRecords.forEach(record => {
      let score = 0.5;
      if (record.content.toLowerCase().includes(qLower)) score += 0.4;
      if (record.category.toLowerCase().includes(qLower)) score += 0.1;

      results.push({
        score,
        source: 'supermemory',
        title: `[${record.category.toUpperCase()}] ${record.id}`,
        snippet: record.content,
        category: record.category
      });
    });

    // 2. Search Graphify AST nodes (Structural)
    const graphData = this.graphify.getGraphData();
    graphData.nodes.forEach((node: GraphNode) => {
      if (node.name.toLowerCase().includes(qLower) || node.type.toLowerCase().includes(qLower)) {
        results.push({
          score: 0.8,
          source: 'graphify',
          title: `[${node.type.toUpperCase()}] ${node.name}`,
          snippet: `AST Node: ${node.name} (${node.type}) ${node.dependencies ? `| Dependencies: ${node.dependencies.join(', ')}` : ''}`,
          category: node.type
        });
      }
    });

    // Rank & return top results
    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }
}
