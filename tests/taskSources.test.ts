import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  captureTaskSourceContents,
  discoverProjectSources,
  inspectTaskSourceContents,
  selectRootDocumentationNames,
  TaskSourceError
} from '../src/harness/taskSources.js';
import { removeTestDirs } from './testUtils.js';

const tempDirs: string[] = [];

function makeTempDir(prefix = 'hm-sources-'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  removeTestDirs(tempDirs);
});

describe('HyperSABMemory — cross-platform root documentation discovery', () => {
  it('discovers Readme.md with exact on-disk casing and valid sha256 when README.md is absent', () => {
    const dir = makeTempDir('hm-readme-mixed-');
    fs.writeFileSync(path.join(dir, 'Readme.md'), '# Commander\nDocumentation\n');

    const discovered = discoverProjectSources(dir);
    expect(discovered).toHaveLength(1);
    expect(discovered[0].path).toBe('Readme.md');
    expect(discovered[0].status).toBe('current');
    expect(discovered[0].sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('discovers lowercase readme.md and Contributing.md with exact on-disk casing', () => {
    const dir = makeTempDir('hm-readme-lower-');
    fs.writeFileSync(path.join(dir, 'readme.md'), '# Lowercase\n');
    fs.writeFileSync(path.join(dir, 'Contributing.md'), '# Contrib\n');

    const discovered = discoverProjectSources(dir);
    expect(discovered.map((s) => s.path)).toEqual(['readme.md', 'Contributing.md']);
    expect(discovered.every((s) => s.status === 'current' && /^[a-f0-9]{64}$/.test(s.sha256))).toBe(true);
  });

  it('ignores unsupported casing variants and unrelated files', () => {
    const dir = makeTempDir('hm-readme-unsupported-');
    fs.writeFileSync(path.join(dir, 'rEaDmE.mD'), '# Weird case\n');
    fs.writeFileSync(path.join(dir, 'README.txt'), 'Not markdown\n');
    expect(discoverProjectSources(dir)).toEqual([]);

    const dirWithFolder = makeTempDir('hm-readme-dir-');
    fs.mkdirSync(path.join(dirWithFolder, 'README.md'));
    expect(discoverProjectSources(dirWithFolder)).toEqual([]);
  });

  it('returns empty list when documentation is missing and handles spaces in workspace and docs paths', () => {
    const empty = makeTempDir('hm-readme-empty-');
    expect(discoverProjectSources(empty)).toEqual([]);

    const root = makeTempDir('hm-readme-space-');
    const spaced = path.join(root, 'repo with spaces');
    fs.mkdirSync(path.join(spaced, 'docs', 'sub folder'), { recursive: true });
    fs.writeFileSync(path.join(spaced, 'Readme.md'), '# Spaced Root\n');
    fs.writeFileSync(path.join(spaced, 'docs', 'sub folder', 'setup guide.md'), '# Setup Guide\n');

    const discovered = discoverProjectSources(spaced);
    expect(discovered.map((s) => s.path)).toEqual(['Readme.md', 'docs/sub folder/setup guide.md']);
    expect(discovered.every((s) => s.status === 'current')).toBe(true);
  });

  it('keeps multiple case variants distinct without merging on case-sensitive directory listings', () => {
    const fakeEntry = (name: string) => ({
      name,
      isFile: () => true,
      isSymbolicLink: () => false
    });

    const selected = selectRootDocumentationNames([
      fakeEntry('Readme.md'),
      fakeEntry('README.md'),
      fakeEntry('readme.md'),
      fakeEntry('unrelated.md'),
      fakeEntry('CONTRIBUTING.md')
    ]);
    expect(selected).toEqual(['README.md', 'Readme.md', 'readme.md', 'CONTRIBUTING.md']);
  });

  it('excludes escaping root symlinks while allowing contained in-workspace symlinks if OS permits', () => {
    const root = makeTempDir('hm-readme-symlink-');
    const workspace = path.join(root, 'ws');
    const outside = path.join(root, 'outside');
    fs.mkdirSync(path.join(workspace, 'docs'), { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, 'secret.md'), '# Outside secret\n');
    fs.writeFileSync(path.join(workspace, 'docs', 'real-readme.md'), '# Real\n');

    let symlinkSupported = true;
    try {
      fs.symlinkSync(path.join(outside, 'secret.md'), path.join(workspace, 'Readme.md'), 'file');
    } catch {
      symlinkSupported = false;
    }

    if (symlinkSupported) {
      const escapedOnly = discoverProjectSources(workspace);
      expect(escapedOnly.some((s) => s.path === 'Readme.md')).toBe(false);
      expect(escapedOnly.map((s) => s.path)).toEqual(['docs/real-readme.md']);

      fs.writeFileSync(path.join(workspace, 'Architecture.md'), '# Arch\n');
      expect(discoverProjectSources(workspace).map((s) => s.path)).toEqual(['Architecture.md', 'docs/real-readme.md']);
    }
  });

  it('captures batch contents with shared parentRealCache while rejecting escapes and catching same-size mutations', () => {
    const workspace = makeTempDir('hm-capture-contents-');
    const outside = makeTempDir('hm-capture-outside-');
    fs.mkdirSync(path.join(workspace, 'src'));
    const insideFile = path.join(workspace, 'src', 'index.ts');
    const siblingFile = path.join(workspace, 'src', 'helper.ts');
    fs.writeFileSync(insideFile, 'export const value = 10;\n');
    fs.writeFileSync(siblingFile, 'export const helper = () => 10;\n');
    fs.writeFileSync(path.join(outside, 'secret.ts'), 'export const secret = true;\n');

    const parentRealCache = new Map<string, string>();
    const captured = captureTaskSourceContents(workspace, ['src/index.ts', 'src/helper.ts', './src/index.ts'], { parentRealCache });
    expect(captured).toHaveLength(2);
    expect(captured[0]).toMatchObject({ path: 'src/index.ts', status: 'current', currentSha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(captured[0].content?.toString('utf8')).toBe('export const value = 10;\n');
    expect(parentRealCache.size).toBeGreaterThanOrEqual(2);

    expect(() => captureTaskSourceContents(workspace, ['../outside.ts'])).toThrow(TaskSourceError);

    let symlinkCreated = true;
    const escapedLink = path.join(workspace, 'src', 'escape.ts');
    try {
      fs.symlinkSync(path.join(outside, 'secret.ts'), escapedLink, 'file');
    } catch {
      symlinkCreated = false;
    }

    if (symlinkCreated) {
      expect(() => captureTaskSourceContents(workspace, ['src/escape.ts'])).toThrow(TaskSourceError);
      const partial = captureTaskSourceContents(workspace, ['src/escape.ts', 'src/index.ts'], { ignoreErrors: true });
      expect(partial.map((item) => item.path)).toEqual(['src/index.ts']);
    }

    // Same-size mutation on disk must be caught when re-inspecting
    fs.writeFileSync(insideFile, 'export const value = 20;\n');
    const rechecked = inspectTaskSourceContents(workspace, [{ path: captured[0].path, sha256: captured[0].sha256 }]);
    expect(rechecked[0].status).toBe('modified');
    expect(rechecked[0].currentSha256).not.toBe(captured[0].sha256);
  });
});
