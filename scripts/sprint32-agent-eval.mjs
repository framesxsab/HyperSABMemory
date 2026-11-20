import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.dirname(here);
const planFile = path.join(here, 'sprint32-tasks.json');
const probe = path.join(here, 'sprint32-freshness.probe.mjs');
const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const args = process.argv.slice(2);
if (args[0] === '--summary') {
  console.table(JSON.parse(fs.readFileSync(path.join(args[1], 'results.json'), 'utf8')).runs);
  process.exit(0);
}
const selected = args.length === 1 ? plan.order.filter(([task]) => task === args[0]) : args.length ? [args] : plan.order;
assert.ok(args.length <= 2 && selected.length && selected.every(([task, arm]) => Object.hasOwn(plan.tasks, task) && ['baseline', 'memory'].includes(arm)),
  'Use [task [baseline|memory]] or --summary <results-dir>');
const codex = process.env.HM32_CODEX ?? 'codex';
const npm = process.env.HM32_NPM_CLI ?? process.env.npm_execpath;
assert.ok(npm, 'Set HM32_NPM_CLI to the npm CLI JavaScript entry or start from an npm script');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hm32-agent-eval-'));
console.log('Evaluation artifacts:', root);
const write = (file, text) => fs.writeFileSync(path.join(root, file), text);

function run(command, argv, cwd, timeout = 180000) {
  const start = performance.now();
  const result = spawnSync(command, argv, { cwd, encoding: 'utf8', timeout, maxBuffer: 24 * 1024 * 1024 });
  return { ...result, elapsedSeconds: +( (performance.now() - start) / 1000 ).toFixed(2) };
}
function checked(command, argv, cwd) {
  const result = run(command, argv, cwd);
  assert.equal(result.status, 0, result.error?.message ?? result.stderr ?? JSON.stringify(argv));
  return result.stdout;
}
async function executeAgent(label, argv, cwd) {
  const start = performance.now();
  const stdoutPath = path.join(root, label + '-events.jsonl');
  const stderrPath = path.join(root, label + '-stderr.log');
  const stdout = fs.openSync(stdoutPath, 'wx');
  const stderr = fs.openSync(stderrPath, 'wx');
  try {
    const child = spawn(codex, argv, { cwd, stdio: ['pipe', stdout, stderr], windowsHide: true });
    child.stdin.end();
    write(label + '-started.json', JSON.stringify({ pid: child.pid, at: new Date().toISOString() }));
    let error;
    const deadline = setTimeout(() => { error = new Error('Agent deadline reached'); child.kill(); }, plan.deadlineMs);
    const [status, signal] = await new Promise(resolve => {
      child.once('error', value => { error = value; });
      child.once('close', (...result) => resolve(result));
    });
    clearTimeout(deadline);
    return { status, signal, error, elapsedSeconds: +((performance.now() - start) / 1000).toFixed(2),
      stdout: fs.readFileSync(stdoutPath, 'utf8'), stderr: fs.readFileSync(stderrPath, 'utf8') };
  } finally {
    fs.closeSync(stdout);
    fs.closeSync(stderr);
  }
}
const git = (cwd, ...argv) => checked('git', argv, cwd).trim();
const node = process.execPath;
const archive = path.join(root, 'snapshot.tar');
git(repo, '-c', 'core.autocrlf=false', 'archive', '--format=tar', '-o', archive, plan.snapshot);
const checkEnv = {
  snapshot: plan.snapshot, tree: git(repo, 'show', '-s', '--format=%T', plan.snapshot),
  snapshotSha256: hash(fs.readFileSync(archive)), node: process.version, platform: process.platform, arch: process.arch,
  codex: checked(codex, ['--version'], repo).trim(), model: plan.model, reasoningEffort: plan.reasoningEffort,
  deadlineMs: plan.deadlineMs, planSha256: hash(fs.readFileSync(planFile)), probeSha256: hash(fs.readFileSync(probe)),
  runnerSha256: hash(fs.readFileSync(fileURLToPath(import.meta.url)))
};
const results = { environment: checkEnv, runs: [] };
const save = () => write('results.json', JSON.stringify(results, null, 2) + '\n');
fs.copyFileSync(planFile, path.join(root, 'tasks.json'));
save();

