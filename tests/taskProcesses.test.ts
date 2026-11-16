import { it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { TaskLedger } from '../src/memory/taskLedger.js';
import { executeTaskTool } from '../src/mcp/taskTools.js';
import { TemporalMemoryEngine } from '../src/memory/temporalMemory.js';

it('marks requested roles unresolved when no verified sources are available', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-task-missing-roles-'));
  try {
    const ledger = new TaskLedger(dir);
    const task = ledger.create({ goal: 'Trace task claiming', acceptanceCriteria: ['find evidence'] });
    const result = executeTaskTool(dir, ledger, 'hypersabmemory_task_grounded_query', { taskId: task.id, query: 'Where is task claiming implemented, tested, and exposed through MCP?' });
    expect(result?.structuredContent).toMatchObject({ canAssert: false, requirements: [
      { role: 'implementation', status: 'unresolved', candidates: [] },
      { role: 'test', status: 'unresolved', candidates: [] },
      { role: 'interface', status: 'unresolved', candidates: [] }
    ] });
    const decision = executeTaskTool(dir, ledger, 'hypersabmemory_task_grounded_query', { taskId: task.id, query: 'Why was this decision made?' });
    expect(decision?.structuredContent).toMatchObject({ canAssert: false, requirements: [{ role: 'decision', status: 'unresolved', candidates: [] }] });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

it('exposes bounded unverified leads when a role has no matching evidence', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-task-role-lead-'));
  try {
    fs.mkdirSync(path.join(dir, 'src'));
    const file = path.join(dir, 'src', 'inventory.ts');
    fs.writeFileSync(file, 'export const amount = 10;\n');
    const ledger = new TaskLedger(dir);
    const task = ledger.create({ goal: 'Find the reservation implementation', acceptanceCriteria: ['inspect source'], sourceRefs: ['src/inventory.ts'] });
    const query = { taskId: task.id, query: 'Where is reservation implemented?' };
    const first = executeTaskTool(dir, ledger, 'hypersabmemory_task_grounded_query', query);
    expect(first?.structuredContent).toMatchObject({ canAssert: false, requirements: [{ role: 'implementation', status: 'unresolved', candidates: [], unrankedReferences: [{ path: 'src/inventory.ts', status: 'unverified', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }] }] });
    fs.writeFileSync(file, 'export const amount = 20;\n');
    const stale = executeTaskTool(dir, ledger, 'hypersabmemory_task_grounded_query', query);
    expect(stale?.structuredContent).toMatchObject({ canAssert: false, staleSources: [{ path: 'src/inventory.ts', status: 'modified' }], requirements: [{ status: 'unresolved', unrankedReferences: [{ path: 'src/inventory.ts', status: 'unverified' }] }] });
    const many = Array.from({ length: 7 }, (_, index) => `src/other${index}.ts`);
    for (const name of many) fs.writeFileSync(path.join(dir, name), 'export const amount = 10;\n');
    const otherTask = ledger.create({ goal: 'Find another implementation', acceptanceCriteria: ['inspect source'], sourceRefs: many });
    const bounded = executeTaskTool(dir, ledger, 'hypersabmemory_task_grounded_query', { taskId: otherTask.id, query: 'Where is reservation implemented?' });
    const roles = bounded?.structuredContent.requirements as Array<{ unrankedReferences: unknown[] }>;
    expect(roles[0].unrankedReferences).toHaveLength(5);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

it('retrieves role candidates using the subject of a multi-role question', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-task-focused-roles-'));
  try {
    for (const folder of ['src/orders', 'src/routes', 'tests/orders', 'docs/decisions']) fs.mkdirSync(path.join(dir, folder), { recursive: true });
    const files: Record<string, string> = {
      'src/orders/cancel.ts': 'export function cancelOrder() {}\n',
      'tests/orders/cancel.test.ts': 'test("cancel order", () => cancelOrder());\n',
      'src/routes/orderRoutes.ts': 'router.post("/orders/cancel", cancelOrder);\n',
      'docs/decisions/order.md': 'Decision: cancel orders explicitly because refunds must be reviewed.\n'
    };
    for (const [filename, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, filename), content);
    const ledger = new TaskLedger(dir);
    const task = ledger.create({ goal: 'Trace order cancellation', acceptanceCriteria: ['find evidence'], sourceRefs: Object.keys(files) });
    const result = executeTaskTool(dir, ledger, 'hypersabmemory_task_grounded_query', { taskId: task.id, query: 'Find the cancel order implementation, test, route interface, and decision rationale.' });
    const payload = result?.structuredContent as { canAssert: boolean; requirements: Array<{ role: string; status: string; candidates: Array<{ path: string; freshness: string }> }> };
    expect(payload.canAssert).toBe(false);
    for (const [role, filename] of [['implementation', 'src/orders/cancel.ts'], ['test', 'tests/orders/cancel.test.ts'], ['interface', 'src/routes/orderRoutes.ts'], ['decision', 'docs/decisions/order.md']]) {
      expect(payload.requirements).toEqual(expect.arrayContaining([expect.objectContaining({ role, status: 'unresolved', candidates: expect.arrayContaining([expect.objectContaining({ path: filename, freshness: 'current' })]) })]));
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

it('backfills an interface candidate outside the main evidence selection', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-task-role-backfill-'));
  try {
    fs.mkdirSync(path.join(dir, 'src', 'mcp'), { recursive: true });
    const sources = Array.from({ length: 6 }, (_, index) => `src/handler${index}.ts`);
    for (const filename of sources) fs.writeFileSync(path.join(dir, filename), '// task claiming implemented exposed\n');
    sources.push('src/mcp/server.ts');
    fs.writeFileSync(path.join(dir, 'src', 'mcp', 'server.ts'), '// task claiming exposed\n');
    const ledger = new TaskLedger(dir);
    const task = ledger.create({ goal: 'Trace task claiming', acceptanceCriteria: ['find interface'], sourceRefs: sources });
    const result = executeTaskTool(dir, ledger, 'hypersabmemory_task_grounded_query', { taskId: task.id, query: 'Where is task claiming implemented and exposed?' });
    const payload = result?.structuredContent as { canAssert: boolean; evidence: Array<{ source: { path: string } }>; requirements: Array<{ role: string; status: string; candidates: Array<{ path: string; freshness: string }> }> };
    expect(payload.canAssert).toBe(false);
    expect(payload.evidence.some(item => item.source.path === 'src/mcp/server.ts')).toBe(false);
    expect(payload.requirements).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'interface', status: 'unresolved', candidates: expect.arrayContaining([expect.objectContaining({ path: 'src/mcp/server.ts', freshness: 'current' })]) })]));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

it('searches a captured file even when an existing memory has unrelated wording', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-task-source-existing-memory-'));
  try {
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src', 'invoice.ts'), 'export function checkPayment() { return "payment validation policy"; }\n');
    new TemporalMemoryEngine(dir).remember('architecture', 'Invoice module metadata', [], { artifacts: ['src/invoice.ts'] });
    const ledger = new TaskLedger(dir);
    const task = ledger.create({ goal: 'Review payment checks', acceptanceCriteria: ['find validation policy'], sourceRefs: ['src/invoice.ts'] });
    const result = executeTaskTool(dir, ledger, 'hypersabmemory_task_grounded_query', { taskId: task.id, query: 'How is payment validation policy implemented?' });
    const payload = result?.structuredContent as { canAssert: boolean; evidence: Array<{ source: { path: string } }> };
    expect(payload.canAssert).toBe(false);
    expect(payload.evidence.map(item => item.source.path)).toContain('src/invoice.ts');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

it('retrieves multiple unindexed task sources for a natural question after restart', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-task-natural-sources-'));
  const clients: Client[] = [];
  const connect = async () => {
    const client = new Client({ name: 'task-natural-source-test', version: '1' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.resolve('dist/cli/index.js'), 'mcp'], cwd: dir, stderr: 'pipe' }));
    clients.push(client);
    return client;
  };
  try {
    fs.mkdirSync(path.join(dir, 'src'));
    fs.mkdirSync(path.join(dir, 'tests'));
    fs.writeFileSync(path.join(dir, 'src', 'invoice.ts'), 'export function createInvoice() { return validateInvoice(); } // invoice validation implementation\n');
    fs.writeFileSync(path.join(dir, 'src', 'routes.ts'), 'router.post("/invoice", createInvoice); // invoice validation route\n');
    fs.writeFileSync(path.join(dir, 'tests', 'invoice.test.ts'), 'test("invoice validation", () => createInvoice());\n');
    const first = await connect();
    const created = await first.callTool({ name: 'hypersabmemory_task_create', arguments: { goal: 'Review invoice validation', acceptanceCriteria: ['find implementation and tests'], sourceRefs: ['src/invoice.ts', 'src/routes.ts', 'tests/invoice.test.ts'] } });
    const taskId = (created.structuredContent as { taskId: string }).taskId;
    await first.close();
    clients.pop();
    const restarted = await connect();
    const result = await restarted.callTool({ name: 'hypersabmemory_task_grounded_query', arguments: { taskId, query: 'How does invoice validation work in the implementation and tests?' } });
    const payload = result.structuredContent as { canAssert: boolean; evidence: Array<{ source: { path: string }; record: { id: string } }>; requirements: Array<{ role: string; status: string; candidates: Array<{ path: string; sha256: string; freshness: string; excerpt?: string; line?: number }> }> };
    expect(payload.canAssert).toBe(false);
    expect(payload.evidence.map(item => item.source.path)).toEqual(expect.arrayContaining(['src/invoice.ts', 'tests/invoice.test.ts']));
    expect(payload.evidence.every(item => item.record.id.startsWith('source_ref:'))).toBe(true);
    expect(payload.requirements).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'implementation', status: 'unresolved', candidates: expect.arrayContaining([expect.objectContaining({ path: 'src/invoice.ts', freshness: 'current', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) })]) }),
      expect.objectContaining({ role: 'test', status: 'unresolved', candidates: expect.arrayContaining([expect.objectContaining({ path: 'tests/invoice.test.ts', freshness: 'current' })]) })
    ]));
    for (const requirement of payload.requirements) for (const candidate of requirement.candidates) {
      if (candidate.excerpt) expect(fs.readFileSync(path.join(dir, candidate.path), 'utf8')).toContain(candidate.excerpt);
      if (candidate.line) expect(candidate.line).toBe(1);
    }
    const missing = await restarted.callTool({ name: 'hypersabmemory_task_grounded_query', arguments: { taskId, query: 'What quantum telescope powers invoice validation?' } });
    expect(missing.structuredContent).toMatchObject({ status: 'INSUFFICIENT_EVIDENCE', canAssert: false, assertions: [] });
    fs.writeFileSync(path.join(dir, 'src', 'invoice.ts'), 'export function createInvoice() { return validateInvoice(); } // invoice validation changed here\n');
    const stale = await restarted.callTool({ name: 'hypersabmemory_task_grounded_query', arguments: { taskId, query: 'How does invoice validation work in the implementation and tests?' } });
    const stalePayload = stale.structuredContent as { canAssert: boolean; evidence: Array<{ source: { path: string } }>; staleSources: Array<{ path: string; status: string }> };
    expect(stalePayload.canAssert).toBe(false);
    expect(stalePayload.evidence.some(item => item.source.path === 'src/invoice.ts')).toBe(false);
    expect(stalePayload.staleSources).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'src/invoice.ts', status: 'modified' })]));
    expect(fs.existsSync(path.join(dir, '.hypersabmemory', 'memory_store.json'))).toBe(false);
  } finally {
    await Promise.all(clients.map(client => client.close()));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);

