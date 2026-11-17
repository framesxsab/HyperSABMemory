import { inspectTaskSourceContents, type TaskSource } from '../harness/taskSources.js';
import { markdownProseLineIndices } from '../harness/taskContext.js';
import { sourceKey } from '../memory/groundedSearch.js';

export interface AtomicEvidenceClaim {
  claim: string;
  value: string;
  source: { path: string; sha256: string; freshness: 'current'; line: number; excerpt: string };
  directlyRecorded: true;
  verification: 'exact_markdown_line';
  limitations: string[];
}

export interface EvidenceRelationship {
  type: 'explicit_decision_source';
  from: string;
  to: string;
  status: 'verified';
  evidence: { path: string; sha256: string; freshness: 'current'; line: number; excerpt: string };
}

export function findDecisionClaims(workspace: string, sources: TaskSource[], query: string) {
  if (!/\b(decision|rationale|why|constraint|design|chosen|choose)\b/i.test(query)) return undefined;
  const unique = [...new Map(sources.map(source => [sourceKey(source.path), source])).values()];
  if (unique.length < 2) return undefined;
  const inspected = inspectTaskSourceContents(workspace, unique);
  if (inspected.some(item => item.status !== 'current' || !item.content)) return undefined;
  const byPath = new Map(inspected.map(item => [sourceKey(item.path), item]));
  const decisions = new Map<string, { value: string; rationale?: string; line: number; rationaleLine?: number }>();
  const decisionCounts = new Map<string, number>();
  for (const item of inspected) {
    const lines = item.content!.toString('utf8').split(/\r?\n/);
    if (lines[0]?.startsWith('\uFEFF')) lines[0] = lines[0].slice(1);
    const prose = new Set(markdownProseLineIndices(lines));
    for (let index = 0; index < lines.length - 1; index++) {
      if (!prose.has(index)) continue;
      const decision = lines[index].match(/^Decision: ([^\r\n]{1,280})$/);
      if (!decision) continue;
      const key = sourceKey(item.path);
      decisionCounts.set(key, (decisionCounts.get(key) ?? 0) + 1);
      const rationale = prose.has(index + 1) ? lines[index + 1].match(/^Rationale: ([^\r\n]{1,280})$/) : null;
      decisions.set(key, { value: decision[1], rationale: rationale?.[1], line: index + 1, rationaleLine: rationale ? index + 2 : undefined });
    }
  }
  for (const [key, count] of decisionCounts) if (count !== 1) decisions.delete(key);
  const linked: Array<{ item: (typeof inspected)[number]; decisionItem: (typeof inspected)[number]; decision: NonNullable<ReturnType<typeof decisions.get>>; constraint: string; refLine: number; constraintLine: number }> = [];
  for (const item of inspected) {
    const lines = item.content!.toString('utf8').split(/\r?\n/);
    if (lines[0]?.startsWith('\uFEFF')) lines[0] = lines[0].slice(1);
    const prose = new Set(markdownProseLineIndices(lines));
    if (lines.filter(line => /^Decision-Source: /.test(line)).length > 1 || lines.filter(line => /^Constraint: /.test(line)).length > 1) return undefined;
    for (let index = 0; index < lines.length - 1; index++) {
      if (!prose.has(index) || !prose.has(index + 1)) continue;
      const ref = lines[index].match(/^Decision-Source: ([^\r\n]{1,2048})$/);
      const constraint = lines[index + 1].match(/^Constraint: ([^\r\n]{1,280})$/);
      if (!ref || !constraint) continue;
      const decisionItem = byPath.get(sourceKey(ref[1]));
      const decision = decisions.get(sourceKey(ref[1]));
      if (!decisionItem || !decision || decisionItem.path === item.path) return undefined;
      linked.push({ item, decisionItem, decision, constraint: constraint[1], refLine: index + 1, constraintLine: index + 2 });
    }
  }
  const distinct = new Set(linked.map(item => `${sourceKey(item.decisionItem.path)}\0${item.decision.value}\0${item.constraint}`));
  if (linked.length !== 1 || distinct.size !== 1) return undefined;
  const result = linked[0];
  const reread = inspectTaskSourceContents(workspace, [result.decisionItem, result.item]);
  if (reread.some(item => item.status !== 'current' || !item.content)) return undefined;
  const makeClaim = (claim: string, value: string, item: (typeof reread)[number], line: number, excerpt: string): AtomicEvidenceClaim => ({
    claim, value, source: { path: item.path, sha256: item.currentSha256!, freshness: 'current', line, excerpt },
    directlyRecorded: true, verification: 'exact_markdown_line',
    limitations: ['This verifies the recorded source text, not semantic correctness or implementation compliance.']
  });
  const decisionLine = `Decision: ${result.decision.value}`;
  const decisionClaim = makeClaim(`Recorded decision: ${result.decision.value}`, result.decision.value, reread[0], result.decision.line, decisionLine);
  const claims = [decisionClaim];
  if (result.decision.rationale && result.decision.rationaleLine) {
    const line = `Rationale: ${result.decision.rationale}`;
    claims.push(makeClaim(`Recorded rationale: ${result.decision.rationale}`, result.decision.rationale, reread[0], result.decision.rationaleLine, line));
  }
  const constraintLine = `Constraint: ${result.constraint}`;
  const constraintClaim = makeClaim(`Recorded constraint: ${result.constraint}`, result.constraint, reread[1], result.constraintLine, constraintLine);
  claims.push(constraintClaim);
  const relationship: EvidenceRelationship = {
    type: 'explicit_decision_source', from: constraintClaim.source.path, to: decisionClaim.source.path, status: 'verified',
    evidence: { path: reread[1].path, sha256: reread[1].currentSha256!, freshness: 'current', line: result.refLine, excerpt: `Decision-Source: ${result.decisionItem.path}` }
  };
  return { claims: claims.slice(0, 3), relationships: [relationship], text: `${claims.map(claim => claim.claim).join(' ')} The constraint source explicitly references the decision source.`, limitation: 'The answer reports recorded statements and an explicit source link; it does not verify implementation compliance.' };
}
