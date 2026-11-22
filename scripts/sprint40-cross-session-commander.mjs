import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
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
const npmCli = process.env.HM40_NPM_CLI ?? process.env.npm_execpath ?? (fs.existsSync(defaultWinNpm) ? defaultWinNpm : undefined);
assert.ok(npmCli, 'Set HM40_NPM_CLI or run via npm so npm-cli.js can be resolved');

const COMMANDER_SPEC = {
  key: 'commander',
  url: 'https://github.com/tj/commander.js.git',
  commit: 'a5a7dc084d4d2b7932e85ca049c5204e50a2c721'
};

function findCodexExecutable() {
  if (process.env.HM40_CODEX_EXE && fs.existsSync(process.env.HM40_CODEX_EXE)) {
    return process.env.HM40_CODEX_EXE;
  }
  const winCandidate = path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe');
  if (winCandidate && fs.existsSync(winCandidate)) return winCandidate;
  const probe = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', ['codex'], { encoding: 'utf8' });
  if (probe.status === 0) {
    const first = probe.stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
    if (first && fs.existsSync(first)) return first;
  }
  return null;
}

function ensureCommanderClone(reposBase) {
  const repoDir = path.join(reposBase, COMMANDER_SPEC.key);
  if (fs.existsSync(path.join(repoDir, '.git'))) {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, encoding: 'utf8' }).trim();
    if (head === COMMANDER_SPEC.commit) return repoDir;
  }
  fs.mkdirSync(repoDir, { recursive: true });
  execFileSync('git', ['init'], { cwd: repoDir, stdio: 'pipe' });
  execFileSync('git', ['remote', 'add', 'origin', COMMANDER_SPEC.url], { cwd: repoDir, stdio: 'pipe' });
  execFileSync('git', ['fetch', '--depth', '1', 'origin', COMMANDER_SPEC.commit], { cwd: repoDir, stdio: 'pipe' });
  execFileSync('git', ['checkout', '--detach', 'FETCH_HEAD'], { cwd: repoDir, stdio: 'pipe' });
  return repoDir;
}

function copyTrackedRepo(sourceRepoDir, targetDir) {
  const tracked = execFileSync('git', ['ls-files'], { cwd: sourceRepoDir, encoding: 'utf8' })
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (const rel of tracked) {
    const src = path.join(sourceRepoDir, rel);
    if (!fs.existsSync(src) || !fs.statSync(src).isFile()) continue;
    const dst = path.join(targetDir, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
  execFileSync('git', ['init'], { cwd: targetDir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'Cross-Session Eval'], { cwd: targetDir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'cross-session@example.invalid'], { cwd: targetDir, stdio: 'pipe' });
  execFileSync('git', ['add', '.'], { cwd: targetDir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'pinned commander baseline'], { cwd: targetDir, stdio: 'pipe' });
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: targetDir, encoding: 'utf8' }).trim();
}