it('verifies task source references after restart without pre-indexed memory records', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-task-source-only-'));
  const clients: Client[] = [];
  const connect = async () => {
    const client = new Client({ name: 'task-source-only-test', version: '1' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.resolve('dist/cli/index.js'), 'mcp'], cwd: dir, stderr: 'pipe' }));
    clients.push(client);
    return client;
  };
  try {
    fs.writeFileSync(path.join(dir, 'config.json'), '{"port": 4321}');
    fs.writeFileSync(path.join(dir, 'widget.ts'), 'export class Widget {}');
    const first = await connect();
    const created = await first.callTool({ name: 'hypersabmemory_task_create', arguments: { goal: 'Recover source facts', acceptanceCriteria: ['verify source references'], sourceRefs: ['config.json', 'widget.ts'] } });
    const taskId = (created.structuredContent as { taskId: string }).taskId;
    await first.close();
    clients.pop();
    const restarted = await connect();
    for (const [query, filename] of [['What is the value of `port` in `config.json`?', 'config.json'], ['Where is `Widget` defined?', 'widget.ts'], ['Where is Widget defined?', 'widget.ts']]) {
      const result = await restarted.callTool({ name: 'hypersabmemory_task_grounded_query', arguments: { taskId, query } });
      expect(result.structuredContent).toMatchObject({ status: 'SUPPORTED', assertions: [{ sourcePath: filename }], evidence: [{ source: { path: filename }, line: 1 }] });
    }
    fs.writeFileSync(path.join(dir, 'widget.ts'), 'export class Gidget {}');
    const stale = await restarted.callTool({ name: 'hypersabmemory_task_grounded_query', arguments: { taskId, query: 'Where is `Widget` defined?' } });
    expect(stale.structuredContent).toMatchObject({ status: 'STALE_EVIDENCE', canAssert: false });
  } finally {
    await Promise.all(clients.map(client => client.close()));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);

