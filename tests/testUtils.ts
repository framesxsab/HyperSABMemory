import * as fs from 'fs';
import { sameCanonicalPath } from '../src/harness/gitWorktree.js';

export const TEST_DIR_RM_OPTIONS: fs.RmOptions = {
  recursive: true,
  force: true,
  maxRetries: 5,
  retryDelay: 50
};

export function removeTestDirs(dirs: string[]): void {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, TEST_DIR_RM_OPTIONS);
}

export function matchesTargetFile(file: fs.PathOrFileDescriptor, targetPath: string): boolean {
  return typeof file === 'string' && sameCanonicalPath(file, targetPath);
}
