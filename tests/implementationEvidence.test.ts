import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { collectImplementationEvidence } from '../src/memory/implementationEvidence.js';

const source = (path: string, content: string) => ({
  path, content, status: 'current' as const,
  sha256: createHash('sha256').update(content).digest('hex'),
  currentSha256: createHash('sha256').update(content).digest('hex')
});
const implementation = source('src/shipment.ts', 'export function totalPallets() { return 6; }');
function links(imports: string, body = "check('counts pallets', () => verify(tally()).toBe(6));") {
  const spec = source('spec/shipments.spec.ts', imports + '\n' + body);
  return collectImplementationEvidence('Where is totalPallets implemented and which tests exercise it?', [implementation, spec]).tests;
}
const helpers = "import { it as check, expect as verify } from 'vitest';";
const target = "import { totalPallets as tally } from '../src/shipment.js';";

describe('runtime bindings for implementation evidence', () => {
  it('keeps current value-import links and reports execution as unverified', () => {
    expect(links(helpers + '\n' + target)).toMatchObject([{
      symbol: 'totalPallets', execution: 'unverified',
      source: { path: 'spec/shipments.spec.ts', freshness: 'current', startLine: 3 },
      target: { path: implementation.path, sha256: implementation.sha256, freshness: 'current' }
    }]);
  });

  it.each([
    helpers + "\nimport type { totalPallets as tally } from '../src/shipment.js';",
    helpers + "\nimport { type totalPallets as tally } from '../src/shipment.js';",
    "import type { it as check, expect as verify } from 'vitest';\n" + target,
    "import { it as check, type expect as verify } from 'vitest';\n" + target,
    "import { type it as check, expect as verify } from 'vitest';\n" + target,
    helpers + "\nimport { type it as check } from 'vitest';\n" + target,
    helpers + "\nimport { totalPallets as tally } from '../src/unrelated.js';"
  ])('does not link erased, ambiguous, or unrelated imports: %s', imports => {
    expect(links(imports)).toEqual([]);
  });

  it('does not resolve a shadowed name to the imported declaration', () => {
    expect(links(helpers + '\n' + target,
      "check('shadow', () => { const tally = () => 6; verify(tally()).toBe(6); });")).toEqual([]);
  });

  it('isolates valid and shadowed imports across batched test files and invalidates same-size changes', () => {
    const validSpec = source('spec/valid.test.ts', `${helpers}\n${target}\ncheck('valid counts', () => verify(tally()).toBe(6));`);
    const shadowedSpec = source('spec/shadow.test.ts', `${helpers}\n${target}\ncheck('shadow counts', () => { const tally = () => 6; verify(tally()).toBe(6); });`);
    const erasedSpec = source('spec/erased.test.ts', `${helpers}\nimport type { totalPallets as tally } from '../src/shipment.js';\ncheck('erased counts', () => verify(tally()).toBe(6));`);
    const query = 'Where is totalPallets implemented and which tests exercise it?';

    const first = collectImplementationEvidence(query, [implementation, shadowedSpec, erasedSpec, validSpec]);
    expect(first.tests.map(item => ({ name: item.name, path: item.source.path }))).toEqual([
      { name: 'valid counts', path: 'spec/valid.test.ts' }
    ]);

    const sameSizeEditedSpec = source(
      'spec/valid.test.ts',
      `${helpers}\n${target}\ncheck('still counts', () => verify(tally()).toBe(6));`
    );
    expect(sameSizeEditedSpec.content.length).toBe(validSpec.content.length);
    const second = collectImplementationEvidence(query, [implementation, shadowedSpec, erasedSpec, sameSizeEditedSpec]);
    expect(second.tests.map(item => ({ name: item.name, path: item.source.path }))).toEqual([
      { name: 'still counts', path: 'spec/valid.test.ts' }
    ]);
  });
});