it('reports conflicting task source and checkpoint evidence hashes through MCP', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-task-source-conflict-'));
  const client = new Client({ name: 'task-source-conflict-test', version: '1' });
  try {
    const file = path.join(dir, 'config.json');
    fs.writeFileSync(file, '{"port": 4321}');
    const ledger = new TaskLedger(dir);
    const created = ledger.create({ goal: 'Verify config', acceptanceCriteria: ['track source'], sourceRefs: ['config.json'] });
    const claimed = ledger.claim({ taskId: created.id, agentId: 'agent' });
    fs.writeFileSync(file, '{"port": 4322}');
    ledger.checkpoint({ taskId: created.id, agentId: 'agent', expectedRevision: claimed.revision, leaseGeneration: claimed.leaseGeneration, evidencePaths: ['config.json'] });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.resolve('dist/cli/index.js'), 'mcp'], cwd: dir, stderr: 'pipe' }));
    const result = await client.callTool({ name: 'hypersabmemory_task_grounded_query', arguments: { taskId: created.id, query: 'What is the value of `port` in `config.json`?' } });
    expect(result.structuredContent).toMatchObject({ status: 'CONFLICTING_EVIDENCE', canAssert: false, conflictOrigin: 'source_hash_mismatch', conflictPaths: ['config.json'], requirements: [{ role: 'configuration', status: 'unresolved', unrankedReferences: [] }] });
  } finally {
    await client.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);

