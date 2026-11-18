import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { verifyHandoff } from './sprint31-consumer.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npmCli = process.env.npm_execpath;
assert.ok(npmCli, 'run this smoke check through npm run package:smoke');

const manifest = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'hypersabmemory-package-smoke-'));
assert.equal(path.dirname(path.resolve(tempRoot)), path.resolve(os.tmpdir()), 'cleanup target is an isolated temp directory');

try {
  execFileSync(process.execPath, [npmCli, 'pack', '--pack-destination', tempRoot], {
    cwd: repoRoot,
    stdio: 'inherit'
  });
  const tarball = path.join(tempRoot, `${manifest.name}-${manifest.version}.tgz`);
  const installDir = path.join(tempRoot, 'install');

  execFileSync(process.execPath, [npmCli, 'install', '--prefix', installDir, '--no-audit', '--no-fund', tarball], {
    cwd: tempRoot,
    stdio: 'inherit'
  });

  const cli = path.join(installDir, 'node_modules', manifest.name, 'dist', 'cli', 'index.js');
  const version = execFileSync(process.execPath, [cli, '--version'], { encoding: 'utf8' }).trim();
  assert.equal(version, manifest.version, 'installed tarball CLI version matches package.json');

  const workspace = path.join(tempRoot, 'consumer');
  mkdirSync(workspace);
  execFileSync('git', ['init'], { cwd: workspace, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Package Smoke'], { cwd: workspace });
  execFileSync('git', ['config', 'user.email', 'package-smoke@example.invalid'], { cwd: workspace });
  writeFileSync(path.join(workspace, 'README.md'), '# Disposable consumer\n');
  mkdirSync(path.join(workspace, 'src'));
  mkdirSync(path.join(workspace, 'tests'));
  writeFileSync(path.join(workspace, 'Architecture.md'), '# Architecture\nDecision: Task creation validates input before routing.\nRationale: Reject invalid requests before dispatch.\n');
  writeFileSync(path.join(workspace, 'constraint-cross.md'), 'Decision-Source: Architecture.md\nConstraint: Reject invalid requests before dispatch.\n');
  writeFileSync(path.join(workspace, 'unrelated-cross.md'), 'Constraint: Task creation validates input before routing.\n');
  writeFileSync(path.join(workspace, 'conflict-cross.md'), 'Decision-Source: Architecture.md\nConstraint: Reject invalid requests.\nConstraint: Accept invalid requests.\n');
  writeFileSync(path.join(workspace, 'src', 'tasks.ts'), 'export function createTask() {}\n');
  writeFileSync(path.join(workspace, 'src', 'routes.ts'), 'export const taskRoute = "createTask";\n');
  writeFileSync(path.join(workspace, 'tests', 'tasks.test.ts'), 'test("createTask validates input", () => {});\n');
  writeFileSync(path.join(workspace, 'AGENTS.md'), '# User-owned instructions\nKeep these rules.\n');
  writeFileSync(path.join(workspace, '.mcp.json'), JSON.stringify({
    mcpServers: { 'user-server': { command: process.execPath, args: ['user-server.js'] } }
  }));
  execFileSync('git', ['add', 'README.md'], { cwd: workspace });
  execFileSync('git', ['commit', '-m', 'consumer baseline'], { cwd: workspace, stdio: 'ignore' });
  const baselineHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workspace, encoding: 'utf8' }).trim();
  execFileSync(process.execPath, [cli, 'setup'], { cwd: workspace, stdio: 'pipe' });
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workspace, encoding: 'utf8' }).trim(), baselineHead, 'setup does not commit by default');
  const configured = JSON.parse(readFileSync(path.join(workspace, '.mcp.json'), 'utf8'));
  assert.ok(configured.mcpServers.hypersabmemory, 'setup connects the local MCP server');
  assert.ok(configured.mcpServers['user-server'], 'setup preserves another MCP server');
  assert.ok(readFileSync(path.join(workspace, 'AGENTS.md'), 'utf8').includes('Keep these rules.'), 'setup preserves user-owned agent instructions');
  const storePath = path.join(workspace, '.hypersabmemory', 'memory_store.json');
  const initialRecords = JSON.parse(readFileSync(storePath, 'utf8'));
  const initialSeeds = initialRecords.filter((record) => record.source === 'seed').length;
  assert.ok(initialSeeds > 0, 'setup seeds local project memory');
  execFileSync(process.execPath, [cli, 'setup'], { cwd: workspace, stdio: 'pipe' });
  const repeatedRecords = JSON.parse(readFileSync(storePath, 'utf8'));
  assert.equal(repeatedRecords.filter((record) => record.source === 'seed').length, initialSeeds, 'repeated setup does not duplicate bootstrap facts');
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workspace, encoding: 'utf8' }).trim(), baselineHead, 'repeated setup does not create a Git commit');

  const fact = 'Packed installation recall probe';
  execFileSync(process.execPath, [cli, 'remember', fact], { cwd: workspace, stdio: 'pipe' });
  const recalled = execFileSync(process.execPath, [cli, 'list', '-q', fact], { cwd: workspace, encoding: 'utf8' });
  assert.ok(recalled.includes(fact), 'installed CLI remembers and recalls a fact');
  const { verifyMcpLaunch } = await import(pathToFileURL(path.join(installDir, 'node_modules', manifest.name, 'dist/cli/doctor.js')).href);
  const mcpConfigPath = path.join(workspace, '.mcp.json');
  const generatedConfig = JSON.parse(readFileSync(mcpConfigPath, 'utf8'));
  const generatedEntry = generatedConfig.mcpServers.hypersabmemory;
  assert.ok(generatedEntry, 'setup writes the supported MCP server entry');
  generatedConfig.mcpServers.hypersabmemory = { command: process.execPath, args: [cli, 'mcp'] };
  writeFileSync(mcpConfigPath, JSON.stringify(generatedConfig, null, 2));
  const cursorConfigPath = path.join(workspace, '.cursor', 'mcp.json');
  const cursorConfig = JSON.parse(readFileSync(cursorConfigPath, 'utf8'));
  assert.ok(cursorConfig.mcpServers.hypersabmemory, 'setup writes the Cursor MCP entry');
  cursorConfig.mcpServers.hypersabmemory = { command: process.execPath, args: [cli, 'mcp'] };
  writeFileSync(cursorConfigPath, JSON.stringify(cursorConfig, null, 2));
  const handshake = await verifyMcpLaunch(workspace, 10_000);
  assert.ok(handshake.ok, handshake.detail);

  const clients = [];
  const connect = async (name) => {
    const client = new Client({ name, version: '1' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [cli, 'mcp'], cwd: workspace, stderr: 'pipe' }));
    clients.push(client);
    return client;
  };
  try {
    const [agentA, agentB] = await Promise.all([connect('package-smoke-a'), connect('package-smoke-b')]);
    const tools = await agentA.listTools();
    assert.ok(tools.tools.some((tool) => tool.name === 'hypersabmemory_task_checkpoint'));
    for (const [file, description] of [
      ['src/memory/taskLedger.ts', 'Exclusive task claiming implementation, lease ownership and task coordination'],
      ['tests/taskLedger.test.ts', 'Exclusive task claiming tests and ownership assertions']
    ]) {
      mkdirSync(path.dirname(path.join(workspace, file)), { recursive: true });
      writeFileSync(path.join(workspace, file), readFileSync(path.join(repoRoot, file)));
      const recorded = await agentA.callTool({ name: 'hypersabmemory_remember', arguments: { category: 'architecture', content: description, artifacts: [file] } });
      assert.ok(!recorded.isError);
    }
    for (const [content, artifact] of [
      ['Task creation validates input before routing.', 'Architecture.md'],
      ['createTask task creation implementation', 'src/tasks.ts'],
      ['task creation route taskRoute', 'src/routes.ts'],
      ['task creation tests validate input', 'tests/tasks.test.ts']
    ]) {
      await agentA.callTool({ name: 'hypersabmemory_remember', arguments: { category: 'architecture', content, artifacts: [artifact] } });
    }
    writeFileSync(path.join(workspace, 'unindexed.json'), '{"port": 4321}');
    writeFileSync(path.join(workspace, 'evidence-config.json'), '{"port": 4321}');
    await agentA.callTool({ name: 'hypersabmemory_remember', arguments: { category: 'decision', content: 'The local service port is configured explicitly.', artifacts: ['evidence-config.json'] } });
    mkdirSync(path.join(workspace, 'design'), { recursive: true });
    mkdirSync(path.join(workspace, 'architecture'), { recursive: true });
    writeFileSync(path.join(workspace, 'design', 'storage-choice.md'), 'Decision: Use SQLite for task coordination.\nRationale: Preserve atomic task transitions.\n');
    writeFileSync(path.join(workspace, 'architecture', 'task-rules.md'), 'Decision-Source: design/storage-choice.md\nConstraint: Task updates must use a transactional coordinator.\n');
    await agentA.callTool({ name: 'hypersabmemory_remember', arguments: { category: 'decision', content: 'SQLite coordination preserves atomic task transitions.', artifacts: ['design/storage-choice.md'] } });
    await agentA.callTool({ name: 'hypersabmemory_remember', arguments: { category: 'architecture', content: 'The task implementation constraint requires transactional updates.', artifacts: ['architecture/task-rules.md'] } });
    writeFileSync(path.join(workspace, 'src', 'paymentFlow.ts'), 'export function checkPayment() { return "payment validation policy"; }\n');
    writeFileSync(path.join(workspace, 'tests', 'paymentFlow.test.ts'), 'test("payment validation policy", () => checkPayment());\n');
    const created = await agentA.callTool({ name: 'hypersabmemory_task_create', arguments: {
      goal: 'Verify packaged MCP task recovery', constraints: ['Keep validation local'], acceptanceCriteria: ['restore the checkpoint'],
      sourceRefs: ['README.md', 'Architecture.md', 'src/tasks.ts', 'src/routes.ts', 'tests/tasks.test.ts', 'unindexed.json', 'src/paymentFlow.ts', 'tests/paymentFlow.test.ts', 'constraint-cross.md', 'unrelated-cross.md', 'conflict-cross.md'], nextAction: 'claim and checkpoint from a second process'
    } });
    const taskId = created.structuredContent.taskId;
    const claimed = await agentA.callTool({ name: 'hypersabmemory_task_claim', arguments: { taskId, agentId: 'package-agent-a' } });
    assert.equal(claimed.isError, undefined);
    const claim = claimed.structuredContent;
    const denied = await agentB.callTool({ name: 'hypersabmemory_task_claim', arguments: { taskId, agentId: 'package-agent-b' } });
    assert.equal(denied.isError, true, 'second process cannot take the active lease');
    const saved = await agentA.callTool({ name: 'hypersabmemory_task_checkpoint', arguments: {
      taskId, agentId: 'package-agent-a', expectedRevision: claim.revision,
      leaseGeneration: claim.leaseGeneration, summary: 'package smoke milestone',
      decisions: ['Task creation validates input before routing.'],
      completedWork: ['installed package and connected two MCP clients'], evidencePaths: ['README.md'],
      nextAction: 'restore from a fresh MCP process', checks: ['setup created no Git commit']
    } });
    assert.equal(saved.isError, undefined);
    const peerContext = await agentB.callTool({ name: 'hypersabmemory_task_context', arguments: { taskId } });
    assert.ok(JSON.stringify(peerContext.structuredContent).includes('package smoke milestone'));
    assert.equal(peerContext.structuredContent.lease.status, 'active');
    assert.equal(peerContext.structuredContent.lease.recordedOwner, 'package-agent-a');
    assert.equal(peerContext.structuredContent.lease.generation, claim.leaseGeneration);
    const released = await agentA.callTool({ name: 'hypersabmemory_task_claim', arguments: { taskId, agentId: 'package-agent-a', action: 'release', leaseGeneration: claim.leaseGeneration } });
    assert.equal(released.isError, undefined);
    const acquired = await agentB.callTool({ name: 'hypersabmemory_task_claim', arguments: { taskId, agentId: 'package-agent-b' } });
    assert.equal(acquired.isError, undefined);
    const stale = await agentA.callTool({ name: 'hypersabmemory_task_checkpoint', arguments: { taskId, agentId: 'package-agent-a', expectedRevision: claim.revision, leaseGeneration: claim.leaseGeneration, summary: 'stale overwrite' } });
    assert.equal(stale.isError, true, 'stale owner cannot overwrite the new claim');
    const continued = await agentB.callTool({ name: 'hypersabmemory_task_checkpoint', arguments: { taskId, agentId: 'package-agent-b', expectedRevision: acquired.structuredContent.revision, leaseGeneration: acquired.structuredContent.leaseGeneration, summary: 'package smoke milestone continued', nextAction: 'inspect implementation and tests' } });
    assert.equal(continued.isError, undefined);
    const practical = [
      { file: 'memo.md', decision: 'Keep archive storage local.', query: 'What decision was recorded about archive storage?' },
      { file: 'journal.md', decision: 'Keep message delivery ordered.', query: 'What decision was recorded about message delivery?' }
    ];
    for (const item of practical) {
      writeFileSync(path.join(workspace, item.file), `Decision: ${item.decision}\nRationale: Preserve local guarantees.\n`);
      const created = await agentB.callTool({ name: 'hypersabmemory_task_create', arguments: { goal: 'Continue component work', acceptanceCriteria: ['Review constraints'], sourceRefs: [item.file] } });
      item.taskId = created.structuredContent.taskId;
    }
    await Promise.all(clients.splice(0).map((client) => client.close()));
    const restarted = await connect('package-smoke-restart');
    for (const item of practical) {
      const response = await restarted.callTool({ name: 'hypersabmemory_task_grounded_query', arguments: { taskId: item.taskId, query: item.query } });
      assert.equal(response.structuredContent.canAssert, false);
      const role = response.structuredContent.requirements.find(entry => entry.role === 'decision');
      assert.equal(role.status, 'unresolved');
      const fact = role.verifiedFacts.find(entry => entry.sourcePath === item.file);
      assert.equal(fact?.excerpt, `Decision: ${item.decision}`);
      assert.equal(fact.line, 1);
      assert.match(fact.sha256, /^[a-f0-9]{64}$/);
      writeFileSync(path.join(workspace, item.file), `Decision: ${item.decision.replace('local', 'LOCAL').replace('ordered', 'ORDERED')}\nRationale: Preserve local guarantees.\n`);
      const stale = await restarted.callTool({ name: 'hypersabmemory_task_grounded_query', arguments: { taskId: item.taskId, query: item.query } });
      assert.ok(stale.structuredContent.staleSources.some(entry => entry.path === item.file && entry.status === 'modified'));
      assert.ok(stale.structuredContent.requirements.flatMap(entry => entry.verifiedFacts).every(entry => entry.sourcePath !== item.file));
    }
    writeFileSync(path.join(workspace, 'sample-example.md'), '```text\nDecision: Keep invoice queues local.\n```\n');
    const sampleTask = await restarted.callTool({ name: 'hypersabmemory_task_create', arguments: { goal: 'Review invoice queues', acceptanceCriteria: ['Inspect decision'], sourceRefs: ['sample-example.md'] } });
    const sample = await restarted.callTool({ name: 'hypersabmemory_task_grounded_query', arguments: { taskId: sampleTask.structuredContent.taskId, query: 'What decision was recorded about invoice queues?' } });
    assert.equal(sample.structuredContent.canAssert, false);
    assert.deepEqual(sample.structuredContent.requirements.find(item => item.role === 'decision').verifiedFacts, []);
    const implementationQuery = async query => {
      const result = await restarted.callTool({ name: 'hypersabmemory_query_evidence', arguments: { query } });
      assert.ok(!result.isError);
      return JSON.parse(result.content[0].text);
    };
    for (const [kind, query] of [
      ['code', 'Where is exclusive task claiming implemented?'],
      ['code-and-test', 'Where is exclusive task claiming implemented, and what evidence supports its behavior?'],
      ['unsupported', 'Is exclusive task claiming race-free under all circumstances?']
    ]) {
      const packet = await implementationQuery(query);
      assert.equal(packet.answerVerified, false);
      if (kind === 'unsupported') assert.equal(packet.implementationEvidence, undefined);
      else {
        const claim = packet.implementationEvidence.code.find(item => item.symbol === 'TaskLedger.claim');
        assert.ok(claim?.facts.some(fact => fact.source.excerpt.includes('this.mutate(')));
        assert.ok(claim.facts.some(fact => fact.source.excerpt.includes('CLAIM_CONFLICT')));
        assert.match(claim.source.sha256, /^[a-f0-9]{64}$/);
        if (kind === 'code-and-test') {
          const test = packet.implementationEvidence.tests.find(item => item.name === 'rejects a second agent claiming an exclusively held task');
          assert.equal(test?.execution, 'unverified');
          console.log('Implementation evidence:', JSON.stringify({ claim: claim.source, test: test.source, facts: claim.facts }));
        }
      }
      const samples = [];
      for (let i = 0; i < 30; i++) {
        const start = performance.now();
        await implementationQuery(query);
        samples.push(performance.now() - start);
      }
      samples.sort((a, b) => a - b);
      console.log('Implementation latency:', JSON.stringify({ kind, n: samples.length, p50: samples[14], p95: samples[28] }));
    }
    const evidenceResult = await restarted.callTool({ name: 'hypersabmemory_query_evidence', arguments: { query: 'What did the project record about task creation before routing?' } });
    const evidencePacket = JSON.parse(evidenceResult.content[0].text);
    assert.equal(evidencePacket.question, 'What did the project record about task creation before routing?');
    assert.ok(evidencePacket.records.some(item => item.statement.includes('Task creation validates input before routing.')));
    assert.ok(evidencePacket.evidence.some(item => item.source.path === 'Architecture.md' && /^[a-f0-9]{64}$/.test(item.source.sha256) && item.source.freshness === 'current'));
    assert.equal(evidencePacket.answerVerified, false, 'ordinary language retrieval is evidence, not asserted entailment');
    assert.ok(evidencePacket.limitations.length > 0);
    const configAnswerResult = await restarted.callTool({ name: 'hypersabmemory_query_evidence', arguments: { query: 'What port is configured for the local service?' } });
    const configAnswer = JSON.parse(configAnswerResult.content[0].text);
    assert.equal(configAnswer.answerVerified, true);
    assert.ok(configAnswer.assertions.some(item => item.claim === 'Configuration port in evidence-config.json is 4321.'));
    assert.ok(configAnswer.evidence.some(item => item.source.path === 'evidence-config.json' && item.source.line === 1 && item.source.freshness === 'current'));
    const compoundResult = await restarted.callTool({ name: 'hypersabmemory_query_evidence', arguments: { query: 'What storage approach was chosen, why, and what implementation constraint follows?' } });
    const compound = JSON.parse(compoundResult.content[0].text);
    assert.equal(compound.compoundAnswer.status, 'source_verified');
    assert.equal(compound.compoundAnswer.implementationCompliance, 'not_verified');
    assert.equal(compound.claims.length, 3);
    assert.ok(compound.claims.every(item => item.directlyRecorded && item.source.freshness === 'current' && /^[a-f0-9]{64}$/.test(item.source.sha256)));
    assert.equal(compound.relationships[0].evidence.path, 'architecture/task-rules.md');
    assert.equal(compound.relationships[0].evidence.excerpt, 'Decision-Source: design/storage-choice.md');
    const decisionResult = await restarted.callTool({ name: 'hypersabmemory_query_evidence', arguments: { query: 'What decision was recorded about task creation before routing?' } });
    const decisionPacket = JSON.parse(decisionResult.content[0].text);
    assert.equal(decisionPacket.answerVerified, true);
    assert.ok(decisionPacket.records.some(item => item.statement === 'Task creation validates input before routing.'));
    assert.ok(decisionPacket.claims.some(item => item.type === 'recorded_decision' && item.value === 'Task creation validates input before routing.' && item.source.path === 'Architecture.md' && item.source.line === 2 && /^[a-f0-9]{64}$/.test(item.source.sha256)));
    const restored = await restarted.callTool({ name: 'hypersabmemory_task_context', arguments: { taskId } });
    assert.equal(restored.structuredContent.lease.status, 'active');
    assert.equal(restored.structuredContent.lease.recordedOwner, 'package-agent-b');
    assert.equal(restored.structuredContent.lease.generation, acquired.structuredContent.leaseGeneration);
    assert.ok(JSON.stringify(restored.structuredContent).includes('package smoke milestone'), 'fresh MCP process restores the durable checkpoint');
    assert.ok(JSON.stringify(restored.structuredContent).includes('README.md'), 'task context restores source evidence references');
    assert.ok(JSON.stringify(restored.structuredContent).includes('Task creation validates input before routing.'), 'task context restores the reported decision');
    assert.deepEqual(restored.structuredContent.decisionEvidence.map(item => ({ decision: item.decision, sourcePath: item.sourcePath, line: item.line })), [{ decision: 'Task creation validates input before routing.', sourcePath: 'Architecture.md', line: 2 }]);
    assert.deepEqual(restored.structuredContent.decisionEvidence[0].rationale, { text: 'Reject invalid requests before dispatch.', line: 3, excerpt: 'Rationale: Reject invalid requests before dispatch.' });
    assert.equal(restored.structuredContent.answerBundle.recordedTask.attribution, 'agent_reported');
    assert.deepEqual(restored.structuredContent.answerBundle.recordedTask.constraints, ['Keep validation local']);
    assert.equal(restored.structuredContent.answerBundle.recordedTask.nextAction, 'inspect implementation and tests');
    assert.equal(restored.structuredContent.answerBundle.linkedConstraints.length, 1);
    assert.equal(restored.structuredContent.answerBundle.linkedConstraints[0].decision, 'Task creation validates input before routing.');
    assert.equal(restored.structuredContent.answerBundle.linkedConstraints[0].constraint, 'Reject invalid requests before dispatch.');
    assert.equal(restored.structuredContent.answerBundle.linkedConstraints[0].taskDecisionMatch, 'exact_text_unverified');
    assert.ok(restored.structuredContent.answerBundle.linkedConstraints[0].sources.every(item => /^[a-f0-9]{64}$/.test(item.sha256)));
    assert.deepEqual(restored.structuredContent.answerBundle.linkedConstraints[0].sources.map(item => [item.path, item.line]), [['Architecture.md', 2], ['constraint-cross.md', 1], ['constraint-cross.md', 2]]);
    const crossQuery = name => `What constraint in \`${name}\` is recorded for the decision in \`Architecture.md\`?`;
    const cross = await restarted.callTool({ name: 'hypersabmemory_task_grounded_query', arguments: { taskId, query: crossQuery('constraint-cross.md') } });
    assert.equal(cross.structuredContent.canAssert, true);
    assert.equal(cross.structuredContent.answer.relationship, 'explicit_source_reference');
    assert.deepEqual(cross.structuredContent.answer.sources.map(item => [item.path, item.line]), [['Architecture.md', 2], ['constraint-cross.md', 1], ['constraint-cross.md', 2]]);
    for (const item of cross.structuredContent.answer.sources) assert.ok(readFileSync(path.join(workspace, item.path), 'utf8').split(/\r?\n/)[item.line - 1].includes(item.excerpt));
    const declaredCrossConflict = await restarted.callTool({ name: 'hypersabmemory_task_grounded_query', arguments: { taskId, query: crossQuery('constraint-cross.md'), conflictingPaths: ['Architecture.md', 'constraint-cross.md'] } });
    assert.equal(declaredCrossConflict.structuredContent.status, 'CONFLICTING_EVIDENCE');
    assert.equal(declaredCrossConflict.structuredContent.canAssert, false);
    for (const name of ['unrelated-cross.md', 'conflict-cross.md', 'missing-cross.md']) {
      const unsupported = await restarted.callTool({ name: 'hypersabmemory_task_grounded_query', arguments: { taskId, query: crossQuery(name) } });
      assert.equal(unsupported.structuredContent.canAssert, false);
      assert.equal(unsupported.structuredContent.status, 'INSUFFICIENT_EVIDENCE');
    }
    writeFileSync(path.join(workspace, 'constraint-cross.md'), 'Decision-Source: Architecture.md\nConstraint: Reject invalid requests before dispatcH.\n');
    const staleCross = await restarted.callTool({ name: 'hypersabmemory_task_grounded_query', arguments: { taskId, query: crossQuery('constraint-cross.md') } });
    assert.equal(staleCross.structuredContent.status, 'STALE_EVIDENCE');
    assert.equal(staleCross.structuredContent.canAssert, false);
    const staleContext = await restarted.callTool({ name: 'hypersabmemory_task_context', arguments: { taskId } });
    assert.deepEqual(staleContext.structuredContent.answerBundle.linkedConstraints, []);
    const decision = await restarted.callTool({ name: 'hypersabmemory_task_grounded_query', arguments: { taskId, query: 'Does `Architecture.md` contain `Task creation validates input before routing.`?' } });
    assert.equal(decision.structuredContent.canAssert, true, 'fresh process verifies the exact decision text');
    assert.equal(decision.structuredContent.assertions[0].sourcePath, 'Architecture.md');
    const quotation = await restarted.callTool({ name: 'hypersabmemory_task_grounded_query', arguments: { taskId, query: 'Does `src/tasks.ts` contain `export function createTask() {}`?' } });
    assert.equal(quotation.structuredContent.canAssert, true, 'fresh process verifies the source quotation');
    assert.equal(quotation.structuredContent.assertions[0].sourcePath, 'src/tasks.ts');
    const grounded = await restarted.callTool({ name: 'hypersabmemory_task_grounded_query', arguments: { taskId, query: 'Where is `createTask` defined?' } });
    assert.equal(grounded.structuredContent.canAssert, true, 'fresh process verifies the implementation source');
    assert.equal(grounded.structuredContent.assertions[0].sourcePath, 'src/tasks.ts');
    const ordinarySymbol = await restarted.callTool({ name: 'hypersabmemory_task_grounded_query', arguments: { taskId, query: 'Where is the function createTask() defined?' } });
    assert.equal(ordinarySymbol.structuredContent.canAssert, true, 'ordinary symbol questions verify the same declaration');
    assert.equal(ordinarySymbol.structuredContent.assertions[0].sourcePath, 'src/tasks.ts');
    const sourceOnly = await restarted.callTool({ name: 'hypersabmemory_task_grounded_query', arguments: { taskId, query: 'What is the value of `port` in `unindexed.json`?' } });
    assert.equal(sourceOnly.structuredContent.canAssert, true, 'fresh process verifies a source without a memory record');
    assert.equal(sourceOnly.structuredContent.evidence[0].record.id, 'source_ref:unindexed.json');
    const natural = await restarted.callTool({ name: 'hypersabmemory_task_grounded_query', arguments: { taskId, query: 'How is the payment validation policy implemented and tested?' } });
    assert.equal(natural.structuredContent.canAssert, false, 'natural-language retrieval does not assert entailment');
    const naturalPaths = natural.structuredContent.evidence.map(item => item.source.path);
    assert.ok(naturalPaths.includes('src/paymentFlow.ts') && naturalPaths.includes('tests/paymentFlow.test.ts'), 'fresh process retrieves unindexed implementation and test evidence');
    for (const [role, sourcePath] of [['implementation', 'src/paymentFlow.ts'], ['test', 'tests/paymentFlow.test.ts']]) {
      const requirement = natural.structuredContent.requirements.find(item => item.role === role);
      assert.equal(requirement?.status, 'unresolved');
      assert.ok(requirement.candidates.some(item => item.path === sourcePath && item.freshness === 'current' && /^[a-f0-9]{64}$/.test(item.sha256)), `fresh process returns current ${role} candidate`);
    }
    const missing = await restarted.callTool({ name: 'hypersabmemory_task_grounded_query', arguments: { taskId, query: 'What quantum telescope powers payment validation?' } });
    assert.equal(missing.structuredContent.canAssert, false, 'missing answers abstain');
    assert.equal(missing.structuredContent.status, 'INSUFFICIENT_EVIDENCE');
    writeFileSync(path.join(workspace, 'unindexed.json'), '{"port": 4322}');
    const conflictingCheckpoint = await restarted.callTool({ name: 'hypersabmemory_task_checkpoint', arguments: { taskId, agentId: 'package-agent-b', expectedRevision: continued.structuredContent.revision, leaseGeneration: acquired.structuredContent.leaseGeneration, evidencePaths: ['unindexed.json'] } });
    assert.equal(conflictingCheckpoint.isError, undefined);
    const conflict = await restarted.callTool({ name: 'hypersabmemory_task_grounded_query', arguments: { taskId, query: 'What is the value of `port` in `unindexed.json`?' } });
    assert.equal(conflict.structuredContent.status, 'CONFLICTING_EVIDENCE');
    assert.equal(conflict.structuredContent.canAssert, false, 'conflicting hashes block assertions');
    for (const query of ['task creation route taskRoute', 'task creation tests validate input']) {
      const found = await restarted.callTool({ name: 'hypersabmemory_query', arguments: { query, source: 'memory' } });
      const expected = query.includes('route') ? 'src/routes.ts' : 'tests/tasks.test.ts';
      assert.ok(JSON.stringify(found).includes(expected), `fresh process retrieves ${expected}`);
    }
  } finally {
    await Promise.all(clients.map((client) => client.close()));
  }

  execFileSync(process.execPath, [cli, 'remove'], { cwd: workspace, stdio: 'pipe' });
  assert.ok(readFileSync(path.join(workspace, 'AGENTS.md'), 'utf8').includes('Keep these rules.'), 'remove preserves user-owned agent instructions');
  const afterRemove = JSON.parse(readFileSync(path.join(workspace, '.mcp.json'), 'utf8'));
  assert.ok(afterRemove.mcpServers['user-server'], 'remove preserves another MCP server');
  assert.equal(afterRemove.mcpServers.hypersabmemory, undefined, 'remove removes the installed MCP entry');
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workspace, encoding: 'utf8' }).trim(), baselineHead, 'setup and removal do not create commits');

  await verifyHandoff(path.join(tempRoot, 'parcel-project'), cli, npmCli);
  process.stdout.write(`Packed install smoke passed: ${manifest.name}@${version}\n`);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
