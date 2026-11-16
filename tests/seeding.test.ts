import { describe, it, expect, afterEach, vi } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import { removeTestDirs } from './testUtils.js';
import * as os from 'os';
import * as path from 'path';
import { deriveBootstrapFacts, seedWorkspace } from '../src/memory/seeding.js';
import { SqliteStore } from '../src/memory/sqliteStore.js';
import { OneShotSetupEngine } from '../src/cli/oneShotSetup.js';

const dirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  removeTestDirs(dirs);
});

function git(cwd: string, args: string[]): string[] {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' })
    .split(/\r?\n/)
    .filter(Boolean);
}

/** Fixture workspace: README + package.json + src/tests/docs + git history (2 commits). */
function makeFixture(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-f1-'));
  dirs.push(dir);
  fs.writeFileSync(
    path.join(dir, 'README.md'),
    '# Fixture Project\n\nFixture projects remember their first boot.\n',
    'utf-8'
  );
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify(
      {
        name: 'fixture-project',
        description: 'A fixture workspace for seeding tests',
        type: 'module',
        dependencies: { left: '1.0.0', right: '1.0.0', up: '1.0.0' },
        devDependencies: { typescript: '5.0.0' }
      },
      null,
      2
    ),
    'utf-8'
  );
  for (const d of ['src', 'tests', 'docs']) {
    fs.mkdirSync(path.join(dir, d));
  }
  fs.writeFileSync(path.join(dir, 'src', 'a.ts'), 'export const a = 1;\n', 'utf-8');
  git(dir, ['init']);
  git(dir, ['config', 'user.email', 'f1@test']);
  git(dir, ['config', 'user.name', 'f1']);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', 'feat: fixture initial commit']);
  fs.writeFileSync(path.join(dir, 'README.md'), '# Fixture Project\n\nUpdated paragraph.\n', 'utf-8');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', 'docs: update readme']);
  return dir;
}

function revCount(dir: string): number {
  return Number(git(dir, ['rev-list', '--count', 'HEAD'])[0]);
}

describe('F1 deriveBootstrapFacts — cold-start derivation', () => {
  it('derives 5-10 tagged seed facts from a fixture workspace', async () => {
    // Given: a fixture workspace with README, package.json, layout dirs and git log
    const fx = makeFixture();

    // When: bootstrap facts are derived
    const facts = await deriveBootstrapFacts(fx);

    // Then: 5-10 records, every one tagged seeded with source 'seed'
    expect(facts.length).toBeGreaterThanOrEqual(5);
    expect(facts.length).toBeLessThanOrEqual(10);
    for (const fact of facts) {
      expect(fact.tags).toContain('seeded');
      expect(fact.source).toBe('seed');
      expect(['architecture', 'general']).toContain(fact.category);
      expect(fact.content.trim().length).toBeGreaterThan(0);
    }
    const all = facts.map((f) => f.content).join('\n');
    expect(all).toContain('fixture-project'); // package.json name
    expect(all).toContain('runtime deps'); // stack summary
    expect(all).toContain('feat: fixture initial commit'); // git digest
  });
});

describe('F1 seedWorkspace — idempotent direct-CAS writes', () => {
  it('is idempotent: double-run yields equal counts and the second run writes nothing', async () => {
    // Given: a fixture workspace
    const fx = makeFixture();

    // When: seeding runs twice
    const first = await seedWorkspace(fx);
    const second = await seedWorkspace(fx);

    // Then: first run seeds >=5, second run is inert, totals match
    expect(first.seeded).toBeGreaterThanOrEqual(5);
    expect(second.seeded).toBe(0);
    expect(second.total).toBe(first.total);
  });

  it('never supersedes pre-existing user facts written alongside seeds (reverse direction)', async () => {
    // Given: a store already holding an active user fact about the layout
    const fx = makeFixture();
    const store = new SqliteStore(path.join(fx, '.hypersabmemory'));
    store.set({
      id: 'user_1',
      category: 'general',
      content: 'fixture-project keeps guides in the docs directory',
      status: 'active'
    });

    // When: seeding runs over the same store
    await seedWorkspace(fx, store);

    // Then: the user fact stays active and untagged by any supersede
    const after = store.get('user_1');
    expect(after?.status).toBe('active');
    expect(after?.tags ?? []).toEqual([]);
  });
});