it('restores a source-backed configuration assertion in a new MCP process', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-task-grounded-'));
  const clients: Client[] = [];
  const connect = async () => {
    const client = new Client({ name: 'grounded-process-test', version: '1' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.resolve('dist/cli/index.js'), 'mcp'], cwd: dir, stderr: 'pipe' }));
    clients.push(client);
    return client;
  };
  try {
    fs.writeFileSync(path.join(dir, 'config.json'), '{"port": 4321}');
    const first = await connect();
    await first.callTool({ name: 'hypersabmemory_remember', arguments: { category: 'decision', content: 'The service uses config port 4321.', artifacts: ['config.json'] } });
    const created = await first.callTool({ name: 'hypersabmemory_task_create', arguments: { goal: 'Restore the service configuration', acceptanceCriteria: ['Verify the port'], sourceRefs: ['config.json'] } });
    const taskId = (created.structuredContent as { taskId: string }).taskId;
    await first.close();
    clients.pop();
    const restarted = await connect();
    const args = { taskId, query: 'What is the value of `port` in `config.json`?' };
    const result = await restarted.callTool({ name: 'hypersabmemory_task_grounded_query', arguments: args });
    expect(result.structuredContent).toMatchObject({ status: 'SUPPORTED', assertions: [{ sourcePath: 'config.json', excerpt: '"port": 4321' }] });
    fs.writeFileSync(path.join(dir, 'config.json'), '{"port": 4322}');
    const stale = await restarted.callTool({ name: 'hypersabmemory_task_grounded_query', arguments: args });
    expect(stale.structuredContent).toMatchObject({ status: 'STALE_EVIDENCE', canAssert: false });
  } finally {
    await Promise.all(clients.map(client => client.close()));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);

