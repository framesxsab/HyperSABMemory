import { createTaskSourceContentInspector, type TaskSource, type TaskSourceContentInspection, type TaskSourceInspection } from '../harness/taskSources.js';
import type { MemoryRecord } from './sqliteStore.js';
import { HybridSearchEngine, queryIdentifiers, tokenizeSearchQuery, tokenizeSearchText, type ScoredMemoryRecord } from './hybridSearch.js';
import { performance } from 'node:perf_hooks';
import * as path from 'node:path';
import { collectImplementationEvidence, wantsImplementationEvidence } from './implementationEvidence.js';
import { verifyJsonScalarClaim, verifyQuotedTextClaim, verifyRecordedClaims, type AtomicEvidenceClaim, type ClaimSourceSnapshot, type EvidenceRelationship } from './claimVerification.js';

export interface GroundedTiming { candidateMs: number; rankingMs: number; indexingMs?: number; pathMs: number; readMs: number; hashMs: number; excerptMs: number; decisionMs: number }

export interface GroundedSearchOptions {
  precomputedCandidates?: ScoredMemoryRecord[];
  preinspectedSources?: Map<string, TaskSourceContentInspection> | TaskSourceContentInspection[];
  sharedParentRealCache?: Map<string, string>;
}

export const GROUNDED_SUPPORT_THRESHOLD = 0.3;
const MARKDOWN_PROSE_SUPPORT_THRESHOLD = 0.45;
const CONFIG_QUERY = /^\s*what\s+is\s+the\s+(?:(root|top-level)\s+)?value\s+of\s+(?:(?:the\s+)?(root|top-level)\s+)?`([^`]+)`\s+in\s+`([^`]+\.json)`\s*\??\s*$/i;
const CONFIG_KEY_QUERY = /^\s*what\s+(?:is\s+)?(?:the\s+)?([A-Za-z][\w-]*)\s+(?:is\s+)?(?:configured|set|defined)\b/i;
const QUOTATION_QUERY = /^\s*does\s+`([^`]+)`\s+contain\s+`([^`\r\n]+)`\s*\??\s*$/i;
const sourceTokenCache = new Map<string, Set<string>>();
let sourceTokenCacheBytes = 0;
const SOURCE_TOKEN_CACHE_LIMIT = 8 * 1024 * 1024;
interface ExcerptDocumentCache {
  lines: string[];
  lineTokens: Array<Set<string> | undefined>;
  strippedLines?: string[];
}
const excerptDocCache = new Map<string, { size: number; doc: ExcerptDocumentCache }>();
let excerptDocCacheBytes = 0;

/** Lexical coverage is a heuristic, not a probability or proof of a claim. */
export function lexicalSupport(
  query: string,
  content: string,
  termEvidence?: Array<{ term: string; idf: number; matched: boolean }>
): number {
  return lexicalTokenSupport(query, new Set(tokenizeSearchText(content)), termEvidence);
}

export function lexicalSupportBreakdown(
  query: string,
  content: string,
  termEvidence?: Array<{ term: string; idf: number; matched: boolean }>
): { support: number; matchedTerms: number; queryTerms: number } {
  return lexicalMatchMetrics(query, new Set(tokenizeSearchText(content)), termEvidence);
}

function lexicalMatchMetrics(
  query: string,
  document: Set<string>,
  termEvidence?: Array<{ term: string; idf: number; matched: boolean }>
): { support: number; matchedTerms: number; queryTerms: number } {
  const tokens = [...new Set(tokenizeSearchQuery(query))];
  if (!tokens.length) return { support: 0, matchedTerms: 0, queryTerms: 0 };
  const idf = new Map(termEvidence?.map(item => [item.term, item.idf]));
  let total = 0;
  let matchedWeight = 0;
  let matchedTerms = 0;
  for (const token of tokens) {
    const weight = idf.get(token) ?? 1;
    total += weight;
    if (document.has(token)) {
      matchedWeight += weight;
      matchedTerms++;
    }
  }
  return { support: total ? matchedWeight / total : 0, matchedTerms, queryTerms: tokens.length };
}

function lexicalTokenSupport(query: string, document: Set<string>, termEvidence?: Array<{ term: string; idf: number; matched: boolean }>): number {
  return lexicalMatchMetrics(query, document, termEvidence).support;
}

export function distinctiveCodeIdentifiers(query: string): string[] {
  return [...new Set([
    ...(query.match(/\b[A-Za-z][A-Za-z0-9_$]*[a-z0-9][A-Z][A-Za-z0-9_$]*\b/g) ?? []),
    ...(query.match(/\b[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+\b/g) ?? []),
    ...(query.match(/(?<!\.)\b[A-Za-z_$][A-Za-z0-9_$]{1,}(?=\(\))/g) ?? [])
  ])];
}

export function sourceContainsIdentifier(text: string, identifier: string): boolean {
  const escaped = escapeIdentifier(identifier);
  if (new RegExp(`(?<![\\w$])${escaped}(?![\\w$])`).test(text)) return true;
  if (/^[A-Z][a-z]+[A-Z][a-z]+$/.test(identifier)) {
    return new RegExp(`(?<![\\w$])${escaped}(?![\\w$])`, 'i').test(text);
  }
  return false;
}

export function isDocOrDecisionQuery(query: string): boolean {
  return /\b(?:readme|docs?|documentation|architect(?:ure)?|decid(?:ed|e)?|decisions?|rationale|constraint|relationship|changelog|contributing|guide|install(?:ation)?|usage|caveat|example|agents?|rules?|prd|phases?|design|polic(?:y|ies))\b/i.test(query)
    || /\.md\b/i.test(query);
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
  claims?: AtomicEvidenceClaim[];
  relationships?: EvidenceRelationship[];
  compoundAnswer?: { text: string; limitation: string };
  implementationEvidence?: ReturnType<typeof collectImplementationEvidence>;
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
  return Boolean(explicitSymbol(query) || CONFIG_QUERY.test(query) || CONFIG_KEY_QUERY.test(query) || QUOTATION_QUERY.test(query));
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

export function excerptFor(query: string, content: string, filename?: string, contentSha256?: string): string | undefined {
  const terms = tokenizeSearchQuery(query);
  const cacheKey = contentSha256 ? `${filename ?? ''}\0${contentSha256}` : undefined;
  let docCache = cacheKey ? excerptDocCache.get(cacheKey)?.doc : undefined;
  if (!docCache) {
    const lines = content.split(/\r?\n/);
    docCache = { lines, lineTokens: new Array<Set<string> | undefined>(lines.length) };
    if (cacheKey) {
      const size = content.length + cacheKey.length + 512;
      if (size <= SOURCE_TOKEN_CACHE_LIMIT) {
        if (excerptDocCacheBytes + size > SOURCE_TOKEN_CACHE_LIMIT) {
          excerptDocCache.clear();
          excerptDocCacheBytes = 0;
        }
        excerptDocCache.set(cacheKey, { size, doc: docCache });
        excerptDocCacheBytes += size;
      }
    }
  }
  const lines = docCache.lines;
  const identifiers = filename && /\.[cm]?[jt]sx?$/i.test(filename) ? queryIdentifiers(query).filter(identifier => content.includes(identifier)) : [];
  const declarations = identifiers.map(identifier => new RegExp(`^\\s*(?:(?:export|declare|abstract|default)\\s+)*(?:class|function|interface|type|const|let|var|enum)\\s+${escapeIdentifier(identifier)}(?![\\w$])`));
  let codeLines: string[] = [];
  if (declarations.length) {
    docCache.strippedLines ??= stripStringsAndComments(content).split(/\r?\n/);
    codeLines = docCache.strippedLines;
  }
  const ranked: Array<{ line: string; matches: number; declaration: boolean }> = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!line.trim()) continue;
    let lineTokens = docCache.lineTokens[index];
    if (!lineTokens) {
      lineTokens = new Set(tokenizeSearchText(line));
      docCache.lineTokens[index] = lineTokens;
    }
    let matches = 0;
    for (const term of terms) {
      if (lineTokens.has(term)) matches++;
    }
    if (!matches) continue;
    const item = { line, matches, declaration: declarations.some(pattern => pattern.test(codeLines[index] ?? '')) };
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
  timing?: GroundedTiming,
  options?: GroundedSearchOptions
): GroundedResult {
  const started = timing ? performance.now() : 0;
  const previous = timing ? { ...timing } : undefined;
  const cacheWorkspace = path.resolve(workspaceDir);
  const symbol = explicitSymbol(query);
  const config = query.match(CONFIG_QUERY);
  const configRootOnly = Boolean(config?.[1] || config?.[2]);
  const configKey = config?.[3] ?? query.match(CONFIG_KEY_QUERY)?.[1];
  const configPath = config?.[4];
  const quotation = query.match(QUOTATION_QUERY);
  const candidates = options?.precomputedCandidates
    ? options.precomputedCandidates.map(candidate => ({ ...candidate }))
    : hybrid.searchRecordsWithScores(query, 50, timing);
  const references = new Map<string, TaskSource>();
  const referenceConflicts = new Set<string>();
  for (const source of sources) {
    const key = sourceKey(source.path);
    const previousSource = references.get(key);
    if (previousSource && previousSource.sha256 !== source.sha256) referenceConflicts.add(previousSource.path);
    if (!previousSource) references.set(key, source);
  }
  const explicitPath = configPath ?? quotation?.[1];
  const directSourceKeys = new Set<string>();
  if (symbol || explicitPath || configKey) {
    const indexedPaths = new Set(candidates.flatMap(candidate => (candidate.record.artifacts ?? []).map(sourceKey)));
    for (const source of references.values()) {
      const filename = source.path;
      if (indexedPaths.has(sourceKey(filename)) || (explicitPath ? sourceKey(filename) !== sourceKey(explicitPath) : symbol ? !/\.[cm]?[jt]sx?$/i.test(filename) : configKey ? !/\.json$/i.test(filename) : true)) continue;
      directSourceKeys.add(sourceKey(filename));
      candidates.push({
        record: { id: `source_ref:${filename}`, category: symbol ? 'symbol' : 'general', content: `Captured source reference: ${filename}`.slice(0, 320), artifacts: [filename], status: 'active', timestamp: new Date().toISOString() },
        bm25Score: 0, queryTermEvidence: [], exactPathMatch: Boolean(explicitPath), identifierDefinitions: [], exactPhraseBoost: 0, score: 0
      });
    }
  }
  let preinspectedMap: Map<string, TaskSourceContentInspection> | undefined;
  if (options?.preinspectedSources instanceof Map) {
    preinspectedMap = new Map<string, TaskSourceContentInspection>();
    for (const [key, item] of options.preinspectedSources.entries()) preinspectedMap.set(sourceKey(key), item);
  } else if (Array.isArray(options?.preinspectedSources)) {
    preinspectedMap = new Map<string, TaskSourceContentInspection>();
    for (const item of options.preinspectedSources) preinspectedMap.set(sourceKey(item.path), item);
  }
  const inspected = new Set<string>();
  const initialParentCache = options?.sharedParentRealCache ?? new Map<string, string>();
  const inspectSource = createTaskSourceContentInspector(workspaceDir, timing, initialParentCache);
  const readForGrounding = (reference: TaskSource): TaskSourceContentInspection | undefined => {
    const pre = preinspectedMap?.get(sourceKey(reference.path));
    if (pre && pre.status === 'current' && pre.sha256 === reference.sha256 && pre.currentSha256 === reference.sha256 && pre.content) {
      return pre;
    }
    return inspectSource([reference])[0];
  };
  const potentialEvidence: Array<{ record: MemoryRecord; source: TaskSourceInspection; lexicalSupport: number; content?: string; rank?: number; priority?: number }> = [];
  let lexicalEvidenceCount = 0;
  const staleSources: TaskSourceInspection[] = [];
  const assertions: GroundedResult['assertions'] = [];
  const claims: AtomicEvidenceClaim[] = [];
  const relationships: EvidenceRelationship[] = [];
  const currentSources = new Map<string, ClaimSourceSnapshot>();
  const sourceRecords = new Map<string, MemoryRecord>();
  const sourceScores = new Map<string, number>();
  const assertedDeclarations = new Set<string>();
  const configValues = new Map<string, Set<string>>();
  const configConflicts = new Set<string>();
  const declarationPattern = symbol ? new RegExp(`^\\s*(?:(?:export|declare|abstract|default)\\s+)*(?:class|function|interface|type|const|let|var|enum)\\s+${escapeIdentifier(symbol)}(?![\\w$])`) : undefined;
  const naturalQuery = !symbol && !config && !quotation;
  const docOrDecisionQuery = isDocOrDecisionQuery(query);
  const asksTests = /\b(?:tests?|specs?|exercis(?:e|es|ed|ing)|verif(?:y|ies|ied)|assert(?:s|ed|ions?)?)\b/i.test(query);
  const codeIds = naturalQuery ? distinctiveCodeIdentifiers(query) : [];
  const foundCodeIds = new Set<string>();
  for (const [candidateIndex, { record, queryTermEvidence, score, exactPathMatch, identifierDefinitions }] of candidates.entries()) {
    if (naturalQuery && candidateIndex >= 12 && lexicalEvidenceCount >= 5) break;
    for (const artifact of record.artifacts ?? []) {
      const reference = references.get(sourceKey(artifact));
      if (!reference) continue;
      const filename = reference.path;
      if (inspected.has(sourceKey(filename))) continue;
      inspected.add(sourceKey(filename));
      const inspectedSource = readForGrounding(reference);
      if (!inspectedSource) continue;
      const { content: sourceBytes, ...source } = inspectedSource;
      if (source.status !== 'current') {
        staleSources.push(source);
        continue;
      }
      const text = sourceBytes?.toString('utf8');
      if (!text) { staleSources.push({ ...source, status: 'unavailable', detail: 'source bytes were not available during grounding' }); continue; }
      currentSources.set(sourceKey(filename), { ...source, content: text });
      sourceRecords.set(sourceKey(filename), record);
      sourceScores.set(sourceKey(filename), score);
      if (codeIds.length) {
        for (const id of codeIds) {
          if (!foundCodeIds.has(id) && sourceContainsIdentifier(text, id)) foundCodeIds.add(id);
        }
      }
      if (symbol && directSourceKeys.has(sourceKey(filename)) && !text.includes(symbol)) continue;
      if (quotation && sourceKey(filename) === sourceKey(quotation[1]) && quotation[2].length <= 320 && text.includes(quotation[2])) {
        const verified = verifyQuotedTextClaim(currentSources.get(sourceKey(filename))!, quotation[2]);
        if (verified.status !== 'supported') continue;
        const claim = verified.claim.claim;
        const key = `${filename}\0${claim}`;
        potentialEvidence.push({ record, source, lexicalSupport: 1, content: text });
        claims.push(verified.claim);
        if (!assertedDeclarations.has(key)) {
          assertedDeclarations.add(key);
          assertions.push({ claim, sourcePath: filename, excerpt: quotation[2] });
        }
        continue;
      }
      if (configKey && (!configPath || sourceKey(filename) === sourceKey(configPath)) && /\.json$/i.test(filename)) {
        const verified = verifyJsonScalarClaim(currentSources.get(sourceKey(filename))!, configKey, { rootOnly: configRootOnly });
        if (verified.status === 'supported') {
          potentialEvidence.push({ record, source, lexicalSupport: 1, content: text });
          claims.push(verified.claim);
          const values = configValues.get(configKey) ?? new Set<string>();
          values.add(verified.claim.value);
          configValues.set(configKey, values);
          const legacyClaim = `Configuration ${configKey} in ${filename} is ${verified.claim.value}.`;
          const key = `${filename}\0${legacyClaim}`;
          if (!assertedDeclarations.has(key)) {
            assertedDeclarations.add(key);
            assertions.push({ claim: legacyClaim, sourcePath: filename, excerpt: verified.claim.source.excerpt });
          }
          continue;
        }
        if (verified.status === 'conflicting') configConflicts.add(filename);
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
      const { support, matchedTerms } = lexicalMatchMetrics(query, sourceTokens, termEvidence);
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
      if (!naturalQuery) {
        if (support < GROUNDED_SUPPORT_THRESHOLD || lexicalEvidenceCount >= 5) continue;
        potentialEvidence.push({ record, source, lexicalSupport: support, content: text, rank: candidateIndex + 1 });
        lexicalEvidenceCount++;
        continue;
      }
      const isMarkdown = /\.md$/i.test(filename);
      const isTypeDecl = /\.d\.[cm]?[jt]sx?$/i.test(filename);
      const isTestFile = /(?:^|\/)(?:tests?|__tests__|spec)\/|\.(?:test|spec)(?:-d)?\.[cm]?[jt]sx?$/i.test(filename);
      const isConfig = /\.(?:json|ya?ml|toml)$/i.test(filename);
      const isRuntimeCode = /\.[cm]?[jt]sx?$/i.test(filename) && !isTypeDecl && !isTestFile;
      const runtimeIdDefsCount = isRuntimeCode ? (identifierDefinitions?.length ?? 0) : 0;
      const hasDecisionHeader = /^(?:\uFEFF)?Decision(?:-Source)?:\s/m.test(text);
      const standardAdmitted = isMarkdown && !docOrDecisionQuery && !exactPathMatch && !hasDecisionHeader
        ? support >= MARKDOWN_PROSE_SUPPORT_THRESHOLD && matchedTerms >= 2
        : support >= GROUNDED_SUPPORT_THRESHOLD;
      const strongCodeOrConfigAdmitted = !isMarkdown && (
        (Boolean(exactPathMatch) && matchedTerms >= 2 && support >= 0.1) ||
        (runtimeIdDefsCount > 0 && support >= 0.04) ||
        ((isRuntimeCode || isConfig) && candidateIndex < 15 && matchedTerms >= 3 && support >= 0.14) ||
        (isTestFile && asksTests && candidateIndex < 10 && matchedTerms >= 3 && support >= 0.2)
      );
      if (!standardAdmitted && !strongCodeOrConfigAdmitted) continue;
      const priority =
        1 / (2 + (candidateIndex + 1)) +
        0.12 * support +
        (exactPathMatch ? 0.5 : 0) +
        (runtimeIdDefsCount > 0 ? 0.25 + 0.08 * Math.min(3, runtimeIdDefsCount) : 0) +
        (isMarkdown && !docOrDecisionQuery && !exactPathMatch && !hasDecisionHeader ? -0.25 : 0) +
        (isTypeDecl && !docOrDecisionQuery ? -0.18 : 0) +
        (isTestFile && !asksTests ? -0.1 : 0);
      potentialEvidence.push({ record, source, lexicalSupport: support, content: text, rank: candidateIndex + 1, priority });
      lexicalEvidenceCount++;
      potentialEvidence.sort((first, second) => (second.priority ?? 0) - (first.priority ?? 0) || first.rank! - second.rank!);
      if (potentialEvidence.length > 5) potentialEvidence.pop();
    }
  }
  let hasMissingCodeIds = false;
  if (naturalQuery && codeIds.length > foundCodeIds.size) {
    for (const { record, score } of candidates) {
      if (foundCodeIds.size >= codeIds.length) break;
      for (const artifact of record.artifacts ?? []) {
        const reference = references.get(sourceKey(artifact));
        if (!reference) continue;
        const filename = reference.path;
        if (inspected.has(sourceKey(filename))) continue;
        inspected.add(sourceKey(filename));
        const inspectedSource = readForGrounding(reference);
        if (!inspectedSource) continue;
        const { content: sourceBytes, ...source } = inspectedSource;
        if (source.status !== 'current') {
          staleSources.push(source);
          continue;
        }
        const text = sourceBytes?.toString('utf8');
        if (!text) continue;
        currentSources.set(sourceKey(filename), { ...source, content: text });
        sourceRecords.set(sourceKey(filename), record);
        sourceScores.set(sourceKey(filename), score);
        for (const id of codeIds) {
          if (!foundCodeIds.has(id) && sourceContainsIdentifier(text, id)) foundCodeIds.add(id);
        }
      }
    }
    hasMissingCodeIds = foundCodeIds.size < codeIds.length;
    if (hasMissingCodeIds && !assertions.length) {
      potentialEvidence.length = 0;
    }
  }
  if (naturalQuery && !assertions.length && potentialEvidence.length > 0 && !potentialEvidence.some(item => item.lexicalSupport >= 0.15)) {
    potentialEvidence.length = 0;
  }
  const allCurrentSources = [...currentSources.values()];
  const decisionSources = allCurrentSources.filter(source => /^(?:\uFEFF)?Decision: /m.test(source.content ?? ''));
  const rankedDecisions = decisionSources.map(source => ({ source, score: sourceScores.get(sourceKey(source.path)) ?? 0 }));
  const bestDecisionScore = Math.max(0, ...rankedDecisions.map(item => item.score));
  const selectedDecisions = rankedDecisions.filter(item => item.score === bestDecisionScore).map(item => item.source);
  const selectedDecisionPaths = new Set(selectedDecisions.map(source => sourceKey(source.path)));
  const asksRelationship = /\b(constraint|relationship|linked|follows?)\b/i.test(query);
  const recordedInputs = allCurrentSources.filter(source => {
    if (selectedDecisionPaths.has(sourceKey(source.path))) return true;
    if (!asksRelationship) return false;
    const lines = source.content?.split(/\r?\n/) ?? [];
    if (lines[0]?.startsWith('\uFEFF')) lines[0] = lines[0].slice(1);
    return selectedDecisions.some(decision => lines.some(line => line.startsWith('Decision-Source: ') && sourceKey(line.slice('Decision-Source: '.length)) === sourceKey(decision.path)));
  });
  const recorded = verifyRecordedClaims(query, recordedInputs);
  if (recorded.status === 'supported') {
    for (const item of recorded.claims) {
      claims.push(item);
      if (!assertions.some(assertion => assertion.sourcePath === item.source.path && assertion.excerpt === item.source.excerpt)) assertions.push({ claim: item.claim, sourcePath: item.source.path, excerpt: item.source.excerpt });
    }
    relationships.push(...recorded.relationships);
    for (const relationship of recorded.relationships) {
      if (!assertions.some(assertion => assertion.sourcePath === relationship.evidence.path && assertion.excerpt === relationship.evidence.excerpt)) assertions.push({ claim: `The source explicitly links ${relationship.from} to ${relationship.to}.`, sourcePath: relationship.evidence.path, excerpt: relationship.evidence.excerpt });
    }
    const structuredPaths = new Set([...recorded.claims.map(item => item.source.path), ...recorded.relationships.map(item => item.evidence.path)]);
    for (const filename of structuredPaths) {
      const key = sourceKey(filename);
      const snapshot = currentSources.get(key);
      const record = sourceRecords.get(key);
      if (snapshot && record && !potentialEvidence.some(item => sourceKey(item.source.path) === key)) potentialEvidence.push({ record, source: snapshot, lexicalSupport: 0, content: snapshot.content });
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
    ...(item.content ? { excerpt: assertionByPath.get(item.source.path)?.excerpt ?? (symbol ? item.content.slice(0, 320) : excerptFor(query, item.content, item.source.path, item.source.currentSha256)) } : {})
  }));
  if (timing && previous) {
    timing.excerptMs += performance.now() - excerptStart;
  }
  const declaredConflicts = [...new Set(conflictingPaths)];
  const queryCandidates = candidates.slice(0, 20).map(({ record, score }) => ({ recordId: record.id, sourcePaths: record.artifacts ?? [], score }));
  const implementation = !declaredConflicts.length && !referenceConflicts.size && !hasMissingCodeIds && wantsImplementationEvidence(query)
    ? collectImplementationEvidence(query, currentSources.values()) : undefined;
  const finalSources = new Map<string, TaskSource>(evidence.map(item => [item.source.path, item.source]));
  for (const item of [...(implementation?.code ?? []), ...(implementation?.tests ?? [])]) {
    const source = references.get(sourceKey(item.source.path));
    if (source) finalSources.set(source.path, source);
  }
  initialParentCache.clear();
  const finalInspectSource = createTaskSourceContentInspector(workspaceDir, timing);
  const checked = finalInspectSource([...finalSources.values()]);
  const rechecked = evidence.map(item => checked.find(source => source.path === item.source.path)!);
  const evidencePaths = new Set(evidence.map(item => item.source.path));
  for (const { content: _content, ...source } of checked) {
    if (source.status !== 'current' && !evidencePaths.has(source.path)) staleSources.push(source);
  }
  const current = new Map(checked.filter(source => source.status === 'current').map(source => [source.path, source.currentSha256]));
  const assessment = implementation && {
    ...implementation,
    code: implementation.code.filter(item => current.get(item.source.path) === item.source.sha256),
    tests: implementation.tests.filter(item => current.get(item.source.path) === item.source.sha256 &&
      current.get(item.target.path) === item.target.sha256)
  };
  const implementationFields = assessment && (assessment.code.length || assessment.tests.length) ? { implementationEvidence: assessment } : {};
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
  const supportedAssertions = assertions.filter(assertion => topEvidence.some(item => item.source.path === assertion.sourcePath));
  const supportedPaths = new Map(topEvidence.map(item => [sourceKey(item.source.path), item.source]));
  const supportedClaims = claims.filter(item => supportedPaths.get(sourceKey(item.source.path))?.currentSha256 === item.source.sha256);
  const supportedRelationships = relationships.filter(item => supportedPaths.get(sourceKey(item.evidence.path))?.currentSha256 === item.evidence.sha256 && supportedPaths.has(sourceKey(item.from)) && supportedPaths.has(sourceKey(item.to)));
  const supportedAssertionSources = new Set(supportedAssertions.map(item => sourceKey(item.sourcePath)));
  const returnedClaims = supportedClaims.filter(item => supportedAssertionSources.has(sourceKey(item.source.path)));
  const returnedRelationships = supportedRelationships.filter(item => returnedClaims.some(claim => sourceKey(claim.source.path) === sourceKey(item.from)) && returnedClaims.some(claim => sourceKey(claim.source.path) === sourceKey(item.to)));
  const compoundAnswer = returnedRelationships.length && recorded.status === 'supported' ? { text: recorded.text!, limitation: recorded.limitation } : undefined;
  if (timing && previous) {
    timing.decisionMs += performance.now() - started - (timing.candidateMs - previous.candidateMs) - (timing.rankingMs - previous.rankingMs) - (timing.pathMs - previous.pathMs) - (timing.readMs - previous.readMs) - (timing.hashMs - previous.hashMs) - (timing.excerptMs - previous.excerptMs);
  }
  if (declaredConflicts.length || referenceConflicts.size || recorded.status === 'conflicting') return {
    status: 'CONFLICTING_EVIDENCE', conflictOrigin: declaredConflicts.length ? 'caller_declared' : 'source_hash_mismatch',
    conflictPaths: [...new Set([...declaredConflicts, ...referenceConflicts, ...(recorded.conflictPaths ?? [])])],
    candidates: queryCandidates, evidence: topEvidence, assertions: [], claims: [], relationships: [], staleSources, canAssert: false
  };
  if (configConflicts.size || [...configValues.values()].some(values => values.size > 1)) return {
    status: 'CONFLICTING_EVIDENCE', conflictOrigin: 'source_hash_mismatch', conflictPaths: [...configConflicts],
    candidates: queryCandidates, evidence: topEvidence, assertions: [], claims: [], relationships: [], staleSources, canAssert: false
  };
  if (supportedAssertions.length) return { status: 'SUPPORTED', candidates: queryCandidates, evidence: topEvidence, assertions: supportedAssertions, claims: returnedClaims, relationships: returnedRelationships, ...(compoundAnswer ? { compoundAnswer } : {}), ...implementationFields, staleSources, canAssert: true };
  if (topEvidence.length || assessment?.code.length) return { status: 'INSUFFICIENT_EVIDENCE', candidates: queryCandidates, evidence: topEvidence, assertions: [], claims: [], relationships: [], ...implementationFields, staleSources, canAssert: false };
  if (staleSources.length) return { status: 'STALE_EVIDENCE', candidates: queryCandidates, evidence: [], assertions: [], claims: [], relationships: [], staleSources, canAssert: false };
  return { status: 'INSUFFICIENT_EVIDENCE', candidates: queryCandidates, evidence: [], assertions: [], claims: [], relationships: [], staleSources, canAssert: false };
}
