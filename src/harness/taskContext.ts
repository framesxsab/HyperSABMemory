import type { TaskRecord } from '../memory/taskLedger.js';
import { TokenCompressor } from './tokenCompressor.js';
import { inspectTaskSources, inspectTaskSourceContents, type TaskSource, type TaskSourceInspection, type TaskSourceContentInspection } from './taskSources.js';

export const TASK_CAPSULE_TOKEN_BUDGET = 600;

export class TaskContextError extends Error {
  readonly code = 'CAPSULE_BUDGET_EXCEEDED';
  readonly details: { estimatedTokens: number; limit: number };

  constructor(estimatedTokens: number) {
    super(`task capsule needs ${estimatedTokens} estimated tokens; shorten its supplied state or use evidence references (limit ${TASK_CAPSULE_TOKEN_BUDGET})`);
    this.details = { estimatedTokens, limit: TASK_CAPSULE_TOKEN_BUDGET };
  }
}

function text(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function items(values: string[]): string {
  return values.map(text).join('; ') || '(none recorded)';
}

function references(values: TaskSource[]): string {
  return values.map((source) => `${text(source.path)}#${source.sha256 ? source.sha256.slice(0, 8) : 'unverified'}`).join('; ') || '(none recorded)';
}

/** Render all accepted state without clipping facts. The ledger enforces the 600-token bound before saving. */
export function renderTaskCapsule(task: TaskRecord): string {
  const lines = [
    `Task ${task.id} r${task.revision} [${task.state}]${task.owner ? ` owner:${text(task.owner)}` : ''}`,
    `Goal: ${text(task.goal)}`,
    `Constraints: ${items(task.constraints)}`,
    `Acceptance: ${items(task.acceptanceCriteria)}`,
    `Source refs (re-read before acting): ${references(task.sourceRefs)}`
  ];
  if (task.summary) lines.push(`Progress (reported): ${text(task.summary)}`);
  if (task.decisions.length) lines.push(`Decisions (reported/unverified): ${items(task.decisions)}`);
  if (task.completedWork.length) lines.push(`Done (reported): ${items(task.completedWork)}`);
  if (task.evidenceRefs.length) lines.push(`Evidence refs: ${references(task.evidenceRefs)}`);
  if (task.checks.length) lines.push(`Checks (agent-reported): ${items(task.checks)}`);
  if (task.openIssues.length) lines.push(`Open issues: ${items(task.openIssues)}`);
  if (task.blockers.length) lines.push(`Blockers: ${items(task.blockers)}`);
  lines.push(`Next action: ${text(task.nextAction) || '(not recorded)'}`);
  return lines.join('\n');
}

export interface RestoredTaskContext {
  taskId: string;
  revision: number;
  state: TaskRecord['state'];
  lease: {
    status: 'unclaimed' | 'active' | 'expired';
    generation: number;
    snapshotRevision: number;
    evaluatedAt: string;
    recordedOwner?: string;
    expiresAt?: string;
  };
  capsule: string;
  estimatedTokens: number;
  sources: TaskSourceInspection[];
  evidence: TaskSourceInspection[];
  warnings: string[];
  reread: string[];
  conflicts: string[];
  unsupportedAssumptions: string[];
  decisionsStatus: 'reported_unverified' | 'historical_unverified';
  decisionEvidence: Array<{ decision: string; sourcePath: string; sha256: string; line: number; excerpt: string; rationale?: { text: string; line: number; excerpt: string } }>;
}

export function* markdownProseLineIndices(lines: string[]): Iterable<number> {
  let fence = '';
  let comment = false;
  for (const [index, line] of lines.entries()) {
    if (fence) {
      if (new RegExp(`^ {0,3}${fence[0]}{${fence.length},}\\s*$`).test(line)) fence = '';
      continue;
    }
    const opening = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (opening) { fence = opening[1]; continue; }
    if (comment) { if (line.includes('-->')) comment = false; continue; }
    const commentStart = line.indexOf('<!--');
    if (commentStart >= 0) { comment = !line.includes('-->', commentStart + 4); continue; }
    yield index;
  }
}

/** Restore only the compact task capsule and freshness metadata; it never updates recorded hashes. */
export function restoreTaskContext(workspaceDir: string, task: TaskRecord, onContent?: (source: TaskSourceContentInspection) => void): RestoredTaskContext {
  const capsule = renderTaskCapsule(task);
  const estimatedTokens = TokenCompressor.estimateTokens(capsule);
  if (estimatedTokens > TASK_CAPSULE_TOKEN_BUDGET) throw new TaskContextError(estimatedTokens);

  const sources = inspectTaskSources(workspaceDir, task.sourceRefs, onContent);
  const evidence = inspectTaskSources(workspaceDir, task.evidenceRefs, onContent);
  const reportedIssues = [...task.openIssues, ...task.blockers];
  const conflicts = reportedIssues.filter((issue) => /\b(conflict\w*|contradict\w*|inconsistent|disagree\w*)\b/i.test(issue));
  const inspections = [...sources, ...evidence];
  const decisionEvidence: RestoredTaskContext['decisionEvidence'] = [];
  if (task.decisions.length && !conflicts.length) {
    const refs = [...task.sourceRefs, ...task.evidenceRefs];
    const statements = new Map(task.decisions.map(decision => [`Decision: ${decision}`, decision]));
    const key = (filename: string) => process.platform === 'win32' ? filename.replace(/\\/g, '/').toLowerCase() : filename;
    const hashes = new Map<string, Set<string>>();
    for (const ref of refs) {
      const name = key(ref.path);
      if (!hashes.has(name)) hashes.set(name, new Set());
      hashes.get(name)!.add(ref.sha256);
    }
    const examined = new Set<string>();
    for (const ref of refs) {
      if (!/\.md$/i.test(ref.path) || hashes.get(key(ref.path))!.size !== 1 || examined.has(key(ref.path))) continue;
      examined.add(key(ref.path));
      const initial = inspectTaskSourceContents(workspaceDir, [ref])[0];
      if (initial.status !== 'current' || !initial.content) {
        const { content: _content, ...inspection } = initial;
        for (const existing of inspections) if (key(existing.path) === key(ref.path) && existing.sha256 === ref.sha256) Object.assign(existing, inspection);
        continue;
      }
      const lines = initial.content.toString('utf8').split(/\r?\n/);
      for (const index of markdownProseLineIndices(lines)) {
        const line = lines[index];
        const excerpt = line.trim();
        if (line !== excerpt) continue;
        const decision = excerpt.length <= 320 ? statements.get(excerpt) : undefined;
        if (!decision || decisionEvidence.some(item => item.decision === decision)) continue;
        const rationaleLine = lines[index + 1];
        const rationale = rationaleLine?.length <= 320 && !rationaleLine.includes('<!--') && !rationaleLine.includes('-->') ? rationaleLine.match(/^Rationale: (\S(?:.*\S)?)$/) : null;
        decisionEvidence.push({ decision, sourcePath: ref.path, sha256: ref.sha256, line: index + 1, excerpt, ...(rationale ? { rationale: { text: rationale[1], line: index + 2, excerpt: rationaleLine } } : {}) });
      }
    }
    const checked = new Map<string, TaskSourceInspection>();
    for (const item of decisionEvidence) {
      const name = key(item.sourcePath);
      if (checked.has(name)) continue;
      const { content: _content, ...inspection } = inspectTaskSourceContents(workspaceDir, [{ path: item.sourcePath, sha256: item.sha256 }])[0];
      checked.set(name, inspection);
      if (inspection.status !== 'current') for (const existing of inspections) if (key(existing.path) === name && existing.sha256 === item.sha256) Object.assign(existing, inspection);
    }
    for (let index = decisionEvidence.length - 1; index >= 0; index--) if (checked.get(key(decisionEvidence[index].sourcePath))?.status !== 'current') decisionEvidence.splice(index, 1);
  }
  const changed = inspections.filter(({ status }) => status !== 'current');
  const warnings = changed.map(({ path, status, detail }) =>
    `${path}: ${status}${detail ? ` (${detail})` : ''}; re-read before relying on its recorded conclusions`);
  if (sources.length === 0) warnings.push('No source references are recorded; the task scope and decisions are unverified.');
  if (task.state === 'reported_complete') warnings.push('Completion and check results are agent-reported, not independently verified.');
  const unsupportedAssumptions = reportedIssues.filter((issue) => /\b(assum\w*|unsupported|unverified|unknown)\b/i.test(issue));
  if (changed.length || sources.length === 0) {
    unsupportedAssumptions.push('Recorded decisions have no guarantee of current source support; treat them as historical/unverified until sources are re-read.');
  }
  if (conflicts.length) warnings.push('Recorded conflicts remain unresolved; do not choose a source silently.');

  const evaluatedAt = new Date();
  const leaseStatus = !task.owner ? 'unclaimed' : Date.parse(task.leaseExpiresAt!) > evaluatedAt.getTime() ? 'active' : 'expired';
  if (leaseStatus === 'expired') warnings.push('The recorded task lease has expired; reacquire it before checkpointing.');

  return {
    taskId: task.id,
    revision: task.revision,
    state: task.state,
    lease: {
      status: leaseStatus,
      generation: task.leaseGeneration,
      snapshotRevision: task.revision,
      evaluatedAt: evaluatedAt.toISOString(),
      ...(task.owner ? { recordedOwner: task.owner, expiresAt: task.leaseExpiresAt } : {})
    },
    capsule,
    estimatedTokens,
    sources,
    evidence,
    warnings,
    reread: [...new Set(inspections.map(({ path }) => path))],
    conflicts,
    unsupportedAssumptions,
    decisionsStatus: changed.length || sources.length === 0 ? 'historical_unverified' : 'reported_unverified',
    decisionEvidence
  };
}
