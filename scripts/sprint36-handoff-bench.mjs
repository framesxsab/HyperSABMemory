import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const defaultWinNpm = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
const npmCli = process.env.HM32_NPM_CLI ?? process.env.npm_execpath ?? (fs.existsSync(defaultWinNpm) ? defaultWinNpm : undefined);
assert.ok(npmCli, 'Set HM32_NPM_CLI or run via npm so npm-cli.js can be resolved');

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return +sorted[index].toFixed(3);
}

function summarizeLatencies(samples) {
  const mean = samples.reduce((sum, x) => sum + x, 0) / Math.max(1, samples.length);
  return {
    n: samples.length,
    p50Ms: percentile(samples, 50),
    p95Ms: percentile(samples, 95),
    meanMs: +mean.toFixed(3)
  };
}

function estimateTokens(text) {
  return Math.ceil(Buffer.byteLength(text, 'utf8') / 4);
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hm36-handoff-bench-'));

try {
  execFileSync(process.execPath, [npmCli, 'pack', '--ignore-scripts', '--pack-destination', tempRoot], {
    cwd: repoRoot,
    stdio: 'pipe'
  });
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const tarball = path.join(tempRoot, `${manifest.name}-${manifest.version}.tgz`);
  const installDir = path.join(tempRoot, 'install');
  fs.mkdirSync(installDir);
  execFileSync(process.execPath, [npmCli, 'install', '--prefix', installDir, '--no-audit', '--no-fund', tarball], {
    cwd: tempRoot,
    stdio: 'pipe'
  });

  const installedRoot = path.join(installDir, 'node_modules', manifest.name, 'dist');
  const cliPath = path.join(installedRoot, 'cli', 'index.js');
  // Seed fixtures using repo dist so the parent process does not lock better_sqlite3.node inside tempRoot.
  const repoDist = path.join(repoRoot, 'dist');
  const { TemporalMemoryEngine } = await import(pathToFileURL(path.join(repoDist, 'memory', 'temporalMemory.js')).href);
  const { TaskLedger } = await import(pathToFileURL(path.join(repoDist, 'memory', 'taskLedger.js')).href);

  async function connectMcp(cwd) {
    const client = new Client({ name: 'sprint36-handoff-bench', version: '1.0.0' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [cliPath, 'mcp'],
      cwd,
      stderr: 'pipe'
    });
    await client.connect(transport);
    return client;
  }

  // ---------------------------------------------------------------------------
  // Part A: Live installed-package MCP task-selection & safety matrix (7 cases)
  // ---------------------------------------------------------------------------
  const matrixWs = path.join(tempRoot, 'matrix-ws');
  fs.mkdirSync(matrixWs);
  fs.writeFileSync(path.join(matrixWs, 'choice.md'), 'Decision: Keep invoices local.\nRationale: Avoid hosted processing.\n');
  fs.writeFileSync(path.join(matrixWs, 'rule.md'), 'Decision-Source: choice.md\nConstraint: Invoice data stays on device.\n');
  fs.writeFileSync(path.join(matrixWs, 'proof.txt'), 'verified\n');

  const matrixLedger = new TaskLedger(matrixWs);
  const doneTask = matrixLedger.create({ goal: 'Completed baseline', acceptanceCriteria: ['Done'], nextAction: 'Never select completed task' });
  const doneClaim = matrixLedger.claim({ taskId: doneTask.id, agentId: 'worker' });
  matrixLedger.checkpoint({
    taskId: doneTask.id,
    agentId: 'worker',
    expectedRevision: doneClaim.revision,
    leaseGeneration: doneClaim.leaseGeneration,
    state: 'reported_complete',
    evidencePaths: ['proof.txt'],
    checks: ['passed']
  });

  // 1) Zero active tasks (when only reported_complete exists) -> TASK_NOT_FOUND
  {
    const client = await connectMcp(matrixWs);
    try {
      const zero = await client.callTool({ name: 'hypersabmemory_task_context', arguments: {} });
      assert.equal(zero.isError, true);
      assert.equal(zero.structuredContent.error.code, 'TASK_NOT_FOUND');
    } finally { await client.close(); }
  }

  const activeTask = matrixLedger.create({
    goal: 'Review invoice locality rules',
    acceptanceCriteria: ['Keep invoices on device'],
    constraints: ['Never upload raw invoices'],
    sourceRefs: ['choice.md', 'rule.md'],
    decisions: ['Keep invoices local.'],
    nextAction: 'Audit invoice serializer'
  });
  const memory = new TemporalMemoryEngine(matrixWs);
  const activeMem = memory.remember('decision', 'Reuse StructuredMemory.artifacts for invoice storage notes.', [], { artifacts: ['choice.md'] });
  const forgottenMem = memory.remember('bug', 'forgotten secret bug comet36', [], { artifacts: ['rule.md'] });
  memory.forget(forgottenMem.id);

  // 2) Sole active task ({}, { compact: true }) + 3) prefix + 4) short/unknown prefix + 6) forgotten exclusion + 7) stale rewrite
  {
    const client = await connectMcp(matrixWs);
    try {
      const soleDefault = await client.callTool({ name: 'hypersabmemory_task_context', arguments: {} });
      assert.equal(soleDefault.isError ?? false, false);
      assert.equal(soleDefault.structuredContent.taskId, activeTask.id);
      assert.equal(soleDefault.structuredContent.answerBundle.relatedMemories.length, 1);
      assert.equal(soleDefault.structuredContent.answerBundle.relatedMemories[0].id, activeMem.id);
      assert.equal(JSON.stringify(soleDefault.structuredContent).includes('comet36'), false);

      const soleCompact = await client.callTool({ name: 'hypersabmemory_task_context', arguments: { compact: true } });
      assert.equal(soleCompact.isError ?? false, false);
      const cp = soleCompact.structuredContent;
      assert.equal(cp.compact, true);
      assert.equal(cp.taskId, activeTask.id);
      assert.equal(cp.nextAction, 'Audit invoice serializer');
      assert.deepEqual(cp.decisions, ['Keep invoices local.']);
      assert.equal(cp.decisionEvidence[0].rationale.text, 'Avoid hosted processing.');
      assert.equal(cp.linkedConstraints[0].constraint, 'Invoice data stays on device.');
      assert.equal(cp.relatedMemories[0].id, activeMem.id);
      assert.equal(cp.sources.length, 2);
      assert.equal(cp.decisionsStatus, 'reported_unverified');
      assert.equal(cp.attribution.task, 'agent_reported');
      assert.equal(cp.attribution.relatedMemories, 'recorded_memory');
      assert.ok(cp.limitation);
      assert.equal(JSON.stringify(cp).includes('comet36'), false);

      const prefixed = await client.callTool({
        name: 'hypersabmemory_task_context',
        arguments: { taskId: activeTask.id.slice(0, 13), compact: true }
      });
      assert.equal(prefixed.isError ?? false, false);
      assert.equal(prefixed.structuredContent.taskId, activeTask.id);

      const shortPrefix = await client.callTool({ name: 'hypersabmemory_task_context', arguments: { taskId: 'task_' } });
      assert.equal(shortPrefix.isError, true);
      assert.equal(shortPrefix.structuredContent.error.code, 'TASK_NOT_FOUND');

      const unknownPrefix = await client.callTool({ name: 'hypersabmemory_task_context', arguments: { taskId: 'task_deadbeef' } });
      assert.equal(unknownPrefix.isError, true);
      assert.equal(unknownPrefix.structuredContent.error.code, 'TASK_NOT_FOUND');

      // 7) Same-size stale rewrite detection
      fs.writeFileSync(path.join(matrixWs, 'choice.md'), 'Decision: Keep invoices l0cal.\nRationale: Avoid hosted processing.\n');
      const staleCompact = await client.callTool({ name: 'hypersabmemory_task_context', arguments: { compact: true } });
      assert.equal(staleCompact.isError ?? false, false);
      const sp = staleCompact.structuredContent;
      assert.equal(sp.decisionsStatus, 'historical_unverified');
      assert.equal(sp.decisionEvidence.length, 0);
      assert.equal(sp.linkedConstraints.length, 0);
      assert.equal(sp.relatedMemories.length, 0);
      assert.ok(sp.warnings.some(w => w.includes('choice.md: modified')));
      const staleSource = sp.sources.find(s => s.path === 'choice.md');
      assert.equal(staleSource.status, 'modified');
      assert.match(staleSource.currentSha256, /^[a-f0-9]{64}$/);
    } finally { await client.close(); }
  }

  // 5) Multiple active tasks -> TASK_ID_REQUIRED + ambiguous >= 8 prefix -> TASK_ID_AMBIGUOUS
  const secondTask = matrixLedger.create({ goal: 'Second active invoice check', acceptanceCriteria: ['Verify'] });
  const matrixTasksPath = path.join(matrixWs, '.hypersabmemory', 'tasks.json');
  fs.writeFileSync(
    matrixTasksPath,
    fs.readFileSync(matrixTasksPath, 'utf8')
      .replace(activeTask.id, `task_36abcdef${activeTask.id.slice(13)}`)
      .replace(secondTask.id, `task_36abcdef${secondTask.id.slice(13)}`)
  );
  {
    const client = await connectMcp(matrixWs);
    try {
      const multi = await client.callTool({ name: 'hypersabmemory_task_context', arguments: {} });
      assert.equal(multi.isError, true);
      assert.equal(multi.structuredContent.error.code, 'TASK_ID_REQUIRED');
      assert.equal(multi.structuredContent.error.details.activeTaskIds.length, 2);

      const ambig = await client.callTool({ name: 'hypersabmemory_task_context', arguments: { taskId: 'task_36abcdef' } });
      assert.equal(ambig.isError, true);
      assert.equal(ambig.structuredContent.error.code, 'TASK_ID_AMBIGUOUS');
      assert.equal(ambig.structuredContent.error.details.matchingTaskIds.length, 2);
    } finally { await client.close(); }
  }

  // ---------------------------------------------------------------------------
  // Part B: Paired alternating benchmarks on archived Sprint 3.5 tasks (N = 30)
  // ---------------------------------------------------------------------------
  const archiveTar = path.join(tempRoot, 'repo-head.tar');
  execFileSync('git', ['-c', 'core.autocrlf=false', 'archive', '--format=tar', '-o', archiveTar, 'HEAD'], {
    cwd: repoRoot,
    stdio: 'pipe'
  });

  const fixtureSpecs = [
    {
      name: 'watcher-provenance',
      goal: 'Continue V2 file-watcher provenance and user-memory protection',
      constraints: ['Preserve existing MemoryRecord keys for plain user remembers; never let auto file-event facts supersede user-confirmed or seeded facts.'],
      acceptanceCriteria: ['Watcher events carry source: auto and normalized artifacts; auto events cannot supersede user-confirmed or seeded records.'],
      decisions: ['Distinguish generated file-event observations with source: auto and workspace-relative artifacts rather than treating them as user-confirmed architecture.'],
      summary: 'Prior V2 research (docs/V2_RESEARCH_AND_SPRINT.md, 2026-10-21/26) deferred separating generated watcher events from user-confirmed facts; sqliteStore already defines source?: seed|auto|user.',
      nextAction: 'Add source: auto provenance and normalized artifact scoping to watcher events, and guard remember() supersession against displacing user-confirmed facts.',
      sourceRefs: ['Rules.md', 'PRD.md', 'Architecture.md', 'src/hooks/fileWatcher.ts', 'src/memory/temporalMemory.ts', 'src/memory/sqliteStore.ts'],
      query: 'V2 event provenance automatic file watcher source path non supersession handoff task',
      memories: [
        ['decision', '[2026-10-21 V2_RESEARCH_AND_SPRINT.md] Separate ephemeral workspace file events from durable user memories: attach source: "auto" and normalized workspace-relative artifacts, and never let file-event observations supersede user-confirmed architecture facts.', ['Rules.md', 'PRD.md', 'Architecture.md', 'src/hooks/fileWatcher.ts']],
        ['architecture', '[2026-10-26 V2_RESEARCH_AND_SPRINT.md] MemoryRecord.source reserves "seed" | "auto" | "user". Plain user remember() calls without explicit source stay backward-compatible with legacy keys; watcher events must never supersede user or seeded records sharing a 48-char prefix.', ['src/memory/sqliteStore.ts', 'src/memory/temporalMemory.ts']]
      ]
    },
    {
      name: 'linked-constraints',
      goal: 'Resume Sprint 2.9 grounding unification for Markdown decision and constraint documents',
      constraints: ['Keep prose conflict detection strict for duplicate prose lines; preserve task-role unresolved semantics and BOM/heading support.'],
      acceptanceCriteria: ['Task context restores formatted Markdown linked constraints; fenced or commented examples do not trigger false conflicts.'],
      decisions: ['Unify Markdown decision and linked-constraint verification on prose lines outside fenced code blocks and HTML comments.'],
      summary: 'Interrupted Sprint 2.9 unification (2026-11-18 session) moved crossFileAnswer onto claimVerification, leaving taskAnswerBundle on a two-line regex and raw-line conflict checks.',
      nextAction: 'Update task-context linked-constraint discovery and recorded-claim Decision/Constraint checks to scan prose lines only while keeping real prose conflicts strict.',
      sourceRefs: ['Architecture.md', 'Rules.md', 'src/mcp/taskTools.ts', 'src/memory/claimVerification.ts', 'src/memory/groundedSearch.ts', 'tests/taskAnswerBundle.test.ts'],
      query: 'Sprint 2.9 grounding unification linked constraint Markdown task ID',
      memories: [
        ['decision', '[2026-11-18 Sprint 2.9 session] Task-context linkedConstraints and grounded recorded-claim verification share the prose-line Markdown contract: strip UTF-8 BOM, ignore fenced code blocks and HTML comments via markdownProseLineIndices, and allow Markdown headings.', ['Architecture.md', 'src/mcp/taskTools.ts', 'src/memory/claimVerification.ts']],
        ['bug', '[2026-11-18 Sprint 2.9 session] Legacy CONSTRAINT_DOCUMENT in taskAnswerBundle drops BOM/headed/commented constraint files, while raw-line Decision:/Constraint: checks in claimVerification and groundedSearch misclassify fenced examples as conflicts. Keep genuine multiple prose lines as CONFLICTING_EVIDENCE.', ['src/mcp/taskTools.ts', 'src/memory/claimVerification.ts', 'src/memory/groundedSearch.ts']]
      ]
    }
  ];

  const ITERATIONS = 30;
  const benchmarks = [];

  for (const spec of fixtureSpecs) {
    const ws = path.join(tempRoot, 'bench-' + spec.name);
    fs.mkdirSync(ws);
    execFileSync('tar', ['-xf', archiveTar, '-C', ws], { stdio: 'pipe' });

    const mem = new TemporalMemoryEngine(ws);
    for (const [category, content, artifacts] of spec.memories) {
      mem.remember(category, content, [], { artifacts });
    }
    const ledger = new TaskLedger(ws);
    const created = ledger.create({
      goal: spec.goal,
      constraints: spec.constraints,
      acceptanceCriteria: spec.acceptanceCriteria,
      sourceRefs: spec.sourceRefs
    });
    const claimed = ledger.claim({ taskId: created.id, agentId: 'handoff-seed' });
    const saved = ledger.checkpoint({
      taskId: created.id,
      agentId: 'handoff-seed',
      expectedRevision: claimed.revision,
      leaseGeneration: claimed.leaseGeneration,
      summary: spec.summary,
      decisions: spec.decisions,
      nextAction: spec.nextAction
    });
    ledger.claim({ taskId: created.id, agentId: 'handoff-seed', action: 'release', leaseGeneration: saved.leaseGeneration });

    // Source read count audit via a short-lived child process importing the installed package.
    const auditScript = `
      import fs from 'node:fs';
      import fsDefault from 'node:fs';
      import { syncBuiltinESMExports } from 'node:module';
      import path from 'node:path';
      import { pathToFileURL } from 'node:url';
      const installedRoot = process.argv[1];
      const ws = process.argv[2];
      const spec = JSON.parse(process.argv[3]);
      const { TaskLedger } = await import(pathToFileURL(path.join(installedRoot, 'memory', 'taskLedger.js')).href);
      const { executeTaskTool } = await import(pathToFileURL(path.join(installedRoot, 'mcp', 'taskTools.js')).href);
      const { captureTaskSources } = await import(pathToFileURL(path.join(installedRoot, 'harness', 'taskSources.js')).href);
      const { HybridSearchEngine } = await import(pathToFileURL(path.join(installedRoot, 'memory', 'hybridSearch.js')).href);
      const { searchGrounded } = await import(pathToFileURL(path.join(installedRoot, 'memory', 'groundedSearch.js')).href);
      const tasksJsonPath = path.resolve(ws, '.hypersabmemory', 'tasks.json');
      const sourceAbsPaths = new Set(spec.sourceRefs.map(rel => path.resolve(ws, rel)));
      function countReads(fn) {
        let sourceReads = 0;
        const origRead = fs.readFileSync;
        const origDefaultRead = fsDefault.readFileSync;
        const counter = function (file, options) {
          const resolved = typeof file === 'string' ? path.resolve(file) : '';
          if (sourceAbsPaths.has(resolved)) sourceReads++;
          return origRead(file, options);
        };
        fs.readFileSync = counter;
        fsDefault.readFileSync = counter;
        syncBuiltinESMExports();
        try {
          fn();
          return { sourceReads };
        } finally {
          fs.readFileSync = origRead;
          fsDefault.readFileSync = origDefaultRead;
          syncBuiltinESMExports();
        }
      }
      const r1Reads = countReads(() => {
        const parsed = JSON.parse(fs.readFileSync(tasksJsonPath, 'utf8'));
        const taskId = parsed.tasks[0].id;
        searchGrounded(new HybridSearchEngine(ws), ws, spec.query, captureTaskSources(ws, spec.sourceRefs));
        executeTaskTool(ws, new TaskLedger(ws), 'hypersabmemory_task_context', { taskId });
      });
      const r2Reads = countReads(() => executeTaskTool(ws, new TaskLedger(ws), 'hypersabmemory_task_context', {}));
      const r3Reads = countReads(() => executeTaskTool(ws, new TaskLedger(ws), 'hypersabmemory_task_context', { compact: true }));
      console.log(JSON.stringify({ r1Reads, r2Reads, r3Reads }));
    `;
    const { r1Reads, r2Reads, r3Reads } = JSON.parse(execFileSync(
      process.execPath,
      ['--input-type=module', '-e', auditScript, installedRoot, ws, JSON.stringify({ query: spec.query, sourceRefs: spec.sourceRefs })],
      { encoding: 'utf8' }
    ).trim().split(/\r?\n/).at(-1));
    const tasksJsonPath = path.resolve(ws, '.hypersabmemory', 'tasks.json');

    const w1Latencies = [];
    const w2Latencies = [];
    const w3Latencies = [];
    let w1Bytes = 0, w2Bytes = 0, w3Bytes = 0;

    const client = await connectMcp(ws);
    try {
      // Warmup 1 cycle
      await client.callTool({ name: 'hypersabmemory_query_evidence', arguments: { query: spec.query } });
      await client.callTool({ name: 'hypersabmemory_task_context', arguments: { taskId: created.id } });
      await client.callTool({ name: 'hypersabmemory_task_context', arguments: {} });
      await client.callTool({ name: 'hypersabmemory_task_context', arguments: { compact: true } });

      for (let i = 0; i < ITERATIONS; i++) {
        const t1Start = performance.now();
        const tasksText = fs.readFileSync(tasksJsonPath, 'utf8');
        const resolvedId = JSON.parse(tasksText).tasks[0].id;
        const qRes = await client.callTool({ name: 'hypersabmemory_query_evidence', arguments: { query: spec.query } });
        const dRes = await client.callTool({ name: 'hypersabmemory_task_context', arguments: { taskId: resolvedId } });
        w1Latencies.push(performance.now() - t1Start);
        w1Bytes = Buffer.byteLength(qRes.content[0].text, 'utf8') + Buffer.byteLength(dRes.content[0].text, 'utf8');

        const t2Start = performance.now();
        const oRes = await client.callTool({ name: 'hypersabmemory_task_context', arguments: {} });
        w2Latencies.push(performance.now() - t2Start);
        w2Bytes = Buffer.byteLength(oRes.content[0].text, 'utf8');

        const t3Start = performance.now();
        const cRes = await client.callTool({ name: 'hypersabmemory_task_context', arguments: { compact: true } });
        w3Latencies.push(performance.now() - t3Start);
        w3Bytes = Buffer.byteLength(cRes.content[0].text, 'utf8');

        if (i === 0) {
          const compactObj = cRes.structuredContent;
          assert.equal(compactObj.compact, true);
          assert.equal(compactObj.taskId, created.id);
          assert.equal(compactObj.nextAction, spec.nextAction);
          assert.deepEqual(compactObj.decisions, spec.decisions);
          assert.deepEqual(compactObj.constraints, spec.constraints);
          assert.equal(compactObj.relatedMemories.length, spec.memories.length);
          assert.equal(compactObj.sources.length, spec.sourceRefs.length);
        }
      }
    } finally { await client.close(); }

    benchmarks.push({
      task: spec.name,
      workflows: {
        sprint35MultiStep: {
          mcpCalls: 2,
          ledgerShellReads: 1,
          sourceReadsInProcess: r1Reads.sourceReads,
          responseBytes: w1Bytes,
          estimatedResponseTokens: Math.ceil(w1Bytes / 4),
          latency: summarizeLatencies(w1Latencies)
        },
        sprint36OneCallDefault: {
          mcpCalls: 1,
          ledgerShellReads: 0,
          sourceReadsInProcess: r2Reads.sourceReads,
          responseBytes: w2Bytes,
          estimatedResponseTokens: Math.ceil(w2Bytes / 4),
          latency: summarizeLatencies(w2Latencies)
        },
        sprint36OneCallCompact: {
          mcpCalls: 1,
          ledgerShellReads: 0,
          sourceReadsInProcess: r3Reads.sourceReads,
          responseBytes: w3Bytes,
          estimatedResponseTokens: Math.ceil(w3Bytes / 4),
          bytesSavedVsMultiStep: w1Bytes - w3Bytes,
          bytesSavedPctVsMultiStep: +(((w1Bytes - w3Bytes) / w1Bytes) * 100).toFixed(1),
          bytesSavedVsDefault: w2Bytes - w3Bytes,
          latency: summarizeLatencies(w3Latencies)
        }
      }
    });
  }

  console.log(JSON.stringify({
    installedPackage: `${manifest.name}@${manifest.version}`,
    matrixPassed: true,
    matrixChecks: [
      'zero_active_tasks -> TASK_NOT_FOUND',
      'completed_task_never_auto_selected',
      'sole_active_task_default_and_compact',
      'prefix_8_plus_resolved_short_or_unknown_rejected',
      'multiple_active_tasks -> TASK_ID_REQUIRED & TASK_ID_AMBIGUOUS',
      'forgotten_memories_excluded',
      'same_size_stale_rewrite_flagged_and_evicted'
    ],
    benchmarks
  }, null, 2));
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
