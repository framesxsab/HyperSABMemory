import { it, expect, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { HyperSABMemoryMcpServer } from '../src/mcp/server.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { HybridSearchEngine } from '../src/memory/hybridSearch.js';

it('registers grounded retrieval and keeps role relationships unresolved', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-reconcile-facts-'));
  const client = new Client({ name: 'reconcile-facts', version: '1' });
  try {
    for (const folder of ['src', 'src/routes', 'tests', 'docs']) fs.mkdirSync(path.join(dir, folder), { recursive: true });
    const files: Record<string, string> = {
      'src/claim.ts': 'export const MAX_TIMEOUT = 20;\nexport function claimTask() { return true; }\n',
      'src/routes/claim.ts': 'router.post("/claim", claimTask);\n',
      'tests/claim.test.ts': 'test("claim task", () => expect(claimTask()).toBe(true));\n',
      'docs/decision.md': 'Decision: claim task uses a lease.\n',
      'config.json': '{\n  "leaseMinutes": 10\n}\n'
    };
    for (const [filename, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, filename), content);
    const server = new HyperSABMemoryMcpServer(dir);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    expect((await client.listTools()).tools.some(tool => tool.name === 'hypersabmemory_task_grounded_query')).toBe(true);
    const created = await client.callTool({ name: 'hypersabmemory_task_create', arguments: { goal: 'Trace claim task', acceptanceCriteria: ['locate evidence'], sourceRefs: Object.keys(files) } });
    const taskId = (created.structuredContent as { taskId: string }).taskId;
    const result = await client.callTool({ name: 'hypersabmemory_task_grounded_query', arguments: { taskId, query: 'Find claim task implementation, test, route interface, and decision rationale.' } });
    const payload = result.structuredContent as { canAssert: boolean; requirements: Array<{ role: string; status: string; verifiedFacts: Array<{ sourcePath: string; excerpt: string; line: number }> }> };
    expect(payload.canAssert).toBe(false);
    for (const role of ['implementation', 'test', 'interface', 'decision']) {
      const requirement = payload.requirements.find(item => item.role === role);
      expect(requirement?.status).toBe('unresolved');
      expect(requirement?.verifiedFacts.length).toBeGreaterThan(0);
      for (const fact of requirement!.verifiedFacts) {
        expect(files[fact.sourcePath]).toContain(fact.excerpt);
        expect(files[fact.sourcePath].split(/\r?\n/)[fact.line - 1]).toContain(fact.excerpt);
      }
    }
    const interfaceRole = payload.requirements.find(item => item.role === 'interface');
    expect(interfaceRole?.verifiedFacts[0]).toMatchObject({ claim: expect.stringContaining('Source contains this router call statement:') });
    const implementation = payload.requirements.find(item => item.role === 'implementation');
    expect(implementation?.verifiedFacts[0]).toMatchObject({ claim: expect.stringContaining('claimTask'), line: 2 });
    const configuration = await client.callTool({ name: 'hypersabmemory_task_grounded_query', arguments: { taskId, query: 'What is the value of `leaseMinutes` in `config.json`?' } });
    const configPayload = configuration.structuredContent as { requirements: Array<{ role: string; status: string; verifiedFacts: Array<{ sourcePath: string; excerpt: string; line: number }> }> };
    expect(configPayload.requirements).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'configuration', status: 'unresolved', verifiedFacts: expect.arrayContaining([expect.objectContaining({ sourcePath: 'config.json', excerpt: '"leaseMinutes": 10', line: 2 })]) })]));
    const quote = await client.callTool({ name: 'hypersabmemory_task_grounded_query', arguments: { taskId, query: 'Does `config.json` contain `leaseMinutes`?' } });
    const quotePayload = quote.structuredContent as { canAssert: boolean; requirements: Array<{ role: string; verifiedFacts: unknown[] }> };
    expect(quotePayload.canAssert).toBe(true);
    expect(quotePayload.requirements.find(item => item.role === 'configuration')?.verifiedFacts).toEqual([]);
    fs.writeFileSync(path.join(dir, 'src', 'claim.ts'), files['src/claim.ts'].replace('claimTask', 'claimMask'));
    const stale = await client.callTool({ name: 'hypersabmemory_task_grounded_query', arguments: { taskId, query: 'Find claim task implementation.' } });
    const stalePayload = stale.structuredContent as { requirements: Array<{ verifiedFacts: Array<{ sourcePath: string }> }>; staleSources: Array<{ path: string; status: string }> };
    expect(stalePayload.staleSources).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'src/claim.ts', status: 'modified' })]));
    expect(stalePayload.requirements.flatMap(item => item.verifiedFacts).some(fact => fact.sourcePath === 'src/claim.ts')).toBe(false);
    const conflict = await client.callTool({ name: 'hypersabmemory_task_grounded_query', arguments: { taskId, query: 'Find claim task implementation and test.', conflictingPaths: ['src/claim.ts'] } });
    expect(conflict.structuredContent).toMatchObject({ status: 'CONFLICTING_EVIDENCE', canAssert: false });
    const conflicted = conflict.structuredContent as { requirements: Array<{ verifiedFacts: unknown[] }> };
    expect(conflicted.requirements.every(item => item.verifiedFacts.length === 0)).toBe(true);
  } finally {
    await client.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);

