import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export async function verifyHandoff(workspace, cli, npmCli) {
  mkdirSync(workspace);
  mkdirSync(path.join(workspace, 'src'));
  mkdirSync(path.join(workspace, 'tests'));
  const write = (name, value) => writeFileSync(path.join(workspace, name), value);
  write('package.json', JSON.stringify({ name: 'parcel-handoff-fixture', version: '1.0.0', private: true, type: 'module',
    scripts: { test: 'vitest run --maxWorkers=1 --pool=threads' }, devDependencies: { vitest: '4.1.12' } }));
  write('design.md', 'Decision: Keep parcel counts as whole numbers.\nRationale: Parcels are indivisible.\n');
  write('rules.md', 'Decision-Source: design.md\nConstraint: Clamp negative parcel counts to zero before reporting totals.\n');
  write('old.md', 'Decision: Allow negative parcel counts.\n');
  write('obsolete.md', 'Obsolete parcel policy marker retired-7d39.\n');
  write('src/math.ts', 'export function countParcels(value: number): number {\n  return value;\n}\n');
  write('src/shipping.ts', 'export function countParcelsBackup(value: number) { return value; }\n');
  write('tests/parcel.test.ts', "import { it, expect } from 'vitest';\nimport { countParcels } from '../src/math.js';\nit('retains positive parcel counts', () => expect(countParcels(4)).toBe(4));\nit('clamps negative parcel counts', () => expect(countParcels(-2)).toBe(0));\n");
  const connect = async () => {
    const client = new Client({ name: 'parcel-handoff', version: '1' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [cli, 'mcp'], cwd: workspace, stderr: 'pipe' }));
    return client;
  };
  async function call(client, name, args = {}) {
    const reply = await client.callTool({ name: 'hypersabmemory_' + name, arguments: args });
    assert.ok(!reply.isError, JSON.stringify(reply));
    return reply.structuredContent ?? reply.content[0].text;
  }
  const first = await connect();
  let taskId;
  const decision = 'Keep parcel counts as whole numbers.';
  const nextAction = 'Make negative parcel totals comply with the current constraint and run the parcel tests.';
  try {
    await call(first, 'scope_sources');
    const created = await call(first, 'task_create', {
      goal: 'Finish parcel counting', acceptanceCriteria: ['Parcel tests pass'], sourceRefs: ['design.md', 'rules.md', 'old.md', 'src/math.ts', 'tests/parcel.test.ts']
    });
    taskId = created.taskId;
    const owner = await call(first, 'task_claim', { taskId, agentId: 'handoff-seed' });
    const saved = await call(first, 'task_checkpoint', {
      taskId, agentId: 'handoff-seed', expectedRevision: owner.revision,
      leaseGeneration: owner.leaseGeneration, summary: 'Baseline tests describe parcel counting.', decisions: [decision], nextAction
    });
    await call(first, 'task_claim', { taskId, agentId: 'handoff-seed', action: 'release', leaseGeneration: saved.leaseGeneration });
    for (const [content, file] of [
      [decision, 'design.md'],
      ['Parcel counts reporting constraint', 'rules.md'],
      ['countParcels parcel counts implementation', 'src/math.ts'],
      ['countParcels parcel count test assertions', 'tests/parcel.test.ts'],
      ['countParcelsBackup alternate shipping label implementation', 'src/shipping.ts'],
      ['Obsolete parcel policy marker retired-7d39', 'obsolete.md']
    ]) {
      const remembered = await call(first, 'remember', { category: 'architecture', content, artifacts: [file] });
      if (file === 'obsolete.md') {
        const id = typeof remembered === 'string' ? remembered.match(/\[([^\]]+)\]/)?.[1] : remembered.id;
        assert.ok(id, JSON.stringify(remembered));
        await call(first, 'forget', { id });
      }
    }
    write('old.md', 'Decision: Allow NEGATIVE parcel counts.\n');
  } finally {
    await first.close();
  }
  const second = await connect();
  try {
    const resumed = await call(second, 'task_context', { taskId });
    assert.equal(resumed.answerBundle.recordedTask.nextAction, nextAction);
    assert.ok(resumed.sources.some(source => source.path === 'old.md' && source.status === 'modified'));
    assert.ok(resumed.decisionEvidence.every(item => item.sourcePath !== 'old.md'));
    assert.equal(resumed.decisionEvidence.find(item => item.decision === decision)?.rationale.text, 'Parcels are indivisible.');
    const query = async question => JSON.parse(await call(second, 'query_evidence', { query: question }));
    const design = await query('What decision was recorded about parcel counts, why, and which reporting constraint follows?');
    assert.ok(design.compoundAnswer, JSON.stringify(design));
    const implementation = await query('Where is countParcels implemented and which tests exercise it?');
    assert.ok(implementation.implementationEvidence.code.some(item => item.symbol === 'countParcels'));
    assert.ok(implementation.implementationEvidence.tests.some(item => item.name === 'clamps negative parcel counts' && item.execution === 'unverified'));
    assert.ok(!JSON.stringify(await query('What obsolete parcel policy marker was recorded?')).includes('retired-7d39'));
    assert.equal((await query('Does parcel counting work correctly under every possible input?')).answerVerified, false);
  } finally {
    await second.close();
  }
  console.log('Sprint 3.1 installed MCP handoff passed.');
  if (!process.env.HM31_CODEX) return;

  // npm 10.9.2 crashes resolving Vitest's optional peers in this disposable fixture.
  execFileSync(process.execPath, [npmCli, 'install', '--legacy-peer-deps', '--no-audit', '--no-fund'], { cwd: workspace, stdio: 'pipe' });
  const runTests = () => spawnSync(process.execPath, [npmCli, 'test'], { cwd: workspace, encoding: 'utf8' });
  const before = runTests();
  assert.equal(before.status, 1, 'unfinished parcel task starts with a failing test');
  assert.match(before.stderr, /expected -2 to be \+?0/i);
  const testFile = path.join(workspace, 'tests/parcel.test.ts');
  const testBefore = readFileSync(testFile, 'utf8');
  const windowsPath = name => name.replaceAll('\\', '/');
  const run = spawnSync(process.env.HM31_CODEX, ['-a', 'never', 'exec', '--json', '--ephemeral', '--ignore-user-config', '--skip-git-repo-check',
    '--sandbox', 'workspace-write', '-C', workspace,
    ...(process.platform === 'win32' ? ['-c', 'windows.sandbox="unelevated"'] : []),
    '-c', 'mcp_servers.hypersabmemory.command=' + JSON.stringify(windowsPath(process.execPath)),
    '-c', 'mcp_servers.hypersabmemory.args=' + JSON.stringify([windowsPath(cli), 'mcp']),
    '-c', 'mcp_servers.hypersabmemory.cwd=' + JSON.stringify(windowsPath(workspace)),
    '-c', 'mcp_servers.hypersabmemory.enabled_tools=["hypersabmemory_task_context","hypersabmemory_query_evidence"]',
    '-c', 'mcp_servers.hypersabmemory.default_tools_approval_mode="approve"',
    'Resume unfinished task ' + taskId + ' using the HyperSABMemory MCP task context and public evidence query tools. Ask your own filename-free project questions for the current constraint and relevant implementation and tests. Make the small implementation change in this disposable project, run npm test using npm.cmd on Windows, and report evidence and results. Keep the test files as written.'
  ], { cwd: workspace, encoding: 'utf8', timeout: 240000, maxBuffer: 4 * 1024 * 1024 });
  const events = run.stdout?.split(/\r?\n/).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } }) ?? [];
  const items = events.filter(event => event.type === 'item.completed').map(event => event.item);
  const toolCalls = items.filter(item => item.type === 'mcp_tool_call' && item.server === 'hypersabmemory' && item.status === 'completed').map(item => item.tool);
  const runsTests = items.some(item => item.type === 'command_execution' && /(?:npm(?:\.cmd)? test|vitest)/i.test(item.command) && item.exit_code === 0);
  const independent = runTests();
  const changed = readFileSync(path.join(workspace, 'src/math.ts'), 'utf8');
  const agentPassed = run.status === 0 && ['hypersabmemory_task_context', 'hypersabmemory_query_evidence'].every(tool => toolCalls.includes(tool)) &&
    runsTests && independent.status === 0 && !changed.includes('return value;') && readFileSync(testFile, 'utf8') === testBefore;
  console.log('Sprint 3.1 Codex result:', JSON.stringify({
    passed: agentPassed, exit: run.status, error: run.error?.code,
    failure: agentPassed ? undefined : (events.findLast(event => event.type === 'turn.failed')?.error?.message ??
      items.findLast(item => item.type === 'agent_message')?.text ?? run.stderr)?.slice(-900),
    toolCalls, runsTests, independentExit: independent.status, implementation: changed
  }));
}
