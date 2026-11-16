import { expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DEVELOPMENT, HELD_OUT } from '../src/eval/repositoryTaskFixture.js';
import { SPRINT25_DEVELOPMENT } from '../src/eval/sprint25DevelopmentFixture.js';

it('keeps multi-source development labels disjoint from the frozen held-out queries', () => {
  const heldOutQueries = new Set(HELD_OUT.map(item => item.query.toLowerCase()));
  const previousDevelopmentQueries = new Set(DEVELOPMENT.map(item => item.query.toLowerCase()));
  expect(SPRINT25_DEVELOPMENT).toHaveLength(21);
  expect(SPRINT25_DEVELOPMENT.filter(item => item.relevantPaths.length)).toHaveLength(11);
  expect(SPRINT25_DEVELOPMENT.filter(item => !item.relevantPaths.length)).toHaveLength(10);
  expect(SPRINT25_DEVELOPMENT.some(item => heldOutQueries.has(item.query.toLowerCase()))).toBe(false);
  expect(SPRINT25_DEVELOPMENT.some(item => previousDevelopmentQueries.has(item.query.toLowerCase()))).toBe(false);
  for (const item of SPRINT25_DEVELOPMENT) {
    if (!item.relevantPaths.length) continue;
    expect(new Set(item.relevantPaths).size).toBe(item.relevantPaths.length);
    expect(item.relevantPaths.length).toBeGreaterThanOrEqual(3);
    expect(item.relevantPaths.some(source => source.startsWith('src/'))).toBe(true);
    expect(item.relevantPaths.some(source => source.startsWith('tests/'))).toBe(true);
    for (const source of item.relevantPaths) expect(fs.existsSync(path.resolve(source))).toBe(true);
  }
  expect(SPRINT25_DEVELOPMENT.some(item => item.relevantPaths.includes('Architecture.md'))).toBe(true);
  expect(SPRINT25_DEVELOPMENT.some(item => item.relevantPaths.includes('src/harness/mcpAccess.ts'))).toBe(true);
  expect(SPRINT25_DEVELOPMENT.some(item => item.relevantPaths.includes('src/mcp/server.ts'))).toBe(true);
});
