/**
 * HyperSABMemory — Verified Git Worktree Resolution & Path Containment
 * Supports normal `.git` directories and linked `.git` worktree pointer files
 * while rejecting symlinks, malformed pointers, and forged escaping `gitdir:` links.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs';
import * as path from 'node:path';

const execFileAsync = promisify(execFile);

const MAX_POINTER_BYTES = 8192;

export interface VerifiedGitWorktree {
  rootDir: string;
  gitDir: string;
  commonDir: string;
  isLinkedWorktree: boolean;
}

export type GitWorktreeResolution =
  | { status: 'valid'; worktree: VerifiedGitWorktree }
  | { status: 'subdir' }
  | { status: 'invalid'; reason: string };

/** Resolve real filesystem path including symlinks and Windows 8.3 short names. */
export function canonicalPath(targetPath: string): string {
  const resolved = path.resolve(targetPath);
  try {
    return process.platform === 'win32'
      ? fs.realpathSync.native(resolved)
      : fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

export function sameCanonicalPath(leftPath: string, rightPath: string): boolean {
  const left = canonicalPath(leftPath);
  const right = canonicalPath(rightPath);
  return process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

export function isPathContained(rootPath: string, targetPath: string): boolean {
  const relative = path.relative(rootPath, targetPath);
  if (relative === '') return true;
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function readSingleLineControlFile(filePath: string): string | null {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(filePath);
  } catch {
    return null;
  }
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size === 0 || stat.size > MAX_POINTER_BYTES) {
    return null;
  }
  const raw = fs.readFileSync(filePath, 'utf-8');
  if (raw.includes('\0')) return null;
  const trimmed = raw.trim();
  if (!trimmed || /[\r\n]/.test(trimmed)) return null;
  return trimmed;
}

function isRealDirectory(dirPath: string): boolean {
  try {
    const lstat = fs.lstatSync(dirPath);
    if (lstat.isSymbolicLink()) return false;
    return lstat.isDirectory();
  } catch {
    return false;
  }
}

export function verifyGitWorktree(
  workspaceDir: string,
  gitDirRaw: string,
  toplevelRaw: string,
  options: { allowMockedMissingDotGit?: boolean } = {}
): GitWorktreeResolution {
  const toplevelTrimmed = toplevelRaw.trim();
  if (!toplevelTrimmed || !sameCanonicalPath(workspaceDir, toplevelTrimmed)) {
    return { status: 'subdir' };
  }

  const wsCanonical = canonicalPath(workspaceDir);
  const dotGitPath = path.join(wsCanonical, '.git');
  const gitDirTrimmed = gitDirRaw.trim();
  if (!gitDirTrimmed || gitDirTrimmed.includes('\0')) {
    return { status: 'invalid', reason: 'invalid git-dir value' };
  }
  const gitDirCandidate = path.resolve(wsCanonical, gitDirTrimmed);

  let dotGitStat: fs.Stats;
  try {
    dotGitStat = fs.lstatSync(dotGitPath);
  } catch (err) {
    if (
      (err as NodeJS.ErrnoException).code === 'ENOENT' &&
      options.allowMockedMissingDotGit &&
      !fs.existsSync(wsCanonical) &&
      sameCanonicalPath(gitDirCandidate, dotGitPath)
    ) {
      return {
        status: 'valid',
        worktree: {
          rootDir: wsCanonical,
          gitDir: gitDirCandidate,
          commonDir: gitDirCandidate,
          isLinkedWorktree: false
        }
      };
    }
    return { status: 'invalid', reason: 'missing .git entry at workspace root' };
  }

  if (dotGitStat.isSymbolicLink()) {
    return { status: 'invalid', reason: '.git entry must not be a symbolic link' };
  }

  if (dotGitStat.isDirectory()) {
    if (!sameCanonicalPath(gitDirCandidate, dotGitPath)) {
      return { status: 'invalid', reason: 'git-dir does not match workspace .git directory' };
    }
    if (!fs.existsSync(path.join(gitDirCandidate, 'HEAD'))) {
      return { status: 'invalid', reason: '.git directory is missing HEAD' };
    }
    const gitDir = canonicalPath(gitDirCandidate);
    return {
      status: 'valid',
      worktree: {
        rootDir: wsCanonical,
        gitDir,
        commonDir: gitDir,
        isLinkedWorktree: false
      }
    };
  }

  if (!dotGitStat.isFile()) {
    return { status: 'invalid', reason: '.git entry is neither a directory nor a regular file' };
  }

  if (dotGitStat.size === 0 || dotGitStat.size > MAX_POINTER_BYTES) {
    return { status: 'invalid', reason: 'malformed .git pointer file size' };
  }
  const rawPointer = fs.readFileSync(dotGitPath, 'utf-8');
  if (rawPointer.includes('\0')) {
    return { status: 'invalid', reason: '.git pointer file contains NUL bytes' };
  }
  const pointerMatch = rawPointer.match(/^gitdir:\s*([^\r\n]+)\r?\n?$/);
  if (!pointerMatch) {
    return { status: 'invalid', reason: 'malformed .git gitdir pointer syntax' };
  }
  const pointerTarget = pointerMatch[1].trim();
  if (!pointerTarget) {
    return { status: 'invalid', reason: 'empty .git gitdir pointer target' };
  }

  const pointerResolved = path.resolve(wsCanonical, pointerTarget);
  if (!sameCanonicalPath(pointerResolved, gitDirCandidate)) {
    return { status: 'invalid', reason: '.git pointer disagrees with git rev-parse --git-dir' };
  }
  if (!isRealDirectory(pointerResolved) || !fs.existsSync(path.join(pointerResolved, 'HEAD'))) {
    return { status: 'invalid', reason: 'gitdir target is not a valid git metadata directory' };
  }

  const gitDir = canonicalPath(pointerResolved);
  const backPointerRaw = readSingleLineControlFile(path.join(gitDir, 'gitdir'));
  if (!backPointerRaw) {
    return { status: 'invalid', reason: 'gitdir target lacks a valid worktree gitdir back-pointer' };
  }
  const backPointerResolved = path.resolve(gitDir, backPointerRaw);
  if (!sameCanonicalPath(backPointerResolved, dotGitPath)) {
    return { status: 'invalid', reason: 'worktree gitdir back-pointer does not point back to this workspace' };
  }

  const commonRel = readSingleLineControlFile(path.join(gitDir, 'commondir'));
  if (!commonRel) {
    return { status: 'invalid', reason: 'linked worktree metadata is missing a valid commondir file' };
  }
  const commonResolved = path.resolve(gitDir, commonRel);
  if (!isRealDirectory(commonResolved) || !fs.existsSync(path.join(commonResolved, 'HEAD'))) {
    return { status: 'invalid', reason: 'linked worktree commondir is not a valid git repository directory' };
  }

  return {
    status: 'valid',
    worktree: {
      rootDir: wsCanonical,
      gitDir,
      commonDir: canonicalPath(commonResolved),
      isLinkedWorktree: true
    }
  };
}

/** Discover and cryptographically/structurally verify Git worktree metadata without trusting forged .git files. */
export async function resolveVerifiedGitWorktree(workspaceDir: string): Promise<GitWorktreeResolution> {
  try {
    const [{ stdout: gitDirRaw }, { stdout: toplevelRaw }] = await Promise.all([
      execFileAsync('git', ['rev-parse', '--git-dir'], { cwd: workspaceDir }),
      execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd: workspaceDir })
    ]);
    return verifyGitWorktree(workspaceDir, gitDirRaw, toplevelRaw);
  } catch {
    return { status: 'invalid', reason: 'not a git repository' };
  }
}
