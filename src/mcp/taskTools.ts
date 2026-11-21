import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { TaskError, TaskLedger, type TaskRecord } from '../memory/taskLedger.js';
import { restoreTaskContext, TASK_CAPSULE_TOKEN_BUDGET, markdownProseLineIndices } from '../harness/taskContext.js';
import { TokenCompressor } from '../harness/tokenCompressor.js';
import { createTaskSourceContentInspector, discoverProjectSources, inspectTaskSourceContents, type TaskSource, type TaskSourceInspection } from '../harness/taskSources.js';
import { HybridSearchEngine, recordSearchText, tokenizeSearchQuery, tokenizeSearchText } from '../memory/hybridSearch.js';
import { excerptFor, isExplicitGroundedQuery, searchGrounded, sourceKey, type GroundedResult } from '../memory/groundedSearch.js';
import { TemporalMemoryEngine } from '../memory/temporalMemory.js';
import type { MemoryRecord } from '../memory/sqliteStore.js';
import { findDecisionClaims } from '../memory/claimVerification.js';

const text = { type: 'string' };
const nonemptyText = { type: 'string', minLength: 1 };
const textList = { type: 'array', items: nonemptyText };

const CROSS_FILE_QUERY = /^\s*what constraint in `([^`\r\n]+\.md)` is recorded for the decision in `([^`\r\n]+\.md)`\s*\??\s*$/i;
const CONSTRAINT_DOCUMENT = /^Decision-Source: ([^\r\n]{1,2048})\r?\nConstraint: ([^\r\n]{1,280})\r?\n?$/;

function crossFileAnswer(workspaceDir: string, task: TaskRecord, sources: TaskSource[], query: string, conflicts: string[]) {
  const match = query.match(CROSS_FILE_QUERY);
  if (!match) return undefined;
  const empty = (status: GroundedResult['status'], reason: string, extra: Record<string, unknown> = {}) => ({ status, reason, canAssert: false, candidates: [], evidence: [], assertions: [], claims: [], relationships: [], staleSources: [], requirements: [], ...extra });
  if (conflicts.length) return empty('CONFLICTING_EVIDENCE', 'The caller reported conflicting sources.', { conflictOrigin: 'caller_declared', conflictPaths: conflicts });
  if ([...task.openIssues, ...task.blockers].some(issue => /\b(?:conflict\w*|contradict\w*|inconsistent|disagree\w*)\b/i.test(issue))) return empty('CONFLICTING_EVIDENCE', 'The task records an unresolved conflict.', { conflictDetails: 'task_reported' });
  const keys = [sourceKey(match[2]), sourceKey(match[1])];
  if (keys[0] === keys[1]) return empty('INSUFFICIENT_EVIDENCE', 'The decision and constraint must be in separate captured sources.');
  const refs: TaskSource[] = [];
  for (const key of keys) {
    const found = sources.filter(source => sourceKey(source.path) === key);
    if (!found.length) return empty('INSUFFICIENT_EVIDENCE', 'Both named files must be captured task sources.');
    if (new Set(found.map(source => source.sha256)).size !== 1) return empty('CONFLICTING_EVIDENCE', 'The task has conflicting captured hashes for a source.', { conflictOrigin: 'source_hash_mismatch', conflictPaths: [found[0].path] });
    refs.push(found[0]);
  }
  const inspected = inspectTaskSourceContents(workspaceDir, refs);
  const stale = inspected.filter(item => item.status !== 'current').map(({ content: _content, ...item }) => item);
  if (stale.length) return empty('STALE_EVIDENCE', 'A supporting source is changed, missing or unavailable.', { staleSources: stale });
  const verified = findDecisionClaims(workspaceDir, refs, 'decision rationale constraint');
  if (!verified) {
    const changed = inspectTaskSourceContents(workspaceDir, refs).filter(item => item.status !== 'current').map(({ content: _content, ...item }) => item);
    return changed.length ? empty('STALE_EVIDENCE', 'A supporting source changed during verification.', { staleSources: changed }) : empty('INSUFFICIENT_EVIDENCE', 'The required single decision and explicit source-linked constraint were not established.');
  }
  const uniqueClaims = new Map(verified.claims.map(claim => [sourceKey(claim.source.path), claim]));
  const evidence = [...uniqueClaims.values()].map(claim => {
    const source = { path: claim.source.path, sha256: claim.source.sha256, currentSha256: claim.source.sha256, status: 'current' as const };
    const record: MemoryRecord = { id: `source_ref:${source.path}`, category: 'general', content: claim.source.excerpt, artifacts: [source.path], status: 'active', timestamp: new Date().toISOString() };
    return { record, source, lexicalSupport: 1, excerpt: claim.source.excerpt, line: claim.source.line };
  });
  const decision = verified.claims.find(claim => claim.type === 'recorded_decision')!;
  const constraint = verified.claims.find(claim => claim.type === 'recorded_constraint')!;
  const citations = [decision.source, verified.relationships[0].evidence, constraint.source].map(({ path, sha256, line, excerpt }) => ({ path, sha256, line, excerpt }));
  return { status: 'SUPPORTED', canAssert: true, candidates: [], evidence, assertions: [
    { claim: `The source records the decision: ${decision.value}`, sourcePath: decision.source.path, excerpt: decision.source.excerpt },
    { claim: `The source records the constraint and explicitly references ${decision.source.path}: ${constraint.value}`, sourcePath: constraint.source.path, excerpt: `${verified.relationships[0].evidence.excerpt}\n${constraint.source.excerpt}` }
  ], claims: verified.claims, relationships: verified.relationships, staleSources: [], requirements: [], answer: { text: verified.text, relationship: 'explicit_source_reference', sources: citations, limitation: verified.limitation } };
}

function taskAnswerBundle(workspaceDir: string, task: TaskRecord) {
  const sources = [...task.sourceRefs, ...task.evidenceRefs];
  const inspect = createTaskSourceContentInspector(workspaceDir);
  const seen = new Set<string>();
  const links: Array<{ decision: string; constraint: string; attribution: 'source_recorded'; taskDecisionMatch: 'exact_text_unverified'; answer: string; sources: Array<{ path: string; sha256: string; line: number; excerpt: string }> }> = [];
  const discovered: Array<{ source: TaskSource; decisionPath: string; constraint: string }> = [];
  const context = restoreTaskContext(workspaceDir, task, task.decisions.length ? inspected => {
    const source = { path: inspected.path, sha256: inspected.sha256 };
    const key = sourceKey(source.path);
    if (seen.has(key) || !/\.md$/i.test(source.path) || source.path.includes('`')) return;
    seen.add(key);
    const parsed = inspected.content!.toString('utf8').match(CONSTRAINT_DOCUMENT);
    if (parsed && !parsed[1].includes('`')) discovered.push({ source, decisionPath: parsed[1], constraint: parsed[2] });
  } : undefined);
  for (const { source, decisionPath, constraint } of discovered) {
    const query = `What constraint in \`${source.path}\` is recorded for the decision in \`${decisionPath}\`?`;
    const result = crossFileAnswer(workspaceDir, task, sources, query, []);
    if (!result?.canAssert || !('answer' in result)) continue;
    const answer = result.answer as { text: string; sources: Array<{ path: string; sha256: string; line: number; excerpt: string }> } | undefined;
    if (!answer) continue;
    const decision = result.claims.find(claim => claim.type === 'recorded_decision')?.value;
    if (!decision || !task.decisions.includes(decision)) continue;
    links.push({ decision, constraint, attribution: 'source_recorded', taskDecisionMatch: 'exact_text_unverified', answer: answer.text, sources: answer.sources });
  }
  const references = new Map<string, TaskSource>();
  for (const item of discovered) references.set(`${sourceKey(item.source.path)}\0${item.source.sha256}`, item.source);
  for (const item of context.decisionEvidence) references.set(`${sourceKey(item.sourcePath)}\0${item.sha256}`, { path: item.sourcePath, sha256: item.sha256 });
  for (const link of links) for (const item of link.sources) references.set(`${sourceKey(item.path)}\0${item.sha256}`, { path: item.path, sha256: item.sha256 });
  const checked = new Map<string, TaskSourceInspection>();
  for (const [key, reference] of references) {
    const { content: _content, ...inspection } = inspect([reference])[0];
    checked.set(key, inspection);
    if (inspection.status !== 'current') {
      for (const item of [...context.sources, ...context.evidence]) if (sourceKey(item.path) === sourceKey(reference.path) && item.sha256 === reference.sha256) Object.assign(item, inspection);
      if (!context.warnings.some(warning => warning.startsWith(`${reference.path}:`))) context.warnings.push(`${reference.path}: ${inspection.status}; re-read before relying on its recorded conclusions`);
    }
  }
  const current = (path: string, sha256: string) => checked.get(`${sourceKey(path)}\0${sha256}`)?.status === 'current';
  context.decisionEvidence = context.decisionEvidence.filter(item => current(item.sourcePath, item.sha256));
  const validLinks = links.filter(link => link.sources.every(item => current(item.path, item.sha256)));
  const selectedLinks: typeof validLinks = [];
  for (const link of validLinks) {
    if (selectedLinks.length < 5 && TokenCompressor.estimateTokens(JSON.stringify([...selectedLinks, link])) <= TASK_CAPSULE_TOKEN_BUDGET) selectedLinks.push(link);
  }
  if ([...checked.values()].some(item => item.status !== 'current')) {
    context.decisionsStatus = 'historical_unverified';
    const warning = 'Recorded decisions have no guarantee of current source support; treat them as historical/unverified until sources are re-read.';
    if (!context.unsupportedAssumptions.includes(warning)) context.unsupportedAssumptions.push(warning);
  }
  return { ...context, answerBundle: {
    recordedTask: { attribution: 'agent_reported', provenance: { path: '.hypersabmemory/tasks.json', taskId: task.id, revision: task.revision, updatedAt: task.updatedAt }, state: task.state, goal: task.goal, acceptanceCriteria: task.acceptanceCriteria, constraints: task.constraints, decisions: task.decisions, summary: task.summary || null, completedWork: task.completedWork, openIssues: task.openIssues, blockers: task.blockers, checks: task.checks, nextAction: task.nextAction || null },
    linkedConstraints: selectedLinks,
    truncated: selectedLinks.length < validLinks.length,
    limitation: 'Task decisions match source text without a stable identity. Recorded statements and explicit references do not prove compliance; absent links are unverified.'
  } };
}

function evidenceBundle(query: string, grounded: GroundedResult, hybrid: HybridSearchEngine, workspaceDir: string, sources: TaskSource[]) {
  const focused = query.replace(/\b(?:find|implementation|implementations|implemented|implementing|tests?|tested|testing|verify|verified|verification|routes?|routed|endpoints?|interfaces?|mcp|exposed|expose|exposes|configuration|config|settings?|decisions?|rationale)\b/gi, ' ');
  const roleQuery = tokenizeSearchQuery(focused).length >= 2 ? focused : query;
  const subjectTerms = new Set(tokenizeSearchQuery(roleQuery));
  const requirements = [
    { role: 'implementation', requested: /\b(implement\w*|code|handler)\b/i.test(query), matches: (filename: string) => /\.[cm]?[jt]sx?$/i.test(filename) && !/(^|\/)(tests?|__tests__)(\/|$)|\.(test|spec)\./i.test(filename) },
    { role: 'test', requested: /\b(tests?|tested|testing|verify|verified|verification)\b/i.test(query), matches: (filename: string) => /(^|\/)(tests?|__tests__)(\/|$)|\.(test|spec)\./i.test(filename) },
    { role: 'interface', requested: /\b(mcp|route\w*|endpoint\w*|interface\w*|expos\w*)\b/i.test(query), matches: (filename: string) => /(^|\/)(mcp|routes?|api)(\/|$)|(?:route|server|interface)/i.test(filename) },
    { role: 'configuration', requested: /\b(config\w*|setting\w*)\b/i.test(query), matches: (filename: string) => /(^|\/)(config|settings)|\.(json|ya?ml|toml|ini)$/i.test(filename) },
    { role: 'decision', requested: /\b(decision\w*|rationale|why)\b/i.test(query), matches: (filename: string) => /\.md$/i.test(filename) || /(^|\/)(docs|decisions?|adr)(\/|$)|(?:architecture|decision)/i.test(filename) }
  ];
  return requirements.filter(item => item.requested).map(item => {
    const roleSources = sources.filter(source => item.matches(source.path));
    let evidence = grounded.evidence.filter(entry => item.matches(entry.source.path));
    if (!evidence.length && grounded.status !== 'CONFLICTING_EVIDENCE') {
      if (roleSources.length) evidence = searchGrounded(hybrid, workspaceDir, roleQuery, roleSources).evidence.filter(entry => item.matches(entry.source.path));
    }
    const candidates = evidence.map(entry => ({ path: entry.source.path, sha256: entry.source.currentSha256, ...(entry.line ? { line: entry.line } : {}), ...(entry.excerpt ? { excerpt: entry.excerpt } : {}), freshness: entry.source.status }));
    const candidateKeys = new Set(candidates.map(candidate => sourceKey(candidate.path)));
    const conflictKeys = new Set((grounded.conflictPaths ?? []).map(sourceKey));
    const references = new Map((candidates.length ? [] : roleSources).filter(source => !candidateKeys.has(sourceKey(source.path)) && !conflictKeys.has(sourceKey(source.path))).map(source => [sourceKey(source.path), source]));
    const unrankedReferences = [...references.values()].slice(0, 5).map(source => ({ path: source.path, sha256: source.sha256, status: 'unverified' as const }));
    const verifiedFacts = [];
    for (const candidate of evidence) {
      if (grounded.status === 'CONFLICTING_EVIDENCE') continue;
      const source = roleSources.find(reference => sourceKey(reference.path) === sourceKey(candidate.source.path));
      if (!source || conflictKeys.has(sourceKey(source.path))) continue;
      const inspection = inspectTaskSourceContents(workspaceDir, [source])[0];
      if (inspection.status !== 'current' || !inspection.content) continue;
      const content = inspection.content.toString('utf8');
      if (item.role === 'configuration') {
        for (const assertion of grounded.assertions.filter(entry => entry.claim.startsWith('Configuration ') && sourceKey(entry.sourcePath) === sourceKey(source.path))) {
          const position = content.indexOf(assertion.excerpt);
          if (position < 0 || content.indexOf(assertion.excerpt, position + 1) >= 0) continue;
          verifiedFacts.push({ status: 'verified' as const, role: item.role, verification: 'json_scalar', claim: assertion.claim, sourcePath: source.path, sha256: source.sha256, currentSha256: inspection.currentSha256, excerpt: assertion.excerpt, line: content.slice(0, position).split('\n').length });
        }
        continue;
      }
      const lines = content.split(/\r?\n/);
      const proseLines = item.role === 'decision' && /\.md$/i.test(source.path) ? new Set(markdownProseLineIndices(lines)) : undefined;
      const lineCounts = new Map<string, number>();
      for (const line of lines) { const key = line.trim(); if (key) lineCounts.set(key, (lineCounts.get(key) ?? 0) + 1); }
      const codeLines = /\.[cm]?[jt]sx?$/i.test(source.path) ? content.replace(/\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|`(?:\\[\s\S]|[^`\\])*`|'(?:\\[\s\S]|[^'\\])*'|"(?:\\[\s\S]|[^"\\])*"/g, part => part.replace(/[^\r\n]/g, ' ')).split(/\r?\n/) : [];
      for (const [index, line] of lines.entries()) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.length > 320 || lineCounts.get(trimmed) !== 1) continue;
        let claim: string | undefined;
        let verification: string | undefined;
        if (item.role === 'implementation') {
          const declaration = codeLines[index]?.match(/^\s*(?:(?:export|declare|abstract|default)\s+)*(?:class|function|interface|type|const|let|var|enum)\s+([A-Za-z_$][\w$]*)\b/);
          if (declaration && tokenizeSearchText(declaration[1]).some(term => subjectTerms.has(term))) {
            const checked = searchGrounded(hybrid, workspaceDir, `Where is \`${declaration[1]}\` defined?`, [source]);
            if (checked.assertions.some(assertion => assertion.sourcePath === source.path)) {
              claim = `Identifier ${declaration[1]} is declared in ${source.path}.`;
              verification = 'source_declaration';
            }
          }
        } else if (item.role === 'interface' && /^\s*(?:router|app)\.(?:get|post|put|patch|delete|all)\s*\(/i.test(codeLines[index] ?? '')) {
          claim = `Source contains this router call statement: ${trimmed}`;
          verification = 'route_registration_statement';
        } else if (item.role === 'test' && /^\s*(?:it|test)\s*\(/.test(codeLines[index] ?? '') && /\b(?:expect|assert)\s*\(/.test(codeLines[index] ?? '') && /\.(?:toBe|toEqual|toMatch|toMatchObject)\s*\(/.test(codeLines[index] ?? '')) {
          claim = `Test source contains this call and assertion statement: ${trimmed}`;
          verification = 'test_statement_present';
        } else if (item.role === 'decision' && (!proseLines || proseLines.has(index)) && /^\s*(?:Decision|Rationale):\s*\S/i.test(trimmed)) {
          claim = `Decision source records this statement: ${trimmed}`;
          verification = 'decision_statement_present';
        }
        if (!claim || !verification) continue;
        if (item.role === 'decision') {
          if (/[`\r\n]/.test(source.path) || trimmed.includes('`')) continue;
        } else {
          const quoted = searchGrounded(hybrid, workspaceDir, `Does \`${source.path}\` contain \`${trimmed}\`?`, [source]);
          if (!quoted.assertions.some(assertion => assertion.sourcePath === source.path)) continue;
        }
        verifiedFacts.push({ status: 'verified' as const, role: item.role, verification, claim, sourcePath: source.path, sha256: source.sha256, currentSha256: inspection.currentSha256, excerpt: trimmed, line: index + 1 });
        break;
      }
    }
    const sourceConflict = roleSources.some(source => conflictKeys.has(sourceKey(source.path)));
    const verificationState = sourceConflict ? 'conflict' : verifiedFacts.length ? 'verified' : candidates.length || unrankedReferences.length ? 'candidate' : 'missing';
    const unresolvedRelationships = verifiedFacts.length ? ({
      implementation: 'A verified declaration does not establish that it satisfies the full behavioral requirement.',
      test: 'A test statement is present; execution and pass status are not established by reading its source.',
      interface: 'A route registration is present; its handler-to-implementation relationship is not established.',
      decision: 'A decision statement is recorded; implementation compliance is not established.'
    }[item.role] ?? 'The complete requested relationship is not established.') : 'No directly verifiable role fact was established.';
    return { role: item.role, status: 'unresolved' as const, verificationState, verifiedFacts, unresolvedRelationships, candidates, unrankedReferences };
  });
}

function finishGroundedQuery(query: string, grounded: GroundedResult, hybrid: HybridSearchEngine, workspaceDir: string, sources: TaskSource[]) {
  const requirements = evidenceBundle(query, grounded, hybrid, workspaceDir, sources);
  const referenceKey = (source: TaskSource) => `${sourceKey(source.path)}\0${source.sha256}`;
  const references = [
    ...grounded.evidence.map(item => item.source),
    ...requirements.flatMap(item => [
      ...item.candidates.map(candidate => ({ path: candidate.path, sha256: candidate.sha256 ?? '' })),
      ...item.verifiedFacts.map(fact => ({ path: fact.sourcePath, sha256: fact.sha256 }))
    ])
  ];
  const unique = new Map(references.map(source => [referenceKey(source), source]));
  const checks = inspectTaskSourceContents(workspaceDir, [...unique.values()]);
  const current = new Set(checks.filter(item => item.status === 'current').map(referenceKey));
  const stale = checks.filter(item => item.status !== 'current').map(({ content: _content, ...item }) => item);
  const staleKeys = new Set(grounded.staleSources.map(item => sourceKey(item.path)));
  grounded.staleSources.push(...stale.filter(item => !staleKeys.has(sourceKey(item.path))));
  grounded.evidence = grounded.evidence.filter(item => current.has(referenceKey(item.source)));
  const sourceFactKeys = new Set([
    ...(grounded.claims ?? []).filter(item => item.type.startsWith('recorded_')).map(item => `${sourceKey(item.source.path)}\0${item.source.excerpt}`),
    ...(grounded.relationships ?? []).map(item => `${sourceKey(item.evidence.path)}\0${item.evidence.excerpt}`)
  ]);
  grounded.assertions = grounded.assertions.filter(item => !sourceFactKeys.has(`${sourceKey(item.sourcePath)}\0${item.excerpt}`));
  grounded.assertions = grounded.assertions.filter(item => grounded.evidence.some(evidence => sourceKey(evidence.source.path) === sourceKey(item.sourcePath)));
  grounded.canAssert = grounded.assertions.length > 0 && grounded.status !== 'CONFLICTING_EVIDENCE';
  if (grounded.status !== 'CONFLICTING_EVIDENCE') {
    grounded.status = grounded.canAssert ? 'SUPPORTED' : grounded.evidence.length ? 'INSUFFICIENT_EVIDENCE' : grounded.staleSources.length ? 'STALE_EVIDENCE' : 'INSUFFICIENT_EVIDENCE';
  }
  for (const requirement of requirements) {
    requirement.candidates = requirement.candidates.filter(item => current.has(referenceKey({ path: item.path, sha256: item.sha256 ?? '' })));
    requirement.verifiedFacts = requirement.verifiedFacts.filter(item => current.has(referenceKey({ path: item.sourcePath, sha256: item.sha256 })));
    if (requirement.verificationState !== 'conflict') {
      requirement.verificationState = requirement.verifiedFacts.length ? 'verified' : requirement.candidates.length || requirement.unrankedReferences.length ? 'candidate' : 'missing';
    }
    if (!requirement.verifiedFacts.length) requirement.unresolvedRelationships = 'No directly verifiable role fact was established.';
  }
  const { implementationEvidence: _implementation, ...taskGrounded } = grounded;
  return { ...taskGrounded, requirements };
}
const progressProperties = {
  summary: text,
  decisions: textList,
  completedWork: textList,
  evidencePaths: textList,
  openIssues: textList,
  blockers: textList,
  nextAction: text,
  checks: textList,
  sourcePaths: textList
};

export const TASK_TOOLS: Tool[] = [
  {
    name: 'hypersabmemory_scope_sources',
    description: 'Discover existing project scope documents with local content hashes. Returns paths and source status, not document contents.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'hypersabmemory_task_create',
    description: 'Create a durable task capsule from an explicit goal, constraints, acceptance criteria, and existing project source paths. No transcripts are stored.',
    inputSchema: {
      type: 'object',
      properties: {
        goal: nonemptyText,
        constraints: textList,
        acceptanceCriteria: { ...textList, minItems: 1 },
        sourceRefs: textList,
        nextAction: text
      },
      required: ['goal', 'acceptanceCriteria'],
      additionalProperties: false
    }
  },
  {
    name: 'hypersabmemory_task_claim',
    description: 'Acquire, renew, or release a durable task claim with a stable explicit agent ID. Default lease is 10 minutes; claims coordinate separate local processes.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: nonemptyText,
        agentId: nonemptyText,
        action: { type: 'string', enum: ['acquire', 'renew', 'release'] },
        leaseGeneration: { type: 'integer', minimum: 1 },
        leaseMinutes: { type: 'number', exclusiveMinimum: 0, maximum: 1440 }
      },
      required: ['taskId', 'agentId'],
      additionalProperties: false
    }
  },
  {
    name: 'hypersabmemory_task_checkpoint',
    description: 'Checkpoint owned work using the expected task revision. Stale revisions fail visibly. reported_complete requires local evidence paths and agent-reported check results; it is not independent verification. sourcePaths explicitly rebaselines sources after rereading them.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: nonemptyText,
        agentId: nonemptyText,
        expectedRevision: { type: 'integer', minimum: 0 },
        leaseGeneration: { type: 'integer', minimum: 1 },
        state: { type: 'string', enum: ['claimed', 'blocked', 'reported_complete'] },
        ...progressProperties
      },
      required: ['taskId', 'agentId', 'expectedRevision', 'leaseGeneration'],
      additionalProperties: false
    }
  },
  {
    name: 'hypersabmemory_task_grounded_query',
    description: 'Find candidate evidence from task source references and verify only explicitly supported deterministic claims. Source hashes and caller-declared conflicts are checked; lexical similarity is not proof. For a recorded cross-file constraint, ask: What constraint in `constraint.md` is recorded for the decision in `decision.md`? The decision source must contain a Decision line with an optional heading and adjacent Rationale line; the constraint source must contain a Decision-Source line naming the captured decision path followed by a Constraint line.',
    inputSchema: {
      type: 'object',
      properties: { taskId: nonemptyText, query: nonemptyText, conflictingPaths: textList },
      required: ['taskId', 'query'],
      additionalProperties: false
    }
  },
  {
    name: 'hypersabmemory_task_context',
    description: 'Restore a task capsule within 600 estimated tokens, compare source/evidence hashes, flag stale or unsupported claims, and return reread paths and the next action. Omit taskId to restore the sole active task, or pass a full taskId or unambiguous taskId prefix (>= 8 characters). Includes an agent-reported task snapshot and bounded source-recorded constraints with explicit links; task-to-source decision matches are exact text, not verified identity.',
    inputSchema: {
      type: 'object',
      properties: { taskId: nonemptyText },
      required: [],
      additionalProperties: false
    }
  }
];

