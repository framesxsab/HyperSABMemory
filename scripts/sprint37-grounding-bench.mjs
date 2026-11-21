import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  rmdirSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baselineRef = '7ddba87';
const repetitions = 3;

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, value) => acc + value, 0);
  return {
    samples: sorted.length,
    p50: +percentile(sorted, 0.5).toFixed(2),
    p95: +percentile(sorted, 0.95).toFixed(2),
    mean: +(sum / Math.max(1, sorted.length)).toFixed(2),
    min: +(sorted[0] ?? 0).toFixed(2),
    max: +(sorted[sorted.length - 1] ?? 0).toFixed(2)
  };
}

function buildFrozenCorpus(repoDir, targetDir) {
  const tracked = execFileSync('git', ['ls-files', '--', 'README.md', 'src', 'tests', 'docs'], {
    cwd: repoDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  })
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\\/g, '/'))
    .filter((line) => line.length > 0 && /\.(md|ts)$/.test(line))
    .sort();
  for (const rel of tracked) {
    const dest = path.join(targetDir, rel);
    mkdirSync(path.dirname(dest), { recursive: true });
    copyFileSync(path.join(repoDir, rel), dest);
  }
  return tracked;
}

const probeRunnerScript = `
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import * as fs from 'node:fs';

const distDir = process.env.HM_DIST_DIR;
const workspaceDir = process.env.HM_WORKSPACE_DIR;
const mode = process.env.HM_MODE || 'bench';

const { HELD_OUT } = await import(pathToFileURL(path.join(distDir, 'eval', 'repositoryTaskFixture.js')).href);
const { TemporalMemoryEngine } = await import(pathToFileURL(path.join(distDir, 'memory', 'temporalMemory.js')).href);
const { HybridSearchEngine } = await import(pathToFileURL(path.join(distDir, 'memory', 'hybridSearch.js')).href);
const { captureTaskSources } = await import(pathToFileURL(path.join(distDir, 'harness', 'taskSources.js')).href);
const { searchGrounded } = await import(pathToFileURL(path.join(distDir, 'memory', 'groundedSearch.js')).href);
const { runRepositoryTaskEvaluation } = await import(pathToFileURL(path.join(distDir, 'eval', 'repositoryTaskEvaluation.js')).href);

const files = JSON.parse(fs.readFileSync(path.join(workspaceDir, '.frozen-files.json'), 'utf8'));
const sources = Array.from({ length: Math.ceil(files.length / 64) }, (_, index) =>
  captureTaskSources(workspaceDir, files.slice(index * 64, (index + 1) * 64))
).flat();
const memory = new TemporalMemoryEngine(workspaceDir);
const hybrid = new HybridSearchEngine(workspaceDir, memory);

if (mode === 'correctness') {
  const perQuery = HELD_OUT.map((item, qi) => {
    const res = searchGrounded(hybrid, workspaceDir, item.query, sources);
    return {
      qi,
      query: item.query,
      status: res.status,
      canAssert: res.canAssert,
      conflictOrigin: res.conflictOrigin ?? null,
      conflictPaths: res.conflictPaths ?? [],
      candidates: res.candidates.map((c) => c.recordId),
      evidence: res.evidence.map((e) => ({
        recordId: e.record.id,
        path: e.source.path,
        sha256: e.source.currentSha256 ?? e.source.sha256,
        status: e.source.status,
        line: e.line ?? null,
        excerpt: e.excerpt ?? null,
        lexicalSupport: +e.lexicalSupport.toFixed(6)
      })),
      assertions: res.assertions,
      claims: res.claims ?? [],
      relationships: res.relationships ?? [],
      compoundAnswer: res.compoundAnswer ?? null,
      implementationEvidence: res.implementationEvidence ?? null,
      staleSources: res.staleSources
    };
  });
  process.stdout.write(JSON.stringify({ perQuery }));
} else if (mode === 'repo-eval') {
  const report = await runRepositoryTaskEvaluation(process.env.HM_EVAL_ROOT);
  process.stdout.write(JSON.stringify(report));
} else {
  const stageTotals = { candidateMs: 0, indexingMs: 0, rankingMs: 0, pathMs: 0, readMs: 0, hashMs: 0, excerptMs: 0, decisionMs: 0, totalMs: 0 };
  const samples = [];
  const perQuery = [];
  for (const [qi, item] of HELD_OUT.entries()) {
    searchGrounded(hybrid, workspaceDir, item.query, sources);
    const qSamples = [];
    const qTiming = { candidateMs: 0, indexingMs: 0, rankingMs: 0, pathMs: 0, readMs: 0, hashMs: 0, excerptMs: 0, decisionMs: 0 };
    for (let s = 0; s < 5; s++) {
      const t0 = performance.now();
      searchGrounded(hybrid, workspaceDir, item.query, sources, [], qTiming);
      const dt = performance.now() - t0;
      samples.push(dt);
      qSamples.push(dt);
      stageTotals.totalMs += dt;
    }
    for (const k of Object.keys(qTiming)) stageTotals[k] += qTiming[k];
    qSamples.sort((a, b) => a - b);
    perQuery.push({
      qi,
      query: item.query,
      p50: +qSamples[2].toFixed(2),
      max: +qSamples[4].toFixed(2),
      stages: Object.fromEntries(Object.entries(qTiming).map(([k, v]) => [k, +(v / 5).toFixed(2)]))
    });
  }
  process.stdout.write(JSON.stringify({ samples, stageTotals, perQuery }));
}
`;

