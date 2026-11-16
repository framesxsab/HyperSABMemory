import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { performance } from 'node:perf_hooks';

export interface TaskSource {
  path: string;
  sha256: string;
}

export interface TaskSourceInspection extends TaskSource {
  status: 'current' | 'modified' | 'missing' | 'unavailable';
  currentSha256?: string;
  detail?: string;
}

export interface TaskSourceContentInspection extends TaskSourceInspection {
  content?: Buffer;
}

export class TaskSourceError extends Error {
  readonly code = 'INVALID_SOURCE_PATH';
}

const MAX_SOURCE_BYTES = 16 * 1024 * 1024;
const MAX_DISCOVERED_SOURCES = 64;
const MAX_DISCOVERY_ENTRIES = 512;
const ROOT_DOCUMENTS = ['AGENTS.md', 'Rules.md', 'PRD.md', 'Architecture.md', 'README.md', 'Phases.md', 'Memory.md', 'Design.md', 'CONTRIBUTING.md'];

function isContained(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

/** Validate both lexical paths and the real existing ancestor, including symlinks. */
function resolveSource(workspaceDir: string, sourcePath: string, resolvedRoot?: string): { absolute: string; relative: string } {
  if (typeof sourcePath !== 'string' || !sourcePath.trim() || sourcePath.length > 2048 || sourcePath.includes('\0') || path.isAbsolute(sourcePath)) {
    throw new TaskSourceError('source references must be non-empty workspace-relative file paths');
  }
  const root = resolvedRoot ?? fs.realpathSync(workspaceDir);
  const absolute = path.resolve(root, sourcePath);
  if (!isContained(root, absolute) || absolute === root) throw new TaskSourceError(`source path escapes the workspace: ${sourcePath}`);

  let ancestor = absolute;
  while (true) {
    try {
      const stat = fs.lstatSync(ancestor);
      let real: string;
      try {
        real = fs.realpathSync(ancestor);
      } catch (error) {
        if (stat.isSymbolicLink()) throw new TaskSourceError(`unresolvable symbolic link in source path: ${sourcePath}`);
        throw error;
      }
      if (!isContained(root, real)) throw new TaskSourceError(`source path escapes the workspace through a symbolic link: ${sourcePath}`);
      break;
    } catch (error) {
      if (error instanceof TaskSourceError) throw error;
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw new TaskSourceError(`could not contain source path: ${sourcePath}`);
      ancestor = parent;
    }
  }
  return { absolute, relative: path.relative(root, absolute).split(path.sep).join('/') };
}

function readContent(absolute: string): Buffer {
  const stat = fs.statSync(absolute);
  if (!stat.isFile()) throw new Error('source is not a regular file');
  if (stat.size > MAX_SOURCE_BYTES) throw new Error('source exceeds the 16 MiB inspection limit');
  return fs.readFileSync(absolute);
}

function readDigest(absolute: string): string {
  return createHash('sha256').update(readContent(absolute)).digest('hex');
}

/** Capture exact bytes; absent/unreadable files remain explicitly unverified. */
export function captureTaskSources(workspaceDir: string, sourcePaths: string[]): TaskSource[] {
  if (!Array.isArray(sourcePaths)) throw new TaskSourceError('source paths must be an array');
  if (sourcePaths.length > MAX_DISCOVERED_SOURCES) throw new TaskSourceError('at most 64 source references may be captured at once');
  const seen = new Set<string>();
  return sourcePaths.flatMap((sourcePath) => {
    const resolved = resolveSource(workspaceDir, sourcePath);
    const key = process.platform === 'win32' ? resolved.relative.toLowerCase() : resolved.relative;
    if (seen.has(key)) return [];
    seen.add(key);
    try {
      return [{ path: resolved.relative, sha256: readDigest(resolved.absolute) }];
    } catch {
      return [{ path: resolved.relative, sha256: '' }];
    }
  });
}

/** Re-hash each source rather than trusting size or timestamps. */
export function inspectTaskSources(workspaceDir: string, sources: TaskSource[], onContent?: (source: TaskSourceContentInspection) => void): TaskSourceInspection[] {
  const inspect = createTaskSourceContentInspector(workspaceDir);
  return sources.map((source) => {
    const inspected = inspect([source])[0];
    if (inspected.status === 'current' && inspected.content) onContent?.(inspected);
    const { content: _content, ...inspection } = inspected;
    if (!source.sha256 && inspection.currentSha256) inspection.detail = 'no readable source was captured; re-read and checkpoint explicitly';
    return inspection;
  });
}

/** Revalidate references and return the exact hashed bytes for callers that need excerpts. */
export function inspectTaskSourceContents(workspaceDir: string, sources: TaskSource[], timing?: { pathMs: number; readMs: number; hashMs: number }): TaskSourceContentInspection[] {
  return createTaskSourceContentInspector(workspaceDir, timing)(sources);
}

export function createTaskSourceContentInspector(workspaceDir: string, timing?: { pathMs: number; readMs: number; hashMs: number }): (sources: TaskSource[]) => TaskSourceContentInspection[] {
  let root: string | undefined;
  try {
    const started = timing ? performance.now() : 0;
    root = fs.realpathSync(workspaceDir);
    if (timing) timing.pathMs += performance.now() - started;
  } catch {}
  return sources => inspectSourceContents(workspaceDir, sources, timing, root);
}

function inspectSourceContents(workspaceDir: string, sources: TaskSource[], timing?: { pathMs: number; readMs: number; hashMs: number }, root?: string): TaskSourceContentInspection[] {
  return sources.map((source) => {
    try {
      let started = timing ? performance.now() : 0;
      const resolved = resolveSource(workspaceDir, source.path, root);
      if (timing) { timing.pathMs += performance.now() - started; started = performance.now(); }
      const content = readContent(resolved.absolute);
      if (timing) { timing.readMs += performance.now() - started; started = performance.now(); }
      const currentSha256 = createHash('sha256').update(content).digest('hex');
      if (timing) timing.hashMs += performance.now() - started;
      const status = !source.sha256 ? 'unavailable' : source.sha256 === currentSha256 ? 'current' : 'modified';
      return { ...source, status, currentSha256, content };
    } catch (error) {
      const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
      return { ...source, status: missing ? 'missing' : 'unavailable', detail: (error as Error).message };
    }
  });
}

/** Discover existing scope documents only, with bounded traversal and no symlink following. */
export function discoverProjectSources(workspaceDir: string): TaskSourceInspection[] {
  const candidates: string[] = [];
  for (const name of ROOT_DOCUMENTS) {
    if (fs.existsSync(path.join(workspaceDir, name))) candidates.push(name);
  }
  let visited = 0;
  const walk = (relative: string, depth: number): void => {
    if (depth > 3 || candidates.length >= MAX_DISCOVERED_SOURCES || visited >= MAX_DISCOVERY_ENTRIES) return;
    const absolute = path.join(workspaceDir, relative);
    let entries: fs.Dirent[];
    try {
      resolveSource(workspaceDir, relative);
      if (fs.lstatSync(absolute).isSymbolicLink()) return;
      entries = fs.readdirSync(absolute, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return;
    }
    for (const entry of entries) {
      if (visited++ >= MAX_DISCOVERY_ENTRIES || candidates.length >= MAX_DISCOVERED_SOURCES) break;
      if (entry.isSymbolicLink()) continue;
      const child = path.join(relative, entry.name);
      if (entry.isDirectory()) walk(child, depth + 1);
      else if (entry.isFile() && /\.md$/i.test(entry.name)) candidates.push(child);
    }
  };
  walk('docs', 0);
  const sources = candidates.slice(0, MAX_DISCOVERED_SOURCES).sort((a, b) => {
    const ar = ROOT_DOCUMENTS.indexOf(a);
    const br = ROOT_DOCUMENTS.indexOf(b);
    return (ar < 0 ? ROOT_DOCUMENTS.length : ar) - (br < 0 ? ROOT_DOCUMENTS.length : br) || a.localeCompare(b);
  }).flatMap((candidate) => {
    try { return captureTaskSources(workspaceDir, [candidate]); } catch { return []; }
  });
  return inspectTaskSources(workspaceDir, sources);
}
