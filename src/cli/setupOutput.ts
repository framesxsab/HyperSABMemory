/**
 * HyperSABMemory — Setup Output Helpers
 * Renders the per-host MCP enable steps shown after a successful setup.
 */

import { McpAccessEngine, resolveMcpLaunch } from '../harness/mcpAccess.js';

export function setupNextStepsFlow(workspaceDir: string): string {
  const access = new McpAccessEngine(workspaceDir);
  return access.describeFlow({ launch: resolveMcpLaunch(workspaceDir), written: [] });
}