function parseTapSummary(text) {
  const summary = {};
  for (const line of (text ?? '').split(/\r?\n/)) {
    const m = line.match(/^# (tests|suites|pass|fail|cancelled|skipped)\s+(\d+)/i);
    if (m) summary[m[1].toLowerCase()] = Number(m[2]);
  }
  return summary;
}

function parseCodexEvents(jsonlText) {
  const mcpCalls = [];
  const commandExecs = [];
  let turnFailed = null;
  let errorEvents = [];
  let tokenUsage = null;
  let finalMessage = '';

  for (const line of jsonlText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    let evt;
    try {
      evt = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (evt.type === 'error') errorEvents.push(evt.message ?? JSON.stringify(evt));
    if (evt.type === 'turn.failed') turnFailed = evt.error?.message ?? JSON.stringify(evt);
    if (evt.type === 'turn.completed' && evt.usage) tokenUsage = evt.usage;
    if ((evt.type === 'item.started' || evt.type === 'item.completed') && evt.item) {
      const item = evt.item;
      if (evt.type === 'item.completed' && item.type === 'mcp_tool_call') {
        mcpCalls.push({
          server: item.server,
          tool: item.tool,
          status: item.status,
          hasError: Boolean(item.error)
        });
      }
      if (evt.type === 'item.completed' && item.type === 'command_execution') {
        commandExecs.push({
          command: item.command,
          exitCode: item.exit_code
        });
      }
      if (evt.type === 'item.completed' && item.type === 'agent_message') {
        finalMessage = item.text ?? '';
      }
    }
  }
  return { mcpCalls, commandExecs, turnFailed, errorEvents, tokenUsage, finalMessage };
}

const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-s40-cross-session-'));
const reposBase = process.env.HM40_REPOS_DIR ?? path.join(os.tmpdir(), 'hm-sprint40-repos');

try {
  execFileSync(process.execPath, [npmCli, 'pack', '--ignore-scripts', '--pack-destination', tempRoot], {
    cwd: repoRoot,
    stdio: 'pipe'
  });
  const tarball = path.join(tempRoot, `${manifest.name}-${manifest.version}.tgz`);
  const installDir = path.join(tempRoot, 'install');
  fs.mkdirSync(installDir);
  execFileSync(process.execPath, [npmCli, 'install', '--prefix', installDir, '--no-audit', '--no-fund', tarball], {
    cwd: tempRoot,
    stdio: 'pipe'
  });
  const cli = path.join(installDir, 'node_modules', manifest.name, 'dist', 'cli', 'index.js');

  const cloneDir = ensureCommanderClone(reposBase);
  const workspace = path.join(tempRoot, 'ws-commander');
  fs.mkdirSync(workspace, { recursive: true });
  const baselineHead = copyTrackedRepo(cloneDir, workspace);

  // Baseline native test checks BEFORE any session changes
  const preTest = spawnSync(process.execPath, ['--test', 'tests/help.suggestion.test.js'], {
    cwd: workspace,
    encoding: 'utf8'
  });
  assert.equal(preTest.status, 0, 'baseline tests/help.suggestion.test.js must pass');
  const baselineTargetedSummary = parseTapSummary(preTest.stdout);
  const preFullTest = spawnSync(process.execPath, ['--test'], {
    cwd: workspace,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024
  });
  const baselineFullSummary = parseTapSummary(preFullTest.stdout);

  // Session 1: setup + record design decision + create & checkpoint unfinished task
  execFileSync(process.execPath, [cli, 'setup'], { cwd: workspace, stdio: 'pipe' });
  const session1 = new Client({ name: 'session-1-author', version: '1.0.0' });
  await session1.connect(new StdioClientTransport({
    command: process.execPath,
    args: [cli, 'mcp'],
    cwd: workspace,
    stderr: 'pipe'
  }));

  let taskId;
  try {
    await session1.callTool({
      name: 'hypersabmemory_remember',
      arguments: {
        category: 'decision',
        content: 'Decision: Cap suggestSimilar() output to at most 3 alphabetically sorted candidates when more than 3 candidates tie at the same best edit distance, keeping exact formatting without ellipsis. Rationale: Prevent noisy terminal error messages on CLIs with many similarly named commands or options while preserving deterministic alphabetical ordering.',
        artifacts: ['lib/suggestSimilar.js', 'tests/help.suggestion.test.js'],
        intent: 'Limit tied did-you-mean suggestions to 3 candidates cleanly'
      }
    });
    await session1.callTool({
      name: 'hypersabmemory_remember',
      arguments: {
        category: 'architecture',
        content: 'suggestSimilar computes Damerau-Levenshtein editDistance matches and formats "(Did you mean ...)" messages.',
        artifacts: ['lib/suggestSimilar.js']
      }
    });
    const created = await session1.callTool({
      name: 'hypersabmemory_task_create',
      arguments: {
        goal: 'Apply recorded suggestion tie-breaking limit in suggestSimilar()',
        constraints: [
          'Follow the recorded design decision in HyperSABMemory without inventing extra flags or ellipsis',
          'Keep behavior unchanged when 3 or fewer candidates match'
        ],
        acceptanceCriteria: [
          'suggestSimilar() limits tied suggestions as decided',
          'Regression test added in tests/help.suggestion.test.js and node --test passes'
        ],
        sourceRefs: ['lib/suggestSimilar.js', 'tests/help.suggestion.test.js'],
        nextAction: 'Restore this decision, inspect lib/suggestSimilar.js and tests/help.suggestion.test.js, implement the change cleanly, add a regression test, verify with node --test tests/help.suggestion.test.js, and checkpoint completion.'
      }
    });
    taskId = created.structuredContent.taskId;
    const claimed = await session1.callTool({
      name: 'hypersabmemory_task_claim',
      arguments: { taskId, agentId: 'session-1-lead' }
    });
    assert.ok(!claimed.isError);
    const ck = await session1.callTool({
      name: 'hypersabmemory_task_checkpoint',
      arguments: {
        taskId,
        agentId: 'session-1-lead',
        expectedRevision: claimed.structuredContent.revision,
        leaseGeneration: claimed.structuredContent.leaseGeneration,
        summary: 'Session 1 investigated lib/suggestSimilar.js and recorded the design decision for tying candidates.',
        decisions: [
          'Cap suggestSimilar() output to at most 3 alphabetically sorted candidates when more than 3 candidates tie at the same best edit distance without adding ellipsis.'
        ],
        completedWork: ['Audited lib/suggestSimilar.js sort and output formatting', 'Recorded architectural decision in HyperSABMemory'],
        evidencePaths: ['lib/suggestSimilar.js', 'tests/help.suggestion.test.js'],
        nextAction: 'Implement the recorded tie cap in lib/suggestSimilar.js, add a focused regression test in tests/help.suggestion.test.js, run node --test tests/help.suggestion.test.js, and checkpoint final results.'
      }
    });
    assert.ok(!ck.isError);
    await session1.callTool({
      name: 'hypersabmemory_task_claim',
      arguments: { taskId, agentId: 'session-1-lead', action: 'release', leaseGeneration: claimed.structuredContent.leaseGeneration }
    });
  } finally {
    await session1.close();
  }

  // Session 2: fresh independent Codex session with neutral prompt (does NOT reveal the max-3 rule)
  const codexExe = findCodexExecutable();
  assert.ok(codexExe, 'codex executable must be available for live Session 2 continuation test');
  const lastMsgFile = path.join(tempRoot, 'codex-last-message.txt');
  const neutralPrompt = [
    'Continue the unfinished maintenance task already recorded in this repository via the HyperSABMemory MCP server.',
    '1. First call `hypersabmemory_task_context` with `{ "compact": true }` to recover the active task, recorded decisions, and source references (and query HyperSABMemory if you need additional recorded context).',
    '2. Inspect the referenced files in this repository, implement the decided change minimally, and add a focused `node:test` test.',
    '3. Verify your edit by running `node --test tests/help.suggestion.test.js`.',
    '4. Claim the active task, save a final completion checkpoint (`state: "reported_complete"` with summary, evidencePaths, and checks) via `hypersabmemory_task_checkpoint`, and release the lease.',
    'Stay strictly scoped to this task.'
  ].join('\n');

  const session2Start = performance.now();
  const slash = (p) => p.replaceAll('\\', '/');
  const codexArgv = [
    '-a', 'never',
    'exec',
    '--json',
    '--ephemeral',
    '--ignore-user-config',
    '--ignore-rules',
    '--sandbox', 'workspace-write',
    ...(process.platform === 'win32' ? ['-c', 'windows.sandbox="unelevated"'] : []),
    '-c', 'model_reasoning_effort="low"',
    '-C', workspace,
    '-c', `mcp_servers.hypersabmemory.command=${JSON.stringify(slash(process.execPath))}`,
    '-c', `mcp_servers.hypersabmemory.args=${JSON.stringify([slash(cli), 'mcp'])}`,
    '-c', `mcp_servers.hypersabmemory.cwd=${JSON.stringify(slash(workspace))}`,
    '-c', 'mcp_servers.hypersabmemory.default_tools_approval_mode="approve"',
    '-o', lastMsgFile,
    neutralPrompt
  ];
  const codexProc = spawnSync(codexExe, codexArgv, {
    cwd: workspace,
    input: '',
    encoding: 'utf8',
    windowsHide: true,
    timeout: 240_000,
    maxBuffer: 24 * 1024 * 1024
  });
  const session2ElapsedMs = +(performance.now() - session2Start).toFixed(2);
  const parsedEvents = parseCodexEvents(codexProc.stdout ?? '');

  // Independent verification outside Codex
  const diffStat = execFileSync('git', ['diff', '--stat'], { cwd: workspace, encoding: 'utf8' }).trim();
  const fullDiff = execFileSync('git', ['diff'], { cwd: workspace, encoding: 'utf8' });

  const targetedTest = spawnSync(process.execPath, ['--test', 'tests/help.suggestion.test.js'], {
    cwd: workspace,
    encoding: 'utf8'
  });
  const fullSuiteTest = spawnSync(process.execPath, ['--test'], {
    cwd: workspace,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024
  });

  // Direct behavioral check of patched lib/suggestSimilar.js
  let behaviorVerified = false;
  let sampleFiveTiesOutput = null;
  let sampleThreeTiesOutput = null;
  try {
    const mod = await import(`${pathToFileURL(path.join(workspace, 'lib', 'suggestSimilar.js')).href}?t=${Date.now()}`);
    sampleFiveTiesOutput = mod.suggestSimilar('cat', ['bat', 'fat', 'hat', 'mat', 'pat', 'rat']);
    sampleThreeTiesOutput = mod.suggestSimilar('cat', ['bat', 'mat', 'rat']);
    behaviorVerified =
      sampleFiveTiesOutput.includes('bat, fat, hat') &&
      !sampleFiveTiesOutput.includes('mat') &&
      !sampleFiveTiesOutput.includes('...') &&
      sampleThreeTiesOutput.includes('bat, mat, rat');
  } catch (err) {
    sampleFiveTiesOutput = `IMPORT_ERROR: ${err.message}`;
  }

  // Fresh MCP inspection of checkpoint state after Session 2
  const verifier = new Client({ name: 'session-3-verifier', version: '1.0.0' });
  await verifier.connect(new StdioClientTransport({
    command: process.execPath,
    args: [cli, 'mcp'],
    cwd: workspace,
    stderr: 'pipe'
  }));
  let restoredAfterSession2 = null;
  try {
    const ctx = await verifier.callTool({ name: 'hypersabmemory_task_context', arguments: { taskId, compact: true } });
    restoredAfterSession2 = ctx.structuredContent;
  } finally {
    await verifier.close();
  }

  const report = {
    evaluatedAt: new Date().toISOString(),
    repo: 'tj/commander.js',
    commit: COMMANDER_SPEC.commit,
    tempBaselineHead: baselineHead,
    taskId,
    codex: {
      executable: codexExe,
      exitCode: codexProc.status,
      elapsedMs: session2ElapsedMs,
      turnFailed: parsedEvents.turnFailed,
      errorEvents: parsedEvents.errorEvents,
      mcpCalls: parsedEvents.mcpCalls,
      taskContextCalls: parsedEvents.mcpCalls.filter((c) => c.tool === 'hypersabmemory_task_context').length,
      commandExecutions: parsedEvents.commandExecs.length,
      tokenUsage: parsedEvents.tokenUsage,
      stderrExcerpt: (codexProc.stderr ?? '').trim().slice(0, 1000),
      finalMessage: fs.existsSync(lastMsgFile) ? fs.readFileSync(lastMsgFile, 'utf8').trim() : parsedEvents.finalMessage
    },
    independentVerification: {
      baselineTargetedSummary,
      baselineFullExitCode: preFullTest.status,
      baselineFullSummary,
      diffStat,
      changedFiles: fullDiff.split(/^diff --git /m).length - 1,
      targetedTestExitCode: targetedTest.status,
      targetedTestSummary: parseTapSummary(targetedTest.stdout),
      fullSuiteExitCode: fullSuiteTest.status,
      fullSuiteSummary: parseTapSummary(fullSuiteTest.stdout),
      behaviorVerified,
      sampleFiveTiesOutput,
      sampleThreeTiesOutput,
      taskStateAfterSession2: restoredAfterSession2?.state ?? null,
      taskRevisionAfterSession2: restoredAfterSession2?.revision ?? null,
      taskSummaryAfterSession2: restoredAfterSession2?.summary ?? null,
      gitDiffExcerpt: fullDiff.slice(0, 3000)
    }
  };

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
