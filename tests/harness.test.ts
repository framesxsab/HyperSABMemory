import { describe, it, expect } from 'vitest';
import { ContextHarness } from '../src/harness/contextHarness.js';
import { TokenCompressor } from '../src/harness/tokenCompressor.js';
import { HashAnchorEngine } from '../src/harness/hashAnchor.js';
import { StructuralGraphEngine } from '../src/memory/structuralGraph.js';
import { MinimalChangeEngine } from '../src/harness/minimalChange.js';
import { UniversalAdaptersEngine } from '../src/harness/universalAdapters.js';
import { McpAccessEngine, resolveMcpLaunch } from '../src/harness/mcpAccess.js';
import { HybridSearchEngine } from '../src/memory/hybridSearch.js';
import { buildContextBlock } from '../src/memory/contextBlock.js';
import { SqliteStore } from '../src/memory/sqliteStore.js';
import { AutoCommitEngine } from '../src/hooks/autoCommit.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('HyperSABMemory — Context Harness Tests', () => {
  it('should generate compressed state header', () => {
    const harness = new ContextHarness(1500);
    const header = harness.generateHeader({
      workspaceName: 'HyperSABMemory',
      activeFile: 'src/index.ts',
      modifiedFiles: ['src/hooks/autoCommit.ts'],
      memorySummary: 'Unit test execution'
    });

    expect(header).toContain('HYPERSABMEMORY :: CONTEXT HARNESS');
    expect(header).toContain('src/index.ts');
  });

  it('should compress long diff text under token limit', () => {
    const longText = 'A'.repeat(10000);
    const compressed = TokenCompressor.compressText(longText, 100);
    expect(TokenCompressor.estimateTokens(compressed)).toBeLessThanOrEqual(150);
  });

  it('should generate and verify hash anchors correctly', () => {
    const content = 'function hello() { return "world"; }';
    const hash = HashAnchorEngine.computeHash(content);
    expect(hash.length).toBe(8);
    expect(HashAnchorEngine.verifyAnchor(content, hash)).toBe(true);
    expect(HashAnchorEngine.verifyAnchor('different content', hash)).toBe(false);
  });

  it('should format structural knowledge graph summary', () => {
    const graph = new StructuralGraphEngine(process.cwd());
    const summary = graph.getGraphSummary();
    expect(summary).toContain('Structural knowledge graph');
  });

  it('should format minimal-change rules header', () => {
    const rules = new MinimalChangeEngine({ enabled: true });
    const header = rules.generateMinimalChangeHeader();
    expect(header).toContain('MINIMAL-CHANGE RULES');
  });

  it('should generate universal IDE rules across Cursor, Windsurf, Copilot, and Claude Code', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-adapt-'));
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# User agents\nKeep shipping.\n');
    fs.mkdirSync(path.join(dir, '.cursor', 'rules'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.cursor', 'rules', 'custom.mdc'), '---\ndescription: custom\n---\nUser rule\n');

    const adapters = new UniversalAdaptersEngine(dir);
    const ingested = adapters.ingestNativeRules();
    expect(ingested.some((r) => r.kind === 'agents-md')).toBe(true);
    expect(ingested.some((r) => r.relativePath.includes('custom.mdc'))).toBe(true);

    const res = adapters.syncAllAdapters({ contextBlock: '[CONTEXT BLOCK]\nFacts:\n- 2026-08-13 [decision] Local first' });
    expect(res.cursor).toBe(true);
    expect(res.agents).toBe(true);
    expect(res.createdFiles.length).toBeGreaterThan(0);

    const agents = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8');
    expect(agents).toContain('Keep shipping.');
    expect(agents).toContain('HYPERSABMEMORY:START');
    expect(agents).toContain('Local first');

    adapters.syncAllAdapters({ contextBlock: '[CONTEXT BLOCK]\nFacts:\n- updated' });
    const agents2 = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8');
    expect(agents2.split('HYPERSABMEMORY:START').length).toBe(2);
    expect(agents2).toContain('Keep shipping.');

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('should execute Quad-Hybrid search query', () => {
    const hybrid = new HybridSearchEngine(process.cwd());
    const results = hybrid.search('HyperSABMemory');
    expect(Array.isArray(results)).toBe(true);
  });

  it('should emit hashline and summarized read in the harness header', () => {
    const harness = new ContextHarness(1500);
    const content = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n');
    const header = harness.generateHeader({
      workspaceName: 'HyperSABMemory',
      activeFile: 'src/harness/contextHarness.ts',
      modifiedFiles: [],
      activeFileContent: content
    });
    expect(header).toContain('#H src/harness/contextHarness.ts');
    expect(header).toContain('summarized read');
  });

  it('should pack dated active facts into a Context Block', () => {
    const block = buildContextBlock([
      {
        id: 'a',
        category: 'decision',
        content: 'Use local SQLite-shaped JSON store',
        timestamp: '2026-08-13T00:00:00.000Z',
        status: 'active'
      },
      {
        id: 'b',
        category: 'decision',
        content: 'Old fact',
        timestamp: '2026-08-01T00:00:00.000Z',
        status: 'forgotten',
        invalidAt: '2026-08-13T00:00:00.000Z'
      }
    ]);
    expect(block).toContain('[CONTEXT BLOCK]');
    expect(block).toContain('Use local SQLite-shaped JSON store');
    expect(block).not.toContain('Old fact');
  });

  it('should forget and supersede overlapping memories', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-mem-'));
    const store = new SqliteStore(dir);
    store.set({ id: 'm1', category: 'decision', content: 'Token ceiling is 8000 tokens for headers' });
    store.set({ id: 'm2', category: 'decision', content: 'Token ceiling is 8000 tokens for headers and diffs' });
    store.supersede('m1', 'm2');
    expect(store.get('m1')?.status).toBe('superseded');
    expect(store.getActive().map((r) => r.id)).toEqual(['m2']);
    store.forget('m2');
    expect(store.getActive()).toHaveLength(0);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('should merge HyperSABMemory into Cursor, Claude, and VS Code MCP configs', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-mcp-'));
    fs.mkdirSync(path.join(dir, '.cursor'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.cursor', 'mcp.json'), JSON.stringify({
      mcpServers: { other: { command: 'echo', args: ['ok'] } }
    }));

    const access = new McpAccessEngine(dir);
    const result = access.connect();
    expect(result.written.length).toBe(3);

    const cursor = JSON.parse(fs.readFileSync(path.join(dir, '.cursor', 'mcp.json'), 'utf-8'));
    expect(cursor.mcpServers.other.command).toBe('echo');
    expect(cursor.mcpServers.hypersabmemory.args).toContain('mcp');
    expect(
      cursor.mcpServers.hypersabmemory.args.some(
        (a: string) => a.replace(/\\/g, '/').includes('dist/cli/index.js') || a === 'hypersabmemory'
      )
    ).toBe(true);

    const claude = JSON.parse(fs.readFileSync(path.join(dir, '.mcp.json'), 'utf-8'));
    expect(claude.mcpServers.hypersabmemory.command).toBeTruthy();

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('should render minimal-change ultra intensity with subagent inject', () => {
    const rules = new MinimalChangeEngine({ intensity: 'ultra' });
    expect(rules.generateMinimalChangeHeader()).toContain('subagent');
  });

  it('should reject rollback hashes that are not git object ids', async () => {
    const engine = new AutoCommitEngine({ workspaceDir: process.cwd() });
    expect(await engine.rollback('HEAD; rm -rf /')).toBe(false);
    expect(await engine.rollback('../.git')).toBe(false);
  });

  it('should wrap explicit online npx fallback in cmd /c on win32 so shell-less hosts can spawn it', () => {
    withPlatform('win32', () => {
      const launch = resolveMcpLaunch(os.tmpdir(), { packageRoot: null, allowOnlineFallback: true });
      expect(launch.command).toBe('cmd');
      expect(launch.args).toEqual(['/c', 'npx', '-y', 'hypersabmemory', 'mcp']);
      expect(launch.mode).toBe('online_npx');
    });
  });

  it('should keep the bare explicit online npx launch shape on darwin and linux', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      withPlatform(platform, () => {
        const launch = resolveMcpLaunch(os.tmpdir(), { packageRoot: null, allowOnlineFallback: true });
        expect(launch.command).toBe('npx');
        expect(launch.args).toEqual(['-y', 'hypersabmemory', 'mcp']);
        expect(launch.mode).toBe('online_npx');
      });
    }
  });
});

function withPlatform<T>(platform: NodeJS.Platform, fn: () => T): T {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  try {
    return fn();
  } finally {
    Object.defineProperty(process, 'platform', descriptor as PropertyDescriptor);
  }
}
