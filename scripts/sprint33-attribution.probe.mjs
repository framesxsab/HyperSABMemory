import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { collectImplementationEvidence } from '../dist/memory/implementationEvidence.js';

const source = (path, content) => ({
  path, content, status: 'current', currentSha256: createHash('sha256').update(content).digest('hex')
});
function links(importLine) {
  const code = source('stock.ts', 'export function countCartons() { return 2; }');
  const spec = source('stock.test.ts', [
    "import { it, expect } from 'vitest';",
    importLine,
    "it('counts cartons', () => expect(countCartons()).toBe(2));"
  ].join('\n'));
  return collectImplementationEvidence('Where is countCartons implemented and which tests exercise it?', [code, spec]).tests;
}
assert.equal(links("import { countCartons } from './stock.js';").length, 1, 'ordinary value import remains linked');
for (const line of [
  "import type { countCartons } from './stock.js';",
  "import { type countCartons } from './stock.js';",
  "import type { it, expect } from 'vitest';\nimport { countCartons } from './stock.js';",
  "import { type it, expect } from 'vitest';\nimport { countCartons } from './stock.js';",
  "import { it, type expect } from 'vitest';\nimport { countCartons } from './stock.js';"
]) {
  assert.equal(links(line).length, 0, 'type-only imports must not establish a test link');
}
