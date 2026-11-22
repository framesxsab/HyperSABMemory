import * as path from 'node:path';
import ts from 'typescript';
import { inspectTaskSourceContents, type TaskSource, type TaskSourceContentInspection } from '../harness/taskSources.js';
import { markdownProseLineIndices } from '../harness/taskContext.js';

export interface ClaimSource {
  path: string;
  sha256: string;
  freshness: 'current';
  line: number;
  excerpt: string;
}

export interface AtomicEvidenceClaim {
  type: 'json_scalar' | 'quoted_text' | 'recorded_decision' | 'recorded_rationale' | 'recorded_constraint';
  claim: string;
  value: string;
  source: ClaimSource;
  directlyRecorded: true;
  verification: 'unique_json_scalar' | 'exact_quotation' | 'exact_markdown_line';
  limitations: string[];
}

export interface EvidenceRelationship {
  type: 'explicit_decision_source';
  from: string;
  to: string;
  status: 'verified';
  evidence: ClaimSource;
}

export interface ClaimSourceSnapshot extends TaskSource {
  currentSha256?: string;
  status: TaskSourceContentInspection['status'];
  content?: string;
}

export interface RecordedClaimResult {
  status: 'supported' | 'conflicting' | 'unsupported';
  claims: AtomicEvidenceClaim[];
  relationships: EvidenceRelationship[];
  conflictPaths?: string[];
  text?: string;
  limitation: string;
}

export type ClaimVerification =
  | { status: 'supported'; claim: AtomicEvidenceClaim }
  | { status: 'conflicting' | 'unsupported' };

const keyOf = (value: string) => {
  const normalized = path.normalize(value);
  return process.platform === 'win32' ? normalized.replace(/\\/g, '/').toLowerCase() : normalized;
};

function sourceCitation(source: ClaimSourceSnapshot, line: number, excerpt: string): ClaimSource {
  return { path: source.path, sha256: source.currentSha256!, freshness: 'current', line, excerpt };
}

function claim(type: AtomicEvidenceClaim['type'], text: string, value: string, source: ClaimSourceSnapshot, line: number, excerpt: string, verification: AtomicEvidenceClaim['verification'], limitation: string): AtomicEvidenceClaim {
  return { type, claim: text, value, source: sourceCitation(source, line, excerpt), directlyRecorded: true, verification, limitations: [limitation] };
}

type JsonPathStep = { kind: 'prop'; key: string } | { kind: 'index'; index: number };

const UNSAFE_JSON_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

function parseJsonPath(rawKey: string, rootOnly: boolean): { explicitRoot: boolean; steps: JsonPathStep[] } | null {
  if (typeof rawKey !== 'string' || !rawKey || rawKey !== rawKey.trim()) return null;
  const hasRootPrefix = rawKey.startsWith('$.');
  const body = hasRootPrefix ? rawKey.slice(2) : rawKey;
  if (!body || body.startsWith('.') || body.endsWith('.') || body.includes('..')) return null;

  const steps: JsonPathStep[] = [];
  for (const segment of body.split('.')) {
    if (!segment || /\s/.test(segment)) return null;
    const bracketIndex = segment.indexOf('[');
    if (bracketIndex < 0) {
      if (segment.includes(']') || UNSAFE_JSON_SEGMENTS.has(segment)) return null;
      steps.push({ kind: 'prop', key: segment });
      continue;
    }
    const propName = segment.slice(0, bracketIndex);
    if (!propName || propName.includes(']') || UNSAFE_JSON_SEGMENTS.has(propName)) return null;
    steps.push({ kind: 'prop', key: propName });
    let rest = segment.slice(bracketIndex);
    while (rest.length > 0) {
      const m = rest.match(/^\[(\d+)\](.*)$/);
      if (!m) return null;
      steps.push({ kind: 'index', index: Number.parseInt(m[1], 10) });
      rest = m[2];
    }
  }
  return steps.length > 0 ? { explicitRoot: hasRootPrefix || rootOnly, steps } : null;
}

