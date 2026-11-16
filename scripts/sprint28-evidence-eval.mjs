import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const files = {
  'src/holds/release.ts': 'export function releaseHold(hold) { return { ...hold, state: "released" }; }\n',
  'tests/holds/release.test.ts': 'test("release hold", () => expect(releaseHold({}).state).toBe("released"));\n',
  'src/routes/holdRoutes.ts': 'router.post("/holds/:id/release", releaseHoldHandler);\n',
  'docs/decisions/hold.md': 'Decision: release holds explicitly because automatic release can race with payment settlement.\n',
  'src/parcels/dispatch.ts': 'export function dispatchParcel(parcel) { return { ...parcel, state: "sent" }; }\n',
  'tests/parcels/dispatch.test.ts': 'test("dispatch parcel", () => expect(dispatchParcel({}).state).toBe("sent"));\n',
  'src/routes/parcelRoutes.ts': 'router.post("/parcels/dispatch", dispatchParcelHandler);\n',
  'docs/decisions/parcel.md': 'Decision: dispatch parcels in batches because carrier pickup is scheduled.\n',
  'docs/retention-a.md': 'Parcel retention is seven days.\n',
  'docs/retention-b.md': 'Parcel retention is fourteen days.\n',
  'src/stale.ts': 'export function expiredBadge() { return "old"; }\n',
  'src/deleted.ts': 'export function removedBadge() { return "gone"; }\n',
};
const cases = [
  { id: 'holds', query: 'Find the release hold implementation, test, route interface, and decision rationale.', roles: { implementation: ['src/holds/release.ts'], test: ['tests/holds/release.test.ts'], interface: ['src/routes/holdRoutes.ts'], decision: ['docs/decisions/hold.md'] } },
  { id: 'parcels', query: 'Find the dispatch parcel implementation, test, route interface, and decision rationale.', roles: { implementation: ['src/parcels/dispatch.ts'], test: ['tests/parcels/dispatch.test.ts'], interface: ['src/routes/parcelRoutes.ts'], decision: ['docs/decisions/parcel.md'] } },
  { id: 'absent', query: 'Find the drone insurance implementation, test, route interface, and decision rationale.', roles: { implementation: [], test: [], interface: [], decision: [] } },
];
assert.equal(new Set(cases.map(c => c.id)).size, cases.length);
for (const c of cases) for (const paths of Object.values(c.roles)) for (const p of paths) assert.ok(Object.hasOwn(files, p));

const tmp = await realpath(os.tmpdir());
const root = await realpath(await mkdtemp(path.join(tmp, 'sprint28-eval-')));
const contained = (base, target) => { const rel = path.relative(base, target); return !!rel && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel); };
assert.ok(contained(tmp, root) && path.basename(root).startsWith('sprint28-eval-'));
const target = name => { const p = path.resolve(root, name); assert.ok(contained(root, p)); return p; };
let client;
try {
  for (const [name, body] of Object.entries(files)) {
    await mkdir(path.dirname(target(name)), { recursive: true });
    await writeFile(target(name), body, { flag: 'wx' });
  }
  const server = fileURLToPath(new URL('../dist/cli/index.js', import.meta.url));
  client = new Client({ name: 'sprint28-evidence-development', version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [server, 'mcp'], cwd: root, stderr: 'pipe' }));
  async function call(name, args) {
    const result = await client.callTool({ name, arguments: args });
    if (result.isError) throw new Error(`${name}: ${JSON.stringify(result)}`);
    return result.structuredContent ?? JSON.parse(result.content.find(x => x.type === 'text').text);
  }
  const { taskId } = await call('hypersabmemory_task_create', { goal: 'Evaluate synthetic evidence', acceptanceCriteria: ['Locate supporting sources'], sourceRefs: Object.keys(files) });
  assert.ok(taskId);
  const query = (q, extra = {}) => call('hypersabmemory_task_grounded_query', { taskId, query: q, ...extra });
  const coverage = [];
  for (const c of cases) {
    const result = await query(c.query);
    assert.ok(Array.isArray(result.requirements) && Array.isArray(result.assertions));
    const roles = Object.entries(c.roles).map(([role, expected]) => {
      const requirement = result.requirements.find(r => r.role === role);
      const returned = requirement?.candidates.map(x => x.path) ?? [];
      return { role, expected, returned, matched: expected.filter(p => returned.includes(p)), requirementStatus: requirement?.status ?? 'not returned' };
    });
    coverage.push({ id: c.id, roles, allExpectedRolesFound: roles.every(r => r.expected.length) ? roles.every(r => r.matched.length) : null, canAssert: result.canAssert, assertions: result.assertions });
  }
  const timings = [];
  for (const item of cases.filter(entry => Object.values(entry.roles).some(paths => paths.length))) {
    await query(item.query);
    for (let run = 0; run < 5; run++) {
      const started = performance.now();
      await query(item.query);
      timings.push(performance.now() - started);
    }
  }
  timings.sort((first, second) => first - second);
  const supported = await query('Where is `releaseHold` defined?');
  const missing = await query('Where is `insureDrone` defined?');
  const conflictQuery = 'What is the parcel retention period?';
  const undeclared = await query(conflictQuery);
  const declared = await query(conflictQuery, { conflictingPaths: ['docs/retention-a.md', 'docs/retention-b.md'] });
  await writeFile(target('src/stale.ts'), 'export function currentBadge() { return "new"; }\n');
  await rm(target('src/deleted.ts'));
  const stale = [];
  for (const [source, question] of [['src/stale.ts', 'Where is `expiredBadge` defined?'], ['src/deleted.ts', 'Where is `removedBadge` defined?']]) {
    const r = await query(question);
    stale.push({ source, status: r.status, detected: r.staleSources.some(s => s.path === source), evidenceLeaks: r.evidence.filter(e => e.source.path === source).length, assertionLeaks: r.assertions.filter(a => a.sourcePath === source).length });
  }
  const assertions = supported.assertions.map(a => ({ ...a, correctSourceAndExcerpt: a.sourcePath === 'src/holds/release.ts' && files[a.sourcePath].includes(a.excerpt) && a.claim === 'Identifier releaseHold is defined in src/holds/release.ts.' }));
  console.log(JSON.stringify({ provenance: 'Independently agent-authored development fixture; synthetic, not human-reviewed or blind.', execution: 'MCP stdio using existing dist; no build; no agent answers generated.', latencyMs: { samples: timings.length, warmupsPerQuery: 1, p50: timings[Math.ceil(timings.length * 0.5) - 1], p95: timings[Math.ceil(timings.length * 0.95) - 1] }, roleCandidateCoverage: coverage, deterministicAssertionCheck: { query: 'Where is `releaseHold` defined?', canAssert: supported.canAssert, assertions, correct: assertions.filter(a => a.correctSourceAndExcerpt).length, total: assertions.length }, missing: { canAssert: missing.canAssert, assertions: missing.assertions, candidates: missing.candidates }, conflict: { undeclared: { status: undeclared.status, canAssert: undeclared.canAssert, assertions: undeclared.assertions }, declared: { status: declared.status, canAssert: declared.canAssert, assertions: declared.assertions } }, stale }, null, 2));
} finally {
  try { if (client) await client.close(); } finally {
    const current = await realpath(root);
    if (current !== root || !contained(tmp, current) || !path.basename(current).startsWith('sprint28-eval-')) throw new Error('Refusing unsafe temporary cleanup');
    await rm(current, { recursive: true, force: true });
  }
}
