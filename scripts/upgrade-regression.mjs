
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';


const repo = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(repo, 'package.json'), 'utf8'));
const npmCli = process.env.npm_execpath;
assert.ok(npmCli, 'run through npm run test:upgrade');
const versions = process.argv.slice(2);
if (!versions.length) versions.push('1.4.0', '1.4.1', '1.5.0-preview.1');
const exactVersion = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
assert.ok(versions.every(version => {
  const match = exactVersion.exec(version);
  return match?.[0] === version && !match[1]?.split('.').some(part => /^0\d+$/.test(part));
}), 'provide exact npm versions (stable or prerelease)');
const temp = mkdtempSync(path.join(os.tmpdir(), 'hm-upgrade-'));
const report = { candidate: manifest.version, results: [] };
const run = (cwd, command, ...args) => execFileSync(command, args, { cwd, encoding: 'utf8', timeout: 90_000, stdio: 'pipe' }).trim();
const git = (cwd, ...args) => run(cwd, 'git', ...args);
const cli = (cwd, entry, ...args) => run(cwd, process.execPath, entry, ...args);
const npm = (...args) => run(temp, process.execPath, npmCli, ...args);
const packageRoot = prefix => path.join(prefix, 'node_modules', manifest.name);
const entry = prefix => path.join(packageRoot(prefix), 'dist', 'cli', 'index.js');
const install = (prefix, spec) => npm('install', '--prefix', prefix, '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org', spec);
const readJson = file => JSON.parse(readFileSync(file, 'utf8'));
const custom = { command: 'user-owned', args: ['keep'] };

