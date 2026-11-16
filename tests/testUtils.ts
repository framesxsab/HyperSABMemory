import * as fs from 'fs';

export function removeTestDirs(dirs: string[]): void {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
}
