/**
 * HyperSABMemory — Remove Command Engine
 * Clean uninstall: strips injected marker sections from rule files, removes
 * hypersabmemory entries from MCP configs (preserving other servers), and
 * deletes the local store directory. Never touches user text outside markers.
 */

import * as fs from 'fs';
import * as path from 'path';

// Marker literals mirror src/harness/universalAdapters.ts; redefined here because
// that module is owned by another workstream and exports no marker constants.
const START = '<!-- HYPERSABMEMORY:START -->';
const END = '<!-- HYPERSABMEMORY:END -->';

const MARKER_RULE_FILES = [
  'AGENTS.md',
  'CLAUDE.md',
  '.windsurfrules',
  path.join('.github', 'copilot-instructions.md'),
  '.clinerules',
  path.join('.agents', 'skills', 'hypersabmemory', 'SKILL.md')
];

const GENERATED_FILES = [
  path.join('.cursor', 'rules', 'hypersabmemory.mdc')
];

const MCP_TARGETS: Array<{ file: string; key: 'mcpServers' | 'servers' }> = [
  { file: path.join('.cursor', 'mcp.json'), key: 'mcpServers' },
  { file: '.mcp.json', key: 'mcpServers' },
  { file: path.join('.vscode', 'mcp.json'), key: 'servers' }
];

export interface RemoveResult {
  cleanedFiles: string[];
  removedFiles: string[];
  storeRemoved: boolean;
}

function stripInjectedSections(content: string): string {
  const pattern = new RegExp(`\\n*${START}[\\s\\S]*?${END}\\n*`, 'g');
  return content.replace(pattern, '');
}

function stripRuleFile(workspaceDir: string, relativePath: string, cleaned: string[]): void {
  const abs = path.join(workspaceDir, relativePath);
  if (!fs.existsSync(abs)) return;
  const original = fs.readFileSync(abs, 'utf-8');
  if (!original.includes(START)) return;
  fs.writeFileSync(abs, stripInjectedSections(original), 'utf-8');
  cleaned.push(abs);
}

function removeMcpEntry(workspaceDir: string, target: { file: string; key: 'mcpServers' | 'servers' }, cleaned: string[]): void {
  const abs = path.join(workspaceDir, target.file);
  if (!fs.existsSync(abs)) return;
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(fs.readFileSync(abs, 'utf-8')) as Record<string, unknown>;
  } catch {
    return;
  }
  const bucket = payload[target.key];
  if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) return;
  const entries = bucket as Record<string, unknown>;
  if (!('hypersabmemory' in entries)) return;
  delete entries.hypersabmemory;
  fs.writeFileSync(abs, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
  cleaned.push(abs);
}

function cleanClaudeJson(workspaceDir: string, cleaned: string[]): void {
  const abs = path.join(workspaceDir, '.claude.json');
  if (!fs.existsSync(abs)) return;
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(fs.readFileSync(abs, 'utf-8')) as Record<string, unknown>;
  } catch {
    return;
  }
  const instructions = payload.instructions;
  if (typeof instructions !== 'string' || !instructions.includes(START)) return;
  const stripped = stripInjectedSections(instructions).trim();
  if (stripped) {
    payload.instructions = stripped;
  } else {
    delete payload.instructions;
  }
  fs.writeFileSync(abs, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
  cleaned.push(abs);
}

/**
 * Removes everything HyperSABMemory injected into the workspace. Idempotent
 * and safe on workspaces where setup never ran.
 */
export function removeInjection(workspaceDir: string): RemoveResult {
  const cleanedFiles: string[] = [];
  const removedFiles: string[] = [];

  for (const relativePath of MARKER_RULE_FILES) {
    stripRuleFile(workspaceDir, relativePath, cleanedFiles);
  }
  cleanClaudeJson(workspaceDir, cleanedFiles);

  for (const target of MCP_TARGETS) {
    removeMcpEntry(workspaceDir, target, cleanedFiles);
  }

  for (const relativePath of GENERATED_FILES) {
    const abs = path.join(workspaceDir, relativePath);
    if (fs.existsSync(abs)) {
      fs.rmSync(abs, { force: true });
      removedFiles.push(abs);
    }
  }

  const storeDir = path.join(workspaceDir, '.hypersabmemory');
  const storeRemoved = fs.existsSync(storeDir);
  if (storeRemoved) {
    fs.rmSync(storeDir, { recursive: true, force: true });
  }

  return { cleanedFiles, removedFiles, storeRemoved };
}
