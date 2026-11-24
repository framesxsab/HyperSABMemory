import { describe, it, expect, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { HyperSABMemoryMcpServer } from '../src/mcp/server.js';
import { SqliteStore } from '../src/memory/sqliteStore.js';
import { TemporalMemoryEngine } from '../src/memory/temporalMemory.js';
import * as fs from 'fs';
import { removeTestDirs } from './testUtils.js';
import * as os from 'os';
import * as path from 'path';

const dirs: string[] = [];

function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-mcpr-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  removeTestDirs(dirs);
});

async function connectServer(dir: string): Promise<Client> {
  const mcp = new HyperSABMemoryMcpServer(dir);
  const client = new Client({ name: 'mcp-resources-test', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([mcp.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

async function connectCliStdio(dir: string): Promise<Client> {
  const cliEntry = path.resolve('dist/cli/index.js');
  expect(fs.existsSync(cliEntry)).toBe(true);
  const client = new Client({ name: 'mcp-cli-safety-test', version: '0.0.0' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [cliEntry, 'mcp'],
      cwd: dir,
      stderr: 'pipe'
    })
  );
  return client;
}

function toolText(result: Awaited<ReturnType<Client['callTool']>>): string {
  return ((result.content as Array<{ type: string; text?: string }>)?.[0]?.text ?? '');
}

function resourceText(result: Awaited<ReturnType<Client['readResource']>>): string {
  return String((result.contents[0] as { text?: string })?.text ?? '');
}

describe('HyperSABMemory — MCP Resources (F7)', () => {
  it('keeps existing resources and adds the task-list resource', async () => {
    const client = await connectServer(tmpDir());

    const { resources } = await client.listResources();

    expect(resources).toHaveLength(3);
    const uris = resources.map((r) => r.uri).sort();
    expect(uris).toEqual(['hypersabmemory://context-block', 'hypersabmemory://memory-log', 'hypersabmemory://tasks']);
  });

  it('reads context-block byte-identical to the hypersabmemory_context_block tool output', async () => {
    const dir = tmpDir();
    const memory = new TemporalMemoryEngine(dir);
    memory.remember('decision', 'Ship MCP resources additively');
    memory.remember('bug', 'Resource read must round-trip bytes');
    const client = await connectServer(dir);

    const resource = await client.readResource({ uri: 'hypersabmemory://context-block' });
    const tool = await client.callTool({ name: 'hypersabmemory_context_block', arguments: {} });

    expect(resource.contents).toHaveLength(1);
    expect(resource.contents[0].uri).toBe('hypersabmemory://context-block');
    expect(resource.contents[0].text).toBe(toolText(tool));
  });

  it('reads memory-log equal to the fixture Memory.md file bytes', async () => {
    const dir = tmpDir();
    const logBytes = '# Decision Log\n\n- 2026-08-23 [decision] keep tarball minimal\n';
    fs.writeFileSync(path.join(dir, 'Memory.md'), logBytes, 'utf-8');
    const client = await connectServer(dir);

    const resource = await client.readResource({ uri: 'hypersabmemory://memory-log' });

    expect(resource.contents).toHaveLength(1);
    expect(resource.contents[0].uri).toBe('hypersabmemory://memory-log');
    expect(resource.contents[0].text).toBe(logBytes);
  });

  it('reads memory-log as an empty string when Memory.md is absent', async () => {
    const client = await connectServer(tmpDir());

    const resource = await client.readResource({ uri: 'hypersabmemory://memory-log' });

    expect(resource.contents[0].text).toBe('');
  });

  it('prevents forgotten and superseded memories from surfacing via Memory.md, fresh MCP server, or restarted CLI MCP process', async () => {
    const dir = tmpDir();
    const memoryMdPath = path.join(dir, 'Memory.md');
    fs.writeFileSync(memoryMdPath, '# Project Memory\n', 'utf-8');
    fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'docs', 'service-notes.md'),
      'Decision: Use bounded local store.\nRationale: Keep local persistence deterministic.\n',
      'utf-8'
    );

    const clients: Client[] = [];
    const forgetCanary = 'CANARY_MCP_FORGET_7719_SIGMA';
    const forgetIntent = 'CANARY_MCP_FORGET_INTENT_7719';
    const sharedPrefix = 'CANARY_MCP_SUPERSEDE_SHARED_PREFIX_48_CHARS_0123456789';
    const supersededOldTail = 'CANARY_MCP_SUPERSEDED_OLD_8821';
    const supersededNext = 'CANARY_MCP_SUPERSEDED_NEXT_8821';
    const successorTail = 'CANARY_MCP_SUPERSEDING_NEW_9932';
    const keepCanary = 'CANARY_MCP_ACTIVE_KEEP_4402';

    try {
      // Session 1: CLI MCP child process creates memories, task, checks active visibility, then forgets & supersedes.
      const cliSession1 = await connectCliStdio(dir);
      clients.push(cliSession1);

      const forgetRemembered = await cliSession1.callTool({
        name: 'hypersabmemory_remember',
        arguments: {
          category: 'decision',
          content: `Legacy secret ${forgetCanary} must be forgotten cleanly.`,
          tags: ['mcp-canary'],
          intent: forgetIntent,
          artifacts: ['docs/service-notes.md']
        }
      });
      const forgetId = toolText(forgetRemembered).match(/Saved memory ID \[([^\]]+)\]/)?.[1];
      expect(forgetId).toBeTruthy();

      const supersededRemembered = await cliSession1.callTool({
        name: 'hypersabmemory_remember',
        arguments: {
          category: 'architecture',
          content: `${sharedPrefix}: ${supersededOldTail}`,
          tags: ['mcp-canary-v1'],
          artifacts: ['docs/service-notes.md'],
          nextSteps: supersededNext
        }
      });
      const supersededId = toolText(supersededRemembered).match(/Saved memory ID \[([^\]]+)\]/)?.[1];
      expect(supersededId).toBeTruthy();

      await cliSession1.callTool({
        name: 'hypersabmemory_remember',
        arguments: {
          category: 'decision',
          content: `Retain active fact ${keepCanary} across restarts.`,
          artifacts: ['docs/service-notes.md']
        }
      });

      const taskCreated = await cliSession1.callTool({
        name: 'hypersabmemory_task_create',
        arguments: {
          goal: 'Verify local memory safety across restarts',
          acceptanceCriteria: ['Exclude forgotten and superseded memories from current interfaces'],
          sourceRefs: ['Memory.md', 'docs/service-notes.md']
        }
      });
      const taskId = (taskCreated.structuredContent as { taskId: string }).taskId;
      expect(taskId).toBeTruthy();

      // Step 3: Active canaries appear in Memory.md, query, context_block, and hypersabmemory://memory-log.
      const activeLog = resourceText(await cliSession1.readResource({ uri: 'hypersabmemory://memory-log' }));
      expect(activeLog).toContain(forgetCanary);
      expect(activeLog).toContain(supersededOldTail);
      expect(activeLog).toContain(keepCanary);
      expect(fs.readFileSync(memoryMdPath, 'utf-8')).toBe(activeLog);
      expect(toolText(await cliSession1.callTool({ name: 'hypersabmemory_query', arguments: { query: forgetCanary } }))).toContain(forgetCanary);
      expect(toolText(await cliSession1.callTool({ name: 'hypersabmemory_context_block', arguments: {} }))).toContain(supersededOldTail);

      // Step 4 & 5: Forget via hypersabmemory_forget and supersede via remember (>= 48-char shared prefix).
      const forgotResp = await cliSession1.callTool({ name: 'hypersabmemory_forget', arguments: { id: forgetId } });
      expect(toolText(forgotResp)).toContain(`Forgot memory [${forgetId}]`);

      const successorRemembered = await cliSession1.callTool({
        name: 'hypersabmemory_remember',
        arguments: {
          category: 'architecture',
          content: `${sharedPrefix}: ${successorTail}`,
          tags: ['mcp-canary-v2'],
          artifacts: ['docs/service-notes.md']
        }
      });
      const successorId = toolText(successorRemembered).match(/Saved memory ID \[([^\]]+)\]/)?.[1];
      expect(successorId).toBeTruthy();

      await cliSession1.close();
      clients.pop();

      // Step 6: Memory.md is clean, while historical audit records stay in memory_store.json / SqliteStore.
      const memoryMdAfter = fs.readFileSync(memoryMdPath, 'utf-8');
      expect(memoryMdAfter).toContain(keepCanary);
      expect(memoryMdAfter).toContain(successorTail);
      for (const leaked of [forgetCanary, forgetIntent, supersededOldTail, supersededNext, '[forgotten]', '[superseded]']) {
        expect(memoryMdAfter).not.toContain(leaked);
      }

      const store = new SqliteStore(path.join(dir, '.hypersabmemory'));
      expect(store.get(forgetId!)?.status).toBe('forgotten');
      expect(store.get(forgetId!)?.invalidAt).toBeTruthy();
      expect(store.get(supersededId!)?.status).toBe('superseded');
      expect(store.get(supersededId!)?.tags).toContain(`superseded-by:${successorId}`);

      const rawStore = JSON.parse(fs.readFileSync(path.join(dir, '.hypersabmemory', 'memory_store.json'), 'utf-8')) as Array<{
        id: string;
        status?: string;
        content: string;
      }>;
      expect(rawStore.find((r) => r.id === forgetId)?.content).toContain(forgetCanary);
      expect(rawStore.find((r) => r.id === supersededId)?.content).toContain(supersededOldTail);

      // Step 7a: Fresh TemporalMemoryEngine + fresh in-memory HyperSABMemoryMcpServer.
      const freshEngine = new TemporalMemoryEngine(dir);
      expect(freshEngine.query(forgetCanary)).toEqual([]);
      expect(freshEngine.query(supersededOldTail)).toEqual([]);
      for (const leaked of [forgetCanary, forgetIntent, supersededOldTail, supersededNext]) {
        expect(freshEngine.getContextBlock()).not.toContain(leaked);
        expect(freshEngine.getSummary()).not.toContain(leaked);
        expect(JSON.stringify(freshEngine.getLedger(50))).not.toContain(leaked);
      }

      const freshInMemoryClient = await connectServer(dir);
      clients.push(freshInMemoryClient);

      // Step 7b: Freshly restarted child-process CLI MCP server (node dist/cli/index.js mcp).
      const restartedCliClient = await connectCliStdio(dir);
      clients.push(restartedCliClient);

      for (const client of [freshInMemoryClient, restartedCliClient]) {
        for (const source of ['all', 'memory', 'graph'] as const) {
          for (const q of [forgetCanary, supersededOldTail, 'CANARY_MCP_']) {
            const queryOut = toolText(await client.callTool({ name: 'hypersabmemory_query', arguments: { query: q, source } }));
            for (const leaked of [forgetCanary, forgetIntent, supersededOldTail, supersededNext]) {
              expect(queryOut).not.toContain(leaked);
            }
          }
        }
        const activeQueryOut = toolText(await client.callTool({ name: 'hypersabmemory_query', arguments: { query: 'CANARY_MCP_', source: 'memory' } }));
        expect(activeQueryOut).toContain(keepCanary);
        expect(activeQueryOut).toContain(successorTail);

        for (const q of [forgetCanary, supersededOldTail, 'service-notes.md CANARY_MCP_']) {
          const evPacket = JSON.parse(
            toolText(await client.callTool({ name: 'hypersabmemory_query_evidence', arguments: { query: q } }))
          ) as { question: string; records: Array<{ id: string }>; [key: string]: unknown };
          const { question: _echoedQuestion, ...evBody } = evPacket;
          const evSerialized = JSON.stringify(evBody);
          expect(evPacket.records.some((r) => r.id === forgetId || r.id === supersededId)).toBe(false);
          for (const leaked of [forgetCanary, forgetIntent, supersededOldTail, supersededNext]) {
            expect(evSerialized).not.toContain(leaked);
          }
        }

        const contextBlockOut = toolText(await client.callTool({ name: 'hypersabmemory_context_block', arguments: {} }));
        const getContextDefaultOut = toolText(await client.callTool({ name: 'hypersabmemory_get_context', arguments: {} }));
        const getContextMemoryMdOut = toolText(await client.callTool({ name: 'hypersabmemory_get_context', arguments: { activeFile: 'Memory.md' } }));
        const taskContextFullOut = toolText(await client.callTool({ name: 'hypersabmemory_task_context', arguments: { taskId, compact: false } }));
        const taskContextCompactOut = toolText(await client.callTool({ name: 'hypersabmemory_task_context', arguments: { taskId, compact: true } }));

        const resContextBlock = resourceText(await client.readResource({ uri: 'hypersabmemory://context-block' }));
        const resMemoryLog = resourceText(await client.readResource({ uri: 'hypersabmemory://memory-log' }));
        const resTasks = resourceText(await client.readResource({ uri: 'hypersabmemory://tasks' }));

        for (const surface of [
          contextBlockOut,
          getContextDefaultOut,
          getContextMemoryMdOut,
          taskContextFullOut,
          taskContextCompactOut,
          resContextBlock,
          resMemoryLog,
          resTasks
        ]) {
          for (const leaked of [forgetCanary, forgetIntent, supersededOldTail, supersededNext]) {
            expect(surface).not.toContain(leaked);
          }
        }

        expect(resMemoryLog).toBe(memoryMdAfter);
        expect(resContextBlock).toBe(contextBlockOut);
        expect(taskContextFullOut).toContain(keepCanary);
        expect(taskContextCompactOut).toContain(keepCanary);
      }
    } finally {
      await Promise.all(clients.map((client) => client.close()));
    }
  }, 30_000);
});
