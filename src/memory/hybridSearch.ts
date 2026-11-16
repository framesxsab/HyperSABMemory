/**
 * HyperSABMemory — Quad-Hybrid Search Engine
 * Combines structural knowledge graph nodes, temporal memory records,
 * and BM25 token matching into a unified Reciprocal Rank Fusion (RRF) search pipeline.
 */

import { TemporalMemoryEngine } from './temporalMemory.js';
import { StructuralGraphEngine } from './structuralGraph.js';
import { MemoryRecord } from './sqliteStore.js';
import { performance } from 'node:perf_hooks';
import * as path from 'node:path';
import { stemmer } from 'stemmer';

export interface HybridSearchResult {
  score: number;
  source: 'graph' | 'memory';
  title: string;
  snippet: string;
  category?: string;
}

export interface ScoredMemoryRecord {
  record: MemoryRecord;
  bm25Score: number;
  queryTermEvidence: Array<{ term: string; idf: number; matched: boolean }>;
  exactPathMatch: boolean;
  identifierDefinitions: string[];
  exactPhraseBoost: number;
  score: number;
  pathCoverage?: number;
  rankingScore?: number;
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
const tokenCache = new Map<string, string[]>();
let tokenCacheSize = 0;
const importCache = new Map<string, string[]>();
let importCacheSize = 0;
const TOKEN_CACHE_LIMIT = 8 * 1024 * 1024;
const stemCache = new Map<string, string>();
export const COMMON_QUERY_TERMS = new Set('a an and are as at be by does for from how in into is of on or the through to what where which who with'.split(' '));

function normalizeToken(token: string): string {
  if (COMMON_QUERY_TERMS.has(token) || !/^[a-z]+$/.test(token)) return token;
  const cached = stemCache.get(token);
  if (cached !== undefined) return cached;
  const result = stemmer(token);
  if (token.length <= 128) {
    if (stemCache.size >= 8192) stemCache.clear();
    stemCache.set(token, result);
  }
  return result;
}

export function tokenizeSearchText(text: string): string[] {
  const split = /[a-z0-9][A-Z]|[A-Z]{2}[a-z]/.test(text)
    ? text.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    : text;
  return (split.toLowerCase().match(/[a-z0-9]+/g) ?? []).map(normalizeToken);
}

export function tokenizeSearchQuery(text: string): string[] {
  return tokenizeSearchText(text).filter(token => token.length > 2 && !COMMON_QUERY_TERMS.has(token));
}

export function recordSearchText(record: MemoryRecord): string {
  return [record.content, (record.tags ?? []).join(' '), record.category, record.intent ?? '', (record.artifacts ?? []).join(' '), record.errorsAndFixes ?? '', record.nextSteps ?? ''].filter(Boolean).join(' ');
}

export function queryIdentifiers(text: string): string[] {
  return [...new Set([
    ...(text.match(/\b[A-Za-z][A-Za-z0-9_$]*[A-Z][A-Za-z0-9_$]*\b/g) ?? []),
    ...(text.match(/\b[A-Za-z0-9]+(?:_[A-Za-z0-9]+)+\b/g) ?? [])
  ])];
}

function declaresIdentifier(text: string, identifier: string): boolean {
  const escaped = identifier.replace(/[$]/g, '\\$');
  return new RegExp(`\\b(?:class|function|interface|type|const|let|var|enum)\\s+${escaped}(?![\\w$])`).test(text);
}

function staticImports(content: string): string[] {
  if (!content.includes('import') && !content.includes('export')) return [];
  const imports: string[] = [];
  let lineStart = true;
  for (let index = 0; index < content.length;) {
    const character = content[index];
    const next = content[index + 1];
    if (character === '\n' || character === '\r') { lineStart = true; index++; continue; }
    if (lineStart && (character === ' ' || character === '\t')) { index++; continue; }
    if (character === '/' && next === '/') {
      const end = content.indexOf('\n', index + 2);
      if (end < 0) break;
      index = end;
      continue;
    }
    if (character === '/' && next === '*') {
      const end = content.indexOf('*/', index + 2);
      if (end < 0) break;
      index = end + 2;
      lineStart = false;
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      const quote = character;
      index++;
      while (index < content.length && content[index] !== quote) index += content[index] === '\\' ? 2 : 1;
      if (index < content.length) index++;
      lineStart = false;
      continue;
    }
    if (lineStart && (content.startsWith('import', index) || content.startsWith('export', index))) {
      // shortcut: imports longer than 4096 characters are ignored; use a parser if they matter.
      const match = content.slice(index, index + 4096).match(/^(?:import|export)\s+(?:[\w*$,\s{}]+?\s+from\s+)?(['"])(\.{1,2}\/[^'"\\\r\n]+)\1/);
      if (match) imports.push(match[2]);
    }
    lineStart = false;
    index++;
  }
  return imports;
}

function containsPath(query: string, candidate: string, basename: boolean): boolean {
  if (!candidate) return false;
  for (let index = query.indexOf(candidate); index >= 0; index = query.indexOf(candidate, index + 1)) {
    const before = query[index - 1] ?? '';
    const after = query[index + candidate.length] ?? '';
    const next = query[index + candidate.length + 1] ?? '';
    const left = !before || !/[a-z0-9_.\/-]/i.test(before) || (!basename && before === '/');
    const right = !after || (!/[a-z0-9_\/-]/i.test(after) && !(after === '.' && /[a-z0-9_]/i.test(next)));
    if (left && right) return true;
  }
  return false;
}

function clampLimit(limit: number): number {
  return Number.isFinite(limit) ? Math.min(Math.max(1, Math.floor(limit)), 100) : 10;
}

export class HybridSearchEngine {
  private memory: Pick<TemporalMemoryEngine, 'getActive'>;
  private graph: StructuralGraphEngine;
  private cachePrefix: string;

  constructor(workspaceDir: string = process.cwd(), memory?: Pick<TemporalMemoryEngine, 'getActive'>, graph?: StructuralGraphEngine) {
    this.memory = memory ?? new TemporalMemoryEngine(workspaceDir);
    this.graph = graph ?? new StructuralGraphEngine(workspaceDir);
    this.cachePrefix = `${path.resolve(workspaceDir)}\0`;
  }

  /**
   * Executes a hybrid search combining structural AST graph nodes and temporal decision records.
   */
  public search(query: string, limit: number = 10): HybridSearchResult[] {
    const qLower = query.toLowerCase().trim();
    if (!qLower) return [];

    const memoryLeg = this.scoreMemoryLeg(query.trim());
    const graphLeg = this.scoreGraphLeg(qLower);

    return this.fuseRRF([memoryLeg, graphLeg], clampLimit(limit));
  }

  /**
   * Ranked active memory records (BM25 over the full corpus) for MCP query compatibility.
   */
  public searchRecords(query: string, limit: number = 10): MemoryRecord[] {
    return this.searchRecordsWithScores(query, limit).map(result => result.record);
  }

  /** Per-call score diagnostics for evaluation; this does not alter default result shapes. */
  public searchRecordsWithScores(query: string, limit: number = 10, timing?: { candidateMs: number; rankingMs: number; indexingMs?: number }): ScoredMemoryRecord[] {
    const trimmed = query.trim();
    const qLower = trimmed.toLowerCase();
    if (!qLower) return [];

    let started = timing ? performance.now() : 0;
    const records = this.memory.getActive();
    const queryTokens = tokenizeSearchQuery(trimmed);
    const queryTerms = new Set(queryTokens);
    const identifiers = queryIdentifiers(trimmed);
    const docFreq = new Map<string, number>();
    let totalLen = 0;
    const indexStarted = timing ? performance.now() : 0;
    const documents = records.map(record => {
      const text = recordSearchText(record);
      const cacheKey = this.cachePrefix + text;
      let tokens = tokenCache.get(cacheKey);
      if (!tokens) {
        tokens = tokenizeSearchText(text);
        if (cacheKey.length <= TOKEN_CACHE_LIMIT) {
          while (tokenCacheSize + cacheKey.length > TOKEN_CACHE_LIMIT) {
            const oldest = tokenCache.keys().next().value!;
            tokenCache.delete(oldest);
            tokenCacheSize -= oldest.length;
          }
          tokenCache.set(cacheKey, tokens);
          tokenCacheSize += cacheKey.length;
        }
      }
      let termFrequency: Map<string, number> | undefined;
      totalLen += tokens.length;
      for (const token of tokens) {
        if (!queryTerms.has(token)) continue;
        termFrequency ??= new Map<string, number>();
        termFrequency.set(token, (termFrequency.get(token) ?? 0) + 1);
        if (termFrequency.get(token) === 1) docFreq.set(token, (docFreq.get(token) ?? 0) + 1);
      }
      const exactPhraseBoost = record.content.toLowerCase().includes(qLower) ? SUBSTRING_BOOST : 0;
      if (!termFrequency && !exactPhraseBoost) return null;
      return { record, termFrequency: termFrequency ?? new Map<string, number>(), documentLength: tokens.length, exactPhraseBoost };
    }).filter((entry): entry is NonNullable<typeof entry> => entry !== null);
    if (timing && timing.indexingMs !== undefined) timing.indexingMs += performance.now() - indexStarted;
    const stats: CorpusStats = { docFreq, avgLen: records.length ? totalLen / records.length : 0, n: records.length };
    if (timing) { timing.candidateMs += performance.now() - started; started = performance.now(); }

    const pathQuery = qLower.replace(/\\/g, '/');
    const scored = documents
      .map(({ record, termFrequency, documentLength, exactPhraseBoost }) => {
        let bm25Score = 0;
        for (const token of queryTokens) {
          const frequency = termFrequency.get(token) ?? 0;
          if (!frequency) continue;
          const documentFrequency = stats.docFreq.get(token) ?? 0;
          const idf = Math.log(1 + (stats.n - documentFrequency + 0.5) / (documentFrequency + 0.5));
          const denominator = frequency + BM25_K1 * (1 - BM25_B + BM25_B * (documentLength / (stats.avgLen || 1)));
          bm25Score += idf * ((frequency * (BM25_K1 + 1)) / denominator);
        }
        if (bm25Score + exactPhraseBoost <= 0) return null;
        const paths = (record.artifacts ?? []).map(artifact => artifact.replace(/\\/g, '/'));
        const lowerPaths = paths.map(artifact => artifact.toLowerCase());
        const exactPathMatch = lowerPaths.some(artifact => containsPath(pathQuery, artifact, !artifact.includes('/')) || containsPath(pathQuery, artifact.split('/').at(-1)!, true));
        const pathTerms = new Set(paths.flatMap(artifact => tokenizeSearchText(artifact)));
        const pathCoverage = [...queryTerms].filter(term => pathTerms.has(term)).length / Math.max(1, queryTerms.size);
        const identifierDefinitions = identifiers.filter(identifier => declaresIdentifier(record.content, identifier));
        return { record, termFrequency, bm25Score, exactPathMatch, identifierDefinitions, exactPhraseBoost, pathCoverage, score: bm25Score + exactPhraseBoost };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
    const maximumScore = scored.reduce((maximum, entry) => Math.max(maximum, entry.score), 1);
    const ranked = scored
      .map(entry => ({ ...entry, rankingScore: entry.score / maximumScore + entry.pathCoverage }))
      .sort((a, b) => Number(b.exactPathMatch) - Number(a.exactPathMatch) || b.identifierDefinitions.length - a.identifierDefinitions.length || b.rankingScore - a.rankingScore);
    const normalizePath = (filename: string) => {
      const normalized = path.posix.normalize(filename.replace(/\\/g, '/'));
      return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
    };
    const paths = new Set<string>();
    for (const entry of ranked) for (const artifact of entry.record.artifacts ?? []) paths.add(normalizePath(artifact));
    const links = new Map<string, Set<string>>();
    for (const entry of ranked) {
      const artifacts = entry.record.artifacts;
      if (!artifacts?.some(artifact => /\.[cm]?[jt]sx?$/i.test(artifact))) continue;
      const cacheKey = this.cachePrefix + entry.record.content;
      let imports = importCache.get(cacheKey);
      if (!imports) {
        imports = staticImports(entry.record.content);
        if (cacheKey.length <= TOKEN_CACHE_LIMIT) {
          while (importCacheSize + cacheKey.length > TOKEN_CACHE_LIMIT) {
            const oldest = importCache.keys().next().value!;
            importCache.delete(oldest);
            importCacheSize -= oldest.length;
          }
          importCache.set(cacheKey, imports);
          importCacheSize += cacheKey.length;
        }
      }
      if (!imports.length) continue;
      for (const artifact of artifacts) {
        const filename = normalizePath(artifact);
        if (!/\.[cm]?[jt]sx?$/i.test(filename)) continue;
        for (const specifier of imports) {
          const resolved = normalizePath(path.posix.join(path.posix.dirname(filename), specifier));
          const targets = [resolved, resolved.replace(/\.js$/i, '.ts'), resolved.replace(/\.mjs$/i, '.mts'), resolved.replace(/\.cjs$/i, '.cts')];
          for (const target of new Set(targets)) {
            if (!paths.has(target) || target === filename) continue;
            if (!links.has(filename)) links.set(filename, new Set());
            if (!links.has(target)) links.set(target, new Set());
            links.get(filename)!.add(target);
            links.get(target)!.add(filename);
          }
        }
      }
    }
    const anchors = ranked.slice(0, 3).map(entry => new Set((entry.record.artifacts ?? []).flatMap(artifact => [...(links.get(normalizePath(artifact)) ?? [])])));
    const reranked = anchors.some(anchor => anchor.size) ? ranked
      .map(entry => {
        const artifacts = entry.record.artifacts;
        if (!artifacts?.length) return entry;
        const normalized = artifacts.map(normalizePath);
        const relationship = anchors.reduce((sum, anchor, index) => sum + (normalized.some(artifact => anchor.has(artifact)) ? 1 / (index + 1) : 0), 0);
        return relationship ? { ...entry, rankingScore: entry.rankingScore + 0.5 * relationship } : entry;
      })
      .sort((a, b) => Number(b.exactPathMatch) - Number(a.exactPathMatch) || b.identifierDefinitions.length - a.identifierDefinitions.length || b.rankingScore - a.rankingScore) : ranked;
    const results = reranked
      .slice(0, clampLimit(limit))
      .map(({ termFrequency, ...entry }) => {
        const queryTermEvidence = [...queryTerms].map(term => {
          const frequency = stats.docFreq.get(term) ?? 0;
          return { term, idf: Math.log(1 + (stats.n - frequency + 0.5) / (frequency + 0.5)), matched: termFrequency.has(term) };
        });
        return { ...entry, queryTermEvidence };
      });
    if (timing) timing.rankingMs += performance.now() - started;
    return results;
  }

  private scoreMemoryLeg(query: string): HybridSearchResult[] {
    const qLower = query.toLowerCase();
    const records = this.memory.getActive();
    const queryTokens = tokenizeSearchQuery(query);
    const queryTerms = new Set(queryTokens);
    const stats = this.corpusStats(records, queryTokens);

    const results: HybridSearchResult[] = [];
    for (const record of records) {
      const docTokens = tokenizeSearchText(recordSearchText(record));
      let score = this.bm25(queryTokens, docTokens, stats, queryTerms);
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

  private corpusStats(records: MemoryRecord[], queryTokens: string[]): CorpusStats {
    return this.tokenStats(records.map(record => tokenizeSearchText(recordSearchText(record))), queryTokens);
  }

  private tokenStats(documents: string[][], queryTokens: string[]): CorpusStats {
    const docFreq = new Map<string, number>();
    const terms = new Set(queryTokens);
    let totalLen = 0;

    for (const tokens of documents) {
      totalLen += tokens.length;
      const seen = new Set<string>();
      for (const token of tokens) {
        if (terms.has(token) && !seen.has(token)) {
          seen.add(token);
          docFreq.set(token, (docFreq.get(token) ?? 0) + 1);
        }
      }
    }

    return {
      docFreq,
      avgLen: documents.length > 0 ? totalLen / documents.length : 0,
      n: documents.length
    };
  }

  private bm25(queryTokens: string[], docTokens: string[], stats: CorpusStats, queryTerms: Set<string>): number {
    const dl = docTokens.length;
    const tf = new Map<string, number>();
    for (const token of docTokens) {
      if (queryTerms.has(token)) tf.set(token, (tf.get(token) ?? 0) + 1);
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

}
