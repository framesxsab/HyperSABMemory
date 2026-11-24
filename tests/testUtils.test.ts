import { afterEach, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { removeTestDirs, matchesTargetFile, TEST_DIR_RM_OPTIONS } from './testUtils.js';

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, rmSync: vi.fn(actual.rmSync) };
});

afterEach(() => {
  vi.clearAllMocks();
});

it('removes and untracks temporary directories with bounded native rmSync retries', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-cleanup-'));
  const dirs = [dir];
  try {
    removeTestDirs(dirs);
    expect(TEST_DIR_RM_OPTIONS).toEqual({
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50
    });
    expect(fs.rmSync).toHaveBeenCalledTimes(1);
    expect(fs.rmSync).toHaveBeenCalledWith(dir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50
    });
    expect(fs.existsSync(dir)).toBe(false);
    expect(dirs).toEqual([]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

it('removes nested directories and files without leaking tracked temp directories', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-cleanup-nested-'));
  const nestedDir = path.join(root, 'level1', 'level2');
  fs.mkdirSync(nestedDir, { recursive: true });
  fs.writeFileSync(path.join(nestedDir, 'artifact.txt'), 'nested\n', 'utf8');
  const dirs = [root];
  try {
    removeTestDirs(dirs);
    expect(fs.existsSync(nestedDir)).toBe(false);
    expect(fs.existsSync(root)).toBe(false);
    expect(dirs).toEqual([]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

it('handles already-missing directories cleanly', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-cleanup-missing-'));
  const missing = path.join(parent, 'does-not-exist');
  const dirs = [missing];
  try {
    expect(() => removeTestDirs(dirs)).not.toThrow();
    expect(fs.existsSync(missing)).toBe(false);
    expect(dirs).toEqual([]);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

it('propagates persistent cleanup failures without swallowing errors', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-cleanup-fail-'));
  const dirs = [dir];
  vi.mocked(fs.rmSync).mockImplementationOnce(() => {
    throw Object.assign(new Error(`EPERM: operation not permitted, rm '${dir}'`), {
      errno: 1,
      code: 'EPERM',
      syscall: 'rm',
      path: dir
    });
  });
  try {
    expect(() => removeTestDirs(dirs)).toThrow(/EPERM/);
    expect(dirs).toEqual([]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

it('only deletes tracked directories and preserves unrelated sibling directories', () => {
  const container = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-cleanup-scope-'));
  const tracked = path.join(container, 'tracked');
  const unrelated = path.join(container, 'unrelated');
  const unrelatedFile = path.join(unrelated, 'keep.txt');
  fs.mkdirSync(tracked);
  fs.mkdirSync(unrelated);
  fs.writeFileSync(unrelatedFile, 'keep\n', 'utf8');
  const dirs = [tracked];
  try {
    removeTestDirs(dirs);
    expect(fs.existsSync(tracked)).toBe(false);
    expect(fs.existsSync(unrelated)).toBe(true);
    expect(fs.readFileSync(unrelatedFile, 'utf8')).toBe('keep\n');
    expect(dirs).toEqual([]);
  } finally {
    fs.rmSync(container, { recursive: true, force: true });
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
