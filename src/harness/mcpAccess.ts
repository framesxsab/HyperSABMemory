/**
 * HyperMemory — Direct MCP access for Cursor, Claude Code, and VS Code.
 * Merges a hypermemory server entry into native MCP config files without wiping other servers.
 */

import * as fs from 'fs';
import * as path from 'path';

export type McpHost = 'cursor' | 'claude' | 'vscode';

export interface McpLaunch {
  command: string;
  args: string[];
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

export function resolveMcpLaunch(workspaceDir: string): McpLaunch {
  const localBin = path.join(workspaceDir, 'dist', 'cli', 'index.js');
  if (fs.existsSync(localBin)) {
    return { command: 'node', args: ['dist/cli/index.js', 'mcp'] };
  }
  return { command: 'npx', args: ['-y', 'hypermemory', 'mcp'] };
}

export const MCP_TOOL_FLOW = [
  'hypermemory_get_context',
  'hypermemory_remember',
  'hypermemory_query',
  'hypermemory_forget',
  'hypermemory_context_block',
  'hypermemory_inject_adapters',
  'hypermemory_checkpoint',
  'hypermemory_broadcast',
  'hypermemory_claim_task',
  'hypermemory_sync_swarm'
];

export class McpAccessEngine {
  private workspaceDir: string;

  constructor(workspaceDir: string = process.cwd()) {
    this.workspaceDir = workspaceDir;
  }

  public connect(): McpConnectResult {
    const launch = resolveMcpLaunch(this.workspaceDir);
    const written = [
      this.mergeCursor(launch),
      this.mergeClaude(launch),
      this.mergeVscode(launch)
    ];
    return { launch, written };
  }

  public describeFlow(result: McpConnectResult): string {
    const tools = MCP_TOOL_FLOW.map((name) => `  • ${name}`).join('\n');
    return `Direct access is wired. Reload the IDE, then use these tools:

${tools}

Hosts:
  • ${hostLabel('cursor')}
  • ${hostLabel('claude')}
  • ${hostLabel('vscode')}

Launch: ${result.launch.command} ${result.launch.args.join(' ')}`;
  }

  private mergeCursor(launch: McpLaunch): string {
    const relativePath = path.join('.cursor', 'mcp.json');
    return this.mergeKeyedConfig(relativePath, 'mcpServers', launch);
  }

  private mergeClaude(launch: McpLaunch): string {
    return this.mergeKeyedConfig('.mcp.json', 'mcpServers', launch);
  }

  private mergeVscode(launch: McpLaunch): string {
    const relativePath = path.join('.vscode', 'mcp.json');
    return this.mergeKeyedConfig(relativePath, 'servers', launch, { type: 'stdio' });
  }

  private mergeKeyedConfig(
    relativePath: string,
    key: 'mcpServers' | 'servers',
    launch: McpLaunch,
    extra: Record<string, string> = {}
  ): string {
    const abs = path.join(this.workspaceDir, relativePath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    let payload: Record<string, unknown> = {};
    if (fs.existsSync(abs)) {
      try {
        payload = JSON.parse(fs.readFileSync(abs, 'utf-8')) as Record<string, unknown>;
      } catch {
        payload = {};
      }
    }
    const bucket = (payload[key] && typeof payload[key] === 'object' && !Array.isArray(payload[key]))
      ? { ...(payload[key] as Record<string, unknown>) }
      : {};
    bucket.hypermemory = { command: launch.command, args: launch.args, ...extra };
    payload[key] = bucket;
    fs.writeFileSync(abs, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
    return abs;
  }
}