function countJsonPropertyOccurrences(node: ts.Node, key: string): number {
  let count = 0;
  function visit(current: ts.Node): void {
    if (ts.isPropertyAssignment(current) && ts.isStringLiteral(current.name) && current.name.text === key) {
      count++;
    }
    ts.forEachChild(current, visit);
  }
  visit(node);
  return count;
}

function extractJsonScalarValue(node: ts.Expression, sourceFile: ts.SourceFile): { ok: true; value: string | number | boolean | null } | { ok: false } {
  if (
    ts.isStringLiteral(node) ||
    ts.isNumericLiteral(node) ||
    (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)) ||
    node.kind === ts.SyntaxKind.TrueKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword ||
    node.kind === ts.SyntaxKind.NullKeyword
  ) {
    try {
      const parsed: unknown = JSON.parse(node.getText(sourceFile));
      if (parsed === null || ['string', 'number', 'boolean'].includes(typeof parsed)) {
        return { ok: true, value: parsed as string | number | boolean | null };
      }
    } catch {
      return { ok: false };
    }
  }
  return { ok: false };
}

export function verifyJsonScalarClaim(
  source: ClaimSourceSnapshot,
  key: string,
  options?: { rootOnly?: boolean }
): ClaimVerification {
  if (source.status !== 'current' || !source.content || !/\.json$/i.test(source.path)) return { status: 'unsupported' };
  const parsedPath = parseJsonPath(key, options?.rootOnly === true);
  if (!parsedPath) return { status: 'unsupported' };
  try {
    const parsed: unknown = JSON.parse(source.content);
    if (!parsed || typeof parsed !== 'object') return { status: 'unsupported' };

    const jsonFile = ts.parseJsonText(source.path, source.content);
    const rootExpr = jsonFile.statements[0]?.expression;
    if (!rootExpr) return { status: 'unsupported' };

    if (!parsedPath.explicitRoot && parsedPath.steps.length === 1 && parsedPath.steps[0].kind === 'prop') {
      if (countJsonPropertyOccurrences(rootExpr, parsedPath.steps[0].key) > 1) {
        return { status: 'conflicting' };
      }
    }

    let current: ts.Expression = rootExpr;
    let lastProperty: ts.PropertyAssignment | undefined;
    for (const step of parsedPath.steps) {
      if (step.kind === 'prop') {
        if (!ts.isObjectLiteralExpression(current)) return { status: 'unsupported' };
        const matches = current.properties.filter(
          (prop): prop is ts.PropertyAssignment =>
            ts.isPropertyAssignment(prop) && ts.isStringLiteral(prop.name) && prop.name.text === step.key
        );
        if (matches.length > 1) return { status: 'conflicting' };
        if (matches.length === 0) return { status: 'unsupported' };
        lastProperty = matches[0];
        current = matches[0].initializer;
      } else {
        if (!ts.isArrayLiteralExpression(current)) return { status: 'unsupported' };
        if (step.index < 0 || step.index >= current.elements.length) return { status: 'unsupported' };
        lastProperty = undefined;
        current = current.elements[step.index];
      }
    }

    const scalar = extractJsonScalarValue(current, jsonFile);
    if (!scalar.ok) return { status: 'unsupported' };

    const spanNode = lastProperty ?? current;
    const start = spanNode.getStart(jsonFile);
    const excerpt = source.content.slice(start, spanNode.end);
    if (!excerpt || excerpt.length > 320) return { status: 'unsupported' };
    const line = jsonFile.getLineAndCharacterOfPosition(start).line + 1;
    const valueText = JSON.stringify(scalar.value);
    const label = parsedPath.explicitRoot && !key.startsWith('$.') ? `root ${key}` : key;
    return {
      status: 'supported',
      claim: claim(
        'json_scalar',
        `The current configuration records ${label} ${valueText}.`,
        valueText,
        source,
        line,
        excerpt,
        'unique_json_scalar',
        'This verifies a current JSON scalar, not runtime behavior.'
      )
    };
  } catch {
    return { status: 'unsupported' };
  }
}

