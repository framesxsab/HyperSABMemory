import { expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { removeTestDirs, matchesTargetFile } from './testUtils.js';

it('removes and untracks temporary directories', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-cleanup-'));
  const dirs = [dir];
  try {
    removeTestDirs(dirs);
    expect(fs.existsSync(dir)).toBe(false);
    expect(dirs).toEqual([]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

it('matches canonical and non-canonical paths while rejecting non-string descriptors and different files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-utils-match-'));
  try {
    const realDir = path.join(dir, 'actual');
    const aliasDir = path.join(dir, 'alias');
    fs.mkdirSync(realDir);
    const target = path.join(realDir, 'target.md');
    const other = path.join(realDir, 'other.md');
    fs.writeFileSync(target, 'ok\n');
    fs.writeFileSync(other, 'no\n');
    fs.symlinkSync(realDir, aliasDir, process.platform === 'win32' ? 'junction' : 'dir');
    const aliasTarget = path.join(aliasDir, 'target.md');
    expect(matchesTargetFile(target, target)).toBe(true);
    expect(matchesTargetFile(target, aliasTarget)).toBe(true);
    expect(matchesTargetFile(aliasTarget, target)).toBe(true);
    expect(matchesTargetFile(other, target)).toBe(false);
    expect(matchesTargetFile(0, target)).toBe(false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
