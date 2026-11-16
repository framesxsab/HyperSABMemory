/**
 * HyperSABMemory — Handoff Command Engine
 * Builds a paste-ready forward handoff brief (<= 600 tokens) or a deterministic
 * captain's-log retrospective rendered purely from local ledgers (no LLM/network).
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { readStoreRecords } from './cliUtils.js';
import { TokenCompressor } from '../harness/tokenCompressor.js';
import { StructuralGraphEngine } from '../memory/structuralGraph.js';
import type { MemoryRecord } from '../memory/sqliteStore.js';

const execFileAsync = promisify(execFile);

const TOKEN_BUDGET = 600;
const FACT_LIMIT = 8;
const NEXT_STEP_LIMIT = 6;
const CHECKPOINT_LIMIT = 5;

export interface HandoffOptions {
  story?: boolean;
}

const CATEGORY_RANK: Record<MemoryRecord['category'], number> = {
  architecture: 0,
  decision: 1,
  bug: 2,
  symbol: 3,
  general: 4
};

function isActive(record: MemoryRecord): boolean {
  return (record.status ?? 'active') === 'active';
}

async function gitLines(workspaceDir: string, args: string[]): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd: workspaceDir });
    return stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

async function focusLines(workspaceDir: string): Promise<string[]> {
  const branchLines = await gitLines(workspaceDir, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branchLines.length === 0) return [];
  const statusLines = await gitLines(workspaceDir, ['status', '--porcelain']);
  const files = statusLines.map((line) => line.slice(3).trim()).filter(Boolean);
  const detail = files.length
    ? `${files.length} uncommitted file(s): ${files.slice(0, 5).join(', ')}`
    : 'working tree clean';
  return [`- branch ${branchLines[0]} | ${detail}`];
}

async function checkpointLines(workspaceDir: string, limit: number): Promise<string[]> {
  // Same `checkpoint:` subject convention the AutoCommitEngine writes.
  const lines = await gitLines(
    workspaceDir,
    ['log', `-n${limit}`, '--grep=^checkpoint:', '--pretty=format:%h %s']
  );
  return lines.map((line) => `- ${line}`);
}

async function countCheckpoints(workspaceDir: string): Promise<number> {
  const lines = await gitLines(
    workspaceDir,
    ['rev-list', '--count', '--grep=^checkpoint:', 'HEAD']
  );
  const count = Number.parseInt(lines[0] ?? '', 10);
  return Number.isFinite(count) ? count : 0;
}

function topFacts(records: MemoryRecord[]): MemoryRecord[] {
  return records
    .filter(isActive)
    .sort((a, b) => {
      const rank = CATEGORY_RANK[a.category] - CATEGORY_RANK[b.category];
      if (rank !== 0) return rank;
      return b.timestamp.localeCompare(a.timestamp);
    })
    .slice(0, FACT_LIMIT);
}

function openNextSteps(records: MemoryRecord[]): string[] {
  const steps = new Set<string>();
  for (const record of records.filter(isActive)) {
    const step = record.nextSteps?.trim();
    if (step) steps.add(step);
    if (steps.size >= NEXT_STEP_LIMIT) break;
  }
  return Array.from(steps);
}

async function buildForwardBrief(workspaceDir: string): Promise<string> {
  const records = readStoreRecords(workspaceDir);
  const [focus, checkpoints] = await Promise.all([
    focusLines(workspaceDir),
    checkpointLines(workspaceDir, CHECKPOINT_LIMIT)
  ]);
  const facts = topFacts(records);
  const nextSteps = openNextSteps(records);

  const lines: string[] = ['# HyperSABMemory Handoff', '', '## Active focus'];
  lines.push(...(focus.length > 0 ? focus : ['- no git state captured']));
  lines.push('', '## Top active facts');
  lines.push(...(facts.length > 0
    ? facts.map((r) => `- [${r.category}] ${r.content}`)
    : ['- none recorded']));
  lines.push('', '## Open next steps');
  lines.push(...(nextSteps.length > 0
    ? nextSteps.map((step) => `- ${step}`)
    : ['- none recorded']));
  lines.push('', '## Recent checkpoints');
  lines.push(...(checkpoints.length > 0 ? checkpoints : ['- none found']));

  return TokenCompressor.compressText(lines.join('\n'), TOKEN_BUDGET);
}

async function buildStoryBrief(workspaceDir: string): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  const records = readStoreRecords(workspaceDir);
  const learnedToday = records.filter((r) => r.timestamp?.slice(0, 10) === today).length;
  const forgottenToday = records.filter(
    (r) => r.status === 'forgotten' && r.invalidAt?.slice(0, 10) === today
  ).length;
  const [checkpoints, graphNodes] = await Promise.all([
    countCheckpoints(workspaceDir),
    Promise.resolve(new StructuralGraphEngine(workspaceDir).getGraphData().nodes.length)
  ]);

  const lines: string[] = [
    `# Captain's Log — ${today}`,
    '',
    'Rendered purely from local ledgers (store timestamps, git log, graph.json). No model calls.',
    '',
    `- Facts learned today: ${learnedToday}`,
    `- Facts forgotten today: ${forgottenToday}`,
    `- Checkpoints recorded: ${checkpoints}`,
    `- Graph nodes mapped: ${graphNodes}`
  ];

  return TokenCompressor.compressText(lines.join('\n'), TOKEN_BUDGET);
}

/**
 * Builds the handoff brief. Forward mode is a paste-ready markdown brief under
 * the token budget; story mode is a byte-stable retrospective of today's ledgers.
 */
export async function buildHandoffBrief(
  workspaceDir: string,
  options: HandoffOptions = {}
): Promise<string> {
  return options.story ? buildStoryBrief(workspaceDir) : buildForwardBrief(workspaceDir);
}