export function verifyQuotedTextClaim(source: ClaimSourceSnapshot, quote: string): ClaimVerification {
  if (source.status !== 'current' || !source.content || !quote || quote.length > 320) return { status: 'unsupported' };
  const position = source.content.indexOf(quote);
  if (position < 0) return { status: 'unsupported' };
  if (source.content.indexOf(quote, position + 1) >= 0) return { status: 'conflicting' };
  return { status: 'supported', claim: claim('quoted_text', `Source ${source.path} contains the quoted text.`, quote, source, source.content.slice(0, position).split('\n').length, quote, 'exact_quotation', 'This verifies the quotation only, not its meaning or implementation.') };
}

function recordedLine(source: ClaimSourceSnapshot, marker: 'Decision' | 'Rationale' | 'Constraint', expectedLine?: number): ClaimVerification {
  if (source.status !== 'current' || !source.content) return { status: 'unsupported' };
  const lines = source.content.split(/\r?\n/);
  if (lines[0]?.startsWith('\uFEFF')) lines[0] = lines[0].slice(1);
  const prose = new Set(markdownProseLineIndices(lines));
  const matches = lines.flatMap((line, index) => {
    const match = prose.has(index) && (expectedLine === undefined || expectedLine === index + 1) ? line.match(new RegExp(`^${marker}: ([^\\r\\n]{1,280})$`)) : null;
    return match ? [{ value: match[1], index }] : [];
  });
  if (matches.length > 1) return { status: 'conflicting' };
  const found = matches[0];
  if (!found) return { status: 'unsupported' };
  const type = marker === 'Decision' ? 'recorded_decision' : marker === 'Rationale' ? 'recorded_rationale' : 'recorded_constraint';
  const noun = marker.toLowerCase();
  const excerpt = `${marker}: ${found.value}`;
  const period = /[.!?]$/.test(found.value) ? '' : '.';
  return { status: 'supported', claim: claim(type, `The source records the ${noun}: ${found.value}${period}`, found.value, source, found.index + 1, excerpt, 'exact_markdown_line', 'This verifies recorded source text, not semantic correctness or implementation compliance.') };
}

