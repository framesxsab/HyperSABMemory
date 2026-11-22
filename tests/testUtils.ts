import * as fs from 'fs';
import { sameCanonicalPath } from '../src/harness/gitWorktree.js';

export function removeTestDirs(dirs: string[]): void {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
}

export function matchesTargetFile(file: fs.PathOrFileDescriptor, targetPath: string): boolean {
  return typeof file === 'string' && sameCanonicalPath(file, targetPath);
}
