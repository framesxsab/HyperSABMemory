import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import fsDefault from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { removeTestDirs } from './testUtils.js';
import * as os from 'os';
import * as path from 'path';
import { SqliteStore } from '../src/memory/sqliteStore.js';
import { TemporalMemoryEngine } from '../src/memory/temporalMemory.js';

const dirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  removeTestDirs(dirs);
});

function tmpWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-c4a-'));
  dirs.push(dir);
  return dir;
}

it('reads the current store once on first use and detects later same-size rewrites', () => {
  const workspace = tmpWorkspace();
  const dir = path.join(workspace, '.hypersabmemory');
  fs.mkdirSync(dir);
  const filename = path.join(dir, 'memory_store.json');
  const record = { id: 'a', category: 'general', content: 'alpha', status: 'active', timestamp: '2026-01-01T00:00:00.000Z' };
  fs.writeFileSync(filename, JSON.stringify([record]));
  const read = fsDefault.readFileSync;
  let reads = 0;
  try {
    vi.spyOn(fsDefault, 'readFileSync').mockImplementation(((file: fs.PathOrFileDescriptor, options?: unknown) => {
      if (String(file) === filename) reads++;
      return read(file, options as never);
    }) as typeof fs.readFileSync);
    syncBuiltinESMExports();
    const engine = new TemporalMemoryEngine(workspace);
    expect(reads).toBe(0);
    fs.writeFileSync(filename, JSON.stringify([{ ...record, content: 'bravo' }]));
    expect(engine.getActive()[0].content).toBe('bravo');
    expect(reads).toBe(1);
    fs.writeFileSync(filename, JSON.stringify([{ ...record, content: 'delta' }]));
    expect(engine.getActive()[0].content).toBe('delta');
    expect(reads).toBe(2);
  } finally { vi.restoreAllMocks(); syncBuiltinESMExports(); }
});

it('recovers a backup on first use of a deferred memory engine', () => {
  const workspace = tmpWorkspace();
  const dir = path.join(workspace, '.hypersabmemory');
  const writer = new SqliteStore(dir);
  writer.set({ id: 'a', category: 'decision', content: 'recoverable fact' });
  fs.writeFileSync(path.join(dir, 'memory_store.json'), '{invalid');
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const memory = new TemporalMemoryEngine(workspace);
  expect(memory.getActive().map(item => item.content)).toEqual(['recoverable fact']);
  expect(warn).toHaveBeenCalled();
});

describe('TemporalMemoryEngine.remember — seeded facts are never superseded (F1)', () => {
  it('keeps an active seeded fact untouched when a near-duplicate user fact arrives', () => {
    // Given: a seeded architecture fact about topic X in the store
    const workspace = tmpWorkspace();
    const seeder = new SqliteStore(path.join(workspace, '.hypersabmemory'));
    seeder.set({
      id: 'seed_1',
      category: 'architecture',
      content: 'Watcher floods the store with architecture facts per changed file',
      tags: ['seeded'],
      source: 'seed',
      status: 'active'
    });
    const engine = new TemporalMemoryEngine(workspace);

    // When: a near-duplicate user fact about the same topic is remembered
    const user = engine.remember(
      'architecture',
      'Watcher floods the store with architecture facts per changed file (v2)'
    );

    // Then: the seed stays ACTIVE and untouched; the user fact sits alongside it
    const persisted = new SqliteStore(path.join(workspace, '.hypersabmemory'));
    const seed = persisted.get('seed_1');
    expect(seed?.status).toBe('active');
    expect(seed?.tags).toEqual(['seeded']);
    expect(seed?.invalidAt).toBeUndefined();
    expect(persisted.get(user.id)?.status).toBe('active');
  });
});