async function scenario(version, candidate, result) {
  const old = path.join(temp, version, 'legacy');
  const root = path.join(temp, version, 'main');
  const workspace = path.join(temp, version, 'linked');
  result.stage = 'install historical release';
  install(old, manifest.name + '@' + version);
  assert.equal(cli(temp, entry(old), '--version'), version);
  const { SqliteStore } = await import(pathToFileURL(path.join(packageRoot(old), 'dist', 'memory', 'sqliteStore.js')).href);

  result.stage = 'create linked fixture with released JSON store';
  mkdirSync(root, { recursive: true });
  git(root, 'init', '-b', 'main');
  git(root, 'config', 'user.name', 'Upgrade Fixture');
  git(root, 'config', 'user.email', 'upgrade@example.invalid');
  const userRules = '# User-owned agent rules\nKeep these instructions.\n';
  const userMemory = '# User memory\nKeep this paragraph.\n\n## Unmanaged notes\nKeep these notes.\n';
  writeFileSync(path.join(root, 'AGENTS.md'), userRules);
  writeFileSync(path.join(root, 'Memory.md'), userMemory);
  git(root, 'add', 'AGENTS.md', 'Memory.md');
  git(root, 'commit', '-m', 'fixture project');
  git(root, 'worktree', 'add', '--detach', workspace);
  const baselineHead = git(workspace, 'rev-parse', 'HEAD');
  const originalRules = readFileSync(path.join(workspace, 'AGENTS.md'), 'utf8');
  const state = path.join(workspace, '.hypersabmemory');
  const store = new SqliteStore(state);
  const put = (id, content) => store.set({ id, category: 'general', content, tags: ['legacy'] });
  put('legacy-current', 'cobalt active upgrade record');
  put('legacy-forget', 'saffron forgotten upgrade canary');
  put('legacy-retired', 'amber superseded upgrade canary');
  store.forget('legacy-forget');
  store.supersede('legacy-retired', 'legacy-current');
  const primary = path.join(state, 'memory_store.json');
  const legacyRecords = readJson(primary);
  assert.equal(legacyRecords.find(r => r.id === 'legacy-forget').status, 'forgotten');
  assert.equal(legacyRecords.find(r => r.id === 'legacy-retired').status, 'superseded');
  writeFileSync(primary + '.bak', readFileSync(primary));
  writeFileSync(primary + '.tmp', '{"interrupted":');
  writeFileSync(primary, '{"corrupt":');

  result.stage = 'create persisted baseline task and interrupted-session fixture';
  const historicalLedger = path.join(packageRoot(old), 'dist', 'memory', 'taskLedger.js');
  const publishedTaskLedger = existsSync(historicalLedger);
  result.taskFixture = publishedTaskLedger ? 'published task ledger' : 'synthetic baseline schema';
  const ledgerPath = publishedTaskLedger ? historicalLedger : path.join(repo, 'dist', 'memory', 'taskLedger.js');
  // Windows keeps native addons mapped until the process that loaded them exits.
  const { taskId, generation } = JSON.parse(run(workspace, process.execPath, '--input-type=module', '--eval', [
    'const { TaskLedger } = await import(process.argv[1]);',
    'const ledger = new TaskLedger(process.cwd(), { now: () => new Date("2025-01-01T00:00:00Z") });',
    'const task = ledger.create({ goal: "Restore the interrupted upgrade fixture", acceptanceCriteria: ["preserve lease history"] });',
    'const claim = ledger.claim({ taskId: task.id, agentId: "interrupted-agent", leaseMinutes: 1 });',
    'console.log(JSON.stringify({ taskId: task.id, generation: claim.leaseGeneration }));'
  ].join('\n'), pathToFileURL(ledgerPath).href));
  assert.ok(existsSync(path.join(state, 'tasks-coordinator.sqlite')));
  writeFileSync(path.join(state, 'tasks.json.tmp'), '{"interrupted":');

  result.stage = 'verify failed MCP configuration migration preserves files';
  const configs = [['.cursor/mcp.json', 'mcpServers'], ['.mcp.json', 'mcpServers'], ['.vscode/mcp.json', 'servers']];
  for (const [file, key] of configs) {
    const target = path.join(workspace, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, JSON.stringify({ [key]: { custom, hypersabmemory: { command: process.execPath, args: [entry(old), 'mcp'] } }, fixtureProperty: 'keep' }));
  }
  const brokenPath = path.join(workspace, '.vscode/mcp.json');
  const repaired = readFileSync(brokenPath, 'utf8');
  const broken = '{"servers":';
  writeFileSync(brokenPath, broken);
  const preserved = configs.map(([p]) => readFileSync(path.join(workspace, p), 'utf8'));
  const workspaceFiles = readdirSync(workspace, { recursive: true }).map(String).sort();
  const originalMemory = readFileSync(path.join(workspace, 'Memory.md'));
  const originalTaskLedger = readFileSync(path.join(state, 'tasks.json'));
  const failed = spawnSync(process.execPath, [entry(candidate), 'setup'], { cwd: workspace, encoding: 'utf8', timeout: 30_000 });
  assert.equal(failed.status, 1, failed.stderr || failed.stdout);
  assert.match(failed.stderr + failed.stdout, /Cannot merge MCP configuration/);
  assert.deepEqual(configs.map(([p]) => readFileSync(path.join(workspace, p), 'utf8')), preserved);
  assert.equal(readFileSync(primary, 'utf8'), '{"corrupt":');
  assert.deepEqual(readdirSync(workspace, { recursive: true }).map(String).sort(), workspaceFiles);
  assert.deepEqual(readFileSync(path.join(workspace, 'Memory.md')), originalMemory);
  assert.deepEqual(readFileSync(path.join(state, 'tasks.json')), originalTaskLedger);
  assert.equal(readFileSync(path.join(workspace, 'AGENTS.md'), 'utf8'), originalRules);
  writeFileSync(brokenPath, repaired);

  result.stage = 'run candidate setup twice and compare records and configuration';
  for (let run = 0; run < 2; run++) cli(workspace, entry(candidate), 'setup');
  for (const record of legacyRecords) assert.deepEqual(readJson(primary).find(item => item.id === record.id), record);
  const projection = readFileSync(path.join(workspace, 'Memory.md'), 'utf8');
  for (const excerpt of ['Keep this paragraph.', 'Keep these notes.', 'cobalt active upgrade record']) assert.ok(projection.includes(excerpt), excerpt);
  assert.doesNotMatch(projection, /saffron forgotten|amber superseded/);
  assert.equal(readFileSync(path.join(workspace, 'AGENTS.md'), 'utf8'), originalRules);
  assert.equal(git(workspace, 'rev-parse', 'HEAD'), baselineHead);
  assert.equal(git(workspace, 'diff', '--', 'AGENTS.md'), '');
  assert.ok(!existsSync(path.join(root, '.hypersabmemory')), 'linked setup must leave the main store untouched');
  for (const [file, key] of configs) {
    const config = readJson(path.join(workspace, file));
    assert.deepEqual(config[key].custom, custom);
    assert.equal(config.fixtureProperty, 'keep');
    assert.equal(path.resolve(config[key].hypersabmemory.args[0]), path.resolve(entry(candidate)));
  }
  assert.match(cli(workspace, entry(candidate), 'list', '-q', 'cobalt'), /cobalt active upgrade record/);

  result.stage = 'restore task over candidate stdio and reassign the expired lease';
  const client = new Client({ name: 'upgrade-fixture', version: '1' });
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [entry(candidate), 'mcp'], cwd: workspace, stderr: 'pipe' }));
    const restored = await client.callTool({ name: 'hypersabmemory_task_context', arguments: { taskId } });
    assert.equal(restored.isError, undefined, JSON.stringify(restored.structuredContent));
    assert.equal(restored.structuredContent.lease.status, 'expired');
    const reclaimed = await client.callTool({ name: 'hypersabmemory_task_claim', arguments: { taskId, agentId: 'resumed-agent' } });
    assert.ok(!reclaimed.isError, JSON.stringify(reclaimed.structuredContent));
    assert.ok(reclaimed.structuredContent.leaseGeneration > generation);
    assert.ok(!existsSync(path.join(state, 'tasks.json.tmp')));
  } finally {
    await client.close();
  }
  result.stage = 'complete';
}

try {
  const [packed] = JSON.parse(run(repo, process.execPath, npmCli, 'pack', '--ignore-scripts', '--json', '--pack-destination', temp));
  const tarball = path.join(temp, packed.filename);
  report.candidateIntegrity = 'sha512-' + createHash('sha512').update(readFileSync(tarball)).digest('base64');
  assert.equal(report.candidateIntegrity, packed.integrity);
  const candidate = path.join(temp, 'candidate');
  install(candidate, tarball);
  for (const version of versions) {
    const result = { version, passed: false };
    report.results.push(result);
    try {
      await scenario(version, candidate, result);
      result.passed = true;
    } catch (error) {
      result.error = String(error.stack ?? error);
    }
  }
  report.passed = report.results.every(result => result.passed);
} catch (error) {
  report.passed = false;
  report.error = String(error.stack ?? error);
} finally {
  try {
    rmSync(temp, { recursive: true, force: true, maxRetries: 5 });
  } catch (error) {
    report.passed = false;
    report.cleanupError = error.message;
  }
}
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
if (!report.passed) process.exitCode = 1;