describe('F1 genesis ritual — terminal setup step', () => {
  it('sets up a git workspace without creating an unsolicited checkpoint', async () => {
    const fx = makeFixture();
    const before = revCount(fx);

    const result = await new OneShotSetupEngine(fx).executeSetup();

    expect(result.success).toBe(true);
    expect(revCount(fx)).toBe(before);
    expect(git(fx, ['log', '--pretty=%s'])).not.toContain('feat: HyperSABMemory One-Shot Setup Complete');
    expect(fs.existsSync(path.join(fx, '.cursor', 'mcp.json'))).toBe(true);
    expect(fs.existsSync(path.join(fx, '.hypersabmemory', 'memory_store.json'))).toBe(true);
  }, 60000);

  it('writes exactly one genesis record, creates the named checkpoint, prints a valid GENESIS hash', async () => {
    // Given: a fresh fixture repo and a captured stdout
    const fx = makeFixture();
    const before = revCount(fx);
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((m) => {
      logs.push(String(m));
    });

    // When: one-shot setup executes
    const result = await new OneShotSetupEngine(fx).executeSetup({ checkpoint: true });

    // Then: setup succeeds with exactly one genesis record via direct set
    expect(result.success).toBe(true);
    const store = new SqliteStore(path.join(fx, '.hypersabmemory'));
    const genesis = store.getAll().filter((r) => r.tags?.includes('genesis'));
    expect(genesis).toHaveLength(1);
    expect(genesis[0].category).toBe('decision');
    expect(genesis[0].content).toMatch(/^GENESIS: workspace memory initialized \d{4}-\d{2}-\d{2}$/);
    expect(genesis[0].tags).toContain('seeded');
    expect(genesis[0].source).toBe('seed');

    // And: exactly ONE genesis-named checkpoint commit exists and rev-list advanced
    expect(revCount(fx)).toBeGreaterThan(before);
    const genesisSubjects = git(fx, ['log', '--pretty=%s']).filter((s) =>
      s.includes('genesis: workspace memory baseline')
    );
    expect(genesisSubjects).toHaveLength(1);

    // And: the final printed line carries that commit's short hash
    const genesisLine = logs.find((l) => l.startsWith('GENESIS '));
    expect(genesisLine).toMatch(/^GENESIS [0-9a-f]{7,40} - this workspace now remembers\.$/);
    const printedHash = genesisLine!.split(' ')[1];
    const commitHash = git(fx, [
      'log',
      '--grep=genesis: workspace memory baseline',
      '--format=%h',
      '-n',
      '1'
    ])[0];
    expect(printedHash).toBe(commitHash);
  }, 60000);

  it('skips the whole ritual on rerun: no new seed/genesis records, no GENESIS output', async () => {
    // Given: a workspace that already went through setup once
    const fx = makeFixture();
    await new OneShotSetupEngine(fx).executeSetup({ checkpoint: true });
    const storePath = path.join(fx, '.hypersabmemory');
    const before = new SqliteStore(storePath).getAll();
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((m) => {
      logs.push(String(m));
    });

    // When: setup runs a second time
    await new OneShotSetupEngine(fx).executeSetup();

    // Then: no GENESIS output and the seeded corpus is unchanged
    const after = new SqliteStore(storePath).getAll();
    expect(logs.some((l) => l.includes('GENESIS'))).toBe(false);
    expect(after.filter((r) => r.tags?.includes('genesis'))).toHaveLength(1);
    expect(after.filter((r) => r.source === 'seed')).toHaveLength(
      before.filter((r) => r.source === 'seed').length
    );
  }, 60000);
});
