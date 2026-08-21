import { describe, it, expect, afterEach } from 'vitest';
import { getPackageVersion } from '../src/version.js';
import { parseIntervalMinutes } from '../src/cli/cliUtils.js';
import { runDoctor } from '../src/cli/doctor.js';
import { registerMemoryCommands } from '../src/cli/memoryCommands.js';
import { SupermemoryEngine } from '../src/memory/supermemory.js';
import { HybridSearchEngine } from '../src/memory/hybridSearch.js';
import { Command } from 'commander';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const dirs: string[] = [];

function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-cli-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('HyperMemory — CLI completeness + bugfix sweep (P12)', () => {
  it('reports the real package version, never a hardcoded literal', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf-8')
    ) as { version: string };
    expect(getPackageVersion()).toBe(pkg.version);
    expect(getPackageVersion()).not.toBe('1.0.0');
  });

  it('rejects invalid --interval values and floors floats', () => {
    expect(parseIntervalMinutes('abc')).toBeNull();
    expect(parseIntervalMinutes('0')).toBeNull();
    expect(parseIntervalMinutes('-3')).toBeNull();
    expect(parseIntervalMinutes('')).toBeNull();
    expect(parseIntervalMinutes('2.9')).toBe(2);
    expect(parseIntervalMinutes('5')).toBe(5);
  });

  it('clamps limit at the engine level in both search paths', () => {
    const dir = tmpDir();
    const engine = new SupermemoryEngine(dir);
    engine.remember('decision', 'clamp probe fact');
    const hybrid = new HybridSearchEngine(dir, engine);

    expect(hybrid.searchRecords('clamp', -5)).toHaveLength(1);
    expect(hybrid.searchRecords('clamp', 500)).toHaveLength(1);
    expect(hybrid.search('clamp', -5).length).toBeLessThanOrEqual(100);
    expect(hybrid.search('clamp', 500).length).toBeLessThanOrEqual(100);
  });

  it('rejects empty or whitespace-only remember content', () => {
    const dir = tmpDir();
    const engine = new SupermemoryEngine(dir);
    expect(() => engine.remember('decision', '')).toThrow();
    expect(() => engine.remember('decision', '   ')).toThrow();
  });

  it('round-trips remember → list → recall alias → forget through commander', () => {
    const dir = tmpDir();
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      const program = new Command();
      program.name('hypermemory-test');
      registerMemoryCommands(program);

      program.parse(['node', 'hypermemory-test', 'remember', 'P12 round trip fact', '--category', 'decision']);
      const engine = new SupermemoryEngine(dir);
      const all = engine.getActive();
      expect(all.some((r) => r.content === 'P12 round trip fact')).toBe(true);

      const id = all.find((r) => r.content === 'P12 round trip fact')!.id;
      program.parse(['node', 'hypermemory-test', 'forget', id]);
      const afterForget = new SupermemoryEngine(dir);
      expect(afterForget.getActive().some((r) => r.id === id)).toBe(false);

      expect(() => program.parse(['node', 'hypermemory-test', 'list'])).not.toThrow();
      expect(() => program.parse(['node', 'hypermemory-test', 'recall'])).not.toThrow();
    } finally {
      process.chdir(cwd);
    }
  });

  it('runs doctor strictly read-only and degrades gracefully outside a repo', async () => {
    const dir = tmpDir();
    const before = fs.readdirSync(dir);

    const report = await runDoctor(dir);

    expect(fs.readdirSync(dir)).toEqual(before);
    expect(report.checks.length).toBeGreaterThanOrEqual(4);
    expect(report.checks.find((c) => c.name === 'worktree')?.ok).toBe(false);
    expect(report.ok).toBe(false);
  });

  it('keeps the built CLI --version in sync with package.json', () => {
    execSync('npx tsc', { cwd: process.cwd(), stdio: 'ignore' });
    const outPath = path.resolve(process.cwd(), 'dist', 'cli', 'index.js');
    expect(fs.existsSync(outPath)).toBe(true);
    const source = fs.readFileSync(outPath, 'utf-8');
    expect(source).toContain('getPackageVersion');
  });
});
