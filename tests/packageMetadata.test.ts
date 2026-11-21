import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8')) as {
  name: string;
  version: string;
  bin: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  engines: Record<string, string>;
};
const lock = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package-lock.json'), 'utf-8')) as {
  name: string;
  version: string;
  packages: Record<string, {
    name: string;
    version: string;
    bin: Record<string, string>;
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
    engines: Record<string, string>;
  }>;
};

describe('published package metadata', () => {
  it('keeps the npm manifest and lockfile root in sync', () => {
    const root = lock.packages[''];
    expect(lock.name).toBe(manifest.name);
    expect(lock.version).toBe(manifest.version);
    expect(root.name).toBe(manifest.name);
    expect(root.version).toBe(manifest.version);
    expect(root.bin).toEqual(manifest.bin);
    expect(root.dependencies).toEqual(manifest.dependencies);
    expect(root.devDependencies).toEqual(manifest.devDependencies);
    expect(root.engines).toEqual(manifest.engines);
  });

  it('has a changelog section for the current package version', () => {
    const changelog = fs.readFileSync(path.join(repoRoot, 'CHANGELOG.md'), 'utf-8');
    expect(changelog).toMatch(new RegExp(`^## \\[${manifest.version}\\]`, 'm'));
  });

  it('excludes internal development/release evaluation artifacts from published files while keeping public eval exports', () => {
    const fullManifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8')) as {
      files: string[];
    };
    expect(fullManifest.files).toContain('dist');
    expect(fullManifest.files).toContain('!dist/eval/repositoryBaseline.*');
    expect(fullManifest.files).toContain('!dist/eval/repositoryTaskEvaluation.*');
    expect(fullManifest.files).toContain('!dist/eval/repositoryTaskFixture.*');
    expect(fullManifest.files).toContain('!dist/eval/sprint25DevelopmentFixture.*');
    expect(fullManifest.files).not.toContain('!dist/eval/memoryBench.*');
    expect(fullManifest.files).not.toContain('!dist/eval/tokenEfficiency.*');
  });
});