async function runMcpRegressionChecks(tempRoot) {
  const manifest = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const packDir = path.join(tempRoot, 'pack');
  const installDir = path.join(tempRoot, 'mcp-install');
  const workspace = path.join(tempRoot, 'mcp-workspace');
  mkdirSync(packDir, { recursive: true });
  mkdirSync(installDir, { recursive: true });
  mkdirSync(workspace, { recursive: true });

  const resolvedNpmCli = process.env.npm_execpath ?? path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  const runNpm = (args, cwd) => {
    if (existsSync(resolvedNpmCli)) {
      return execFileSync(process.execPath, [resolvedNpmCli, ...args], { cwd, stdio: 'pipe' });
    }
    return execFileSync('npm', args, { cwd, shell: process.platform === 'win32', stdio: 'pipe' });
  };
  runNpm(['pack', '--pack-destination', packDir], repoRoot);
  const tarball = path.join(packDir, `${manifest.name}-${manifest.version}.tgz`);
  assert.ok(existsSync(tarball), `expected packed tarball at ${tarball}`);
  runNpm(['install', '--prefix', installDir, '--no-audit', '--no-fund', tarball], tempRoot);
  const cli = path.join(installDir, 'node_modules', manifest.name, 'dist', 'cli', 'index.js');

  execFileSync('git', ['init'], { cwd: workspace, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Sprint37 Check'], { cwd: workspace });
  execFileSync('git', ['config', 'user.email', 'sprint37@example.invalid'], { cwd: workspace });
  mkdirSync(path.join(workspace, 'src'), { recursive: true });
  mkdirSync(path.join(workspace, 'tests'), { recursive: true });
  mkdirSync(path.join(workspace, 'design'), { recursive: true });
  mkdirSync(path.join(workspace, 'architecture'), { recursive: true });

  writeFileSync(path.join(workspace, 'README.md'), '# Sprint 3.7 MCP Check\n');
  writeFileSync(path.join(workspace, 'widget.ts'), 'export function createWidget() { return 1; }\n');
  writeFileSync(path.join(workspace, 'config.json'), '{"port": 4321}\n');
  writeFileSync(path.join(workspace, 'design', 'storage-choice.md'), 'Decision: Use SQLite for task coordination.\nRationale: Preserve atomic task transitions.\n');
  writeFileSync(path.join(workspace, 'architecture', 'task-rules.md'), 'Decision-Source: design/storage-choice.md\nConstraint: Task updates must use a transactional coordinator.\n');
  writeFileSync(path.join(workspace, 'src', 'inventory.ts'), 'export function tallyCrates() {\n  return countItems();\n}\n');
  writeFileSync(path.join(workspace, 'tests', 'inventory.test.ts'), "import { it, expect } from 'vitest';\nimport { tallyCrates as tally } from '../src/inventory.js';\nit('totals stock', () => {\n  expect(tally()).toBe(12);\n});\n");

  execFileSync('git', ['add', 'README.md'], { cwd: workspace });
  execFileSync('git', ['commit', '-m', 'baseline'], { cwd: workspace, stdio: 'ignore' });

  const client = new Client({ name: 'sprint37-mcp-verifier', version: '1.0.0' });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [cli, 'mcp'],
    cwd: workspace,
    stderr: 'pipe'
  }));

  const results = [];
  const callToolJson = async (name, args) => {
    const res = await client.callTool({ name, arguments: args });
    assert.ok(!res.isError, `MCP tool ${name} failed: ${JSON.stringify(res)}`);
    if (res.structuredContent) return res.structuredContent;
    const text = res.content?.[0]?.text ?? '';
    try {
      return JSON.parse(text);
    } catch {
      return { text };
    }
  };

  try {
    await callToolJson('hypersabmemory_remember', { category: 'symbol', content: 'createWidget is defined in widget.ts', artifacts: ['widget.ts'] });
    await callToolJson('hypersabmemory_remember', { category: 'architecture', content: 'Service port setting is stored in config.json', artifacts: ['config.json'] });
    await callToolJson('hypersabmemory_remember', { category: 'decision', content: 'SQLite task coordination decision and rationale', artifacts: ['design/storage-choice.md'] });
    await callToolJson('hypersabmemory_remember', { category: 'architecture', content: 'Task update constraint follows storage choice', artifacts: ['architecture/task-rules.md'] });
    await callToolJson('hypersabmemory_remember', { category: 'architecture', content: 'tallyCrates implementation and tests', artifacts: ['src/inventory.ts'] });
    await callToolJson('hypersabmemory_remember', { category: 'general', content: 'tallyCrates test coverage in inventory.test.ts', artifacts: ['tests/inventory.test.ts'] });
    const secret = await callToolJson('hypersabmemory_remember', { category: 'decision', content: 'Legacy secret deployment token MUST_NOT_LEAK_TOKEN_987', artifacts: ['README.md'] });
    const secretId = JSON.parse(readFileSync(path.join(workspace, '.hypersabmemory', 'memory_store.json'), 'utf8')).find((r) => r.content.includes('MUST_NOT_LEAK_TOKEN_987')).id;
    assert.ok(secret && secretId);

    const task = await callToolJson('hypersabmemory_task_create', {
      goal: 'Verify grounded MCP regression queries',
      acceptanceCriteria: ['Confirm all 9 grounded query categories'],
      sourceRefs: ['widget.ts', 'config.json', 'design/storage-choice.md', 'architecture/task-rules.md', 'src/inventory.ts', 'tests/inventory.test.ts']
    });
    const taskId = task.taskId;

    // 1. Exact symbol definition query
    const sym = await callToolJson('hypersabmemory_query_evidence', { query: 'Where is `createWidget` defined?' });
    assert.equal(sym.answerVerified, true);
    assert.equal(sym.assertions[0].sourcePath, 'widget.ts');
    results.push({ id: 1, category: 'exact_symbol_definition', passed: true, answerVerified: sym.answerVerified, sourcePath: sym.assertions[0].sourcePath });

    // 2. Exact JSON value query
    const jsonCfg = await callToolJson('hypersabmemory_query_evidence', { query: 'What is the value of `port` in `config.json`?' });
    assert.equal(jsonCfg.answerVerified, true);
    assert.equal(jsonCfg.claims[0].type, 'json_scalar');
    assert.equal(jsonCfg.claims[0].value, '4321');
    results.push({ id: 2, category: 'exact_json_value', passed: true, answerVerified: jsonCfg.answerVerified, value: jsonCfg.claims[0].value });

    // 3. Exact Markdown decision query
    const mdDecision = await callToolJson('hypersabmemory_query_evidence', { query: 'What decision was recorded about task coordination?' });
    assert.equal(mdDecision.answerVerified, true);
    assert.equal(mdDecision.claims[0].type, 'recorded_decision');
    assert.equal(mdDecision.claims[0].source.path, 'design/storage-choice.md');
    results.push({ id: 3, category: 'exact_markdown_decision', passed: true, answerVerified: mdDecision.answerVerified, claim: mdDecision.claims[0].value });

    // 4. Explicit cross-file decision-to-constraint query
    const cross = await callToolJson('hypersabmemory_task_grounded_query', {
      taskId,
      query: 'What constraint in `architecture/task-rules.md` is recorded for the decision in `design/storage-choice.md`?'
    });
    assert.equal(cross.status, 'SUPPORTED');
    assert.equal(cross.canAssert, true);
    assert.equal(cross.relationships[0].status, 'verified');
    results.push({ id: 4, category: 'explicit_cross_file_constraint', passed: true, status: cross.status, relationshipStatus: cross.relationships[0].status });

    // 5. Implementation and TypeScript test attribution query
    const impl = await callToolJson('hypersabmemory_query_evidence', { query: 'Where is tallyCrates implemented and which tests call it?' });
    assert.equal(impl.answerVerified, false);
    assert.equal(impl.implementationEvidence.code[0].symbol, 'tallyCrates');
    assert.equal(impl.implementationEvidence.tests[0].name, 'totals stock');
    assert.equal(impl.implementationEvidence.tests[0].execution, 'unverified');
    results.push({ id: 5, category: 'implementation_and_ts_test_attribution', passed: true, symbol: impl.implementationEvidence.code[0].symbol, test: impl.implementationEvidence.tests[0].name });

    // 6. Stale-source query after file edit
    writeFileSync(path.join(workspace, 'design', 'storage-choice.md'), 'Decision: Use PostgresSQL cluster for task coordination.\nRationale: Preserve atomic task transitions.\n');
    const staleEdit = await callToolJson('hypersabmemory_task_grounded_query', {
      taskId,
      query: 'What constraint in `architecture/task-rules.md` is recorded for the decision in `design/storage-choice.md`?'
    });
    assert.equal(staleEdit.status, 'STALE_EVIDENCE');
    assert.equal(staleEdit.canAssert, false);
    assert.ok(staleEdit.staleSources.some((s) => s.path === 'design/storage-choice.md' && s.status === 'modified'));
    results.push({ id: 6, category: 'stale_source_after_edit', passed: true, status: staleEdit.status, canAssert: staleEdit.canAssert });

    // 7. Same-size file rewrite query
    const origCfg = readFileSync(path.join(workspace, 'config.json'), 'utf8');
    const rewrittenCfg = '{"port": 4322}\n';
    assert.equal(rewrittenCfg.length, origCfg.length);
    writeFileSync(path.join(workspace, 'config.json'), rewrittenCfg);
    const sameSize = await callToolJson('hypersabmemory_task_grounded_query', {
      taskId,
      query: 'What is the value of `port` in `config.json`?'
    });
    assert.equal(sameSize.status, 'STALE_EVIDENCE');
    assert.equal(sameSize.canAssert, false);
    assert.ok(sameSize.staleSources.some((s) => s.path === 'config.json' && s.status === 'modified'));
    results.push({ id: 7, category: 'same_size_file_rewrite', passed: true, status: sameSize.status, canAssert: sameSize.canAssert });

    // 8. Forgotten-memory query
    await callToolJson('hypersabmemory_forget', { id: secretId });
    const forgottenQuery = await callToolJson('hypersabmemory_query', { query: 'MUST_NOT_LEAK_TOKEN_987' });
    assert.ok(!JSON.stringify(forgottenQuery).includes('MUST_NOT_LEAK_TOKEN_987') && !JSON.stringify(forgottenQuery).includes(secretId));
    const forgottenEvidence = await callToolJson('hypersabmemory_query_evidence', { query: 'MUST_NOT_LEAK_TOKEN_987' });
    const { question: _echoedQuestion, ...forgottenPayload } = forgottenEvidence;
    const forgottenPayloadText = JSON.stringify(forgottenPayload);
    assert.equal(forgottenEvidence.answerVerified, false);
    assert.equal(forgottenEvidence.records.length, 0);
    assert.ok(!forgottenPayloadText.includes('MUST_NOT_LEAK_TOKEN_987') && !forgottenPayloadText.includes(secretId));
    results.push({ id: 8, category: 'forgotten_memory_excluded', passed: true, answerVerified: forgottenEvidence.answerVerified, recordsReturned: forgottenEvidence.records.length });

    // 9. Unanswerable / evaluative compliance query
    const compliance = await callToolJson('hypersabmemory_query_evidence', { query: 'Is tallyCrates correctly implemented and free of production database password bugs?' });
    assert.equal(compliance.answerVerified, false);
    assert.equal(compliance.assertions.length, 0);
    results.push({ id: 9, category: 'unanswerable_and_compliance_abstention', passed: true, answerVerified: compliance.answerVerified });
  } finally {
    await client.close();
  }
  return results;
}

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'hm-sprint37-bench-'));
const baselineRepo = path.join(tempRoot, 'baseline-repo');
const frozenWorkspace = path.join(tempRoot, 'frozen-workspace');
const runnerPath = path.join(tempRoot, 'runner.mjs');