it('coordinates competing MCP processes and restores after restart', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-task-process-'));
  const clients: Client[] = [];
  const connect = async () => {
    const client = new Client({ name: 'task-process-test', version: '1' });
    const transport = new StdioClientTransport({ command: process.execPath, args: [path.resolve('dist/cli/index.js'), 'mcp'], cwd: dir, stderr: 'pipe' });
    await client.connect(transport);
    clients.push(client);
    return client;
  };
  try {
    fs.writeFileSync(path.join(dir, 'Architecture.md'), 'Decision: Use a durable task ledger.\nRationale: Preserve checkpoints across process restarts.\n');
    fs.writeFileSync(path.join(dir, 'Constraints.md'), 'Decision: Keep processing local.\nRationale: Avoid a hosted service dependency.\n');
    const [a, b] = await Promise.all([connect(), connect()]);
    const remembered = await a.callTool({ name: 'hypersabmemory_remember', arguments: { category: 'general', content: 'forgotten quasarviolet marker' } });
    const memoryId = (remembered.content[0] as { text: string }).text.match(/Saved memory ID \[([^\]]+)\]/)?.[1];
    expect(memoryId).toBeTruthy();
    await a.callTool({ name: 'hypersabmemory_forget', arguments: { id: memoryId } });
    const call = async (client: Client, name: string, args: Record<string, unknown>) => client.callTool({ name: `hypersabmemory_task_${name}`, arguments: args });
    const created = await call(a, 'create', { goal: 'coordinate', constraints: ['Keep processing local'], acceptanceCriteria: ['restore'], sourceRefs: ['Architecture.md', 'Constraints.md'] });
    const taskId = (created.structuredContent as { taskId: string }).taskId;
    const claims = await Promise.all(['a', 'b'].map((agentId, index) => call(index ? b : a, 'claim', { taskId, agentId })));
    expect(claims.filter((result) => !result.isError)).toHaveLength(1);
    const winner = claims.findIndex((result) => !result.isError);
    const metadata = claims[winner].structuredContent as { revision: number; leaseGeneration: number };
    const saved = await call(winner ? b : a, 'checkpoint', { taskId, agentId: winner ? 'b' : 'a', expectedRevision: metadata.revision, leaseGeneration: metadata.leaseGeneration, summary: 'durable milestone', decisions: ['Use a durable task ledger.', 'Keep processing local.'], completedWork: ['Saved the checkpoint'], nextAction: 'Inspect the implementation' });
    expect(saved.isError).not.toBe(true);
    await Promise.all(clients.splice(0).map((client) => client.close()));
    const restarted = await connect();
    const restored = await call(restarted, 'context', { taskId });
    expect(JSON.stringify(restored.structuredContent)).toContain('durable milestone');
    expect(restored.structuredContent).toMatchObject({ lease: { status: 'active', generation: metadata.leaseGeneration, recordedOwner: winner ? 'b' : 'a' } });
    expect(restored.structuredContent).toMatchObject({ decisionEvidence: [
      { decision: 'Use a durable task ledger.', sourcePath: 'Architecture.md', line: 1, excerpt: 'Decision: Use a durable task ledger.', rationale: { text: 'Preserve checkpoints across process restarts.', line: 2, excerpt: 'Rationale: Preserve checkpoints across process restarts.' } },
      { decision: 'Keep processing local.', sourcePath: 'Constraints.md', rationale: { text: 'Avoid a hosted service dependency.', line: 2 } }
    ] });
    expect(JSON.stringify(restored.structuredContent)).toContain('Keep processing local');
    expect(JSON.stringify(restored.structuredContent)).toContain('Saved the checkpoint');
    expect(JSON.stringify(restored.structuredContent)).toContain('Inspect the implementation');
    const missing = await call(restarted, 'grounded_query', { taskId, query: 'What is the maintainer favorite color?' });
    expect(missing.structuredContent).toMatchObject({ canAssert: false, assertions: [] });
    const forgotten = await restarted.callTool({ name: 'hypersabmemory_query', arguments: { query: 'quasarviolet', source: 'memory' } });
    expect(JSON.stringify(forgotten.content)).not.toContain('quasarviolet');
    fs.writeFileSync(path.join(dir, 'Architecture.md'), 'Decision: Use a mutable task ledger.\nRationale: Preserve checkpoints across process restarts.\n');
    const changed = await call(restarted, 'context', { taskId });
    expect(changed.structuredContent).toMatchObject({ decisionEvidence: [{ sourcePath: 'Constraints.md' }], sources: expect.arrayContaining([expect.objectContaining({ path: 'Architecture.md', status: 'modified' })]) });
  } finally {
    await Promise.all(clients.map((client) => client.close()));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);

