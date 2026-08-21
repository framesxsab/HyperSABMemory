/**
 * HyperSABMemory — Quad-Hybrid Search Engine
 * Combines structural knowledge graph nodes, temporal memory records,
 * and BM25 token matching into a unified Reciprocal Rank Fusion (RRF) search pipeline.
 */

import { TemporalMemoryEngine } from './temporalMemory.js';
import { StructuralGraphEngine, GraphNode } from './structuralGraph.js';
import { MemoryRecord } from './sqliteStore.js';

export interface HybridSearchResult {
  score: number;
  source: 'graph' | 'memory';
  title: string;
  snippet: string;
  category?: string;
}

interface CorpusStats {
  docFreq: Map<string, number>;
  avgLen: number;
  n: number;
}

const BM25_K1 = 1.2;
const BM25_B = 0.75;
const RRF_K = 60;
const SUBSTRING_BOOST = 0.5;

function clampLimit(limit: number): number {
  return Number.isFinite(limit) ? Math.min(Math.max(1, Math.floor(limit)), 100) : 10;
}

export class HybridSearchEngine {
  private memory: TemporalMemoryEngine;
  private graph: StructuralGraphEngine;

  constructor(workspaceDir: string = process.cwd(), memory?: TemporalMemoryEngine, graph?: StructuralGraphEngine) {
    this.memory = memory ?? new TemporalMemoryEngine(workspaceDir);
    this.graph = graph ?? new StructuralGraphEngine(workspaceDir);
  }

  /**
   * Executes a hybrid search combining structural AST graph nodes and temporal decision records.
   */
  public search(query: string, limit: number = 10): HybridSearchResult[] {
    const qLower = query.toLowerCase().trim();
    if (!qLower) return [];

    const memoryLeg = this.scoreMemoryLeg(qLower);
    const graphLeg = this.scoreGraphLeg(qLower);

    return this.fuseRRF([memoryLeg, graphLeg], clampLimit(limit));
  }

  /**
   * Ranked active memory records (BM25 over the full corpus) for MCP query compatibility.
   */
  public searchRecords(query: string, limit: number = 10): MemoryRecord[] {
    const qLower = query.toLowerCase().trim();
    if (!qLower) return [];

    const records = this.memory.getActive();
    const stats = this.corpusStats(records);
    const queryTokens = this.tokenize(qLower);

    return records
      .map(record => {
        const docTokens = this.tokenize(this.recordText(record));
        let score = this.bm25(queryTokens, docTokens, stats);
        if (record.content.toLowerCase().includes(qLower)) score += SUBSTRING_BOOST;
        return { record, score };
      })
      .filter(entry => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, clampLimit(limit))
      .map(entry => entry.record);
  }

  private scoreMemoryLeg(qLower: string): HybridSearchResult[] {
    const records = this.memory.getActive();
    const stats = this.corpusStats(records);
    const queryTokens = this.tokenize(qLower);

    const results: HybridSearchResult[] = [];
    for (const record of records) {
      const docTokens = this.tokenize(this.recordText(record));
      let score = this.bm25(queryTokens, docTokens, stats);
      if (record.content.toLowerCase().includes(qLower)) score += SUBSTRING_BOOST;
      if (score <= 0) continue;

      results.push({
        score,
        source: 'memory',
        title: `[${record.category.toUpperCase()}] ${record.id}`,
        snippet: record.content,
        category: record.category
      });
    }
    return results;
  }

  private scoreGraphLeg(qLower: string): HybridSearchResult[] {
    const graphData = this.graph.getGraphData();
    const results: HybridSearchResult[] = [];

    for (const node of graphData.nodes) {
      const nameLower = node.name.toLowerCase();
      const typeLower = node.type.toLowerCase();
      if (!nameLower.includes(qLower) && !typeLower.includes(qLower)) continue;

      results.push({
        score: 1,
        source: 'graph',
        title: `[${node.type.toUpperCase()}] ${node.name}`,
        snippet: `AST Node: ${node.name} (${node.type}) ${node.dependencies ? `| Dependencies: ${node.dependencies.join(', ')}` : ''}`,
        category: node.type
      });
    }
    return results;
  }

  private fuseRRF(legs: HybridSearchResult[][], limit: number): HybridSearchResult[] {
    const fused = new Map<string, { result: HybridSearchResult; score: number }>();

    for (const leg of legs) {
      leg.forEach((result, rank) => {
        const key = `${result.source}|${result.title}`;
        const contribution = 1 / (RRF_K + rank + 1);
        const existing = fused.get(key);
        if (existing) {
          existing.score += contribution;
        } else {
          fused.set(key, { result, score: contribution });
        }
      });
    }

    return Array.from(fused.values())
      .map(entry => ({ ...entry.result, score: entry.score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  private corpusStats(records: MemoryRecord[]): CorpusStats {
    const docFreq = new Map<string, number>();
    let totalLen = 0;

    for (const record of records) {
      const tokens = this.tokenize(this.recordText(record));
      totalLen += tokens.length;
      for (const token of new Set(tokens)) {
        docFreq.set(token, (docFreq.get(token) ?? 0) + 1);
      }
    }

    return {
      docFreq,
      avgLen: records.length > 0 ? totalLen / records.length : 0,
      n: records.length
    };
  }

  private bm25(queryTokens: string[], docTokens: string[], stats: CorpusStats): number {
    const dl = docTokens.length;
    const tf = new Map<string, number>();
    for (const token of docTokens) {
      tf.set(token, (tf.get(token) ?? 0) + 1);
    }

    let score = 0;
    for (const token of queryTokens) {
      const freq = tf.get(token) ?? 0;
      if (freq === 0) continue;

      const n = stats.docFreq.get(token) ?? 0;
      const idf = Math.log(1 + (stats.n - n + 0.5) / (n + 0.5));
      const denominator = freq + BM25_K1 * (1 - BM25_B + BM25_B * (dl / (stats.avgLen || 1)));
      score += idf * ((freq * (BM25_K1 + 1)) / denominator);
    }
    return score;
  }

  private tokenize(text: string): string[] {
    return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  }

  private recordText(record: MemoryRecord): string {
    return [
      record.content,
      (record.tags ?? []).join(' '),
      record.category,
      record.intent ?? '',
      (record.artifacts ?? []).join(' '),
      record.errorsAndFixes ?? '',
      record.nextSteps ?? ''
    ].filter(Boolean).join(' ');
  }
}