import * as path from 'node:path';
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

export function verifyJsonScalarClaim(source: ClaimSourceSnapshot, key: string): ClaimVerification {
  if (source.status !== 'current' || !source.content || !/\.json$/i.test(source.path)) return { status: 'unsupported' };
  try {
    const parsed: unknown = JSON.parse(source.content);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Object.hasOwn(parsed, key)) return { status: 'unsupported' };
    const value = (parsed as Record<string, unknown>)[key];
    if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) return { status: 'unsupported' };
    const escapedKey = JSON.stringify(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const valueText = JSON.stringify(value);
    const occurrences = [...source.content.matchAll(new RegExp(`${escapedKey}\\s*:`, 'g'))];
    if (occurrences.length > 1) return { status: 'conflicting' };
    const match = source.content.match(new RegExp(`${escapedKey}\\s*:\\s*${valueText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s*[,}])`));
    if (!match || match[0].length > 320) return { status: 'unsupported' };
    const position = match.index ?? -1;
    if (position < 0) return { status: 'unsupported' };
    return { status: 'supported', claim: claim('json_scalar', `The current configuration records ${key} ${valueText}.`, valueText, source, source.content.slice(0, position).split('\n').length, match[0], 'unique_json_scalar', 'This verifies a current JSON scalar, not runtime behavior.') };
  } catch { return { status: 'unsupported' }; }
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
