import { describe, it, expect, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { HyperSABMemoryMcpServer } from '../src/mcp/server.js';
import { TemporalMemoryEngine } from '../src/memory/temporalMemory.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const dirs: string[] = [];

function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-mcpr-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

async function connectServer(dir: string): Promise<Client> {
  const mcp = new HyperSABMemoryMcpServer(dir);
  const client = new Client({ name: 'mcp-resources-test', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([mcp.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe('HyperSABMemory — MCP Resources (F7)', () => {
  it('lists exactly two resources with the context-block and memory-log URIs', async () => {
    const client = await connectServer(tmpDir());

    const { resources } = await client.listResources();

    expect(resources).toHaveLength(2);
    const uris = resources.map((r) => r.uri).sort();
    expect(uris).toEqual(['hypersabmemory://context-block', 'hypersabmemory://memory-log']);
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
    expect(resource.contents[0].text).toBe(tool.content[0].text);
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
});
