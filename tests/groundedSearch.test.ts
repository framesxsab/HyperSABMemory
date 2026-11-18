import { it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { TemporalMemoryEngine } from '../src/memory/temporalMemory.js';
import { HybridSearchEngine } from '../src/memory/hybridSearch.js';
import { captureTaskSources, createTaskSourceContentInspector, inspectTaskSourceContents, inspectTaskSources } from '../src/harness/taskSources.js';
import { excerptFor, searchGrounded } from '../src/memory/groundedSearch.js';

it('links a test assertion to the imported implementation and rechecks both sources', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-implementation-'));
  try {
    const code = 'export function tallyCrates() {\n  return countItems();\n}\n';
    const test = "import { it, expect } from 'vitest';\nimport { tallyCrates as tally } from './inventory.js';\nit('totals stock', () => {\n  expect(tally()).toBe(12);\n});\n";
    fs.writeFileSync(path.join(dir, 'inventory.ts'), code);
    fs.writeFileSync(path.join(dir, 'inventory.test.ts'), test);
    fs.writeFileSync(path.join(dir, 'other.test.ts'), test.replace("  expect(tally())", "  const tally = () => 12;\n  expect(tally())"));
    fs.writeFileSync(path.join(dir, 'scratch.ts'), code.replace('tallyCrates', 'tallyCratesBackup'));
    const memory = new TemporalMemoryEngine(dir);
    for (const file of ['inventory.ts', 'inventory.test.ts', 'other.test.ts', 'scratch.ts']) {
      memory.remember('architecture', 'tallyCrates implementation evidence ' + file, [], { artifacts: [file] });
    }
    const refs = captureTaskSources(dir, ['inventory.ts', 'inventory.test.ts', 'other.test.ts', 'scratch.ts']);
    const hybrid = new HybridSearchEngine(dir, memory);
    const ask = () => searchGrounded(hybrid, dir, 'Where is tallyCrates implemented and which tests call it?', refs);
    expect(ask().implementationEvidence).toMatchObject({
      code: [{ symbol: 'tallyCrates', source: { path: 'inventory.ts', sha256: refs[0].sha256, startLine: 1, endLine: 3 },
        facts: [{ kind: 'call_site', source: { startLine: 2, excerpt: 'countItems()' } }] }],
      tests: [{ name: 'totals stock', execution: 'unverified', source: { path: 'inventory.test.ts', sha256: refs[1].sha256, startLine: 4 } }]
    });
    expect(searchGrounded(hybrid, dir, 'Is tallyCrates correct in every case?', refs).canAssert).toBe(false);
    const forgotten = memory.getActive().find(item => item.artifacts?.includes('inventory.ts'))!;
    memory.forget(forgotten.id);
    expect(ask().implementationEvidence).toBeUndefined();
    memory.remember('architecture', 'tallyCrates implementation in inventory', [], { artifacts: ['inventory.ts'] });
    fs.writeFileSync(path.join(dir, 'inventory.test.ts'), test.replace('12', '17'));
    expect(ask().implementationEvidence?.tests).toEqual([]);
    fs.writeFileSync(path.join(dir, 'inventory.ts'), code.replace('countItems', 'countBoxes'));
    expect(ask().implementationEvidence).toBeUndefined();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

it('reports a line only for a unique verified excerpt', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-grounded-line-'));
  try {
    const file = path.join(dir, 'widget.ts');
    fs.writeFileSync(file, '// introduction\n\nexport class Widget {}\n');
    let refs = captureTaskSources(dir, ['widget.ts']);
    const hybrid = new HybridSearchEngine(dir);
    let result = searchGrounded(hybrid, dir, 'Where is Widget defined?', refs);
    expect(result.evidence[0]).toMatchObject({ line: 3, excerpt: 'export class Widget {}' });
    fs.writeFileSync(file, 'export class Widget {}\nexport class Widget {}\n');
    refs = captureTaskSources(dir, ['widget.ts']);
    result = searchGrounded(hybrid, dir, 'Where is Widget defined?', refs);
    expect(result.evidence[0]).not.toHaveProperty('line');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

it('reuses source tokens across questions while invalidating same-size source changes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-grounded-source-token-cache-'));
  try {
    const file = path.join(dir, 'evidence.txt');
    fs.writeFileSync(file, 'alpha beta');
    const refs = captureTaskSources(dir, ['evidence.txt']);
    const memory = new TemporalMemoryEngine(dir);
    memory.remember('architecture', 'alpha gamma beta', [], { artifacts: ['evidence.txt'] });
    const hybrid = new HybridSearchEngine(dir, memory);
    expect(searchGrounded(hybrid, dir, 'alpha', refs).evidence).toHaveLength(1);
    expect(searchGrounded(hybrid, dir, 'gamma', refs).evidence).toEqual([]);
    fs.writeFileSync(file, 'gamma beta');
    expect(searchGrounded(hybrid, dir, 'alpha', refs)).toMatchObject({ status: 'STALE_EVIDENCE', canAssert: false });
    const refreshed = captureTaskSources(dir, ['evidence.txt']);
    expect(searchGrounded(hybrid, dir, 'gamma', refreshed).evidence).toHaveLength(1);
    expect(searchGrounded(hybrid, dir, 'alpha', refreshed).evidence).toEqual([]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

it('preserves mixed batch freshness results without retaining metadata-only source bytes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-source-batch-'));
  try {
    for (const name of ['current.txt', 'changed.txt', 'missing.txt']) fs.writeFileSync(path.join(dir, name), 'alpha');
    const refs = captureTaskSources(dir, ['current.txt', 'changed.txt', 'missing.txt']);
    fs.writeFileSync(path.join(dir, 'changed.txt'), 'bravo');
    fs.unlinkSync(path.join(dir, 'missing.txt'));
    const sources = [...refs, { path: 'current.txt', sha256: '' }, { path: '../outside.txt', sha256: '' }];
    const metadata = inspectTaskSources(dir, sources);
    const contents = inspectTaskSourceContents(dir, sources);
    expect(metadata.map(item => item.status)).toEqual(['current', 'modified', 'missing', 'unavailable', 'unavailable']);
    expect(contents.map(item => item.status)).toEqual(metadata.map(item => item.status));
    expect(metadata.every(item => !('content' in item))).toBe(true);
    expect(metadata[3].detail).toContain('re-read and checkpoint');
    expect(contents[0].content?.toString()).toBe('alpha');
    expect(contents[4]).not.toHaveProperty('content');
    expect(inspectTaskSources(path.join(dir, 'absent'), [])).toEqual([]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

it('verifies ordinary symbol questions while abstaining from compound or negated claims', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-grounded-symbol-language-'));
  try {
    fs.writeFileSync(path.join(dir, 'widget.ts'), 'export function createWidget() {}\nexport class Widget$ {}');
    const refs = captureTaskSources(dir, ['widget.ts']);
    const hybrid = new HybridSearchEngine(dir);
    for (const query of ['Where is createWidget defined?', 'Which file defines createWidget?', 'Where is the function createWidget() defined?', 'Where is `createWidget()` defined?', 'Which file defines Widget$?']) {
      expect(searchGrounded(hybrid, dir, query, refs)).toMatchObject({ status: 'SUPPORTED', canAssert: true, assertions: [{ sourcePath: 'widget.ts' }] });
    }
    for (const query of ['Where is createWidget defined and is it secure?', 'Where is createWidget not defined?', 'Explain where is `createWidget` defined and why it is safe.', 'Which file defines Widget?', 'Which file defines `Widget`?']) {
      expect(searchGrounded(hybrid, dir, query, refs).canAssert).toBe(false);
    }
    fs.writeFileSync(path.join(dir, 'widget.ts'), 'export function deleteWidget() {}\nexport class Widget$ {}');
    expect(searchGrounded(hybrid, dir, 'Where is createWidget defined?', refs)).toMatchObject({ canAssert: false, status: 'STALE_EVIDENCE' });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

it('never returns a stale source promoted by an import relationship', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-grounded-stale-import-'));
  try {
    fs.mkdirSync(path.join(dir, 'src'));
    fs.mkdirSync(path.join(dir, 'tests'));
    fs.mkdirSync(path.join(dir, '.hypersabmemory'));
    const files = [
      ['src/task.ts', 'lease validation policy lease validation policy'],
      ['src/noise.ts', 'lease validation policy'],
      ['tests/check.ts', "import { task } from '../src/task.js';\nlease validation policy"]
    ];
    for (const [filename, content] of files) fs.writeFileSync(path.join(dir, filename), content);
    const refs = captureTaskSources(dir, files.map(([filename]) => filename));
    const records = files.map(([filename, content]) => ({ id: filename, category: 'architecture', content, artifacts: [filename], status: 'active', timestamp: '2026-01-01T00:00:00.000Z' }));
    fs.writeFileSync(path.join(dir, '.hypersabmemory', 'memory_store.json'), JSON.stringify(records));
    fs.writeFileSync(path.join(dir, 'tests/check.ts'), files[2][1].replace('policy', 'policx'));
    const result = searchGrounded(new HybridSearchEngine(dir), dir, 'lease validation policy', refs);
    expect(result.canAssert).toBe(false);
    expect(result.evidence.some(item => item.source.path === 'tests/check.ts')).toBe(false);
    expect(result.staleSources).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'tests/check.ts', status: 'modified' })]));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

it('selects stronger current evidence beyond the first five without asserting a claim', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-grounded-evidence-pool-'));
  try {
    const names = Array.from({ length: 6 }, (_, index) => `source${index}.txt`);
    for (const [index, name] of names.entries()) fs.writeFileSync(path.join(dir, name), index === 5 ? 'lease validation policy' : 'lease');
    const refs = captureTaskSources(dir, names);
    const hybrid = new HybridSearchEngine(dir);
    vi.spyOn(hybrid, 'searchRecordsWithScores').mockReturnValue(names.map((name, index) => ({
      record: { id: name, category: 'general', content: 'lease validation policy', artifacts: [name], timestamp: '2026-01-01T00:00:00.000Z' },
      bm25Score: 10 - index, queryTermEvidence: [], exactPathMatch: false, identifierDefinitions: [], exactPhraseBoost: 0, score: 10 - index
    })));
    const result = searchGrounded(hybrid, dir, 'lease validation policy', refs);
    expect(result.canAssert).toBe(false);
    expect(result.assertions).toEqual([]);
    expect(result.evidence.map(item => item.source.path)).toContain('source5.txt');
    expect(result.evidence).toHaveLength(5);
    fs.writeFileSync(path.join(dir, 'source5.txt'), 'lease validation policx');
    const stale = searchGrounded(hybrid, dir, 'lease validation policy', refs);
    expect(stale.evidence.some(item => item.source.path === 'source5.txt')).toBe(false);
    expect(stale.staleSources).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'source5.txt', status: 'modified' })]));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

it('prefers an actual identifier declaration over earlier mentions in code excerpts', () => {
  const content = [
    '// export function createInvoice() {}',
    "import { createInvoice } from './other.js';",
    'createInvoice();',
    'createInvoice();',
    'export function createInvoice() { return 42; }'
  ].join('\n');
  const excerpt = excerptFor('How is createInvoice handled?', content, 'src/invoice.ts');
  expect(excerpt?.split('\n')[0]).toBe('export function createInvoice() { return 42; }');
  expect(excerpt?.split('\n').length).toBeLessThanOrEqual(3);
});

it('revalidates file contents and symlink containment for every source inspection', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-source-inspector-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-source-outside-'));
  try {
    const inside = path.join(dir, 'inside');
    const link = path.join(dir, 'link');
    fs.mkdirSync(inside);
    fs.writeFileSync(path.join(inside, 'config.json'), '{"port": 4321}');
    fs.writeFileSync(path.join(outside, 'config.json'), '{"port": 4321}');
    fs.symlinkSync(inside, link, 'junction');
    const refs = captureTaskSources(dir, ['link/config.json']);
    const inspect = createTaskSourceContentInspector(dir);
    expect(inspect(refs)[0].status).toBe('current');
    fs.writeFileSync(path.join(inside, 'config.json'), '{"port": 4322}');
    expect(inspect(refs)[0].status).toBe('modified');
    if (process.platform === 'win32') fs.rmdirSync(link); else fs.unlinkSync(link);
    fs.symlinkSync(outside, link, 'junction');
    const escaped = inspect(refs)[0];
    expect(escaped.status).toBe('unavailable');
    expect(escaped).not.toHaveProperty('content');
    expect(inspectTaskSources(dir, refs)[0].status).toBe('unavailable');
    const batch = inspectTaskSourceContents(dir, refs)[0];
    expect(batch.status).toBe('unavailable');
    expect(batch).not.toHaveProperty('content');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); }
});

it('verifies explicitly captured sources without a separately remembered record', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-grounded-task-sources-'));
  try {
    fs.writeFileSync(path.join(dir, 'config.json'), '{"port": 4321}');
    fs.writeFileSync(path.join(dir, 'widget.ts'), 'export class Widget {}');
    fs.writeFileSync(path.join(dir, 'Architecture.md'), 'Decision: validate input before routing.');
    const refs = captureTaskSources(dir, ['config.json', 'widget.ts', 'Architecture.md']);
    const hybrid = new HybridSearchEngine(dir);
    for (const [query, filename] of [
      ['What is the value of `port` in `config.json`?', 'config.json'],
      ['Where is `Widget` defined?', 'widget.ts'],
      ['Does `Architecture.md` contain `validate input before routing`?', 'Architecture.md']
    ]) {
      const result = searchGrounded(hybrid, dir, query, refs);
      expect(result).toMatchObject({ status: 'SUPPORTED', canAssert: true, assertions: [{ sourcePath: filename }] });
      expect(result.evidence[0].record.id).toBe(`source_ref:${filename}`);
      expect(result.evidence[0].record.category).toBe(filename === 'widget.ts' ? 'symbol' : 'general');
      expect(result.evidence[0].record.content.length).toBeLessThan(320);
    }
    fs.writeFileSync(path.join(dir, 'config.json'), '{"port": 4322}');
    expect(searchGrounded(hybrid, dir, 'What is the value of `port` in `config.json`?', refs)).toMatchObject({ status: 'STALE_EVIDENCE', canAssert: false, claims: [] });
    expect(searchGrounded(hybrid, dir, 'Where is `DefinitelyAbsent` defined?', refs).canAssert).toBe(false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

it('returns a source-qualified decision claim through the general grounder', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-grounded-recorded-claim-'));
  try {
    const sourcePath = 'decisions/task-storage.md';
    fs.mkdirSync(path.dirname(path.join(dir, sourcePath)), { recursive: true });
    fs.writeFileSync(path.join(dir, sourcePath), 'Decision: Use SQLite for task coordination.\nRationale: Preserve atomic task transitions.\n');
    const memory = new TemporalMemoryEngine(dir);
    memory.remember('decision', 'Task coordination decision: SQLite.', [], { artifacts: [sourcePath] });
    const refs = captureTaskSources(dir, [sourcePath]);
    const result = searchGrounded(new HybridSearchEngine(dir, memory), dir, 'What decision was recorded about task coordination?', refs);
    expect(result).toMatchObject({ status: 'SUPPORTED', canAssert: true });
    expect(result.claims).toEqual(expect.arrayContaining([expect.objectContaining({
        type: 'recorded_decision',
        claim: 'The source records the decision: Use SQLite for task coordination.',
        source: expect.objectContaining({ path: sourcePath, sha256: refs[0].sha256, line: 1, freshness: 'current' }),
        verification: 'exact_markdown_line'
      })]));
    fs.writeFileSync(path.join(dir, sourcePath), 'Decision: Use a queue for task coordination.\nRationale: Preserve atomic task transitions.\n');
    expect(searchGrounded(new HybridSearchEngine(dir, memory), dir, 'What decision was recorded about task coordination?', refs)).toMatchObject({ status: 'STALE_EVIDENCE', canAssert: false, claims: [] });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

it('returns explicitly linked multi-source claims through the general grounder and abstains on compliance or conflicts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-grounded-linked-claims-'));
  try {
    const decisionPath = 'decisions/storage-choice.md';
    const constraintPath = 'architecture/task-rules.md';
    const conflictPath = 'architecture/alternate-rules.md';
    fs.mkdirSync(path.dirname(path.join(dir, decisionPath)), { recursive: true });
    fs.mkdirSync(path.dirname(path.join(dir, constraintPath)), { recursive: true });
    fs.writeFileSync(path.join(dir, decisionPath), 'Decision: Use SQLite for task coordination.\nRationale: Preserve atomic task transitions.\n');
    fs.writeFileSync(path.join(dir, constraintPath), `Decision-Source: ${decisionPath}\nConstraint: Task updates must use a transactional coordinator.\n`);
    fs.writeFileSync(path.join(dir, conflictPath), `Decision-Source: ${decisionPath}\nConstraint: Task updates may bypass transactions.\n`);
    const memory = new TemporalMemoryEngine(dir);
    memory.remember('decision', 'SQLite task coordination preserves atomic task transitions.', [], { artifacts: [decisionPath] });
    memory.remember('architecture', 'Task update implementation constraint requires a transactional coordinator.', [], { artifacts: [constraintPath] });
    const refs = captureTaskSources(dir, [decisionPath, constraintPath, conflictPath]);
    const hybrid = new HybridSearchEngine(dir, memory);
    const query = 'What storage decision was recorded, why, and what task update constraint explicitly follows?';
    const result = searchGrounded(hybrid, dir, query, refs);
    expect(result).toMatchObject({ status: 'SUPPORTED', canAssert: true, compoundAnswer: { text: expect.stringContaining('transactional coordinator') } });
    expect(result.claims?.map(item => item.type)).toEqual(['recorded_decision', 'recorded_rationale', 'recorded_constraint']);
    expect(result.claims?.every(item => item.source.freshness === 'current' && /^[a-f0-9]{64}$/.test(item.source.sha256))).toBe(true);
    expect(result.relationships).toEqual([expect.objectContaining({ status: 'verified', evidence: expect.objectContaining({ path: constraintPath, line: 1, excerpt: `Decision-Source: ${decisionPath}` }) })]);

    const compliance = searchGrounded(hybrid, dir, 'Is task coordination correctly implemented using SQLite?', refs);
    expect(compliance.canAssert).toBe(false);
    expect(compliance.assertions).toEqual([]);
    expect(compliance.claims).toEqual([]);

    memory.remember('architecture', 'Conflicting task update constraint permits uncoordinated writes.', [], { artifacts: [conflictPath] });
    const conflict = searchGrounded(hybrid, dir, query, refs);
    expect(conflict).toMatchObject({ status: 'CONFLICTING_EVIDENCE', canAssert: false, assertions: [], claims: [], relationships: [] });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

it('does not resurrect forgotten memory or trust an escaping source reference', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-grounded-forgotten-source-'));
  try {
    fs.writeFileSync(path.join(dir, 'config.json'), '{"port": 4321}');
    const refs = captureTaskSources(dir, ['config.json']);
    const memory = new TemporalMemoryEngine(dir);
    const forgotten = memory.remember('decision', 'forgotten private note about config port', [], { artifacts: ['config.json'] });
    memory.forget(forgotten.id);
    const hybrid = new HybridSearchEngine(dir, memory);
    const result = searchGrounded(hybrid, dir, 'What is the value of `port` in `config.json`?', refs);
    expect(result.canAssert).toBe(true);
    expect(result.claims?.some(item => item.type === 'json_scalar')).toBe(true);
    expect(JSON.stringify(result)).not.toContain(forgotten.id);
    expect(JSON.stringify(result)).not.toContain('forgotten private note');
    const escaping = searchGrounded(hybrid, dir, 'What is the value of `port` in `../outside.json`?', [{ path: '../outside.json', sha256: 'arbitrary' }]);
    expect(escaping.canAssert).toBe(false);
    expect(escaping.staleSources).toEqual(expect.arrayContaining([expect.objectContaining({ path: '../outside.json', status: 'unavailable' })]));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

it('refuses assertions when captured references disagree about the same source', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-grounded-conflicting-hashes-'));
  try {
    const file = path.join(dir, 'config.json');
    fs.writeFileSync(file, '{"port": 4321}');
    const original = captureTaskSources(dir, ['config.json']);
    fs.writeFileSync(file, '{"port": 4322}');
    const updated = captureTaskSources(dir, ['config.json']);
    const result = searchGrounded(new HybridSearchEngine(dir), dir, 'What is the value of `port` in `config.json`?', [...original, ...updated]);
    expect(result).toMatchObject({ status: 'CONFLICTING_EVIDENCE', canAssert: false, assertions: [], claims: [], relationships: [], conflictOrigin: 'source_hash_mismatch', conflictPaths: ['config.json'] });
    const duplicate = searchGrounded(new HybridSearchEngine(dir), dir, 'What is the value of `port` in `config.json`?', [...updated, ...updated]);
    expect(duplicate).toMatchObject({ status: 'SUPPORTED', canAssert: true });
    const alias = searchGrounded(new HybridSearchEngine(dir), dir, 'What is the value of `port` in `config.json`?', [{ ...original[0], path: './config.json' }, ...updated]);
    expect(alias).toMatchObject({ status: 'CONFLICTING_EVIDENCE', canAssert: false, conflictOrigin: 'source_hash_mismatch' });
    if (process.platform === 'win32') {
      const caseAlias = searchGrounded(new HybridSearchEngine(dir), dir, 'What is the value of `port` in `config.json`?', [{ ...original[0], path: 'CONFIG.JSON' }, ...updated]);
      expect(caseAlias).toMatchObject({ status: 'CONFLICTING_EVIDENCE', canAssert: false, conflictOrigin: 'source_hash_mismatch' });
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

it('finds an explicit symbol at the end of a full task source list', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-grounded-many-sources-'));
  try {
    const names = Array.from({ length: 64 }, (_, index) => `source${index}.ts`);
    for (const [index, name] of names.entries()) fs.writeFileSync(path.join(dir, name), index === 63 ? 'export class Widget {}' : 'export class Other {}');
    const refs = captureTaskSources(dir, names);
    const result = searchGrounded(new HybridSearchEngine(dir), dir, 'Where is `Widget` defined?', refs);
    expect(result).toMatchObject({ status: 'SUPPORTED', assertions: [{ sourcePath: 'source63.ts' }] });
    expect(result.evidence.length).toBeLessThanOrEqual(5);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

it('does not promote source-only lexical matches without the requested symbol', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-grounded-source-no-symbol-'));
  try {
    fs.writeFileSync(path.join(dir, 'other.ts'), '// defined elsewhere\nexport class Other {}');
    const refs = captureTaskSources(dir, ['other.ts']);
    const result = searchGrounded(new HybridSearchEngine(dir), dir, 'Where is `Widget` defined?', refs);
    expect(result.canAssert).toBe(false);
    expect(result.evidence).toEqual([]);
    expect(result.candidates.map(candidate => candidate.recordId)).toEqual(['source_ref:other.ts']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

it('backfills distinct evidence when several memory records reference the same file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-grounded-duplicate-sources-'));
  try {
    for (const name of ['first.txt', 'second.txt']) fs.writeFileSync(path.join(dir, name), 'lock recovery policy');
    const refs = captureTaskSources(dir, ['first.txt', 'second.txt']);
    const hybrid = new HybridSearchEngine(dir);
    vi.spyOn(hybrid, 'searchRecordsWithScores').mockReturnValue([...Array(5).fill('first.txt'), 'second.txt'].map((name, index) => ({
      record: { id: `${index}`, category: 'general', content: 'lock recovery policy', artifacts: [name], timestamp: '2026-01-01T00:00:00.000Z' },
      bm25Score: 10 - index, queryTermEvidence: [], exactPathMatch: false, identifierDefinitions: [], exactPhraseBoost: 0, score: 10 - index
    })));
    const result = searchGrounded(hybrid, dir, 'lock recovery policy', refs);
    expect(result.evidence.map(item => item.source.path)).toEqual(['first.txt', 'second.txt']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

it('includes verified assertion sources even after five earlier candidates', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-grounded-assertion-evidence-'));
  try {
    const names = [...Array.from({ length: 5 }, (_, index) => `candidate${index}.ts`), 'widget.ts'];
    for (const name of names) fs.writeFileSync(path.join(dir, name), name === 'widget.ts' ? 'export class Widget {}' : 'Widget definition is discussed here.');
    const refs = captureTaskSources(dir, names);
    const hybrid = new HybridSearchEngine(dir);
    vi.spyOn(hybrid, 'searchRecordsWithScores').mockReturnValue(names.map((name, index) => ({
      record: { id: name, category: 'symbol', content: 'Widget definition', artifacts: [name], timestamp: '2026-01-01T00:00:00.000Z' },
      bm25Score: 10 - index, queryTermEvidence: [], exactPathMatch: false, identifierDefinitions: [], exactPhraseBoost: 0, score: 10 - index
    })));
    const result = searchGrounded(hybrid, dir, 'Where is `Widget` defined?', refs);
    expect(result.assertions).toHaveLength(1);
    expect(result.evidence.some(item => item.source.path === result.assertions[0].sourcePath && item.excerpt === result.assertions[0].excerpt)).toBe(true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

it('continues past five lexical candidates to verify an explicit configuration source', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-grounded-config-backfill-'));
  try {
    const names = [...Array.from({ length: 5 }, (_, index) => `candidate${index}.txt`), 'config.json'];
    for (const name of names) fs.writeFileSync(path.join(dir, name), name === 'config.json' ? '{"port": 4321}' : 'port config json value');
    const refs = captureTaskSources(dir, names);
    const hybrid = new HybridSearchEngine(dir);
    vi.spyOn(hybrid, 'searchRecordsWithScores').mockReturnValue(names.map((name, index) => ({
      record: { id: name, category: 'general', content: 'port config json value', artifacts: [name], timestamp: '2026-01-01T00:00:00.000Z' },
      bm25Score: 10 - index, queryTermEvidence: [], exactPathMatch: false, identifierDefinitions: [], exactPhraseBoost: 0, score: 10 - index
    })));
    const result = searchGrounded(hybrid, dir, 'What is the value of `port` in `config.json`?', refs);
    expect(result).toMatchObject({ status: 'SUPPORTED', assertions: [{ sourcePath: 'config.json' }] });
    expect(result.evidence.some(item => item.source.path === 'config.json' && item.excerpt === result.assertions[0].excerpt)).toBe(true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

it('limits supported assertions to the evidence actually returned', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-grounded-assertion-limit-'));
  try {
    const names = Array.from({ length: 7 }, (_, index) => `widget${index}.ts`);
    for (const name of names) fs.writeFileSync(path.join(dir, name), 'export class Widget {}');
    const refs = captureTaskSources(dir, names);
    const hybrid = new HybridSearchEngine(dir);
    vi.spyOn(hybrid, 'searchRecordsWithScores').mockReturnValue(names.map((name, index) => ({
      record: { id: name, category: 'symbol', content: 'Widget', artifacts: [name], timestamp: '2026-01-01T00:00:00.000Z' },
      bm25Score: 10 - index, queryTermEvidence: [], exactPathMatch: false, identifierDefinitions: [], exactPhraseBoost: 0, score: 10 - index
    })));
    const result = searchGrounded(hybrid, dir, 'Where is `Widget` defined?', refs);
    expect(result.evidence).toHaveLength(5);
    expect(result.assertions).toHaveLength(5);
    expect(result.assertions.every(assertion => result.evidence.some(item => item.source.path === assertion.sourcePath && item.excerpt === assertion.excerpt))).toBe(true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

it('rejects a source modified after inspection but before an assertion is returned', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-grounded-late-change-'));
  try {
    const source = path.join(dir, 'widget.ts');
    fs.writeFileSync(source, 'export class Widget {}');
    fs.writeFileSync(path.join(dir, 'other.ts'), 'unrelated content');
    const refs = captureTaskSources(dir, ['widget.ts', 'other.ts']);
    const hybrid = new HybridSearchEngine(dir);
    const base = { bm25Score: 1, queryTermEvidence: [], exactPathMatch: false, identifierDefinitions: [], exactPhraseBoost: 0, score: 1 };
    const later = { id: 'other', category: 'symbol' as const, content: 'other', timestamp: '2026-01-01T00:00:00.000Z', get artifacts() { fs.writeFileSync(source, 'export class Gidget {}'); return ['other.ts']; } };
    vi.spyOn(hybrid, 'searchRecordsWithScores').mockReturnValue([
      { ...base, record: { id: 'widget', category: 'symbol', content: 'Widget', artifacts: ['widget.ts'], timestamp: '2026-01-01T00:00:00.000Z' } },
      { ...base, record: later }
    ]);
    const result = searchGrounded(hybrid, dir, 'Where is `Widget` defined?', refs);
    expect(result.canAssert).toBe(false);
    expect(result.assertions).toEqual([]);
    expect(result.staleSources).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'widget.ts', status: 'modified' })]));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

it('verifies exact decision text without inferring its meaning', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-grounded-decision-'));
  try {
    const file = path.join(dir, 'Architecture.md');
    fs.writeFileSync(file, 'Decision: validate input before routing.');
    const refs = captureTaskSources(dir, ['Architecture.md']);
    const memory = new TemporalMemoryEngine(dir);
    memory.remember('decision', 'Decision: validate input before routing.', [], { artifacts: ['Architecture.md'] });
    const hybrid = new HybridSearchEngine(dir, memory);
    const query = 'Does `Architecture.md` contain `validate input before routing`?';
    expect(searchGrounded(hybrid, dir, query, refs)).toMatchObject({ status: 'SUPPORTED', assertions: [{ sourcePath: 'Architecture.md', excerpt: 'validate input before routing' }] });
    fs.writeFileSync(file, 'Decision: validate input after routing.');
    expect(searchGrounded(hybrid, dir, query, refs).canAssert).toBe(false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

it('does not assert that a symbol is defined in a documentation example', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-grounded-doc-example-'));
  try {
    fs.writeFileSync(path.join(dir, 'example.md'), '~~~ts\nexport class Widget {}\n~~~');
    const refs = captureTaskSources(dir, ['example.md']);
    const memory = new TemporalMemoryEngine(dir);
    memory.remember('symbol', 'Widget is an example class.', [], { artifacts: ['example.md'] });
    const result = searchGrounded(new HybridSearchEngine(dir, memory), dir, 'Where is `Widget` defined?', refs);
    expect(result.canAssert).toBe(false);
    expect(result.assertions).toEqual([]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

it('asserts an exact JSON configuration value only from current unambiguous bytes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-grounded-config-'));
  try {
    const file = path.join(dir, 'config.json');
    fs.writeFileSync(file, '{"port": 4321}');
    const refs = captureTaskSources(dir, ['config.json']);
    const memory = new TemporalMemoryEngine(dir);
    memory.remember('architecture', 'config port 4321', [], { artifacts: ['config.json'] });
    const hybrid = new HybridSearchEngine(dir, memory);
    const query = 'What is the value of `port` in `config.json`?';
    const supported = searchGrounded(hybrid, dir, query, refs);
    expect(supported).toMatchObject({ status: 'SUPPORTED', canAssert: true, assertions: [{ claim: 'Configuration port in config.json is 4321.', excerpt: '"port": 4321' }] });
    expect(supported.claims).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'json_scalar', claim: 'The current configuration records port 4321.', source: expect.objectContaining({ path: 'config.json', sha256: refs[0].sha256, line: 1, freshness: 'current' }), verification: 'unique_json_scalar' })]));
    expect(searchGrounded(hybrid, dir, query, refs, ['config.json']).canAssert).toBe(false);
    fs.writeFileSync(file, '{"port": 4322}');
    expect(searchGrounded(hybrid, dir, query, refs).canAssert).toBe(false);
    fs.writeFileSync(file, '{"port": 4321, "nested": {"port": 4321}}');
    expect(searchGrounded(hybrid, dir, query, captureTaskSources(dir, ['config.json'])).canAssert).toBe(false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

it('backfills stale ranked sources while preserving verified current evidence', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-grounded-backfill-'));
  try {
    const names = Array.from({ length: 7 }, (_, i) => `source${i}.txt`);
    for (const name of names) fs.writeFileSync(path.join(dir, name), 'lock recovery policy');
    const refs = captureTaskSources(dir, names);
    fs.writeFileSync(path.join(dir, names[0]), 'lock recovery pol1cy');
    const hybrid = new HybridSearchEngine(dir);
    vi.spyOn(hybrid, 'searchRecordsWithScores').mockReturnValue(names.map((name, i) => ({
      record: { id: name, category: 'general', content: 'lock recovery policy', artifacts: [name], status: 'active', timestamp: '2026-01-01T00:00:00.000Z' },
      bm25Score: 7 - i, queryTermEvidence: [], exactPathMatch: false, identifierDefinitions: [], exactPhraseBoost: 0, score: 7 - i
    })));
    const result = searchGrounded(hybrid, dir, 'lock recovery policy', refs);
    expect(result.staleSources.map(source => source.path)).toEqual([names[0]]);
    expect(result.evidence.map(item => item.source.path)).toEqual(names.slice(1, 6));
    expect(result.evidence.every(item => item.source.status === 'current')).toBe(true);
    const timing = { candidateMs: 0, rankingMs: 0, pathMs: 0, readMs: 0, hashMs: 0, excerptMs: 0, decisionMs: 0 };
    searchGrounded(hybrid, dir, 'lock recovery policy', refs, [], timing);
    const priorDecision = timing.decisionMs;
    searchGrounded(hybrid, dir, 'lock recovery policy', refs, [], timing);
    expect(timing.decisionMs).toBeGreaterThanOrEqual(priorDecision);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

it('requires current source hashes and surfaces declared conflicts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-grounded-'));
  try {
    fs.writeFileSync(path.join(dir, 'evidence.txt'), 'lock recovery policy');
    const refs = captureTaskSources(dir, ['evidence.txt']);
    const memory = new TemporalMemoryEngine(dir);
    const record = memory.remember('decision', 'lock recovery policy coordinates writer ownership', [], { artifacts: ['evidence.txt'] });
    const hybrid = new HybridSearchEngine(dir, memory);
    expect(searchGrounded(hybrid, dir, 'lock recovery policy', refs).status).toBe('INSUFFICIENT_EVIDENCE');
    expect(searchGrounded(hybrid, dir, 'lock recovery policy', refs).canAssert).toBe(false);
    expect(searchGrounded(hybrid, dir, 'lock recovery policy', refs, ['evidence.txt'])).toMatchObject({ status: 'CONFLICTING_EVIDENCE', canAssert: false, conflictOrigin: 'caller_declared' });
    expect(searchGrounded(hybrid, dir, 'patient pharmacy prescription', refs).status).toBe('INSUFFICIENT_EVIDENCE');
    const originalSize = fs.statSync(path.join(dir, 'evidence.txt')).size;
    fs.writeFileSync(path.join(dir, 'evidence.txt'), 'lock recovery pol1cy');
    expect(fs.statSync(path.join(dir, 'evidence.txt')).size).toBe(originalSize);
    expect(searchGrounded(hybrid, dir, 'lock recovery policy', refs)).toMatchObject({ status: 'STALE_EVIDENCE', canAssert: false, staleSources: [{ path: 'evidence.txt', status: 'modified' }] });
    fs.unlinkSync(path.join(dir, 'evidence.txt'));
    expect(searchGrounded(hybrid, dir, 'lock recovery policy', refs)).toMatchObject({ status: 'STALE_EVIDENCE', staleSources: [{ path: 'evidence.txt', status: 'missing' }] });
    memory.forget(record.id);
    expect(searchGrounded(hybrid, dir, 'lock recovery policy', refs).status).toBe('INSUFFICIENT_EVIDENCE');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

it('rejects renamed evidence referenced by a stale indexed memory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-grounded-rename-'));
  try {
    fs.writeFileSync(path.join(dir, 'oldName.ts'), 'export class Widget {}');
    const refs = captureTaskSources(dir, ['oldName.ts']);
    const memory = new TemporalMemoryEngine(dir);
    memory.remember('symbol', 'Where is Widget defined? Widget is the exported class.', [], { artifacts: ['oldName.ts'] });
    const hybrid = new HybridSearchEngine(dir, memory);
    fs.renameSync(path.join(dir, 'oldName.ts'), path.join(dir, 'newName.ts'));
    expect(searchGrounded(hybrid, dir, 'Where is `Widget` defined?', refs)).toMatchObject({
      status: 'STALE_EVIDENCE', canAssert: false, staleSources: [{ path: 'oldName.ts', status: 'missing' }]
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

it('rechecks source bytes after candidate retrieval and before asserting', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-grounded-race-'));
  try {
    const source = path.join(dir, 'widget.ts');
    fs.writeFileSync(source, 'export class Widget {}');
    const refs = captureTaskSources(dir, ['widget.ts']);
    const memory = new TemporalMemoryEngine(dir);
    memory.remember('symbol', 'Where is Widget defined? Widget is the exported class.', [], { artifacts: ['widget.ts'] });
    const hybrid = new HybridSearchEngine(dir, memory);
    const search = hybrid.searchRecordsWithScores.bind(hybrid);
    vi.spyOn(hybrid, 'searchRecordsWithScores').mockImplementation((...args) => {
      const candidates = search(...args);
      fs.writeFileSync(source, 'export class Gidget {}');
      return candidates;
    });
    expect(searchGrounded(hybrid, dir, 'Where is `Widget` defined?', refs)).toMatchObject({
      status: 'STALE_EVIDENCE', canAssert: false, staleSources: [{ path: 'widget.ts', status: 'modified' }]
    });
    const refreshedRefs = captureTaskSources(dir, ['widget.ts']);
    memory.remember('symbol', 'Where is Gidget defined? Gidget is the exported class.', [], { artifacts: ['widget.ts'] });
    expect(searchGrounded(hybrid, dir, 'Where is `Gidget` defined?', refreshedRefs)).toMatchObject({
      status: 'SUPPORTED', canAssert: true, assertions: [{ sourcePath: 'widget.ts' }]
    });
    expect(searchGrounded(hybrid, dir, 'Where is `Gidget` defined?', refreshedRefs).assertions).toHaveLength(1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

it('excludes superseded and forgotten records from grounded candidates', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-grounded-status-'));
  try {
    for (const filename of ['old.txt', 'new.txt']) fs.writeFileSync(path.join(dir, filename), 'lock recovery policy');
    const refs = captureTaskSources(dir, ['old.txt', 'new.txt']);
    const memory = new TemporalMemoryEngine(dir);
    const old = memory.remember('decision', 'lock recovery policy coordinates writer ownership', [], { artifacts: ['old.txt'] });
    const current = memory.remember('decision', 'lock recovery policy coordinates writer ownership', [], { artifacts: ['new.txt'] });
    const hybrid = new HybridSearchEngine(dir, memory);
    expect(searchGrounded(hybrid, dir, 'lock recovery policy', refs).candidates.map(item => item.recordId)).toEqual([current.id]);
    expect(current.id).not.toBe(old.id);
    memory.forget(current.id);
    expect(searchGrounded(hybrid, dir, 'lock recovery policy', refs).candidates).toEqual([]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

it('does not treat an unsupported memory statement as source evidence', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-grounded-'));
  try {
    fs.writeFileSync(path.join(dir, 'evidence.txt'), 'only an unrelated garden note');
    const refs = captureTaskSources(dir, ['evidence.txt']);
    const memory = new TemporalMemoryEngine(dir);
    memory.remember('decision', 'lock recovery policy coordinates writer ownership', [], { artifacts: ['evidence.txt'] });
    expect(searchGrounded(new HybridSearchEngine(dir, memory), dir, 'lock recovery policy', refs).status).toBe('INSUFFICIENT_EVIDENCE');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

it('asserts only an exact source declaration and returns its excerpt', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-grounded-'));
  try {
    const file = path.join(dir, 'mcpAccess.ts');
    fs.writeFileSync(file, 'export class McpAccessEngine {}');
    const fixture = path.join(dir, 'fixture.test.ts');
    const misleading = "const fixture = `\nexport class McpAccessEngine {}\n`;";
    fs.writeFileSync(fixture, misleading);
    const refs = captureTaskSources(dir, ['mcpAccess.ts', 'fixture.test.ts']);
    const memory = new TemporalMemoryEngine(dir);
    memory.remember('architecture', 'export class McpAccessEngine {}', [], { artifacts: ['mcpAccess.ts'] });
    memory.remember('general', misleading, [], { artifacts: ['fixture.test.ts'] });
    const result = searchGrounded(new HybridSearchEngine(dir, memory), dir, 'Which file defines `McpAccessEngine`?', refs);
    expect(result.status).toBe('SUPPORTED');
    expect(result.canAssert).toBe(true);
    expect(result.assertions[0].sourcePath).toBe('mcpAccess.ts');
    expect(result.assertions).toHaveLength(1);
    expect(result.assertions[0].excerpt).toContain('class McpAccessEngine');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
