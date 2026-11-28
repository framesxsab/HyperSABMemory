/**
 * HyperSABMemory — Direct MCP access for Cursor, Claude Code, and VS Code.
 * Merges a hypersabmemory server entry into native MCP config files without wiping other servers.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

export type McpHost = 'cursor' | 'claude' | 'vscode';
export type McpLaunchMode = 'workspace' | 'installed' | 'online_npx';

export interface McpLaunch {
  command: string;
  args: string[];
  mode?: McpLaunchMode;
}

export interface ResolveMcpLaunchOptions {
  /** Whether to fall back to `npx -y hypersabmemory mcp` when no installed CLI entry is found (default: true). */
  allowOnlineFallback?: boolean;
  /** Override the package root holding `package.json` + `dist/cli/index.js`; pass `null` to skip self-package lookup. */
  packageRoot?: string | null;
  /** Override the Node executable path (default: `process.execPath`). */
  nodeExecutable?: string;
}

export interface McpConnectResult {
  launch: McpLaunch;
  written: string[];
}

function hostLabel(host: McpHost): string {
  switch (host) {
    case 'cursor':
      return 'Cursor (.cursor/mcp.json)';
    case 'claude':
      return 'Claude Code (.mcp.json)';
    case 'vscode':
      return 'VS Code (.vscode/mcp.json)';
    default: {
      const _exhaustive: never = host;
      return _exhaustive;
    }
  }
}

const DEFAULT_PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function isEphemeralNpxCache(targetPath: string): boolean {
  return /(?:^|[\\/])_npx(?:[\\/]|$)/.test(targetPath);
}

function validatePackageCliEntry(packageRoot: string): string | null {
  try {
    const manifestPath = path.join(packageRoot, 'package.json');
    if (!fs.existsSync(manifestPath)) return null;
    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as { name?: unknown };
    if (!parsed || typeof parsed !== 'object' || parsed.name !== 'hypersabmemory') return null;

    const cliEntry = path.join(packageRoot, 'dist', 'cli', 'index.js');
    if (!fs.existsSync(cliEntry) || !fs.statSync(cliEntry).isFile()) return null;
    return path.resolve(cliEntry);
  } catch {
    return null;
  }
}

export function resolveMcpLaunch(workspaceDir: string, options: ResolveMcpLaunchOptions = {}): McpLaunch {
  const nodeExecutable = options.nodeExecutable ?? process.execPath;

  if (validatePackageCliEntry(workspaceDir)) {
    return { command: 'node', args: ['dist/cli/index.js', 'mcp'], mode: 'workspace' };
  }

  const consumerLocalEntry = validatePackageCliEntry(path.join(workspaceDir, 'node_modules', 'hypersabmemory'));
  if (consumerLocalEntry) {
    return { command: nodeExecutable, args: [consumerLocalEntry, 'mcp'], mode: 'installed' };
  }

  const packageRoot = options.packageRoot === undefined ? DEFAULT_PACKAGE_ROOT : options.packageRoot;
  if (packageRoot && !isEphemeralNpxCache(packageRoot)) {
    const installedEntry = validatePackageCliEntry(packageRoot);
    if (installedEntry) {
      return { command: nodeExecutable, args: [installedEntry, 'mcp'], mode: 'installed' };
    }
  }

  if (options.allowOnlineFallback === false) {
    throw new Error(
      'Unable to locate an installed hypersabmemory CLI entry point for offline MCP launch. ' +
      'Install hypersabmemory in this project (`npm install --save-dev hypersabmemory`) or run `setup` from an installed package.'
    );
  }

  if (process.platform === 'win32') {
    return { command: 'cmd', args: ['/c', 'npx', '-y', 'hypersabmemory', 'mcp'], mode: 'online_npx' };
  }
  return { command: 'npx', args: ['-y', 'hypersabmemory', 'mcp'], mode: 'online_npx' };
}

export const MCP_TOOL_FLOW = [
  'hypersabmemory_get_context',
  'hypersabmemory_remember',
  'hypersabmemory_query',
  'hypersabmemory_forget',
  'hypersabmemory_context_block',
  'hypersabmemory_inject_adapters',
  'hypersabmemory_checkpoint',
  'hypersabmemory_broadcast',
  'hypersabmemory_claim_task',
  'hypersabmemory_sync_swarm'
];

export class McpAccessEngine {
  private workspaceDir: string;

  constructor(workspaceDir: string = process.cwd()) {
    this.workspaceDir = workspaceDir;
  }

  public connect(): McpConnectResult {
    const launch = resolveMcpLaunch(this.workspaceDir);
    const configs = [
      this.planConfig('.cursor/mcp.json', 'mcpServers', launch),
      this.planConfig('.mcp.json', 'mcpServers', launch),
      this.planConfig('.vscode/mcp.json', 'servers', launch, { type: 'stdio' })
    ];
    const written = configs.map(({ abs, payload }) => {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
      return abs;
    });
    return { launch, written };
  }

  public describeFlow(result: McpConnectResult): string {
    const tools = MCP_TOOL_FLOW.map((name) => `  • ${name}`).join('\n');
    const launchLabel =
      result.launch.mode === 'online_npx'
        ? 'Launch (online npx fallback — requires npm registry or local npx cache)'
        : 'Launch (offline local)';
    return `Direct access is wired. Reload the IDE, then use these tools:

${tools}

Hosts:
  • ${hostLabel('cursor')}
  • ${hostLabel('claude')}
  • ${hostLabel('vscode')}

${launchLabel}: ${result.launch.command} ${result.launch.args.join(' ')}`;
  }

  private planConfig(
    relativePath: string,
    key: 'mcpServers' | 'servers',
    launch: McpLaunch,
    extra: Record<string, string> = {}
  ): { abs: string; payload: Record<string, unknown> } {
    const abs = path.join(this.workspaceDir, relativePath);
    let payload: Record<string, unknown> = {};
    try {
      const existing: unknown = JSON.parse(fs.readFileSync(abs, 'utf-8').replace(/^\uFEFF/, ''));
      if (!isConfigObject(existing)) throw new Error('expected a JSON object');
      payload = existing;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error('Cannot merge MCP configuration ' + relativePath + ': ' + (error instanceof SyntaxError ? 'invalid JSON' : (error as NodeJS.ErrnoException).code ?? (error as Error).message));
      }
    }

    const bucket = payload[key];
    if (bucket !== undefined && !isConfigObject(bucket)) {
      throw new Error('Cannot merge MCP configuration ' + relativePath + ': ' + key + ' must be a JSON object');
    }
    payload[key] = { ...bucket, hypersabmemory: { command: launch.command, args: launch.args, ...extra } };
    return { abs, payload };
  }
}

function isConfigObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
