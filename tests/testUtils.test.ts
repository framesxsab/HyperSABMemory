import { expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { removeTestDirs } from './testUtils.js';

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