export const TASK_LIST_RESOURCE = {
  uri: 'hypersabmemory://tasks',
  name: 'Active Tasks',
  description: 'Read-only metadata for ready, claimed, and blocked local tasks. Completion reporting is agent-reported, not independently verified.',
  mimeType: 'application/json'
};

interface TaskToolResult {
  [key: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
  structuredContent: Record<string, unknown>;
  isError?: boolean;
}

function result(payload: Record<string, unknown>, isError = false): TaskToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
    ...(isError ? { isError: true } : {})
  };
}

function input(name: string, raw: unknown): Record<string, unknown> {
  if (raw !== undefined && (typeof raw !== 'object' || raw === null || Array.isArray(raw))) {
    throw new TaskError('INVALID_ARGUMENT', 'arguments must be an object');
  }
  const args = (raw ?? {}) as Record<string, unknown>;
  const schema = TASK_TOOLS.find((tool) => tool.name === name)!.inputSchema;
  const allowed = Object.keys(schema.properties ?? {});
  for (const key of Object.keys(args)) {
    if (!allowed.includes(key)) throw new TaskError('INVALID_ARGUMENT', `unsupported argument: ${key}`);
  }
  return args;
}

function stringArg(args: Record<string, unknown>, key: string, required = false): string | undefined {
  const value = args[key];
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || (required && !value.trim())) {
    throw new TaskError('INVALID_ARGUMENT', `${key} must be ${required ? 'a non-empty' : 'a'} string`);
  }
  return value.trim();
}

