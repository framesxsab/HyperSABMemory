import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { collectImplementationEvidence } from '../dist/memory/implementationEvidence.js';

const capture = (path, content) => ({ path, content, status: 'current', currentSha256: createHash('sha256').update(content).digest('hex') });
const links = (emitted, implementation) => collectImplementationEvidence(
  'Where is measureBins implemented and which tests exercise it?', [
    capture('src/layout.' + implementation, 'export function measureBins() { return 3; }'),
    capture('spec/layout.spec.ts', "import { it, expect } from 'vitest';\nimport { measureBins as measure } from '../src/layout." +
      emitted + "';\nit('counts bins', () => expect(measure()).toBe(3));")
  ]).tests;
for (const [emitted, implementation] of [['js', 'ts'], ['mjs', 'mts'], ['cjs', 'cts'], ['mjs', 'mjs']]) {
  assert.equal(links(emitted, implementation)[0]?.execution, 'unverified', 'valid runtime import remains linked');
}
for (const [emitted, implementation] of [['mjs', 'ts'], ['cjs', 'mts'], ['mjs', 'cts'], ['cjs', 'ts']]) {
  assert.equal(links(emitted, implementation).length, 0, 'incompatible emitted extensions must not establish a test link');
}
