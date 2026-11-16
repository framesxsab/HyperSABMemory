import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DEVELOPMENT, HELD_OUT } from '../src/eval/repositoryTaskFixture.js';
import { SPRINT25_DEVELOPMENT } from '../src/eval/sprint25DevelopmentFixture.js';
import { runRepositoryTaskEvaluation } from '../src/eval/repositoryTaskEvaluation.js';

describe('provisional held-out repository task labels', () => {
  it('has 20 multi-source queries and ten unsupported queries with distinct existing source paths', () => {
    expect(HELD_OUT).toHaveLength(30);
    const answerable = HELD_OUT.filter(item => item.relevantPaths.length > 0);
    expect(answerable).toHaveLength(20);
    expect(HELD_OUT.filter(item => item.relevantPaths.length === 0)).toHaveLength(10);
    for (const item of answerable) {
      expect(new Set(item.relevantPaths).size).toBe(item.relevantPaths.length);
      expect(item.relevantPaths.length).toBeGreaterThanOrEqual(3);
      for (const filename of item.relevantPaths) expect(fs.existsSync(path.resolve(filename))).toBe(true);
    }
  });

  it('keeps a larger, disjoint development set for calibration', () => {
    expect(DEVELOPMENT).toHaveLength(21);
    expect(DEVELOPMENT.filter(item => item.relevantPaths.length)).toHaveLength(11);
    expect(DEVELOPMENT.filter(item => !item.relevantPaths.length)).toHaveLength(10);
    expect(DEVELOPMENT.some(dev => HELD_OUT.some(test => test.query.toLowerCase() === dev.query.toLowerCase()))).toBe(false);
  });

  it('indexes the documented architecture source in Sprint 2.5 development evaluation', () => {
    const report = runRepositoryTaskEvaluation(process.cwd(), true, true, SPRINT25_DEVELOPMENT);
    expect(report.staleProbe).toEqual({ attempted: 11, candidates: 11, flagged: 11, leaks: 0 });
    expect(report.methodology.reviewed).toBe(false);
    const task = report.diagnostics.find(item => item.query.startsWith('What documented boundaries'));
    expect(task?.gold.find(source => source.path === 'Architecture.md')?.indexed).toBe(true);
  }, 20_000);

});
