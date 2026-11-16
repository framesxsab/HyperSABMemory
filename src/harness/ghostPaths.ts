/**
 * HyperSABMemory — Ghost Paths Engine (F8)
 * Deterministic memory of dead timelines: warns when currently-edited files
 * overlap files captured in rolled-back safety snapshots. Read-only git calls,
 * bounded to the 3 most recent snapshot commits; zero output when silent.
 */

import { execFileSync } from 'child_process';
import { sleepSync } from '../memory/fileLock.js';

/** Opt-out flag: HYPERSABMEMORY_GHOST_PATHS=off disables the scan entirely. */
export const GHOST_PATHS_ENV = 'HYPERSABMEMORY_GHOST_PATHS';

/**
 * Exact subject of rollback-flow safety snapshots. AutoCommitEngine.rollback
 * calls createCheckpoint('safety: pre-rollback snapshot'), which prefixes
 * custom reasons with 'feat: ' — so the on-disk commit subject is this string.
 */
export const GHOST_SNAPSHOT_SUBJECT = 'feat: safety: pre-rollback snapshot';

const SNAPSHOT_WINDOW = 3;
const GIT_TIMEOUT_MS = 2000;
const LOCK_RETRY_WAIT_MS = 1000;
const LOCK_RETRY_MAX = 5;

export interface GhostHit {
  shortHash: string;
}

export function formatGhostLine(hit: GhostHit): string {
  return `[GHOST] files in this session match a rolled-back checkpoint (${hit.shortHash})`;
}

function normalizeRel(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

function isIndexLockError(err: unknown): boolean {
  return err instanceof Error && /index\.lock/.test(err.message);
}

/** Read-only git call; retries on index.lock contention, degrades to []. */
function gitLines(workspaceDir: string, args: string[]): string[] {
  for (let attempt = 1; ; attempt++) {
    try {
      const stdout = execFileSync('git', args, {
        cwd: workspaceDir,
        timeout: GIT_TIMEOUT_MS,
        encoding: 'utf-8'
      });
      return stdout.split('\n').map((l) => l.trim()).filter(Boolean);
    } catch (err) {
      if (attempt < LOCK_RETRY_MAX && isIndexLockError(err)) {
        sleepSync(LOCK_RETRY_WAIT_MS);
        continue;
      }
      return [];
    }
  }
}

/**
 * Returns the most recent snapshot commit (within the bounded window) whose
 * changed-file list intersects liveFiles, or null. Max git calls:
 * 1 log + SNAPSHOT_WINDOW diff-tree.
 */
export function detectGhostCollision(workspaceDir: string, liveFiles: readonly string[]): GhostHit | null {
  const live = new Set(liveFiles.map(normalizeRel).filter(Boolean));
  if (live.size === 0) return null;

  const hashes = gitLines(workspaceDir, [
    'log', `-n${SNAPSHOT_WINDOW}`, '--fixed-strings', `--grep=${GHOST_SNAPSHOT_SUBJECT}`, '--pretty=%H'
  ]);

  for (const hash of hashes.slice(0, SNAPSHOT_WINDOW)) {
    const changed = gitLines(workspaceDir, [
      'diff-tree', '--no-commit-id', '--name-only', '-r', '--root', hash
    ]);
    if (changed.some((f) => live.has(normalizeRel(f)))) {
      return { shortHash: hash.slice(0, 7) };
    }
  }
  return null;
}

export interface GhostPathsInput {
  workspaceDir?: string;
  activeFile?: string;
  modifiedFiles?: readonly string[];
}

/**
 * Live edit set = watcher-provided modifiedFiles + activeFile. Returns '' when
 * opted out, when there is nothing live to check, or when no snapshot collides
 * (byte-identical header; zero tokens).
 */
export function resolveGhostLine(input: GhostPathsInput): string {
  if (process.env[GHOST_PATHS_ENV] === 'off') return '';
  const liveFiles = [...(input.modifiedFiles ?? []), ...(input.activeFile ? [input.activeFile] : [])];
  if (liveFiles.length === 0) return '';
  const hit = detectGhostCollision(input.workspaceDir || process.cwd(), liveFiles);
  return hit ? formatGhostLine(hit) : '';
}