function listArg(args: Record<string, unknown>, key: string, required = false): string[] | undefined {
  const value = args[key];
  if (value === undefined && !required) return undefined;
  if (!Array.isArray(value) || (required && value.length === 0) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new TaskError('INVALID_ARGUMENT', `${key} must be an array of non-empty strings`);
  }
  return value.map((item: string) => item.trim());
}

function taskMetadata(task: TaskRecord): Record<string, unknown> {
  return {
    taskId: task.id,
    revision: task.revision,
    leaseGeneration: task.leaseGeneration,
    state: task.state,
    ...(task.owner ? { owner: task.owner } : {}),
    ...(task.leaseExpiresAt ? { leaseExpiresAt: task.leaseExpiresAt } : {}),
    updatedAt: task.updatedAt
  };
}

export function listActiveTasks(ledger: TaskLedger): Record<string, unknown> {
  const tasks = ledger.list().filter((task) => task.state !== 'reported_complete')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  return {
    total: tasks.length,
    limit: 50,
    truncated: tasks.length > 50,
    tasks: tasks.slice(0, 50).map((task) => ({
      ...taskMetadata(task),
      goal: task.goal,
      nextAction: task.nextAction
    }))
  };
}

function resolveContextTask(ledger: TaskLedger, requestedTaskId?: string): TaskRecord {
  const tasks = ledger.list();
  if (!requestedTaskId) {
    const active = tasks.filter((task) => task.state !== 'reported_complete');
    if (active.length === 1) return active[0];
    if (active.length === 0) {
      throw new TaskError('TASK_NOT_FOUND', 'No active task was found.', { activeTasks: 0 });
    }
    throw new TaskError('TASK_ID_REQUIRED', 'Multiple active tasks exist; specify taskId.', {
      activeTaskIds: active.map((task) => task.id)
    });
  }
  const exact = tasks.find((task) => task.id === requestedTaskId);
  if (exact) return exact;
  if (requestedTaskId.length >= 8) {
    const matches = tasks.filter((task) => task.id.startsWith(requestedTaskId));
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      throw new TaskError('TASK_ID_AMBIGUOUS', `Task prefix ${requestedTaskId} matched multiple tasks.`, {
        taskId: requestedTaskId,
        matchingTaskIds: matches.map((task) => task.id)
      });
    }
  }
  return ledger.get(requestedTaskId);
}