it('rejects a late expired-agent checkpoint after another MCP process takes ownership', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-task-fence-'));
  const clients: Client[] = [];
  try {
    const historical = new TaskLedger(dir, { now: () => new Date('2020-01-01T00:00:00.000Z') });
    const created = historical.create({ goal: 'fence stale agent', acceptanceCriteria: ['new owner wins'] });
    const expired = historical.claim({ taskId: created.id, agentId: 'agent-old', leaseMinutes: 1 });
    const connect = async () => {
      const client = new Client({ name: 'fencing-test', version: '1' });
      await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.resolve('dist/cli/index.js'), 'mcp'], cwd: dir, stderr: 'pipe' }));
      clients.push(client);
      return client;
    };
    const [oldAgent, newAgent] = await Promise.all([connect(), connect()]);
    const context = await oldAgent.callTool({ name: 'hypersabmemory_task_context', arguments: { taskId: created.id } });
    expect(context.structuredContent).toMatchObject({ lease: { status: 'expired', generation: expired.leaseGeneration, recordedOwner: 'agent-old' }, warnings: expect.arrayContaining([expect.stringContaining('lease has expired')]) });
    const acquired = await newAgent.callTool({ name: 'hypersabmemory_task_claim', arguments: { taskId: created.id, agentId: 'agent-old' } });
    const current = acquired.structuredContent as { revision: number; leaseGeneration: number };
    expect(acquired.isError).not.toBe(true);
    expect(current.leaseGeneration).toBeGreaterThan(expired.leaseGeneration);
    const late = await oldAgent.callTool({ name: 'hypersabmemory_task_checkpoint', arguments: {
      taskId: created.id, agentId: 'agent-old', expectedRevision: current.revision,
      leaseGeneration: expired.leaseGeneration, summary: 'late write'
    } });
    expect(late.isError).toBe(true);
    expect(JSON.stringify(late.structuredContent)).toContain('OWNERSHIP_CONFLICT');
    expect(new TaskLedger(dir).get(created.id).summary).toBe('');
  } finally {
    await Promise.all(clients.map(client => client.close()));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);

