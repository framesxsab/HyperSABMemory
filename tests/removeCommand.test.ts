import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { removeInjection } from '../src/cli/removeCommand.js';
import { UniversalAdaptersEngine } from '../src/harness/universalAdapters.js';
import { McpAccessEngine } from '../src/harness/mcpAccess.js';
import { TemporalMemoryEngine } from '../src/memory/temporalMemory.js';

const dirs: string[] = [];

function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-remove-'));
  dirs.push(dir);
  return dir;
}

interface Fixture {
  dir: string;
  agentsMd: string;
  cursorMcp: string;
}

function seedFixtureWorkspace(): Fixture {
  const dir = tmpDir();

  const agentsMd = path.join(dir, 'AGENTS.md');
  fs.writeFileSync(agentsMd, '# My Project\n\nCustom agent rules live here.\n');

  const cursorDir = path.join(dir, '.cursor');
  fs.mkdirSync(cursorDir, { recursive: true });
  const cursorMcp = path.join(cursorDir, 'mcp.json');
  fs.writeFileSync(
    cursorMcp,
    `${JSON.stringify({ mcpServers: { 'other-server': { command: 'uvx', args: ['some-server'] } } }, null, 2)}\n`
  );

  const memory = new TemporalMemoryEngine(dir);
  memory.remember('architecture', 'Remove fixture fact about the store');

  const adapters = new UniversalAdaptersEngine(dir);
  adapters.syncAllAdapters({ contextBlock: memory.getContextBlock() });

  const access = new McpAccessEngine(dir);
  access.connect();

  // Simulate user text written outside/below the injected marker block after setup.
  fs.appendFileSync(agentsMd, '\nUser footnote added after setup.\n');

  return { dir, agentsMd, cursorMcp };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('HyperSABMemory — remove command (H1)', () => {
  it('strips injected sections but preserves user text outside the markers', () => {
    const fixture = seedFixtureWorkspace();

    const result = removeInjection(fixture.dir);

    const agentsContent = fs.readFileSync(fixture.agentsMd, 'utf-8');
    expect(agentsContent).toContain('# My Project');
    expect(agentsContent).toContain('Custom agent rules live here.');
    expect(agentsContent).toContain('User footnote added after setup.');
    expect(agentsContent).not.toContain('HYPERSABMEMORY:START');
    expect(agentsContent).not.toContain('HYPERSABMEMORY:END');
    expect(agentsContent).not.toContain('HyperSABMemory AI Agent Harness Protocol');

    expect(result.cleanedFiles.some((f) => f.endsWith('AGENTS.md'))).toBe(true);
  });

  it('keeps other MCP servers while dropping the hypersabmemory entries', () => {
    const fixture = seedFixtureWorkspace();

    removeInjection(fixture.dir);

    const cursorConfig = JSON.parse(fs.readFileSync(fixture.cursorMcp, 'utf-8')) as {
      mcpServers: Record<string, unknown>;
    };
    expect(cursorConfig.mcpServers['other-server']).toEqual({ command: 'uvx', args: ['some-server'] });
    expect(cursorConfig.mcpServers.hypersabmemory).toBeUndefined();

    for (const rel of ['.mcp.json', path.join('.vscode', 'mcp.json')]) {
      const config = JSON.parse(fs.readFileSync(path.join(fixture.dir, rel), 'utf-8')) as {
        mcpServers?: Record<string, unknown>;
        servers?: Record<string, unknown>;
      };
      expect(config.mcpServers?.hypersabmemory ?? config.servers?.hypersabmemory).toBeUndefined();
    }
  });

  it('removes generated adapter files and the whole store directory', () => {
    const fixture = seedFixtureWorkspace();

    removeInjection(fixture.dir);

    expect(fs.existsSync(path.join(fixture.dir, '.hypersabmemory'))).toBe(false);
    expect(fs.existsSync(path.join(fixture.dir, '.cursor', 'rules', 'hypersabmemory.mdc'))).toBe(false);
    expect(fs.existsSync(path.join(fixture.dir, 'AGENTS.md'))).toBe(true);
  });

  it('is a safe no-op on an empty workspace without injected files', () => {
    const dir = tmpDir();

    expect(() => removeInjection(dir)).not.toThrow();
    expect(fs.existsSync(path.join(dir, '.hypersabmemory'))).toBe(false);
  });

  it('cleans the injected instructions field out of .claude.json', () => {
    const fixture = seedFixtureWorkspace();
    const claudeJson = path.join(fixture.dir, '.claude.json');

    removeInjection(fixture.dir);

    const payload = JSON.parse(fs.readFileSync(claudeJson, 'utf-8')) as { instructions?: string };
    expect(payload.instructions === undefined || !payload.instructions.includes('HYPERSABMEMORY:START')).toBe(true);
  });
});
