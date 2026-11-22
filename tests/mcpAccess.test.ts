import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { McpAccessEngine, resolveMcpLaunch } from '../src/harness/mcpAccess.js';
import { removeTestDirs } from './testUtils.js';

const tempDirs: string[] = [];

function makeTempDir(prefix = 'hm-mcp-access-'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function makeFakePackage(root: string, name = 'hypersabmemory', body = 'console.log("ok");\n'): string {
  fs.mkdirSync(path.join(root, 'dist', 'cli'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name, version: '1.4.1' }));
  const entry = path.join(root, 'dist', 'cli', 'index.js');
  fs.writeFileSync(entry, body);
  return path.resolve(entry);
}

function withPlatform<T>(platform: NodeJS.Platform, fn: () => T): T {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  try {
    return fn();
  } finally {
    Object.defineProperty(process, 'platform', descriptor as PropertyDescriptor);
  }
}

afterEach(() => {
  removeTestDirs(tempDirs);
});

describe('HyperSABMemory — offline MCP launch resolution', () => {
  it('prefers validated local workspace dist/cli/index.js inside the hypersabmemory repository', () => {
    const repo = makeTempDir('hm-repo-');
    makeFakePackage(repo, 'hypersabmemory');

    const launch = resolveMcpLaunch(repo);
    expect(launch).toEqual({
      command: 'node',
      args: ['dist/cli/index.js', 'mcp'],
      mode: 'workspace'
    });
  });

  it('ignores an unrelated dist/cli/index.js in an independent consumer workspace', () => {
    const root = makeTempDir('hm-unrelated-');
    const consumer = path.join(root, 'consumer project');
    fs.mkdirSync(consumer, { recursive: true });
    makeFakePackage(consumer, 'unrelated-user-app');

    expect(() => resolveMcpLaunch(consumer, { packageRoot: null, allowOnlineFallback: false })).toThrow(
      /offline MCP launch/i
    );
    const fallback = resolveMcpLaunch(consumer, { packageRoot: null, allowOnlineFallback: true });
    expect(fallback.args).not.toContain('dist/cli/index.js');
    expect(fallback.mode).toBe('online_npx');
  });

  it('throws an actionable error when allowOnlineFallback is false and no installed package exists', () => {
    const consumer = makeTempDir('hm-missing-pkg-');
    makeFakePackage(consumer, 'unrelated-consumer');

    expect(() => resolveMcpLaunch(consumer, { packageRoot: null, allowOnlineFallback: false })).toThrow(
      /offline MCP launch/i
    );
  });

  it('uses consumer node_modules/hypersabmemory entry without falling back to npx', () => {
    const consumer = makeTempDir('hm-local-nm-');
    const installedEntry = makeFakePackage(path.join(consumer, 'node_modules', 'hypersabmemory'), 'hypersabmemory');

    const launch = resolveMcpLaunch(consumer, { packageRoot: null });
    expect(launch).toEqual({
      command: process.execPath,
      args: [installedEntry, 'mcp'],
      mode: 'installed'
    });
  });

  it('resolves the validated installed packageRoot including paths with spaces and spawns with shell:false', () => {
    const root = makeTempDir('hm-spaced-');
    const consumer = path.join(root, 'my consumer repo');
    const pkgRoot = path.join(root, 'global prefix', 'node_modules', 'hypersabmemory');
    fs.mkdirSync(consumer, { recursive: true });
    const entryScript = [
      "if (process.argv[2] !== 'mcp') process.exit(2);",
      "let buf = '';",
      "process.stdin.on('data', (d) => {",
      "  buf += d.toString('utf8');",
      "  if (buf.includes('\\n')) {",
      "    process.stdout.write(JSON.stringify({ argv: process.argv.slice(2) }) + '\\n');",
      '    process.exit(0);',
      '  }',
      '});'
    ].join('\n');
    const installedEntry = makeFakePackage(pkgRoot, 'hypersabmemory', entryScript);

    const launch = resolveMcpLaunch(consumer, { packageRoot: pkgRoot });
    expect(launch).toEqual({
      command: process.execPath,
      args: [installedEntry, 'mcp'],
      mode: 'installed'
    });

    const spawned = spawnSync(launch.command, launch.args, {
      cwd: consumer,
      shell: false,
      encoding: 'utf8',
      input: '{"jsonrpc":"2.0","id":1,"method":"initialize"}\n',
      timeout: 5000
    });
    expect(spawned.status).toBe(0);
    expect(JSON.parse(spawned.stdout.trim())).toEqual({ argv: ['mcp'] });
  });

  it('treats ephemeral _npx cache paths as online fallback and labels describeFlow explicitly', () => {
    const root = makeTempDir('hm-npx-cache-');
    const consumer = path.join(root, 'consumer');
    const npxCachePkg = path.join(root, '_npx', 'hash123', 'node_modules', 'hypersabmemory');
    fs.mkdirSync(consumer, { recursive: true });
    makeFakePackage(npxCachePkg, 'hypersabmemory');

    const access = new McpAccessEngine(consumer);
    withPlatform('linux', () => {
      const launch = resolveMcpLaunch(consumer, { packageRoot: npxCachePkg });
      expect(launch).toEqual({
        command: 'npx',
        args: ['-y', 'hypersabmemory', 'mcp'],
        mode: 'online_npx'
      });
      const flow = access.describeFlow({ launch, written: [] });
      expect(flow).toMatch(/online npx fallback/i);
    });

    withPlatform('win32', () => {
      const launch = resolveMcpLaunch(consumer, { packageRoot: npxCachePkg });
      expect(launch).toEqual({
        command: 'cmd',
        args: ['/c', 'npx', '-y', 'hypersabmemory', 'mcp'],
        mode: 'online_npx'
      });
    });
  });

  it('connect() persists command/args without leaking internal mode metadata', () => {
    const root = makeTempDir('hm-connect-clean-');
    const consumer = path.join(root, 'consumer space');
    fs.mkdirSync(consumer, { recursive: true });
    const installedEntry = makeFakePackage(path.join(consumer, 'node_modules', 'hypersabmemory'), 'hypersabmemory');
    fs.writeFileSync(
      path.join(consumer, '.mcp.json'),
      JSON.stringify({ mcpServers: { keepme: { command: 'node', args: ['keep.js'] } } })
    );

    const access = new McpAccessEngine(consumer);
    const result = access.connect();
    expect(result.launch.mode).toBe('installed');

    const claude = JSON.parse(fs.readFileSync(path.join(consumer, '.mcp.json'), 'utf8'));
    expect(claude.mcpServers.keepme).toEqual({ command: 'node', args: ['keep.js'] });
    expect(claude.mcpServers.hypersabmemory).toEqual({
      command: process.execPath,
      args: [installedEntry, 'mcp']
    });
    expect(claude.mcpServers.hypersabmemory).not.toHaveProperty('mode');

    const vscode = JSON.parse(fs.readFileSync(path.join(consumer, '.vscode', 'mcp.json'), 'utf8'));
    expect(vscode.servers.hypersabmemory).toEqual({
      command: process.execPath,
      args: [installedEntry, 'mcp'],
      type: 'stdio'
    });
    expect(access.describeFlow(result)).toMatch(/offline local/i);
  });
});