try {
  mkdirSync(baselineRepo, { recursive: true });
  mkdirSync(frozenWorkspace, { recursive: true });
  writeFileSync(runnerPath, probeRunnerScript, 'utf8');

  // Extract untouched baseline commit in an isolated temp directory without switching git branch or worktrees
  const tarPath = path.join(tempRoot, 'baseline.tar');
  execFileSync('git', ['archive', '--format=tar', '--output', tarPath, baselineRef], { cwd: repoRoot });
  execFileSync('tar', ['-xf', tarPath, '-C', baselineRepo], { cwd: tempRoot });
  symlinkSync(path.join(repoRoot, 'node_modules'), path.join(baselineRepo, 'node_modules'), 'junction');
  execFileSync(process.execPath, [path.join(baselineRepo, 'scripts', 'build.mjs')], { cwd: baselineRepo, stdio: 'pipe' });

  // Build frozen snapshot seeded identically to repositoryTaskEvaluation
  const files = buildFrozenCorpus(repoRoot, frozenWorkspace);
  writeFileSync(path.join(frozenWorkspace, '.frozen-files.json'), JSON.stringify(files), 'utf8');
  const { TemporalMemoryEngine } = await import(path.join(path.resolve(repoRoot), 'dist', 'memory', 'temporalMemory.js').replace(/^([A-Za-z]):/, 'file:///$1:').replace(/\\/g, '/'));
  const mem = new TemporalMemoryEngine(frozenWorkspace);
  for (const file of files) {
    const content = readFileSync(path.join(frozenWorkspace, file), 'utf8');
    mem.remember(file.startsWith('tests/') ? 'general' : 'architecture', `${file}\n${content}`, [], { artifacts: [file] });
  }
  const forgotten = mem.remember('decision', 'Production database password and private API credential reference.', [], { artifacts: ['README.md'] });
  mem.forget(forgotten.id);

  const baselineDist = path.join(baselineRepo, 'dist');
  const candidateDist = path.join(repoRoot, 'dist');

  const runWorker = (distDir, mode, extraEnv = {}) => {
    const out = execFileSync(process.execPath, [runnerPath], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, HM_DIST_DIR: distDir, HM_WORKSPACE_DIR: frozenWorkspace, HM_MODE: mode, ...extraEnv },
      stdio: ['ignore', 'pipe', 'ignore']
    });
    return JSON.parse(out);
  };

  // Correctness comparison across all 30 HELD_OUT queries
  const beforeCorrectness = runWorker(baselineDist, 'correctness');
  const afterCorrectness = runWorker(candidateDist, 'correctness');
  assert.equal(beforeCorrectness.perQuery.length, 30);
  assert.equal(afterCorrectness.perQuery.length, 30);
  const queryDiffs = [];
  for (let i = 0; i < 30; i++) {
    const b = beforeCorrectness.perQuery[i];
    const a = afterCorrectness.perQuery[i];
    const fields = ['status', 'canAssert', 'conflictOrigin', 'conflictPaths', 'candidates', 'evidence', 'assertions', 'claims', 'relationships', 'compoundAnswer', 'implementationEvidence', 'staleSources'];
    for (const field of fields) {
      if (JSON.stringify(b[field]) !== JSON.stringify(a[field])) {
        queryDiffs.push({ qi: i, field, before: b[field], after: a[field] });
      }
    }
  }
  assert.equal(queryDiffs.length, 0, `Per-query output mismatch detected: ${JSON.stringify(queryDiffs.slice(0, 2))}`);

  // Alternating Before/After runs on frozen workspace (3 repetitions each)
  const beforeRuns = [];
  const afterRuns = [];
  for (let rep = 0; rep < repetitions; rep++) {
    beforeRuns.push(runWorker(baselineDist, 'bench'));
    afterRuns.push(runWorker(candidateDist, 'bench'));
  }

  const aggregateRuns = (runs) => {
    const pooled = runs.flatMap((r) => r.samples);
    const stageKeys = Object.keys(runs[0].stageTotals);
    const totalQueries = runs.reduce((acc, r) => acc + r.samples.length, 0);
    const stageMeansMs = Object.fromEntries(
      stageKeys.map((k) => [k, +(runs.reduce((acc, r) => acc + r.stageTotals[k], 0) / totalQueries).toFixed(2)])
    );
    const perQuery = runs[0].perQuery.map((_, qi) => {
      const p50s = runs.map((r) => r.perQuery[qi].p50).sort((a, b) => a - b);
      const maxs = runs.map((r) => r.perQuery[qi].max).sort((a, b) => a - b);
      return {
        qi,
        query: runs[0].perQuery[qi].query,
        medianP50Ms: p50s[Math.floor(p50s.length / 2)],
        worstMaxMs: maxs[maxs.length - 1]
      };
    });
    return {
      repetitions: runs.length,
      perRun: runs.map((r, i) => ({ rep: i + 1, ...summarize(r.samples) })),
      pooled: summarize(pooled),
      stageMeansMs,
      top10Slowest: [...perQuery].sort((a, b) => b.medianP50Ms - a.medianP50Ms).slice(0, 10)
    };
  };

  const beforeSummary = aggregateRuns(beforeRuns);
  const afterSummary = aggregateRuns(afterRuns);

  // Full runRepositoryTaskEvaluation comparison (exact 82-file frozen baselineRepo + live repoRoot)
  const beforeRepoEval = runWorker(baselineDist, 'repo-eval', { HM_EVAL_ROOT: baselineRepo });
  const afterRepoEvalSameCorpus = runWorker(candidateDist, 'repo-eval', { HM_EVAL_ROOT: baselineRepo });
  const afterRepoEval = runWorker(candidateDist, 'repo-eval', { HM_EVAL_ROOT: repoRoot });

  const mcpRegression = await runMcpRegressionChecks(tempRoot);

  console.log(JSON.stringify({
    environment: { node: process.version, platform: process.platform, arch: process.arch, baselineRef },
    alternatingBenchmark: {
      corpusFiles: files.length,
      queries: 30,
      samplesPerRun: 150,
      repetitions,
      before: beforeSummary,
      after: afterSummary,
      deltaPct: {
        p50: +(((afterSummary.pooled.p50 - beforeSummary.pooled.p50) / beforeSummary.pooled.p50) * 100).toFixed(1),
        p95: +(((afterSummary.pooled.p95 - beforeSummary.pooled.p95) / beforeSummary.pooled.p95) * 100).toFixed(1),
        mean: +(((afterSummary.pooled.mean - beforeSummary.pooled.mean) / beforeSummary.pooled.mean) * 100).toFixed(1)
      }
    },
    perQueryCorrectness: { queriesCompared: 30, identicalQueries: 30, diffs: 0 },
    repositoryTaskEvalComparison: {
      before: {
        passed: beforeRepoEval.passed,
        latencyMs: beforeRepoEval.latencyMs,
        raw: beforeRepoEval.raw ?? beforeRepoEval.retrieval,
        grounded: beforeRepoEval.grounded
      },
      afterSameCorpus: {
        passed: afterRepoEvalSameCorpus.passed,
        latencyMs: afterRepoEvalSameCorpus.latencyMs,
        raw: afterRepoEvalSameCorpus.raw ?? afterRepoEvalSameCorpus.retrieval,
        grounded: afterRepoEvalSameCorpus.grounded
      },
      after: {
        passed: afterRepoEval.passed,
        latencyMs: afterRepoEval.latencyMs,
        raw: afterRepoEval.raw ?? afterRepoEval.retrieval,
        grounded: afterRepoEval.grounded
      }
    },
    mcpRegression
  }, null, 2));
} finally {
  const junction = path.join(baselineRepo, 'node_modules');
  if (existsSync(junction)) {
    try { rmdirSync(junction); } catch { try { unlinkSync(junction); } catch {} }
  }
  rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