it('recovers after a crashed writer left a sentinel and partial temp file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-task-crash-'));
  try {
    const ledger = new TaskLedger(dir);
    const task = ledger.create({ goal: 'recover task write', acceptanceCriteria: ['preserve state'] });
    const stateDir = path.join(dir, '.hypersabmemory');
    const crashed = spawnSync(process.execPath, ['-e', "const fs=require('fs'),p=require('path');const d=process.argv[1];fs.writeFileSync(p.join(d,'tasks.json.lock'),JSON.stringify({pid:process.pid,acquiredAt:Date.now()}),{flag:'wx'});fs.writeFileSync(p.join(d,'tasks.json.tmp'),'{partial');process.exit(7)", stateDir]);
    expect(crashed.status).toBe(7);
    expect(ledger.claim({ taskId: task.id, agentId: 'recovered' }).owner).toBe('recovered');
    expect(new TaskLedger(dir).get(task.id).revision).toBe(task.revision + 1);
    expect(fs.existsSync(path.join(stateDir, 'tasks.json.tmp'))).toBe(false);
    expect(fs.existsSync(path.join(stateDir, 'tasks.json.lock'))).toBe(true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}, 30_000);

it('recovers SQLite ownership after a writer exits inside BEGIN IMMEDIATE', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-task-sqlite-crash-'));
  const clients: Client[] = [];
  try {
    const ledger = new TaskLedger(dir);
    const leased = ledger.create({ goal: 'keep active lease', acceptanceCriteria: ['retain owner'] });
    const owner = ledger.claim({ taskId: leased.id, agentId: 'agent-owner' });
    const dbPath = path.join(dir, '.hypersabmemory', 'tasks-coordinator.sqlite');
    const crash = spawnSync(process.execPath, ['-e', "const Database=require('better-sqlite3'),fs=require('fs'),path=require('path');const db=new Database(process.argv[1]);const run=db.transaction(()=>{db.prepare('UPDATE task_writer SET generation=generation WHERE id=1').run();fs.writeFileSync(path.join(path.dirname(process.argv[1]),'tasks.json.tmp'),'{partial');process.exit(17)});run.immediate()", dbPath]);
    expect(crash.status).toBe(17);

    const connect = async () => {
      const client = new Client({ name: 'sqlite-recovery-test', version: '1' });
      await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.resolve('dist/cli/index.js'), 'mcp'], cwd: dir, stderr: 'pipe' }));
      clients.push(client);
      return client;
    };
    const [a, b] = await Promise.all([connect(), connect()]);
    const results = await Promise.all([a, b].map((client, i) => client.callTool({ name: 'hypersabmemory_task_create', arguments: { goal: `recover ${i}`, acceptanceCriteria: ['persist'] } })));
    expect(results.every(result => result.isError !== true)).toBe(true);
    const contenders = await Promise.all([a, b].map((client, i) => client.callTool({ name: 'hypersabmemory_task_claim', arguments: { taskId: owner.id, agentId: `agent-${i}` } })));
    expect(contenders.every(result => result.isError === true)).toBe(true);
    expect(fs.existsSync(path.join(dir, '.hypersabmemory', 'tasks.json.tmp'))).toBe(false);
    expect(fs.existsSync(path.join(dir, '.hypersabmemory', 'tasks-coordinator.sqlite-journal'))).toBe(false);
    await Promise.all(clients.splice(0).map(client => client.close()));
    expect(new TaskLedger(dir).list().find(task => task.id === leased.id)?.owner).toBe('agent-owner');
    expect(new TaskLedger(dir).list()).toHaveLength(3);
  } finally {
    await Promise.all(clients.map(client => client.close()));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);
