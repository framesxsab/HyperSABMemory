import { createTaskSourceContentInspector, inspectTaskSourceContents, type TaskSource, type TaskSourceInspection } from '../harness/taskSources.js';
import type { MemoryRecord } from './sqliteStore.js';
import { HybridSearchEngine, queryIdentifiers, tokenizeSearchQuery, tokenizeSearchText } from './hybridSearch.js';
import { performance } from 'node:perf_hooks';
import * as path from 'node:path';

export interface GroundedTiming { candidateMs: number; rankingMs: number; indexingMs?: number; pathMs: number; readMs: number; hashMs: number; excerptMs: number; decisionMs: number }

export const GROUNDED_SUPPORT_THRESHOLD = 0.3;
const CONFIG_QUERY = /^\s*what\s+is\s+the\s+value\s+of\s+`([^`]+)`\s+in\s+`([^`]+\.json)`\s*\??\s*$/i;
const QUOTATION_QUERY = /^\s*does\s+`([^`]+)`\s+contain\s+`([^`\r\n]+)`\s*\??\s*$/i;
const sourceTokenCache = new Map<string, Set<string>>();
let sourceTokenCacheBytes = 0;
const SOURCE_TOKEN_CACHE_LIMIT = 8 * 1024 * 1024;

/** Lexical coverage is a heuristic, not a probability or proof of a claim. */
export function lexicalSupport(
  query: string,
  content: string,
  termEvidence?: Array<{ term: string; idf: number; matched: boolean }>
): number {
  return lexicalTokenSupport(query, new Set(tokenizeSearchText(content)), termEvidence);
}

function lexicalTokenSupport(query: string, document: Set<string>, termEvidence?: Array<{ term: string; idf: number; matched: boolean }>): number {
  const tokens = [...new Set(tokenizeSearchQuery(query))];
  if (!tokens.length) return 0;
  const idf = new Map(termEvidence?.map(item => [item.term, item.idf]));
  const total = tokens.reduce((sum, token) => sum + (idf.get(token) ?? 1), 0);
  return total ? tokens.reduce((sum, token) => sum + (document.has(token) ? idf.get(token) ?? 1 : 0), 0) / total : 0;
}

export interface GroundedEvidence {
  record: MemoryRecord;
  source: TaskSourceInspection;
  lexicalSupport: number;
  excerpt?: string;
  line?: number;
}

export interface GroundedResult {
  status: 'SUPPORTED' | 'INSUFFICIENT_EVIDENCE' | 'CONFLICTING_EVIDENCE' | 'STALE_EVIDENCE';
  canAssert: boolean;
  candidates: Array<{ recordId: string; sourcePaths: string[]; score: number }>;
  evidence: GroundedEvidence[];
  assertions: Array<{ claim: string; sourcePath: string; excerpt: string }>;
  staleSources: TaskSourceInspection[];
  conflictOrigin?: 'caller_declared' | 'source_hash_mismatch';
  conflictPaths?: string[];
}

function escapeIdentifier(identifier: string): string {
  return identifier.replace(/\$/g, '\\$');
}

export function sourceKey(filename: string): string {
  const normalized = path.normalize(filename);
  return process.platform === 'win32' ? normalized.replace(/\\/g, '/').toLowerCase() : normalized;
}

function explicitSymbol(query: string): string | undefined {
  const question = query.match(/^\s*(?:where\s+is\s+(.+?)\s+defined|which\s+file\s+defines\s+(.+?))\s*[?.]?\s*$/i);
  if (!question) return undefined;
  const subject = (question[1] ?? question[2]).replace(/^(?:the\s+)?(?:function|class|symbol|identifier)\s+/i, '');
  const identifier = subject.match(/^(?:`([A-Za-z_$][\w$]*)(?:\(\))?`|([A-Za-z_$][\w$]*))(?:\(\))?$/);
  return identifier?.[1] ?? identifier?.[2];
}

export function isExplicitGroundedQuery(query: string): boolean {
  return Boolean(explicitSymbol(query) || CONFIG_QUERY.test(query) || QUOTATION_QUERY.test(query));
}

function stripStringsAndComments(source: string): string {
  const chars = [...source];
  let mode: 'code' | 'single' | 'double' | 'template' | 'lineComment' | 'blockComment' = 'code';
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const next = chars[i + 1];
    if (mode === 'code') {
      if (ch === '/' && next === '/') { chars[i++] = ' '; chars[i] = ' '; mode = 'lineComment'; }
      else if (ch === '/' && next === '*') { chars[i++] = ' '; chars[i] = ' '; mode = 'blockComment'; }
      else if (ch === "'") { chars[i] = ' '; mode = 'single'; }
      else if (ch === '"') { chars[i] = ' '; mode = 'double'; }
      else if (ch === '`') { chars[i] = ' '; mode = 'template'; }
    } else if (mode === 'lineComment') {
      if (ch === '\n' || ch === '\r') mode = 'code'; else chars[i] = ' ';
    } else if (mode === 'blockComment') {
      if (ch === '*' && next === '/') { chars[i++] = ' '; chars[i] = ' '; mode = 'code'; }
      else if (ch !== '\n' && ch !== '\r') chars[i] = ' ';
    } else if (ch === '\\') {
      chars[i] = ' ';
      if (i + 1 < chars.length && chars[i + 1] !== '\n' && chars[i + 1] !== '\r') chars[++i] = ' ';
    } else if ((mode === 'single' && ch === "'") || (mode === 'double' && ch === '"') || (mode === 'template' && ch === '`')) {
      chars[i] = ' ';
      mode = 'code';
    } else if (ch !== '\n' && ch !== '\r') chars[i] = ' ';
  }
  return chars.join('');
}

export function excerptFor(query: string, content: string, filename?: string): string | undefined {
  const terms = tokenizeSearchQuery(query);
  const lines = content.split(/\r?\n/);
  const identifiers = filename && /\.[cm]?[jt]sx?$/i.test(filename) ? queryIdentifiers(query).filter(identifier => content.includes(identifier)) : [];
  const declarations = identifiers.map(identifier => new RegExp(`^\\s*(?:(?:export|declare|abstract|default)\\s+)*(?:class|function|interface|type|const|let|var|enum)\\s+${escapeIdentifier(identifier)}(?![\\w$])`));
  const codeLines = declarations.length ? stripStringsAndComments(content).split(/\r?\n/) : [];
  const ranked: Array<{ line: string; matches: number; declaration: boolean }> = [];
  for (const [index, line] of lines.entries()) {
    const lineTokens = new Set(tokenizeSearchText(line));
    const item = { line, matches: terms.filter(term => lineTokens.has(term)).length, declaration: declarations.some(pattern => pattern.test(codeLines[index] ?? '')) };
    if (!line.trim() || !item.matches) continue;
    const position = ranked.findIndex(existing => Number(item.declaration) > Number(existing.declaration) || (item.declaration === existing.declaration && item.matches > existing.matches));
    ranked.splice(position < 0 ? ranked.length : position, 0, item);
    if (ranked.length > 3) ranked.pop();
  }
  return ranked.map(item => item.line.trim().slice(0, 320)).join('\n') || undefined;
}

/**
 * Separate experimental operation; callers must supply captured source hashes and known
 * conflicts. A lexical match does not verify a claim or detect unreported contradictions.
 */
export function searchGrounded(
  hybrid: HybridSearchEngine,
  workspaceDir: string,
  query: string,
  sources: TaskSource[],
  conflictingPaths: string[] = [],
  timing?: GroundedTiming
): GroundedResult {
  const started = timing ? performance.now() : 0;
  const previous = timing ? { ...timing } : undefined;
  const cacheWorkspace = path.resolve(workspaceDir);
  const symbol = explicitSymbol(query);
  const config = query.match(CONFIG_QUERY);
  const quotation = query.match(QUOTATION_QUERY);
  const candidates = hybrid.searchRecordsWithScores(query, 50, timing);
  const references = new Map<string, TaskSource>();
  const referenceConflicts = new Set<string>();
  for (const source of sources) {
    const key = sourceKey(source.path);
    const previousSource = references.get(key);
    if (previousSource && previousSource.sha256 !== source.sha256) referenceConflicts.add(previousSource.path);
    if (!previousSource) references.set(key, source);
  }
  const explicitPath = config?.[2] ?? quotation?.[1];
  const directSourceKeys = new Set<string>();
  if (symbol || explicitPath) {
    const indexedPaths = new Set(candidates.flatMap(candidate => (candidate.record.artifacts ?? []).map(sourceKey)));
    for (const source of references.values()) {
      const filename = source.path;
      if (indexedPaths.has(sourceKey(filename)) || (explicitPath ? sourceKey(filename) !== sourceKey(explicitPath) : !/\.[cm]?[jt]sx?$/i.test(filename))) continue;
      directSourceKeys.add(sourceKey(filename));
      candidates.push({
        record: { id: `source_ref:${filename}`, category: symbol ? 'symbol' : 'general', content: `Captured source reference: ${filename}`.slice(0, 320), artifacts: [filename], status: 'active', timestamp: new Date().toISOString() },
        bm25Score: 0, queryTermEvidence: [], exactPathMatch: Boolean(explicitPath), identifierDefinitions: [], exactPhraseBoost: 0, score: 0
      });
    }
  }
  const inspected = new Set<string>();
  const inspectSource = createTaskSourceContentInspector(workspaceDir, timing);
  const potentialEvidence: Array<{ record: MemoryRecord; source: TaskSourceInspection; lexicalSupport: number; content?: string; rank?: number }> = [];
  let lexicalEvidenceCount = 0;
  const staleSources: TaskSourceInspection[] = [];
  const assertions: GroundedResult['assertions'] = [];
  const assertedDeclarations = new Set<string>();
  const declarationPattern = symbol ? new RegExp(`^\\s*(?:(?:export|declare|abstract|default)\\s+)*(?:class|function|interface|type|const|let|var|enum)\\s+${escapeIdentifier(symbol)}(?![\\w$])`) : undefined;
  const naturalQuery = !symbol && !config && !quotation;
  for (const [candidateIndex, { record, queryTermEvidence }] of candidates.entries()) {
    if (naturalQuery && candidateIndex >= 10 && lexicalEvidenceCount >= 5) break;
    for (const artifact of record.artifacts ?? []) {
      const reference = references.get(sourceKey(artifact));
      if (!reference) continue;
      const filename = reference.path;
      if (inspected.has(sourceKey(filename))) continue;
      inspected.add(sourceKey(filename));
      const inspectedSource = inspectSource([reference])[0];
      if (!inspectedSource) continue;
      const { content: sourceBytes, ...source } = inspectedSource;
      if (source.status !== 'current') {
        staleSources.push(source);
        continue;
      }
      const text = sourceBytes?.toString('utf8');
      if (!text) { staleSources.push({ ...source, status: 'unavailable', detail: 'source bytes were not available during grounding' }); continue; }
      if (symbol && directSourceKeys.has(sourceKey(filename)) && !text.includes(symbol)) continue;
      if (quotation && sourceKey(filename) === sourceKey(quotation[1]) && quotation[2].length <= 320 && text.includes(quotation[2])) {
        const claim = `Source ${filename} contains the quoted text.`;
        const key = `${filename}\0${claim}`;
        potentialEvidence.push({ record, source, lexicalSupport: 1, content: text });
        if (!assertedDeclarations.has(key)) {
          assertedDeclarations.add(key);
          assertions.push({ claim, sourcePath: filename, excerpt: quotation[2] });
        }
        continue;
      }
      if (config && sourceKey(filename) === sourceKey(config[2])) {
        try {
          const parsed: unknown = JSON.parse(text);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Object.hasOwn(parsed, config[1])) {
            const value = (parsed as Record<string, unknown>)[config[1]];
            if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
              const key = JSON.stringify(config[1]).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              const valueText = JSON.stringify(value);
              const occurrences = [...text.matchAll(new RegExp(`${key}\\s*:`, 'g'))];
              const match = text.match(new RegExp(`${key}\\s*:\\s*${valueText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s*[,}])`));
              if (occurrences.length === 1 && match && match[0].length <= 320) {
                potentialEvidence.push({ record, source, lexicalSupport: 1, content: text });
                const claim = `Configuration ${config[1]} in ${filename} is ${valueText}.`;
                const key = `${filename}\0${claim}`;
                if (!assertedDeclarations.has(key)) {
                  assertedDeclarations.add(key);
                  assertions.push({ claim, sourcePath: filename, excerpt: match[0] });
                }
                continue;
              }
            }
          }
        } catch {}
      }
      const termEvidence = record.id.startsWith('source_ref:') ? undefined : queryTermEvidence;
      const tokenKey = `${cacheWorkspace}\0${source.currentSha256}`;
      let sourceTokens = sourceTokenCache.get(tokenKey);
      if (!sourceTokens) {
        sourceTokens = new Set(tokenizeSearchText(text));
        const size = sourceBytes!.length + tokenKey.length;
        if (size <= SOURCE_TOKEN_CACHE_LIMIT) {
          if (sourceTokenCacheBytes + size > SOURCE_TOKEN_CACHE_LIMIT) { sourceTokenCache.clear(); sourceTokenCacheBytes = 0; }
          sourceTokenCache.set(tokenKey, sourceTokens);
          sourceTokenCacheBytes += size;
        }
      }
      const support = lexicalTokenSupport(query, sourceTokens, termEvidence);
      const sourceLines = text.split(/\r?\n/);
      const codeLines = symbol && declarationPattern && /\.[cm]?[jt]sx?$/i.test(filename) ? stripStringsAndComments(text).split(/\r?\n/) : [];
      const declarationIndex = codeLines.findIndex(line => declarationPattern?.test(line));
      if (symbol && declarationIndex >= 0) {
        potentialEvidence.push({ record, source, lexicalSupport: 1, content: sourceLines[declarationIndex]?.trim() });
        const claim = `Identifier ${symbol} is defined in ${filename}.`;
        const key = `${filename}\0${claim}`;
        if (!assertedDeclarations.has(key)) {
          assertedDeclarations.add(key);
          assertions.push({ claim, sourcePath: filename, excerpt: sourceLines[declarationIndex]?.trim().slice(0, 320) ?? '' });
        }
        continue;
      }
      if (support < GROUNDED_SUPPORT_THRESHOLD || (!naturalQuery && lexicalEvidenceCount >= 5)) continue;
      potentialEvidence.push({ record, source, lexicalSupport: support, content: text, rank: candidateIndex + 1 });
      lexicalEvidenceCount++;
      if (naturalQuery) {
        potentialEvidence.sort((first, second) => (1 / (10 + second.rank!) + second.lexicalSupport / 10) - (1 / (10 + first.rank!) + first.lexicalSupport / 10) || first.rank! - second.rank!);
        if (potentialEvidence.length > 5) potentialEvidence.pop();
      }
    }
  }
  const excerptStart = timing ? performance.now() : 0;
  const assertionByPath = new Map(assertions.map(assertion => [assertion.sourcePath, assertion]));
  const selectedPaths = new Set<string>();
  const selectedEvidence = [...potentialEvidence.filter(item => assertionByPath.has(item.source.path)), ...potentialEvidence.filter(item => !assertionByPath.has(item.source.path))]
    .filter(item => {
      if (selectedPaths.has(item.source.path)) return false;
      selectedPaths.add(item.source.path);
      return true;
    }).slice(0, 5);
  const evidence: GroundedEvidence[] = selectedEvidence.map(item => ({
    record: item.record,
    source: item.source,
    lexicalSupport: item.lexicalSupport,
    ...(item.content ? { excerpt: assertionByPath.get(item.source.path)?.excerpt ?? (symbol ? item.content.slice(0, 320) : excerptFor(query, item.content, item.source.path)) } : {})
  }));
  if (timing && previous) {
    timing.excerptMs += performance.now() - excerptStart;
  }
  const declaredConflicts = [...new Set(conflictingPaths)];
  const queryCandidates = candidates.slice(0, 20).map(({ record, score }) => ({ recordId: record.id, sourcePaths: record.artifacts ?? [], score }));
  const rechecked = inspectTaskSourceContents(workspaceDir, evidence.map(item => item.source), timing);
  const topEvidence = evidence.flatMap((item, index) => {
    const { content, ...source } = rechecked[index];
    if (source.status !== 'current') {
      staleSources.push(source);
      return [];
    }
    const text = content?.toString('utf8');
    const position = text && item.excerpt ? text.indexOf(item.excerpt) : -1;
    const line = position >= 0 && text!.lastIndexOf(item.excerpt!) === position ? text!.slice(0, position).split('\n').length : undefined;
    return [{ ...item, source, ...(line !== undefined ? { line } : {}) }];
  });
  if (timing && previous) {
    timing.decisionMs += performance.now() - started - (timing.candidateMs - previous.candidateMs) - (timing.rankingMs - previous.rankingMs) - (timing.pathMs - previous.pathMs) - (timing.readMs - previous.readMs) - (timing.hashMs - previous.hashMs) - (timing.excerptMs - previous.excerptMs);
  }
  if (declaredConflicts.length || referenceConflicts.size) return { status: 'CONFLICTING_EVIDENCE', conflictOrigin: declaredConflicts.length ? 'caller_declared' : 'source_hash_mismatch', conflictPaths: [...new Set([...declaredConflicts, ...referenceConflicts])], candidates: queryCandidates, evidence: topEvidence, assertions: [], staleSources, canAssert: false };
  const supportedAssertions = assertions.filter(assertion => topEvidence.some(item => item.source.path === assertion.sourcePath));
  if (supportedAssertions.length) return { status: 'SUPPORTED', candidates: queryCandidates, evidence: topEvidence, assertions: supportedAssertions, staleSources, canAssert: true };
  if (topEvidence.length) return { status: 'INSUFFICIENT_EVIDENCE', candidates: queryCandidates, evidence: topEvidence, assertions: [], staleSources, canAssert: false };
  if (staleSources.length) return { status: 'STALE_EVIDENCE', candidates: queryCandidates, evidence: [], assertions: [], staleSources, canAssert: false };
  return { status: 'INSUFFICIENT_EVIDENCE', candidates: queryCandidates, evidence: [], assertions: [], staleSources, canAssert: false };
}