export function executeTaskTool(
  workspaceDir: string,
  ledger: TaskLedger,
  name: string,
  raw: unknown
): TaskToolResult | undefined {
  if (!TASK_TOOLS.some((tool) => tool.name === name)) return undefined;
  try {
    const args = input(name, raw);
    if (name === 'hypersabmemory_scope_sources') {
      return result({ sources: discoverProjectSources(workspaceDir) });
    }
    if (name === 'hypersabmemory_task_create') {
      return result(taskMetadata(ledger.create({
        goal: stringArg(args, 'goal', true)!,
        acceptanceCriteria: listArg(args, 'acceptanceCriteria', true)!,
        constraints: listArg(args, 'constraints'),
        sourceRefs: listArg(args, 'sourceRefs'),
        nextAction: stringArg(args, 'nextAction')
      })));
    }
    if (name === 'hypersabmemory_task_context') {
      const requestedTaskId = stringArg(args, 'taskId', false);
      return result(taskAnswerBundle(workspaceDir, resolveContextTask(ledger, requestedTaskId)));
    }
    const taskId = stringArg(args, 'taskId', true)!;
    if (name === 'hypersabmemory_task_grounded_query') {
      const task = ledger.get(taskId);
      const sources = [...task.sourceRefs, ...task.evidenceRefs];
      const query = stringArg(args, 'query', true)!;
      const conflicts = listArg(args, 'conflictingPaths') ?? [];
      const crossFile = crossFileAnswer(workspaceDir, task, sources, query, conflicts);
      if (crossFile) return result(crossFile);
      if (isExplicitGroundedQuery(query)) {
        const hybrid = new HybridSearchEngine(workspaceDir);
        const grounded = searchGrounded(hybrid, workspaceDir, query, sources, conflicts);
        return result(finishGroundedQuery(query, grounded, hybrid, workspaceDir, sources));
      }
      const memory = new TemporalMemoryEngine(workspaceDir);
      const active = memory.getActive();
      const scope = new Set(sources.map(source => sourceKey(source.path)));
      const queryTerms = new Set(tokenizeSearchQuery(query));
      const indexed = new Map<string, Array<Set<string>>>();
      for (const record of active) {
        const keys = (record.artifacts ?? []).map(sourceKey).filter(key => scope.has(key));
        if (!keys.length) continue;
        const terms = new Set(tokenizeSearchText(recordSearchText(record)));
        for (const key of keys) indexed.set(key, [...(indexed.get(key) ?? []), terms]);
      }
      const seen = new Set<string>();
      const records: MemoryRecord[] = [];
      const stale: TaskSourceInspection[] = [];
      const inspect = createTaskSourceContentInspector(workspaceDir);
      for (const source of sources) {
        const key = sourceKey(source.path);
        if (seen.has(key)) continue;
        seen.add(key);
        const { content, ...inspection } = inspect([source])[0];
        if (inspection.status !== 'current' || !content) { stale.push(inspection); continue; }
        const excerpt = excerptFor(query, content.toString('utf8'), source.path) ?? '';
        const excerptTerms = [...new Set(tokenizeSearchText(excerpt).filter(term => queryTerms.has(term)))];
        if (indexed.get(key)?.some(terms => excerptTerms.every(term => terms.has(term)))) continue;
        records.push({ id: `source_ref:${source.path}`, category: 'general', content: excerpt, artifacts: [source.path], status: 'active', timestamp: new Date().toISOString() });
      }
      const hybrid = new HybridSearchEngine(workspaceDir, { getActive: () => [...memory.getActive(), ...records] });
      const grounded = searchGrounded(hybrid, workspaceDir, query, sources, conflicts);
      const reported = new Set(grounded.staleSources.map(source => sourceKey(source.path)));
      grounded.staleSources.push(...stale.filter(source => !reported.has(sourceKey(source.path))));
      if (grounded.status === 'INSUFFICIENT_EVIDENCE' && !grounded.evidence.length && grounded.staleSources.length) grounded.status = 'STALE_EVIDENCE';
      return result(finishGroundedQuery(query, grounded, hybrid, workspaceDir, sources));
    }
    const agentId = stringArg(args, 'agentId', true)!;
    if (name === 'hypersabmemory_task_claim') {
      const action = stringArg(args, 'action') ?? 'acquire';
      if (!['acquire', 'renew', 'release'].includes(action)) throw new TaskError('INVALID_ARGUMENT', 'invalid claim action');
      const leaseMinutes = args.leaseMinutes;
      if (leaseMinutes !== undefined && (typeof leaseMinutes !== 'number' || !Number.isFinite(leaseMinutes) || leaseMinutes <= 0 || leaseMinutes > 1440)) {
        throw new TaskError('INVALID_ARGUMENT', 'leaseMinutes must be a positive finite number no greater than 1440');
      }
      const leaseGeneration = args.leaseGeneration;
      if (action !== 'acquire' && (!Number.isSafeInteger(leaseGeneration) || (leaseGeneration as number) < 1)) throw new TaskError('INVALID_ARGUMENT', 'leaseGeneration is required for renewal and release');
      return result(taskMetadata(ledger.claim({ taskId, agentId, action: action as 'acquire' | 'renew' | 'release', leaseMinutes, leaseGeneration: leaseGeneration as number | undefined })));
    }
    const expectedRevision = args.expectedRevision;
    if (typeof expectedRevision !== 'number' || !Number.isInteger(expectedRevision) || expectedRevision < 0) {
      throw new TaskError('INVALID_ARGUMENT', 'expectedRevision must be a non-negative integer');
    }
    const state = stringArg(args, 'state');
    if (state !== undefined && !['claimed', 'blocked', 'reported_complete'].includes(state)) {
      throw new TaskError('INVALID_ARGUMENT', 'invalid checkpoint state');
    }
    return result(taskMetadata(ledger.checkpoint({
      taskId,
      agentId,
      expectedRevision,
      leaseGeneration: args.leaseGeneration as number,
      state: state as 'claimed' | 'blocked' | 'reported_complete' | undefined,
      summary: stringArg(args, 'summary'),
      decisions: listArg(args, 'decisions'),
      completedWork: listArg(args, 'completedWork'),
      evidencePaths: listArg(args, 'evidencePaths'),
      openIssues: listArg(args, 'openIssues'),
      blockers: listArg(args, 'blockers'),
      nextAction: stringArg(args, 'nextAction'),
      checks: listArg(args, 'checks'),
      sourcePaths: listArg(args, 'sourcePaths')
    })));
  } catch (error) {
    if (error instanceof TaskError) {
      const { currentTask: _currentTask, ...details } = error.details;
      return result({ error: { code: error.code, message: error.message, details } }, true);
    }
    return result({ error: { code: 'TASK_OPERATION_FAILED', message: error instanceof Error ? error.message : 'Task operation failed' } }, true);
  }
}
