import { it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import fsDefault from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';
import { TaskLedger } from '../src/memory/taskLedger.js';
import { executeTaskTool } from '../src/mcp/taskTools.js';
import { SqliteStore } from '../src/memory/sqliteStore.js';
import { TemporalMemoryEngine } from '../src/memory/temporalMemory.js';
import { matchesTargetFile } from './testUtils.js';

it('restores recorded task facts and explicit linked evidence without a filename-specific question', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-answer-bundle-'));
  try {
    fs.writeFileSync(path.join(dir, 'choice.md'), 'Decision: Keep invoices local.\nRationale: Avoid hosted processing.\n');
    fs.writeFileSync(path.join(dir, 'rule.md'), 'Decision-Source: choice.md\nConstraint: Invoice data stays on device.\n');
    fs.writeFileSync(path.join(dir, 'unrelated.md'), 'Constraint: Invoice data moves elsewhere.\n');
    const ledger = new TaskLedger(dir);
    const task = ledger.create({ goal: 'Review invoice storage', acceptanceCriteria: ['Preserve local storage'], constraints: ['Avoid hosted services'], sourceRefs: ['choice.md', 'rule.md', 'unrelated.md'] });
    const claimed = ledger.claim({ taskId: task.id, agentId: 'worker' });
    ledger.checkpoint({ taskId: task.id, agentId: 'worker', expectedRevision: claimed.revision, leaseGeneration: claimed.leaseGeneration, decisions: ['Keep invoices local.'], completedWork: ['Recorded the decision'], nextAction: 'Review invoice tests' });
    const memory = new TemporalMemoryEngine(dir);
    const forgotten = memory.remember('general', 'forgotten cometmarker', [], { artifacts: ['rule.md'] });
    memory.forget(forgotten.id);
    const context = executeTaskTool(dir, ledger, 'hypersabmemory_task_context', { taskId: task.id })!.structuredContent;
    expect(JSON.stringify(context)).not.toContain('cometmarker');
    expect(context).toMatchObject({ decisionEvidence: [{ decision: 'Keep invoices local.', sourcePath: 'choice.md', sha256: task.sourceRefs[0].sha256, line: 1, rationale: { text: 'Avoid hosted processing.', line: 2 } }], answerBundle: { recordedTask: { constraints: ['Avoid hosted services'], decisions: ['Keep invoices local.'], nextAction: 'Review invoice tests', attribution: 'agent_reported', provenance: { taskId: task.id, revision: 3, path: '.hypersabmemory/tasks.json' } }, linkedConstraints: [{ decision: 'Keep invoices local.', constraint: 'Invoice data stays on device.', attribution: 'source_recorded', sources: [{ path: 'choice.md', sha256: task.sourceRefs[0].sha256, line: 1, excerpt: 'Decision: Keep invoices local.' }, { path: 'rule.md', sha256: task.sourceRefs[1].sha256, line: 1, excerpt: 'Decision-Source: choice.md' }, { path: 'rule.md', sha256: task.sourceRefs[1].sha256, line: 2, excerpt: 'Constraint: Invoice data stays on device.' }] }] } });
    const unknown = executeTaskTool(dir, ledger, 'hypersabmemory_task_grounded_query', { taskId: task.id, query: 'What is the encryption key?' })!.structuredContent;
    expect(unknown).toMatchObject({ canAssert: false, assertions: [] });
    const unrecorded = ledger.create({ goal: 'Review storage', acceptanceCriteria: ['Inspect'], sourceRefs: ['choice.md', 'rule.md'] });
    expect(executeTaskTool(dir, ledger, 'hypersabmemory_task_context', { taskId: unrecorded.id })!.structuredContent).toMatchObject({ answerBundle: { linkedConstraints: [] } });
    fs.writeFileSync(path.join(dir, 'rule.md'), 'Decision-Source: choice.md\nConstraint: Invoice data stays on devicE.\n');
    const stale = executeTaskTool(dir, ledger, 'hypersabmemory_task_context', { taskId: task.id })!.structuredContent;
    expect(stale).toMatchObject({ answerBundle: { linkedConstraints: [] }, sources: expect.arrayContaining([expect.objectContaining({ path: 'rule.md', status: 'modified' })]) });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

it('discovers different task sources while refusing an unlinked constraint', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-answer-other-'));
  try {
    fs.writeFileSync(path.join(dir, 'queue.md'), 'Decision: Use ordered delivery.\nRationale: Retain message order.\n');
    fs.writeFileSync(path.join(dir, 'policy.md'), 'Constraint: Messages remain ordered.\n');
    const ledger = new TaskLedger(dir);
    const task = ledger.create({ goal: 'Review queues', acceptanceCriteria: ['Check ordering'], sourceRefs: ['queue.md', 'policy.md'], decisions: ['Use ordered delivery.'], nextAction: 'Inspect the queue' });
    const response = executeTaskTool(dir, ledger, 'hypersabmemory_task_context', { taskId: task.id })!.structuredContent;
    expect(response).toMatchObject({ answerBundle: { recordedTask: { provenance: { taskId: task.id }, nextAction: 'Inspect the queue' }, linkedConstraints: [] } });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

it('bounds returned relationships and reports omitted links', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-answer-bound-'));
  try {
    fs.writeFileSync(path.join(dir, 'choice.md'), 'Decision: Keep data local.\n');
    const files = Array.from({ length: 6 }, (_, index) => `rule${index}.md`);
    for (const [index, name] of files.entries()) fs.writeFileSync(path.join(dir, name), `Decision-Source: choice.md\nConstraint: Keep item ${index} local.\n`);
    const ledger = new TaskLedger(dir);
    const task = ledger.create({ goal: 'Check locality', acceptanceCriteria: ['Inspect rules'], sourceRefs: ['choice.md', ...files], decisions: ['Keep data local.'] });
    const response = executeTaskTool(dir, ledger, 'hypersabmemory_task_context', { taskId: task.id })!.structuredContent as { answerBundle: { linkedConstraints: unknown[]; truncated: boolean } };
    expect(response.answerBundle.linkedConstraints.length).toBeLessThanOrEqual(5);
    expect(response.answerBundle.linkedConstraints.length).toBeGreaterThan(0);
    expect(response.answerBundle.truncated).toBe(true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

it('removes a relationship if its supporting source changes during restoration', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-answer-race-'));
  try {
    fs.writeFileSync(path.join(dir, 'choice.md'), 'Decision: Keep invoices local.\n');
    const file = path.join(dir, 'rule.md');
    const original = 'Decision-Source: choice.md\nConstraint: Invoice data stays local.\n';
    fs.writeFileSync(file, original);
    const ledger = new TaskLedger(dir);
    const task = ledger.create({ goal: 'Review storage', acceptanceCriteria: ['Check locality'], sourceRefs: ['choice.md', 'rule.md'], decisions: ['Keep invoices local.'] });
    const read = fs.readFileSync;
    let reads = 0;
    vi.spyOn(fsDefault, 'readFileSync').mockImplementation(((name: fs.PathOrFileDescriptor, options?: unknown) => {
      const value = read(name, options as never);
      if (matchesTargetFile(name, file) && ++reads === 3) fs.writeFileSync(file, original.replace('local', 'other'));
      return value;
    }) as typeof fs.readFileSync);
    syncBuiltinESMExports();
    const result = executeTaskTool(dir, ledger, 'hypersabmemory_task_context', { taskId: task.id })!.structuredContent;
    expect(reads).toBeGreaterThanOrEqual(3);
    expect(result).toMatchObject({ answerBundle: { linkedConstraints: [] }, sources: expect.arrayContaining([expect.objectContaining({ path: 'rule.md', status: 'modified' })]) });
  } finally { vi.restoreAllMocks(); syncBuiltinESMExports(); fs.rmSync(dir, { recursive: true, force: true }); }
});


it('restores linked evidence while avoiding a redundant read of unrelated captured sources', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-answer-reads-'));
  try {
    fs.writeFileSync(path.join(dir, 'choice.md'), 'Decision: Keep invoices local.\n');
    fs.writeFileSync(path.join(dir, 'rule.md'), 'Decision-Source: choice.md\nConstraint: Keep data local.\n');
    const other = path.join(dir, 'other.md');
    fs.writeFileSync(other, 'Unrelated notes.\n');
    const ledger = new TaskLedger(dir);
    const task = ledger.create({ goal: 'Review storage', acceptanceCriteria: ['Check locality'], sourceRefs: ['choice.md', 'rule.md', 'other.md'], decisions: ['Keep invoices local.'] });
    const read = fs.readFileSync;
    let reads = 0;
    vi.spyOn(fsDefault, 'readFileSync').mockImplementation(((name: fs.PathOrFileDescriptor, options?: unknown) => {
      if (matchesTargetFile(name, other)) reads++;
      return read(name, options as never);
    }) as typeof fs.readFileSync);
    syncBuiltinESMExports();
    const result = executeTaskTool(dir, ledger, 'hypersabmemory_task_context', { taskId: task.id })!.structuredContent;
    expect(result).toMatchObject({ answerBundle: { linkedConstraints: [{ constraint: 'Keep data local.' }] } });
    expect(reads).toBe(2);
  } finally { vi.restoreAllMocks(); syncBuiltinESMExports(); fs.rmSync(dir, { recursive: true, force: true }); }
});

it('restores the sole active task without taskId, resolves an unambiguous prefix, and fails closed when ambiguous', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-answer-resolve-'));
  try {
    fs.writeFileSync(path.join(dir, 'choice.md'), 'Decision: Keep invoices local.\n');
    fs.writeFileSync(path.join(dir, 'proof.txt'), 'verified\n');
    const ledger = new TaskLedger(dir);
    expect(executeTaskTool(dir, ledger, 'hypersabmemory_task_context', {})).toMatchObject({
      isError: true,
      structuredContent: { error: { code: 'TASK_NOT_FOUND' } }
    });
    const done = ledger.create({ goal: 'Finished work', acceptanceCriteria: ['Done'] });
    const doneClaim = ledger.claim({ taskId: done.id, agentId: 'a' });
    ledger.checkpoint({ taskId: done.id, agentId: 'a', expectedRevision: doneClaim.revision, leaseGeneration: doneClaim.leaseGeneration, state: 'reported_complete', evidencePaths: ['proof.txt'], checks: ['passed'] });

    const task = ledger.create({ goal: 'Active work', acceptanceCriteria: ['Verify'], sourceRefs: ['choice.md'], nextAction: 'Inspect choice.md' });
    expect(executeTaskTool(dir, ledger, 'hypersabmemory_task_context', {})!.structuredContent).toMatchObject({
      taskId: task.id,
      answerBundle: { recordedTask: { nextAction: 'Inspect choice.md' } }
    });
    expect(executeTaskTool(dir, ledger, 'hypersabmemory_task_context', { taskId: task.id.slice(0, 13) })!.structuredContent).toMatchObject({
      taskId: task.id
    });
    const second = ledger.create({ goal: 'Second active work', acceptanceCriteria: ['Compare'] });
    expect(executeTaskTool(dir, ledger, 'hypersabmemory_task_context', {})).toMatchObject({
      isError: true,
      structuredContent: {
        error: {
          code: 'TASK_ID_REQUIRED',
          details: { activeTaskIds: [task.id, second.id] }
        }
      }
    });
    expect(executeTaskTool(dir, ledger, 'hypersabmemory_task_context', { taskId: 'task_' })).toMatchObject({
      isError: true,
      structuredContent: {
        error: {
          code: 'TASK_NOT_FOUND',
          details: { taskId: 'task_' }
        }
      }
    });
    const tasksFile = path.join(dir, '.hypersabmemory', 'tasks.json');
    fs.writeFileSync(
      tasksFile,
      fs.readFileSync(tasksFile, 'utf8')
        .replace(task.id, `task_aaaaaaaa${task.id.slice(13)}`)
        .replace(second.id, `task_aaaaaaaa${second.id.slice(13)}`)
    );
    expect(executeTaskTool(dir, ledger, 'hypersabmemory_task_context', { taskId: 'task_aaaaaaaa' })).toMatchObject({
      isError: true,
      structuredContent: {
        error: {
          code: 'TASK_ID_AMBIGUOUS',
          details: {
            taskId: 'task_aaaaaaaa',
            matchingTaskIds: [`task_aaaaaaaa${task.id.slice(13)}`, `task_aaaaaaaa${second.id.slice(13)}`]
          }
        }
      }
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

it('delivers task-linked active memories and a compact one-call handoff projection while preserving freshness and forgetting guarantees', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-answer-compact-'));
  try {
    const choiceText = 'Decision: Keep invoices local.\nRationale: Avoid hosted processing.\n';
    const ruleText = 'Decision-Source: choice.md\nConstraint: Invoice data stays on device.\n';
    fs.writeFileSync(path.join(dir, 'choice.md'), choiceText);
    fs.writeFileSync(path.join(dir, 'rule.md'), ruleText);
    const ledger = new TaskLedger(dir);
    const task = ledger.create({
      goal: 'Review invoice storage',
      acceptanceCriteria: ['Preserve local storage'],
      constraints: ['Avoid hosted services'],
      sourceRefs: ['choice.md', 'rule.md'],
      decisions: ['Keep invoices local.'],
      nextAction: 'Update invoice persistence guard'
    });
    const memory = new TemporalMemoryEngine(dir);
    const decisionMem = memory.remember('decision', 'Reuse StructuredMemory.artifacts rather than adding new fields.', [], { artifacts: ['choice.md'] });
    const forgottenMem = memory.remember('bug', 'forgotten cometmarker bug note', [], { artifacts: ['rule.md'] });
    memory.forget(forgottenMem.id);
    new SqliteStore(path.join(dir, '.hypersabmemory')).set({
      id: 'auto_watcher_choice',
      category: 'architecture',
      content: 'Automatic watcher observation on choice.md',
      artifacts: ['choice.md'],
      source: 'auto'
    });
    memory.remember('architecture', 'File change: choice.md', [], { artifacts: ['choice.md'] });
    memory.remember('decision', 'Unrelated decision on other.md', [], { artifacts: ['other.md'] });

    const defaultCall = executeTaskTool(dir, ledger, 'hypersabmemory_task_context', {})!;
    const compactCall = executeTaskTool(dir, ledger, 'hypersabmemory_task_context', { compact: true })!;
    const defaultPayload = defaultCall.structuredContent as Record<string, unknown> & {
      answerBundle: { relatedMemories: Array<{ id: string; statement: string; attribution: string }> };
    };
    const compactPayload = compactCall.structuredContent as Record<string, unknown> & {
      relatedMemories: Array<{ id: string; category: string; statement: string; matchedSources: string[] }>;
      sources: Array<Record<string, unknown>>;
    };

    expect(defaultPayload.answerBundle.relatedMemories).toEqual([
      expect.objectContaining({
        id: decisionMem.id,
        category: 'decision',
        statement: 'Reuse StructuredMemory.artifacts rather than adding new fields.',
        matchedSources: ['choice.md'],
        attribution: 'recorded_memory'
      })
    ]);
    expect(compactPayload).toMatchObject({
      compact: true,
      taskId: task.id,
      nextAction: 'Update invoice persistence guard',
      decisions: ['Keep invoices local.'],
      decisionsStatus: 'reported_unverified',
      decisionEvidence: [{ decision: 'Keep invoices local.', sourcePath: 'choice.md', line: 1, rationale: { text: 'Avoid hosted processing.', line: 2 } }],
      linkedConstraints: [{ decision: 'Keep invoices local.', constraint: 'Invoice data stays on device.', sources: ['choice.md:1', 'rule.md:1', 'rule.md:2'] }],
      relatedMemories: defaultPayload.answerBundle.relatedMemories.map(({ attribution: _attribution, ...rest }) => rest),
      attribution: {
        task: 'agent_reported',
        decisionEvidence: 'source_recorded',
        linkedConstraints: 'source_recorded',
        relatedMemories: 'recorded_memory'
      }
    });
    expect(compactPayload).not.toHaveProperty('capsule');
    expect(compactPayload.sources.every((item) => typeof item.sha256 === 'string' && (item.sha256 as string).length === 64 && !('currentSha256' in item))).toBe(true);
    const defaultJson = JSON.stringify(defaultPayload);
    const compactJson = JSON.stringify(compactPayload);
    expect(defaultJson).not.toContain('cometmarker');
    expect(compactJson).not.toContain('cometmarker');
    expect(compactJson.length).toBeLessThan(defaultJson.length);

    expect(executeTaskTool(dir, ledger, 'hypersabmemory_task_context', { compact: 'yes' })).toMatchObject({
      isError: true,
      structuredContent: { error: { code: 'INVALID_ARGUMENT' } }
    });

    // Same-size rewrite on choice.md drops stale decisionEvidence, linkedConstraints, and relatedMemories for that source.
    fs.writeFileSync(path.join(dir, 'choice.md'), choiceText.replace('local.', 'l0cal.'));
    const staleDefault = executeTaskTool(dir, ledger, 'hypersabmemory_task_context', {})!.structuredContent as Record<string, unknown>;
    const staleCompact = executeTaskTool(dir, ledger, 'hypersabmemory_task_context', { compact: true })!.structuredContent as Record<string, unknown>;
    for (const payload of [staleDefault, staleCompact]) {
      expect(payload).toMatchObject({
        decisionsStatus: 'historical_unverified',
        decisionEvidence: [],
        sources: expect.arrayContaining([
          expect.objectContaining({ path: 'choice.md', status: 'modified', currentSha256: expect.stringMatching(/^[a-f0-9]{64}$/) })
        ])
      });
      expect((payload.warnings as string[]).some((warning) => warning.includes('choice.md: modified'))).toBe(true);
    }
    expect((staleDefault.answerBundle as { linkedConstraints: unknown[]; relatedMemories: unknown[] }).linkedConstraints).toEqual([]);
    expect((staleDefault.answerBundle as { linkedConstraints: unknown[]; relatedMemories: unknown[] }).relatedMemories).toEqual([]);
    expect(staleCompact.linkedConstraints).toEqual([]);
    expect(staleCompact.relatedMemories).toEqual([]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

it('achieves >= 50% UTF-8 byte reduction on the Gate 5.1 3-source fixture while preserving complete semantic equivalence', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-answer-g51-compact-'));
  try {
    const key = 'p-queue';
    const readmeFile = 'readme.md';
    const decFile = `g51-lat-${key}-dec.md`;
    const conFile = `g51-lat-${key}-con.md`;
    fs.writeFileSync(path.join(dir, readmeFile), '# p-queue\nPromise queue with concurrency control.\n');
    fs.writeFileSync(path.join(dir, decFile), `Decision: Keep ${key} handoff snapshots deterministic and hash-checked.\nRationale: Prevent stale context assumptions across agent restarts.\n`);
    fs.writeFileSync(path.join(dir, conFile), `Decision-Source: ${decFile}\nConstraint: Verify all referenced files against current SHA-256 checksums before emitting decisions.\n`);

    const mem = new TemporalMemoryEngine(dir);
    mem.remember('decision', `Keep ${key} handoff snapshots deterministic and hash-checked across restarts.`, [], {
      artifacts: [readmeFile, decFile, conFile]
    });

    const ledger = new TaskLedger(dir);
    const created = ledger.create({
      goal: `Benchmark compact handoff on ${key}`,
      constraints: [
        'Verify all referenced files against current SHA-256 checksums before emitting decisions.',
        'Preserve existing baseline test guarantees without regressions.'
      ],
      acceptanceCriteria: ['Compact handoff preserves goal, decisions, constraints, and verified sources'],
      sourceRefs: [readmeFile, decFile, conFile],
      nextAction: `Resume ${key} audit and run baseline tests.`
    });
    const claimed = ledger.claim({ taskId: created.id, agentId: 'lat-seed' });
    const checkpointed = ledger.checkpoint({
      taskId: created.id,
      agentId: 'lat-seed',
      expectedRevision: claimed.revision,
      leaseGeneration: claimed.leaseGeneration,
      summary: `Captured architectural constraints and source refs for ${key}.`,
      decisions: [`Keep ${key} handoff snapshots deterministic and hash-checked.`],
      completedWork: ['Indexed repository sources', 'Verified decision-constraint Markdown pair'],
      nextAction: `Implement requested extension in ${key} and verify tests.`
    });
    ledger.claim({ taskId: created.id, agentId: 'lat-seed', action: 'release', leaseGeneration: checkpointed.leaseGeneration });

    const fullCall = executeTaskTool(dir, ledger, 'hypersabmemory_task_context', { compact: false })!;
    const compactCall = executeTaskTool(dir, ledger, 'hypersabmemory_task_context', { compact: true })!;
    const fullText = fullCall.content[0].text;
    const compactText = compactCall.content[0].text;
    const fullJson = JSON.parse(fullText) as any;
    const cJson = JSON.parse(compactText) as any;

    expect(cJson).toEqual(compactCall.structuredContent);

    // Byte reduction checks: wire UTF-8 (content[0].text vs full), same-format pretty, and same-format minified
    const fullBytes = Buffer.byteLength(fullText, 'utf8');
    const compactWireBytes = Buffer.byteLength(compactText, 'utf8');
    const fullMinBytes = Buffer.byteLength(JSON.stringify(fullJson), 'utf8');
    const compactMinBytes = Buffer.byteLength(JSON.stringify(cJson), 'utf8');
    const compactPrettyBytes = Buffer.byteLength(JSON.stringify(cJson, null, 2), 'utf8');

    expect((fullBytes - compactWireBytes) / fullBytes).toBeGreaterThanOrEqual(0.5);
    expect((fullBytes - compactPrettyBytes) / fullBytes).toBeGreaterThanOrEqual(0.5);
    expect((fullMinBytes - compactMinBytes) / fullMinBytes).toBeGreaterThanOrEqual(0.5);

    // Complete 1:1 semantic equivalence across every required task context field
    const rec = fullJson.answerBundle.recordedTask;
    expect(cJson.compact).toBe(true);
    expect(cJson.taskId).toBe(fullJson.taskId);
    expect(cJson.revision).toBe(fullJson.revision);
    expect(cJson.state).toBe(fullJson.state);
    expect(cJson.lease).toMatchObject({
      status: fullJson.lease.status,
      generation: fullJson.lease.generation
    });
    expect(cJson.goal).toBe(rec.goal);
    expect(cJson.nextAction).toBe(rec.nextAction);
    expect(cJson.summary ?? null).toBe(rec.summary);
    expect(cJson.completedWork ?? []).toEqual(rec.completedWork);
    expect(cJson.openIssues ?? []).toEqual(rec.openIssues);
    expect(cJson.blockers ?? []).toEqual(rec.blockers);
    expect(cJson.checks ?? []).toEqual(rec.checks);
    expect(cJson.constraints).toEqual(rec.constraints);
    expect(cJson.acceptanceCriteria).toEqual(rec.acceptanceCriteria);
    expect(cJson.decisions).toEqual(rec.decisions);
    expect(cJson.decisionsStatus).toBe(fullJson.decisionsStatus);

    // Source references preserve full 64-hex SHA-256 and freshness
    const shaByPath = new Map<string, string>(cJson.sources.map((s: any) => [s.path, s.sha256]));
    expect(cJson.sources.map((s: any) => ({ path: s.path, sha256: s.sha256, status: s.status }))).toEqual(
      fullJson.sources.map((s: any) => ({ path: s.path, sha256: s.sha256, status: s.status }))
    );
    expect(cJson.sources.every((s: any) => /^[a-f0-9]{64}$/.test(s.sha256))).toBe(true);

    // decisionEvidence recovers full sha256, excerpt, and rationale.excerpt
    expect(cJson.decisionEvidence).toHaveLength(fullJson.decisionEvidence.length);
    for (let i = 0; i < fullJson.decisionEvidence.length; i++) {
      const fDec = fullJson.decisionEvidence[i];
      const cDec = cJson.decisionEvidence[i];
      expect(cDec.decision).toBe(fDec.decision);
      expect(cDec.sourcePath).toBe(fDec.sourcePath);
      expect(cDec.line).toBe(fDec.line);
      expect(shaByPath.get(cDec.sourcePath)).toBe(fDec.sha256);
      expect(`Decision: ${cDec.decision}`).toBe(fDec.excerpt);
      if (fDec.rationale) {
        expect(cDec.rationale.text).toBe(fDec.rationale.text);
        expect(cDec.rationale.line).toBe(fDec.rationale.line);
        expect(`Rationale: ${cDec.rationale.text}`).toBe(fDec.rationale.excerpt);
      }
    }

    // linkedConstraints recovers decision, constraint, and all source path:line + sha256 references
    expect(cJson.linkedConstraints).toHaveLength(fullJson.answerBundle.linkedConstraints.length);
    for (let i = 0; i < fullJson.answerBundle.linkedConstraints.length; i++) {
      const fLink = fullJson.answerBundle.linkedConstraints[i];
      const cLink = cJson.linkedConstraints[i];
      expect(cLink.decision).toBe(fLink.decision);
      expect(cLink.constraint).toBe(fLink.constraint);
      expect(cLink.sources).toHaveLength(fLink.sources.length);
      for (let j = 0; j < fLink.sources.length; j++) {
        const match = String(cLink.sources[j]).match(/^(.*):(\d+)$/);
        expect(match).not.toBeNull();
        expect(match![1]).toBe(fLink.sources[j].path);
        expect(Number(match![2])).toBe(fLink.sources[j].line);
        expect(shaByPath.get(match![1])).toBe(fLink.sources[j].sha256);
      }
    }

    // relatedMemories recovers id, category, statement, matchedSources, and top-level attribution
    expect(cJson.relatedMemories).toHaveLength(fullJson.answerBundle.relatedMemories.length);
    for (let i = 0; i < fullJson.answerBundle.relatedMemories.length; i++) {
      const fMem = fullJson.answerBundle.relatedMemories[i];
      const cMem = cJson.relatedMemories[i];
      expect({ ...cMem, attribution: cJson.attribution.relatedMemories }).toEqual(fMem);
    }

    expect(cJson.reread).toEqual(fullJson.reread);
    expect(cJson.warnings ?? []).toEqual(fullJson.warnings);
    expect(cJson.conflicts ?? []).toEqual(fullJson.conflicts);
    expect(cJson.unsupportedAssumptions ?? []).toEqual(fullJson.unsupportedAssumptions);
    expect(cJson.attribution).toEqual({
      task: 'agent_reported',
      decisionEvidence: 'source_recorded',
      linkedConstraints: 'source_recorded',
      relatedMemories: 'recorded_memory'
    });
    expect(typeof cJson.limitation).toBe('string');
    expect(cJson.limitation.length).toBeGreaterThan(20);

    // Also verify active-lease owner/expiry + openIssues/blockers/checks preservation in compact mode
    const reClaimed = ledger.claim({ taskId: created.id, agentId: 'worker-2', leaseMinutes: 15 });
    ledger.checkpoint({
      taskId: created.id,
      agentId: 'worker-2',
      expectedRevision: reClaimed.revision,
      leaseGeneration: reClaimed.leaseGeneration,
      openIssues: ['Check retry edge case'],
      checks: ['tsc --noEmit pass']
    });
    const activeFull = executeTaskTool(dir, ledger, 'hypersabmemory_task_context', { compact: false })!.structuredContent as any;
    const activeCompact = executeTaskTool(dir, ledger, 'hypersabmemory_task_context', { compact: true })!.structuredContent as any;
    expect(activeCompact.lease).toEqual({
      status: 'active',
      generation: reClaimed.leaseGeneration,
      recordedOwner: 'worker-2',
      expiresAt: reClaimed.leaseExpiresAt
    });
    expect(activeCompact.openIssues).toEqual(activeFull.answerBundle.recordedTask.openIssues);
    expect(activeCompact.checks).toEqual(activeFull.answerBundle.recordedTask.checks);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
