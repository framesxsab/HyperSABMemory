/**
 * HyperSABMemory — Universal IDE Rule Adapter Generator
 * Ingests native rule formats already on disk, then safely writes un-tracked or
 * opt-in HyperSABMemory sections (Cursor MDC, AGENTS.md, CLAUDE.md, Copilot, Windsurf, Claude JSON).
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export type NativeRuleKind =
  | 'cursor-mdc'
  | 'agents-md'
  | 'claude-md'
  | 'claude-json'
  | 'windsurf'
  | 'copilot'
  | 'antigravity-skill'
  | 'cline';

export interface NativeRuleFile {
  kind: NativeRuleKind;
  relativePath: string;
  body: string;
}

export interface AdapterSyncOptions {
  contextBlock?: string;
  /** Skip modifying Git-tracked instruction files by default unless explicitly opted out (`false`). */
  preserveTrackedFiles?: boolean;
  /** Optional pre-resolved normalized tracked paths (forward slashes, lowercased on win32). */
  trackedPaths?: ReadonlySet<string>;
}

export interface AdapterSyncResult {
  cursor: boolean;
  claude: boolean;
  windsurf: boolean;
  copilot: boolean;
  antigravity: boolean;
  agents: boolean;
  ingested: NativeRuleFile[];
  createdFiles: string[];
  skippedTrackedFiles: string[];
}

const ADAPTER_TARGET_PATHS = [
  path.posix.join('.cursor', 'rules', 'hypersabmemory.mdc'),
  'AGENTS.md',
  'CLAUDE.md',
  '.windsurfrules',
  path.posix.join('.github', 'copilot-instructions.md'),
  path.posix.join('.agents', 'skills', 'hypersabmemory', 'SKILL.md'),
  '.claude.json',
  '.clinerules'
];

