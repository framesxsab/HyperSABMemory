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

describe('parameterized curried and tagged-template test attribution (Sprint 4.3)', () => {
  it('links antfu/ni style extensionless relative it.each tests to isVerbatimSpec with unverified execution', () => {
    const specImpl = source(
      'src/catalog/spec.ts',
      [
        'const SEMVER_RANGE_RE = /^\\s*(?:v?\\d)/;',
        'export function isVerbatimSpec(spec: string): boolean {',
        '  if (spec === "*") return true;',
        '  if (spec.includes(":")) return true;',
        '  return SEMVER_RANGE_RE.test(spec);',
        '}'
      ].join('\n')
    );
    const niSpecTest = source(
      'test/programmatic/catalog-spec.spec.ts',
      [
        "import { describe, expect, it } from 'vitest'",
        "import { isVerbatimSpec } from '../../src/catalog/spec'",
        '',
        "describe('isVerbatimSpec', () => {",
        "  const verbatim = ['0.28.1', 'v1.2.3', '*', 'workspace:*']",
        "  it.each(verbatim)('keeps %s as typed', (spec) => {",
        '    expect(isVerbatimSpec(spec)).toBe(true)',
        '  })',
        '',
        "  it.each(['latest', 'next'])('resolves the dist-tag %s', (spec) => {",
        '    expect(isVerbatimSpec(spec)).toBe(false)',
        '  })',
        '})'
      ].join('\n')
    );

    const evidence = collectImplementationEvidence(
      'Where is isVerbatimSpec implemented and which tests call it?',
      [specImpl, niSpecTest]
    );

    expect(evidence.code).toHaveLength(1);
    expect(evidence.code[0].symbol).toBe('isVerbatimSpec');
    expect(evidence.tests.map(item => ({
      symbol: item.symbol,
      name: item.name,
      execution: item.execution,
      path: item.source.path,
      startLine: item.source.startLine,
      targetSha: item.target.sha256
    }))).toEqual([
      {
        symbol: 'isVerbatimSpec',
        name: 'keeps %s as typed',
        execution: 'unverified',
        path: 'test/programmatic/catalog-spec.spec.ts',
        startLine: 7,
        targetSha: specImpl.sha256
      },
      {
        symbol: 'isVerbatimSpec',
        name: 'resolves the dist-tag %s',
        execution: 'unverified',
        path: 'test/programmatic/catalog-spec.spec.ts',
        startLine: 11,
        targetSha: specImpl.sha256
      }
    ]);
  });

  it('links aliased test.each, tagged-template it.each, and class method calls inside parameterized callbacks', () => {
    const calcImpl = source(
      'src/pricing/calc.ts',
      'export function totalPallets(n: number) { return n + 6; }\nexport class RateTable { rate(v: number) { return v * 2; } }'
    );
    const paramSpec = source(
      'spec/pricing/calc.spec.ts',
      [
        "import { it as check, test as runCase, expect as verify } from 'vitest';",
        "import { totalPallets as tally, RateTable } from '../../src/pricing/calc.js';",
        'const table = new RateTable();',
        "check.each([1, 2])('aliased it.each %s', (n) => verify(tally(n)).toBe(n + 6));",
        "runCase.each([3])('test.each %s', (n) => verify(tally(n)).toBe(9));",
        'check.each`input\\n${1}`(`template each $input`, ({ input }) => verify(tally(input)).toBe(7));',
        "runCase.each([4])('class method %s', (v) => verify(table.rate(v)).toBe(8));"
      ].join('\n')
    );

    const fnEvidence = collectImplementationEvidence(
      'Where is totalPallets implemented and which tests call it?',
      [calcImpl, paramSpec]
    );
    expect(fnEvidence.tests.map(item => [item.name, item.source.startLine, item.execution])).toEqual([
      ['aliased it.each %s', 4, 'unverified'],
      ['test.each %s', 5, 'unverified'],
      ['template each $input', 6, 'unverified']
    ]);

    const methodEvidence = collectImplementationEvidence(
      'Where is rate implemented and which tests call it?',
      [calcImpl, paramSpec]
    );
    expect(methodEvidence.tests).toMatchObject([
      { symbol: 'RateTable.rate', name: 'class method %s', execution: 'unverified', source: { startLine: 7 } }
    ]);
  });

  it.each([
    [
      'shadowed callback parameter hides imported symbol',
      "import { it as check, expect as verify } from 'vitest';\nimport { totalPallets as tally } from '../src/shipment.js';\ncheck.each([() => 6])('shadow param', (tally) => verify(tally()).toBe(6));"
    ],
    [
      'shadowed block variable hides imported symbol',
      "import { it, expect } from 'vitest';\nimport { totalPallets } from '../src/shipment.js';\nit.each([1])('shadow local', () => { const totalPallets = () => 6; expect(totalPallets()).toBe(6); });"
    ],
    [
      'shadowed it object is ignored',
      "import { expect } from 'vitest';\nimport { totalPallets } from '../src/shipment.js';\nconst it = { each: (_rows: unknown[]) => (_name: string, _fn: () => void) => {} };\nit.each([1])('shadow it', () => expect(totalPallets()).toBe(6));"
    ],
    [
      'shadowed expect helper is ignored',
      "import { it } from 'vitest';\nimport { totalPallets } from '../src/shipment.js';\nconst expect = (_v: unknown) => ({ toBe: (_e: unknown) => {} });\nit.each([1])('shadow expect', () => expect(totalPallets()).toBe(6));"
    ],
    [
      'type-only target import is ignored',
      "import { it, expect } from 'vitest';\nimport type { totalPallets } from '../src/shipment.js';\nit.each([1])('type target', () => expect(totalPallets()).toBe(6));"
    ],
    [
      'type-only vitest it import is ignored',
      "import { type it, expect } from 'vitest';\nimport { totalPallets } from '../src/shipment.js';\nit.each([1])('type it', () => expect(totalPallets()).toBe(6));"
    ],
    [
      'unrelated imported helper call does not link totalPallets',
      "import { it, expect } from 'vitest';\nimport { totalPallets } from '../src/shipment.js';\nimport { helperFn } from '../src/helper.js';\nit.each([1])('unrelated call', () => expect(helperFn()).toBe(6));"
    ],
    [
      'node:test test.each is not falsely recognized as vitest parameterized helper',
      "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { totalPallets } from '../src/shipment.js';\ntest.each([1])('node test each', () => assert.equal(totalPallets(), 6));"
    ],
    [
      'it.skip.each and zero-arg it.each() and comments/strings do not link',
      "import { it, expect } from 'vitest';\nimport { totalPallets } from '../src/shipment.js';\n// it.each([1])('comment', () => expect(totalPallets()).toBe(6));\nconst doc = \"it.each([1])('str', () => expect(totalPallets()).toBe(6))\";\nit.skip.each([1])('skipped', () => expect(totalPallets()).toBe(6));\nit.each()('empty', () => expect(totalPallets()).toBe(6));"
    ]
  ])('rejects false parameterized links: %s', (_label, specContent) => {
    const helper = source('src/helper.js', 'export function helperFn() { return 6; }');
    const spec = source('spec/shipments.spec.ts', specContent);
    expect(
      collectImplementationEvidence('Where is totalPallets implemented and which tests exercise it?', [implementation, helper, spec]).tests
    ).toEqual([]);
  });
});