export function verifyRecordedClaims(query: string, input: ClaimSourceSnapshot[]): RecordedClaimResult {
  const unsupported = (limitation = 'No directly verifiable recorded claim was established.') => ({ status: 'unsupported' as const, claims: [], relationships: [], limitation });
  if (/\b(?:implemented|compliance|compliant)\b/i.test(query) && /\b(?:correctly|properly|compliance|compliant|is|are|does)\b/i.test(query)) return unsupported('Source-recorded decisions do not verify implementation compliance.');
  if (!/\b(decision|rationale|why|constraint|design|chosen|choose)\b/i.test(query)) return unsupported();
  const sources = [...new Map(input.filter(item => item.status === 'current' && item.content).map(item => [keyOf(item.path), item])).values()];
  const decisionSources = sources.filter(source => /^(?:\uFEFF)?Decision: /m.test(source.content!));
  if (decisionSources.length > 1) return { status: 'conflicting', claims: [], relationships: [], conflictPaths: decisionSources.map(source => source.path), limitation: 'More than one current source records a decision; no single decision was selected.' };
  if (!decisionSources.length) return unsupported();
  const decisionSource = decisionSources[0];
  const decision = recordedLine(decisionSource, 'Decision');
  if (decision.status !== 'supported') return { status: decision.status, claims: [], relationships: [], limitation: 'The recorded decision is ambiguous or could not be verified.' };
  const claims = [decision.claim];
  const lines = decisionSource.content!.split(/\r?\n/);
  if (lines[0]?.startsWith('\uFEFF')) lines[0] = lines[0].slice(1);
  const decisionLine = decision.claim.source.line;
  const rationale = recordedLine(decisionSource, 'Rationale', decisionLine + 1);
  if (rationale.status === 'conflicting') return { status: 'conflicting', claims: [], relationships: [], limitation: 'The rationale line is ambiguous.' };
  if (rationale.status === 'supported') claims.push(rationale.claim);

  type LinkCandidate = { conflict: true; path: string } | { conflict: false; source: ClaimSourceSnapshot; lines: string[]; prose: Set<number>; index: number };
  const linkCandidates: LinkCandidate[] = [];
  for (const source of sources) {
    const sourceLines = source.content!.split(/\r?\n/);
    if (sourceLines[0]?.startsWith('\uFEFF')) sourceLines[0] = sourceLines[0].slice(1);
    const prose = new Set(markdownProseLineIndices(sourceLines));
    const refs = sourceLines.flatMap((line, index) => prose.has(index) && /^Decision-Source: /.test(line) ? [{ source, lines: sourceLines, prose, index }] : []);
    if (refs.length > 1 || refs.some(() => sourceLines.filter(line => /^Constraint: /.test(line)).length > 1)) linkCandidates.push({ conflict: true, path: source.path });
    else for (const item of refs) linkCandidates.push({ ...item, conflict: false });
  }
  if (linkCandidates.some(candidate => candidate.conflict) || linkCandidates.length > 1) return { status: 'conflicting', claims: [], relationships: [], conflictPaths: linkCandidates.map(candidate => candidate.conflict ? candidate.path : candidate.source.path), limitation: 'Multiple or ambiguous explicit decision links were found.' };
  const relationships: EvidenceRelationship[] = [];
  if (linkCandidates.length === 1) {
    const link = linkCandidates[0];
    if (link.conflict) return { status: 'conflicting', claims: [], relationships: [], limitation: 'The explicit decision link is ambiguous.' };
    const reference = link.lines[link.index].match(/^Decision-Source: ([^\r\n]{1,2048})$/);
    const constraintLine = link.lines[link.index + 1]?.match(/^Constraint: ([^\r\n]{1,280})$/);
    if (!reference || !constraintLine || !link.prose.has(link.index + 1) || keyOf(reference[1]) !== keyOf(decisionSource.path) || keyOf(link.source.path) === keyOf(decisionSource.path)) return { status: 'conflicting', claims: [], relationships: [], conflictPaths: [link.source.path, decisionSource.path], limitation: 'The explicit source link does not resolve uniquely to the recorded decision.' };
    const constraint = recordedLine(link.source, 'Constraint', link.index + 2);
    if (constraint.status !== 'supported') return { status: constraint.status, claims: [], relationships: [], limitation: 'The linked constraint could not be verified.' };
    claims.push(constraint.claim);
    relationships.push({ type: 'explicit_decision_source', from: link.source.path, to: decisionSource.path, status: 'verified', evidence: sourceCitation(link.source, link.index + 1, `Decision-Source: ${decisionSource.path}`) });
  }
  const asksConstraint = /\bconstraint\b/i.test(query);
  const asksRationale = /\b(rationale|why)\b/i.test(query);
  const hasRationale = claims.some(item => item.type === 'recorded_rationale');
  const text = `${claims.map(item => item.claim).join(' ')}${relationships.length ? ' The constraint source explicitly references the decision source.' : ''}`;
  return {
    status: 'supported', claims, relationships, text,
    limitation: relationships.length ? 'The answer verifies recorded text and an explicit source link; it does not verify implementation compliance.' : asksConstraint ? 'The recorded decision and rationale are supported, but no explicit linked constraint was established.' : asksRationale && !hasRationale ? 'The decision is recorded, but no adjacent rationale was found.' : 'This verifies recorded source text, not semantic correctness or implementation compliance.'
  };
}

export function findDecisionClaims(workspace: string, sources: TaskSource[], query: string) {
  const inspected = inspectTaskSourceContents(workspace, sources);
  const snapshots: ClaimSourceSnapshot[] = inspected.map(item => ({ ...item, content: item.content?.toString('utf8') }));
  const result = verifyRecordedClaims(query, snapshots);
  if (result.status !== 'supported' || !result.relationships.length) return undefined;
  const supporting = [...new Map([...result.claims.map(item => item.source.path), ...result.relationships.map(item => item.evidence.path)].map(file => [keyOf(file), sources.find(source => keyOf(source.path) === keyOf(file))!])).values()];
  const reread = inspectTaskSourceContents(workspace, supporting);
  if (reread.some(item => item.status !== 'current')) return undefined;
  return { ...result, claims: result.claims.slice(0, 3), limitation: 'The answer reports source statements and an explicit source link; semantic consistency and implementation compliance are not verified.' };
}