function normalizeTrackedKey(relativePath: string): string {
  const posix = relativePath.replace(/\\/g, '/').replace(/^\.\//, '');
  return process.platform === 'win32' ? posix.toLowerCase() : posix;
}

const START = '<!-- HYPERSABMEMORY:START -->';
const END = '<!-- HYPERSABMEMORY:END -->';

const PROTOCOL = `# HyperSABMemory AI Agent Harness Protocol
- **State Harness**: Keep context headers under 1500 tokens. Read Memory.md on session start.
- **Structural Knowledge**: Query the structural knowledge graph (graph.json) before writing new modules. Re-use existing components.
- **Minimal-Change Rules**: Default to NO for unnecessary features. Use standard libraries. Write minimal code.
- **Auto-Commit Safety**: Work is auto-checkpointed every 3-5m under configured git author.
`;

function describeKind(kind: NativeRuleKind): string {
  switch (kind) {
    case 'cursor-mdc':
      return 'Cursor MDC';
    case 'agents-md':
      return 'AGENTS.md';
    case 'claude-md':
      return 'CLAUDE.md';
    case 'claude-json':
      return '.claude.json';
    case 'windsurf':
      return 'Windsurf';
    case 'copilot':
      return 'Copilot';
    case 'antigravity-skill':
      return 'Antigravity skill';
    case 'cline':
      return 'Cline';
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

export function injectHypersabmemorySection(existing: string, inner: string): string {
  const block = `${START}\n${inner.trim()}\n${END}`;
  if (existing.includes(START) && existing.includes(END)) {
    return existing.replace(new RegExp(`${START}[\\s\\S]*?${END}`), block);
  }
  if (!existing.trim()) return `${block}\n`;
  return `${existing.trimEnd()}\n\n${block}\n`;
}

export class UniversalAdaptersEngine {
  private workspaceDir: string;

  constructor(workspaceDir: string = process.cwd()) {
    this.workspaceDir = workspaceDir;
  }

  public ingestNativeRules(): NativeRuleFile[] {
    const found: NativeRuleFile[] = [];
    const cursorRulesDir = path.join(this.workspaceDir, '.cursor', 'rules');
    if (fs.existsSync(cursorRulesDir)) {
      for (const name of fs.readdirSync(cursorRulesDir)) {
        if (!name.endsWith('.mdc')) continue;
        const relativePath = path.join('.cursor', 'rules', name);
        found.push({
          kind: 'cursor-mdc',
          relativePath,
          body: this.readWorkspaceFile(relativePath)
        });
      }
    }

    const singles: Array<{ kind: NativeRuleKind; relativePath: string }> = [
      { kind: 'agents-md', relativePath: 'AGENTS.md' },
      { kind: 'claude-md', relativePath: 'CLAUDE.md' },
      { kind: 'claude-json', relativePath: '.claude.json' },
      { kind: 'windsurf', relativePath: '.windsurfrules' },
      { kind: 'copilot', relativePath: path.join('.github', 'copilot-instructions.md') },
      { kind: 'antigravity-skill', relativePath: path.join('.agents', 'skills', 'hypersabmemory', 'SKILL.md') },
      { kind: 'cline', relativePath: '.clinerules' }
    ];

    for (const entry of singles) {
      if (!fs.existsSync(path.join(this.workspaceDir, entry.relativePath))) continue;
      found.push({
        kind: entry.kind,
        relativePath: entry.relativePath,
        body: this.readWorkspaceFile(entry.relativePath)
      });
    }

    return found;
  }

  /**
   * Returns normalized Git-tracked paths among candidate adapter files, or empty set outside Git repos.
   */
  public getTrackedRelativePaths(candidates: string[] = ADAPTER_TARGET_PATHS): Set<string> {
    try {
      const stdout = execFileSync('git', ['ls-files', '--', ...candidates], {
        cwd: this.workspaceDir,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore']
      });
      const out = new Set<string>();
      for (const line of stdout.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed) out.add(normalizeTrackedKey(trimmed));
      }
      return out;
    } catch {
      return new Set<string>();
    }
  }

  /**
   * Merges HyperSABMemory into native rule files. Preserves user text outside markers and,
   * unless `preserveTrackedFiles` is explicitly set to `false`, leaves Git-tracked instruction files untouched.
   */
  public syncAllAdapters(options: AdapterSyncOptions = {}): AdapterSyncResult {
    const ingested = this.ingestNativeRules();
    const createdFiles: string[] = [];
    const skippedTrackedFiles: string[] = [];
    const inner = this.buildInjectBody(options.contextBlock);

    const preserveTracked = options.preserveTrackedFiles ?? true;
    const tracked = preserveTracked
      ? (options.trackedPaths ?? this.getTrackedRelativePaths(ADAPTER_TARGET_PATHS))
      : new Set<string>();
    const isTracked = (relPath: string): boolean => tracked.has(normalizeTrackedKey(relPath));

    const cursorRel = path.posix.join('.cursor', 'rules', 'hypersabmemory.mdc');
    const copilotRel = path.posix.join('.github', 'copilot-instructions.md');
    const skillRel = path.posix.join('.agents', 'skills', 'hypersabmemory', 'SKILL.md');

    const applyOrSkip = (relPath: string, writer: () => string): boolean => {
      if (isTracked(relPath)) {
        skippedTrackedFiles.push(relPath.replace(/\\/g, '/'));
        return false;
      }
      createdFiles.push(writer());
      return true;
    };

    const cursor = applyOrSkip(cursorRel, () => this.writeCursorHypersabmemoryMdc(inner));
    const agents = applyOrSkip('AGENTS.md', () => this.mergeMarkdown('AGENTS.md', inner));
    const claudeMd = applyOrSkip('CLAUDE.md', () => this.mergeMarkdown('CLAUDE.md', inner));
    const windsurf = applyOrSkip('.windsurfrules', () => this.mergeMarkdown('.windsurfrules', inner));
    const copilot = applyOrSkip(copilotRel, () => this.mergeMarkdown(path.join('.github', 'copilot-instructions.md'), inner, true));
    const antigravity = applyOrSkip(skillRel, () => this.mergeSkill(inner));
    const claudeJson = applyOrSkip('.claude.json', () => this.mergeClaudeJson(inner));

    const clinePath = path.join(this.workspaceDir, '.clinerules');
    if (fs.existsSync(clinePath)) {
      applyOrSkip('.clinerules', () => this.mergeMarkdown('.clinerules', inner));
    }

    return {
      cursor,
      claude: claudeMd || claudeJson,
      windsurf,
      copilot,
      antigravity,
      agents,
      ingested,
      createdFiles,
      skippedTrackedFiles
    };
  }

  private buildInjectBody(contextBlock?: string): string {
    const extra = contextBlock?.trim()
      ? `\n## Auto-injected Context Block\n${contextBlock.trim()}\n`
      : '';
    return `${PROTOCOL}${extra}`;
  }

  private writeCursorHypersabmemoryMdc(inner: string): string {
    const dir = path.join(this.workspaceDir, '.cursor', 'rules');
    fs.mkdirSync(dir, { recursive: true });
    const relativePath = path.join('.cursor', 'rules', 'hypersabmemory.mdc');
    const body = `---
description: HyperSABMemory agent rules
globs: "*"
alwaysApply: true
---
${inner}`;
    this.writeWorkspaceFile(relativePath, body);
    return path.join(this.workspaceDir, relativePath);
  }

  private mergeMarkdown(relativePath: string, inner: string, ensureParent = false): string {
    const abs = path.join(this.workspaceDir, relativePath);
    if (ensureParent) fs.mkdirSync(path.dirname(abs), { recursive: true });
    const existing = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf-8') : '';
    this.writeWorkspaceFile(relativePath, injectHypersabmemorySection(existing, inner));
    return abs;
  }

  private mergeSkill(inner: string): string {
    const relativePath = path.join('.agents', 'skills', 'hypersabmemory', 'SKILL.md');
    const abs = path.join(this.workspaceDir, relativePath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const existing = fs.existsSync(abs)
      ? fs.readFileSync(abs, 'utf-8')
      : `---\nname: hypersabmemory\ndescription: Universal IDE Context Harness & Memory Engine\n---\n`;
    this.writeWorkspaceFile(relativePath, injectHypersabmemorySection(existing, inner));
    return abs;
  }

  private mergeClaudeJson(inner: string): string {
    const relativePath = '.claude.json';
    const abs = path.join(this.workspaceDir, relativePath);
    let payload: { instructions?: string; [key: string]: unknown } = {};
    if (fs.existsSync(abs)) {
      try {
        payload = JSON.parse(fs.readFileSync(abs, 'utf-8')) as typeof payload;
      } catch {
        payload = {};
      }
    }
    const current = typeof payload.instructions === 'string' ? payload.instructions : '';
    payload.instructions = injectHypersabmemorySection(current, inner);
    this.writeWorkspaceFile(relativePath, `${JSON.stringify(payload, null, 2)}\n`);
    return abs;
  }

  private readWorkspaceFile(relativePath: string): string {
    return fs.readFileSync(path.join(this.workspaceDir, relativePath), 'utf-8');
  }

  private writeWorkspaceFile(relativePath: string, content: string): void {
    const abs = path.join(this.workspaceDir, relativePath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf-8');
  }
}

export { describeKind };