it('removes a role fact if its source changes while another role is being verified', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-fact-race-'));
  const client = new Client({ name: 'fact-race', version: '1' });
  try {
    for (const folder of ['src', 'tests']) fs.mkdirSync(path.join(dir, folder));
    const filename = path.join(dir, 'src', 'claim.ts');
    const original = 'export function claimTask() { return true; }\n';
    fs.writeFileSync(filename, original);
    fs.writeFileSync(path.join(dir, 'tests', 'claim.test.ts'), 'test("claim task", () => expect(claimTask()).toBe(true));\n');
    const server = new HyperSABMemoryMcpServer(dir);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const created = await client.callTool({ name: 'hypersabmemory_task_create', arguments: { goal: 'Trace claim task', acceptanceCriteria: ['locate evidence'], sourceRefs: ['src/claim.ts', 'tests/claim.test.ts'] } });
    const taskId = (created.structuredContent as { taskId: string }).taskId;
    const baseline = await client.callTool({ name: 'hypersabmemory_task_grounded_query', arguments: { taskId, query: 'Find claim task implementation and test.' } });
    const baselineRoles = (baseline.structuredContent as { requirements: Array<{ role: string; verifiedFacts: unknown[] }> }).requirements;
    expect(baselineRoles.find(item => item.role === 'implementation')?.verifiedFacts.length).toBeGreaterThan(0);
    const search = HybridSearchEngine.prototype.searchRecordsWithScores;
    let changed = false;
    vi.spyOn(HybridSearchEngine.prototype, 'searchRecordsWithScores').mockImplementation(function (this: HybridSearchEngine, query, ...args) {
      if (query.startsWith('Does `tests/claim.test.ts` contain')) {
        fs.writeFileSync(filename, original.replace('claimTask', 'claimMask'));
        changed = true;
      }
      return search.call(this, query, ...args);
    });
    const response = await client.callTool({ name: 'hypersabmemory_task_grounded_query', arguments: { taskId, query: 'Find claim task implementation and test.' } });
    expect(changed).toBe(true);
    const payload = response.structuredContent as { evidence: Array<{ source: { path: string } }>; staleSources: Array<{ path: string; status: string }>; requirements: Array<{ role: string; verifiedFacts: Array<{ sourcePath: string }>; candidates: Array<{ path: string }> }> };
    expect(payload.staleSources).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'src/claim.ts', status: 'modified' })]));
    expect(payload.evidence.some(item => item.source.path === 'src/claim.ts')).toBe(false);
    expect(payload.requirements.flatMap(item => item.verifiedFacts).some(fact => fact.sourcePath === 'src/claim.ts')).toBe(false);
    expect(payload.requirements.flatMap(item => item.candidates).some(item => item.path === 'src/claim.ts')).toBe(false);
    expect(payload.requirements.find(item => item.role === 'test')?.verifiedFacts.length).toBeGreaterThan(0);
  } finally {
    vi.restoreAllMocks();
    await client.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);

it('rechecks initial evidence after later role verification changes the source', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-role-race-'));
  const client = new Client({ name: 'role-race', version: '1' });
  try {
    fs.mkdirSync(path.join(dir, 'src'));
    const filename = path.join(dir, 'src', 'claim.ts');
    const original = 'export function claimTask() { return true; }\n';
    fs.writeFileSync(filename, original);
    const server = new HyperSABMemoryMcpServer(dir);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const created = await client.callTool({ name: 'hypersabmemory_task_create', arguments: { goal: 'Trace claim task', acceptanceCriteria: ['locate evidence'], sourceRefs: ['src/claim.ts'] } });
    const taskId = (created.structuredContent as { taskId: string }).taskId;
    const search = HybridSearchEngine.prototype.searchRecordsWithScores;
    let changed = false;
    vi.spyOn(HybridSearchEngine.prototype, 'searchRecordsWithScores').mockImplementation(function (this: HybridSearchEngine, query, ...args) {
      if (query === 'Where is `claimTask` defined?') {
        fs.writeFileSync(filename, original.replace('claimTask', 'claimMask'));
        changed = true;
      }
      return search.call(this, query, ...args);
    });
    const response = await client.callTool({ name: 'hypersabmemory_task_grounded_query', arguments: { taskId, query: 'Find claim task implementation.' } });
    expect(changed).toBe(true);
    expect(response.structuredContent).toMatchObject({ status: 'STALE_EVIDENCE', canAssert: false, evidence: [], staleSources: expect.arrayContaining([expect.objectContaining({ path: 'src/claim.ts', status: 'modified' })]) });
    const payload = response.structuredContent as { requirements: Array<{ verifiedFacts: unknown[]; candidates: unknown[] }> };
    expect(payload.requirements.every(item => item.verifiedFacts.length === 0 && item.candidates.length === 0)).toBe(true);
  } finally {
    vi.restoreAllMocks();
    await client.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);
