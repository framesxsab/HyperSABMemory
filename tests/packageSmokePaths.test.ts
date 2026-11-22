import { AssertionError } from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { expect, it } from 'vitest';
import { assertSameInstalledCliEntry, canonicalExistingFile } from '../scripts/package-smoke-helpers.mjs';

function createCliFixture(rootDir: string, installSubdir = 'install'): { cliPath: string; packageDir: string } {
  const packageDir = path.join(rootDir, installSubdir, 'node_modules', 'hypersabmemory');
  const cliDir = path.join(packageDir, 'dist', 'cli');
  fs.mkdirSync(cliDir, { recursive: true });
  const cliPath = path.join(cliDir, 'index.js');
  fs.writeFileSync(cliPath, 'console.log("1.4.1");\n', 'utf-8');
  return { cliPath, packageDir };
}

it('accepts canonical vs symlinked directory paths and redundant relative path spellings', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-smoke-canon-'));
  try {
    const realBase = path.join(dir, 'real-root');
    fs.mkdirSync(realBase);
    const { cliPath } = createCliFixture(realBase);
    const symlinkBase = path.join(dir, 'symlink-alias');
    fs.symlinkSync(realBase, symlinkBase, process.platform === 'win32' ? 'junction' : 'dir');

    const symlinkedCli = path.join(symlinkBase, 'install', 'node_modules', 'hypersabmemory', 'dist', 'cli', 'index.js');
    const dottedCli = path.join(symlinkBase, 'install', '.', 'node_modules', 'hypersabmemory', 'dist', 'cli', '..', 'cli', 'index.js');

    const expectedReal = canonicalExistingFile(cliPath, 'real');
    expect(assertSameInstalledCliEntry(expectedReal, symlinkedCli)).toBe(expectedReal);
    expect(assertSameInstalledCliEntry(dottedCli, expectedReal)).toBe(expectedReal);

    // On win32, also verify an explicit >8-char directory vs its 8.3 short-path spelling when NTFS generates one.
    if (process.platform === 'win32') {
      const longBase = path.join(dir, 'very_long_install_root_directory');
      const { cliPath: longCli } = createCliFixture(longBase);
      const shortAlias = path.join(dir, 'VERY_L~1', 'install', 'node_modules', 'hypersabmemory', 'dist', 'cli', 'index.js');
      if (fs.existsSync(shortAlias)) {
        expect(assertSameInstalledCliEntry(longCli, shortAlias)).toBe(canonicalExistingFile(longCli, 'long'));
      }
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

it('rejects a different installed CLI file even when filenames match', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-smoke-mismatch-'));
  try {
    const { cliPath: firstCli } = createCliFixture(dir, 'install-a');
    const { cliPath: secondCli } = createCliFixture(dir, 'install-b');
    expect(() => assertSameInstalledCliEntry(firstCli, secondCli, 'setup points directly to the installed dist/cli/index.js entry')).toThrow(AssertionError);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

it('rejects nonexistent targets and directory paths', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-smoke-missing-'));
  try {
    const { cliPath } = createCliFixture(dir);
    const missingCli = path.join(dir, 'install', 'node_modules', 'hypersabmemory', 'dist', 'cli', 'missing.js');
    expect(() => assertSameInstalledCliEntry(missingCli, cliPath)).toThrow(AssertionError);
    expect(() => assertSameInstalledCliEntry(cliPath, missingCli)).toThrow(AssertionError);
    expect(() => assertSameInstalledCliEntry(path.dirname(cliPath), cliPath)).toThrow(AssertionError);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

it('handles paths containing spaces and still rejects a mismatched space-containing sibling', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-smoke-spaces-'));
  try {
    const spacedReal = path.join(dir, 'real base with spaces');
    fs.mkdirSync(spacedReal);
    const { cliPath } = createCliFixture(spacedReal, 'install dir with spaces');
    const { cliPath: otherSpaced } = createCliFixture(spacedReal, 'other dir with spaces');
    const spacedLink = path.join(dir, 'link with spaces');
    fs.symlinkSync(spacedReal, spacedLink, process.platform === 'win32' ? 'junction' : 'dir');

    const viaSymlinkWithSpaces = path.join(
      spacedLink,
      'install dir with spaces',
      'node_modules',
      'hypersabmemory',
      'dist',
      'cli',
      'index.js'
    );
    expect(assertSameInstalledCliEntry(cliPath, viaSymlinkWithSpaces)).toBe(canonicalExistingFile(cliPath, 'spaced'));
    expect(() => assertSameInstalledCliEntry(otherSpaced, viaSymlinkWithSpaces)).toThrow(AssertionError);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