function snapshot(label, dependencySource) {
  const cwd = path.join(root, label);
  fs.mkdirSync(cwd);
  checked('tar', ['-xf', archive, '-C', cwd], root);
  if (dependencySource) {
    fs.cpSync(dependencySource, path.join(cwd, 'node_modules'), { recursive: true, verbatimSymlinks: true });
  }
  return cwd;
}
const prep = snapshot('pristine');
const deps = path.join(prep, 'node_modules');
checked(node, [npm, 'ci', '--no-audit', '--no-fund'], prep);
const build = cwd => run(node, ['scripts/build.mjs'], cwd);
assert.equal(build(prep).status, 0);
const pack = JSON.parse(checked(node, [npm, 'pack', '--json', '--ignore-scripts', '--pack-destination', root], prep))[0];
const install = path.join(root, 'installed');
checked(node, [npm, 'install', '--prefix', install, '--no-audit', '--no-fund', path.join(root, pack.filename)], root);
const installed = path.join(install, 'node_modules/hypersabmemory/dist');
const cli = path.join(installed, 'cli/index.js');
const { TemporalMemoryEngine } = await import(pathToFileURL(path.join(installed, 'memory/temporalMemory.js')).href);
const architecture = fs.readFileSync(path.join(prep, 'Architecture.md'), 'utf8').split(/\r?\n/);
const notes = [
  ['Implementation evidence parses', ['Architecture.md', 'src/memory/implementationEvidence.ts', 'src/mcp/server.ts']],
  ['Test files enter', ['Architecture.md', 'src/memory/implementationEvidence.ts']],
  ['Active-record reads refresh', ['Architecture.md', 'src/memory/groundedSearch.ts', 'src/harness/taskSources.ts']],
  ['The general evidence query adds', ['Architecture.md', 'src/memory/claimVerification.ts', 'tests/mcpQuery.test.ts']]
].map(([prefix, artifacts]) => {
  const content = architecture.find(line => line.startsWith(prefix));
  assert.ok(content, prefix);
  return { content, artifacts };
});
write('memory-seed.json', JSON.stringify(notes, null, 2));

function vitest(cwd, ...files) {
  const argv = ['node_modules/vitest/vitest.mjs', 'run', '--maxWorkers=1'];
  const result = run(node, [...argv, '--pool=threads', ...files], cwd);
  if (process.platform !== 'win32' || result.status !== 0xc0000005) return result;
  // Retry the scorer after a native process crash, preserving the original outcome.
  const retry = run(node, [...argv, '--pool=forks', ...files], cwd);
  return { ...retry, initialCrash: result };
}
function probeFreshness(cwd) {
  const built = build(cwd);
  if (built.status !== 0) return built;
  const destination = path.join(cwd, 'scripts/sprint32-freshness.probe.mjs');
  fs.copyFileSync(probe, destination);
  return run(node, [destination], cwd);
}
function mutateWire(cwd, transform) {
  const server = path.join(cwd, 'src/mcp/server.ts');
  const original = fs.readFileSync(server, 'utf8');
  const port = "implementationEvidence: grounded.implementationEvidence";
  assert.ok(original.includes(port));
  fs.writeFileSync(server, original.replace(port, transform));
  try { return vitest(cwd, 'tests/mcpQuery.test.ts'); }
  finally { fs.writeFileSync(server, original); }
}
const mutants = [
  'omittedImplementationEvidence: grounded.implementationEvidence',
  "implementationEvidence: { ...grounded.implementationEvidence, tests: grounded.implementationEvidence.tests.map(item => ({ ...item, execution: 'passed' })) }"
];
function log(label, result) {
  if (result.initialCrash) log(label + '-thread-crash', result.initialCrash);
  write(label + '.log', JSON.stringify({ status: result.status, signal: result.signal, error: result.error?.message, elapsedSeconds: result.elapsedSeconds }) +
    '\n' + result.stdout + '\n' + result.stderr);
}
const negative = probeFreshness(prep);
log('preflight-freshness', negative);
assert.equal(negative.status, 1);
assert.match(negative.stderr, /explicit link must not survive/);
for (const [index, mutant] of mutants.entries()) {
  const preflight = mutateWire(prep, mutant);
  log('preflight-mutant-' + index, preflight);
  assert.equal(preflight.status, 0, 'existing tests should lack coverage for this mutant');
}
console.log('Frozen preflight passed', checkEnv);