describe('TemporalMemoryEngine.remember — transactional persistence', () => {
  it('writes one transaction for every matching supersede', () => {
    // Given: three active architecture facts that all duplicate the incoming content
    const workspace = tmpWorkspace();
    const seeder = new SqliteStore(path.join(workspace, '.hypersabmemory'));
    for (let i = 0; i < 3; i++) {
      seeder.set({
        id: `old_${i}`,
        category: 'architecture',
        content: `Watcher floods the store with architecture facts per changed file (variant ${i})`,
        status: 'active'
      });
    }
    const engine = new TemporalMemoryEngine(workspace);
    const transactionSpy = vi.spyOn(SqliteStore.prototype, 'setAndSupersede');

    // When: a single remember() call supersedes all three duplicates
    const record = engine.remember(
      'architecture',
      'Watcher floods the store with architecture facts per changed file'
    );

    // Then: the new fact and every supersede use one store transaction.
    expect(transactionSpy).toHaveBeenCalledTimes(1);

    // And semantics are preserved: the single batched save persisted every flip
    const persisted = new SqliteStore(path.join(workspace, '.hypersabmemory'));
    for (let i = 0; i < 3; i++) {
      const old = persisted.get(`old_${i}`);
      expect(old?.status).toBe('superseded');
      expect(old?.tags).toContain(`superseded-by:${record.id}`);
      expect(old?.invalidAt).toBeTruthy();
    }
    expect(persisted.get(record.id)?.status).toBe('active');
  });

  it('uses one transaction when remember finds no duplicates', () => {
    // Given: an empty store and a fresh engine
    const workspace = tmpWorkspace();
    const engine = new TemporalMemoryEngine(workspace);
    const transactionSpy = vi.spyOn(SqliteStore.prototype, 'setAndSupersede');

    // When: a remember() with no duplicate/contradiction matches runs
    const record = engine.remember('decision', 'Unique QUANTUMWIDGET routing fact with no twins');

    // Then: one atomic store transaction happened and the record is active
    expect(transactionSpy).toHaveBeenCalledTimes(1);
    expect(record.status).toBe('active');
  });

  it('does not expose a new fact or supersede old facts when the atomic write fails', () => {
    const workspace = tmpWorkspace();
    const storeDir = path.join(workspace, '.hypersabmemory');
    const seeder = new SqliteStore(storeDir);
    seeder.set({ id: 'old', category: 'architecture', content: 'The stable widget route uses local state.' });
    const engine = new TemporalMemoryEngine(workspace);
    fs.mkdirSync(path.join(storeDir, 'memory_store.json.tmp'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => engine.remember('architecture', 'The stable widget route uses local state. Updated.')).toThrow();

    const persisted = new SqliteStore(storeDir);
    expect(persisted.get('old')?.status).toBe('active');
    expect(persisted.getAll()).toHaveLength(1);
    expect(engine.getActive().map(({ id }) => id)).toEqual(['old']);
  });
});

describe('TemporalMemoryEngine — forgotten and superseded memory safety in Memory.md (P0)', () => {
  it('excludes forgotten and superseded records from Memory.md and fresh-engine views while preserving store audit history', () => {
    const workspace = tmpWorkspace();
    const memoryMdPath = path.join(workspace, 'Memory.md');
    fs.writeFileSync(
      memoryMdPath,
      '# Workspace Memory\n\n## Manual Notes\nPreserve this manual section.\n',
      'utf-8'
    );
    fs.mkdirSync(path.join(workspace, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(workspace, 'docs', 'canary-note.md'), 'Decision: keep active routing.\n', 'utf-8');

    const engine = new TemporalMemoryEngine(workspace);

    const forgetCanary = 'CANARY_FORGET_TOKEN_9F3A1C_ALPHA';
    const forgetIntent = 'CANARY_FORGET_INTENT_9F3A1C';
    const forgetFix = 'CANARY_FORGET_FIX_9F3A1C';
    const forgetNext = 'CANARY_FORGET_NEXT_9F3A1C';
    const forgetRecord = engine.remember(
      'decision',
      `Deprecated token rule ${forgetCanary} must not survive revocation.`,
      ['canary-forget'],
      {
        intent: forgetIntent,
        artifacts: ['docs/canary-note.md'],
        errorsAndFixes: forgetFix,
        nextSteps: forgetNext
      }
    );

    // >= 48-char shared lowercase-trimmed prefix triggers automatic supersede in remember().
    const sharedPrefix = 'CANARY_SUPERSEDE_SHARED_PREFIX_48_CHARS_0123456789_XYZ';
    const supersededOldTail = 'CANARY_SUPERSEDED_OLD_V1_8842';
    const supersededIntent = 'CANARY_SUPERSEDED_INTENT_8842';
    const supersededNext = 'CANARY_SUPERSEDED_NEXT_8842';
    const supersededRecord = engine.remember(
      'architecture',
      `${sharedPrefix}: ${supersededOldTail}`,
      ['canary-supersede-v1'],
      {
        intent: supersededIntent,
        artifacts: ['docs/canary-note.md'],
        nextSteps: supersededNext
      }
    );

    const keepCanary = 'CANARY_KEEP_ACTIVE_7C2E9B';
    const keepRecord = engine.remember('decision', `Active policy ${keepCanary} with literal $& and $1 tokens.`);

    // Step 3: Active canaries appear in Memory.md, query, and Context Block before invalidation.
    const activeMemoryMd = fs.readFileSync(memoryMdPath, 'utf-8');
    expect(activeMemoryMd).toContain(forgetCanary);
    expect(activeMemoryMd).toContain(supersededOldTail);
    expect(activeMemoryMd).toContain(keepCanary);
    expect(engine.query(forgetCanary).map((r) => r.id)).toEqual([forgetRecord.id]);
    expect(engine.query(supersededOldTail).map((r) => r.id)).toEqual([supersededRecord.id]);
    expect(engine.getContextBlock()).toContain(forgetCanary);
    expect(engine.getContextBlock()).toContain(supersededOldTail);

    // Step 4 & 5: Forget one canary and supersede the other (>= 48-char prefix), syncing Memory.md.
    const forgotten = engine.forget(forgetRecord.id);
    expect(forgotten?.status).toBe('forgotten');

    const successorTail = 'CANARY_SUPERSEDING_NEW_V2_9951';
    const successorRecord = engine.remember(
      'architecture',
      `${sharedPrefix}: ${successorTail}`,
      ['canary-supersede-v2']
    );

    // Step 6: Memory.md excludes forgotten & superseded content and preserves active & manual sections.
    const syncedMemoryMd = fs.readFileSync(memoryMdPath, 'utf-8');
    expect(syncedMemoryMd).toContain('Preserve this manual section.');
    expect(syncedMemoryMd).toContain(keepCanary);
    expect(syncedMemoryMd).toContain('with literal $& and $1 tokens.');
    expect(syncedMemoryMd).toContain(successorTail);
    for (const leaked of [
      forgetCanary,
      forgetIntent,
      forgetFix,
      forgetNext,
      supersededOldTail,
      supersededIntent,
      supersededNext,
      '[forgotten]',
      '[superseded]'
    ]) {
      expect(syncedMemoryMd).not.toContain(leaked);
    }

    // Historical records remain preserved in SqliteStore and memory_store.json for auditability.
    const storePath = path.join(workspace, '.hypersabmemory', 'memory_store.json');
    const persistedRaw = JSON.parse(fs.readFileSync(storePath, 'utf-8')) as Array<{
      id: string;
      status?: string;
      invalidAt?: string;
      content: string;
      tags?: string[];
    }>;
    const rawForgotten = persistedRaw.find((r) => r.id === forgetRecord.id);
    const rawSuperseded = persistedRaw.find((r) => r.id === supersededRecord.id);
    expect(rawForgotten?.status).toBe('forgotten');
    expect(rawForgotten?.invalidAt).toBeTruthy();
    expect(rawForgotten?.content).toContain(forgetCanary);
    expect(rawSuperseded?.status).toBe('superseded');
    expect(rawSuperseded?.invalidAt).toBeTruthy();
    expect(rawSuperseded?.tags).toContain(`superseded-by:${successorRecord.id}`);
    expect(rawSuperseded?.content).toContain(supersededOldTail);

    const store = new SqliteStore(path.join(workspace, '.hypersabmemory'));
    expect(store.getAll()).toHaveLength(4);
    expect(store.getActive().map((r) => r.id).sort()).toEqual([keepRecord.id, successorRecord.id].sort());

    // Step 7: Fresh TemporalMemoryEngine cannot surface forgotten or superseded content via any current-memory API.
    const freshEngine = new TemporalMemoryEngine(workspace);
    expect(freshEngine.getCounts()).toEqual({ recorded: 4, active: 2 });
    expect(freshEngine.getActive().map((r) => r.id).sort()).toEqual([keepRecord.id, successorRecord.id].sort());
    expect(freshEngine.query(forgetCanary)).toEqual([]);
    expect(freshEngine.query(supersededOldTail)).toEqual([]);
    expect(freshEngine.query('CANARY_').map((r) => r.id).sort()).toEqual([keepRecord.id, successorRecord.id].sort());

    const freshContextBlock = freshEngine.getContextBlock();
    const freshSummary = freshEngine.getSummary();
    const freshLedger = JSON.stringify(freshEngine.getLedger(50));
    for (const leaked of [forgetCanary, forgetIntent, forgetFix, forgetNext, supersededOldTail, supersededIntent, supersededNext]) {
      expect(freshContextBlock).not.toContain(leaked);
      expect(freshSummary).not.toContain(leaked);
      expect(freshLedger).not.toContain(leaked);
    }
    expect(freshContextBlock).toContain(keepCanary);
    expect(freshContextBlock).toContain(successorTail);
    expect(freshSummary).toContain('2 items recorded.');
    expect(freshLedger).toContain(keepCanary);
    expect(freshLedger).toContain(successorTail);
  });

  it('overwrites a previously synced Memory.md index cleanly with "No records logged yet." when the last active record is forgotten', () => {
    const workspace = tmpWorkspace();
    const memoryMdPath = path.join(workspace, 'Memory.md');
    const preSyncedForgotten = 'CANARY_PRESYNCED_FORGOTTEN_INDEX_LINE';
    const lastActiveCanary = 'CANARY_LAST_ACTIVE_RECORD_31415';
    fs.writeFileSync(
      memoryMdPath,
      [
        '# Workspace Memory',
        '',
        '## Persistent Memory Index',
        `- **[DECISION]** (12:00:00 PM) [forgotten]: ${preSyncedForgotten}`,
        '',
        '## Footer',
        'Keep footer intact.',
        ''
      ].join('\n'),
      'utf-8'
    );

    const engine = new TemporalMemoryEngine(workspace);
    const record = engine.remember('decision', `Sole active record ${lastActiveCanary}.`);
    expect(fs.readFileSync(memoryMdPath, 'utf-8')).toContain(lastActiveCanary);

    engine.forget(record.id);

    const updated = fs.readFileSync(memoryMdPath, 'utf-8');
    expect(updated).toContain('## Persistent Memory Index\nNo records logged yet.');
    expect(updated).toContain('## Footer\nKeep footer intact.');
    expect(updated).not.toContain(preSyncedForgotten);
    expect(updated).not.toContain(lastActiveCanary);
    expect(updated).not.toContain('[forgotten]');
  });
});