for (const [task, arm] of selected) {
  const label = task + '-' + arm;
  const cwd = snapshot(label, deps);
  git(cwd, 'init', '-q');
  git(cwd, 'config', 'core.autocrlf', 'false');
  git(cwd, 'config', 'user.name', 'Sprint 3.2 fixture');
  git(cwd, 'config', 'user.email', 'fixture@example.invalid');
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-qm', 'Pinned evaluation snapshot');
  const initial = git(cwd, 'rev-parse', 'HEAD');
  assert.equal(git(cwd, 'show', '-s', '--format=%T', initial), checkEnv.tree, 'agent receives the committed snapshot bytes');
  const treatment = arm === 'memory';
  if (treatment) {
    const memory = new TemporalMemoryEngine(cwd);
    for (const note of notes) memory.remember('architecture', note.content, [], { artifacts: note.artifacts });
  }
  const slash = file => file.replaceAll('\\', '/');
  const mcp = treatment ? [
    '-c', 'mcp_servers.hypersabmemory.command=' + JSON.stringify(slash(node)),
    '-c', 'mcp_servers.hypersabmemory.args=' + JSON.stringify([slash(cli), 'mcp']),
    '-c', 'mcp_servers.hypersabmemory.cwd=' + JSON.stringify(slash(cwd)),
    '-c', 'mcp_servers.hypersabmemory.enabled_tools=["hypersabmemory_query_evidence","hypersabmemory_query"]',
    '-c', 'mcp_servers.hypersabmemory.default_tools_approval_mode="approve"'
  ] : [];
  const prompt = plan.tasks[task].prompt +
    ' Work only in this checkout. Use the tools available to you. Use Vitest threads with one worker on Windows. Do not commit or edit scoring infrastructure. Report your changes, evidence paths, and tests run.';
  console.log('Starting', label);
  const execution = await executeAgent(label, ['-a', 'never', 'exec', '--json', '--ephemeral', '--ignore-user-config', '--ignore-rules', '--sandbox', 'workspace-write',
    ...(process.platform === 'win32' ? ['-c', 'windows.sandbox="unelevated"'] : []),
    '-c', 'model_reasoning_effort=' + JSON.stringify(plan.reasoningEffort), '-m', plan.model, '-C', cwd, ...mcp, prompt], cwd);
  log(label + '-agent', execution);
  git(cwd, 'add', '-A');
  const files = git(cwd, 'diff', '--cached', '--name-only', initial).split(/\r?\n/).filter(Boolean);
  const delta = path.join(root, label + '.patch');
  // Git writes the patch bytes directly, including a trailing newline and binary records.
  git(cwd, 'diff', '--cached', '--binary', '--output=' + delta, initial);
  const permitted = task === 'freshness' ? ['src/memory/groundedSearch.ts', 'tests/groundedSearch.test.ts'] : ['tests/mcpQuery.test.ts'];
  const scope = permitted.every(file => files.includes(file)) && files.every(file => permitted.includes(file));
  const successful = result => result.status === 0 && !result.error;
  let accepted = false, regression = false, checks = [];
  if (scope) {
    const scorer = snapshot(label + '-scorer', deps);
    checked('git', ['apply', '--whitespace=nowarn', delta], scorer);
    const normal = vitest(scorer, 'tests/groundedSearch.test.ts', 'tests/mcpQuery.test.ts', 'tests/taskLedger.test.ts');
    log(label + '-regression', normal);
    regression = successful(normal);
    checks = task === 'freshness' ? [probeFreshness(scorer)] : mutants.map(mutant => mutateWire(scorer, mutant));
    for (const [index, result] of checks.entries()) log(label + '-check-' + index, result);
    accepted = regression && (task === 'freshness' ? checks.every(successful) :
      checks.every(result => result.status === 1 && /\b[1-9]\d* failed\b/.test(result.stdout) && !/No test suite found|Startup Error/.test(result.stderr)));
  }
  const events = (execution.stdout ?? '').split(/\r?\n/).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  const items = events.filter(event => event.type === 'item.completed').map(event => event.item);
  const shell = items.filter(item => item.type === 'command_execution');
  const calls = items.filter(item => item.type === 'mcp_tool_call');
  const lastMessage = items.findLast(item => item.type === 'agent_message')?.text;
  if (lastMessage) write(label + '-final.txt', lastMessage);
  const row = {
    label, task, arm, accepted, regression, scope, files, elapsedSeconds: execution.elapsedSeconds, exit: execution.status,
    infrastructureError: execution.error?.message ?? events.findLast(event => event.type === 'turn.failed')?.error?.message,
    shell: shell.length, inspection: shell.filter(item => /\b(rg|Get-Content|Get-ChildItem|git show|git grep|cat|Select-String)\b/i.test(item.command)).length,
    edits: items.filter(item => item.type === 'file_change').length,
    mcp: calls.length, successfulMcp: calls.filter(item => item.status === 'completed' && !item.error).length,
    testCommands: shell.filter(item => /\b(vitest|npm(?:\.cmd)? test|npm(?:\.cmd)? run test)\b/i.test(item.command)).length,
    usage: events.filter(event => event.type === 'turn.completed').at(-1)?.usage,
    checkExits: checks.map(result => result.status), patchSha256: hash(fs.readFileSync(delta))
  };
  results.runs.push(row);
  save();
  console.log(JSON.stringify(row));
}
