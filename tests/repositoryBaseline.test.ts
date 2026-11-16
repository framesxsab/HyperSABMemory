import { describe, expect, it } from 'vitest';
import { runRepositoryBaseline } from '../src/eval/repositoryBaseline.js';

describe('repository-grounded retrieval and context baseline', () => {
  it('reports corpus, retrieval, latency, stale-memory, and context-budget evidence', () => {
    const report = runRepositoryBaseline();

    expect(report.corpus.records).toBe(500);
    expect(report.corpus.distractors).toBeGreaterThan(400);
    expect(report.retrieval.answerableQueries).toBe(6);
    expect(report.retrieval.unanswerableQueries).toBe(1);
    expect(report.retrieval.falsePositiveQueries).toBeLessThanOrEqual(report.retrieval.unanswerableQueries);
    expect(report.retrieval.recallAt5).toBeGreaterThanOrEqual(0.8);
    expect(report.retrieval.staleLeaks).toBe(0);
    expect(report.latencyMs.samples).toBeGreaterThan(0);
    expect(report.latencyMs.p50).toBeGreaterThanOrEqual(0);
    expect(report.latencyMs.p95).toBeGreaterThanOrEqual(report.latencyMs.p50);
    expect(report.context.withinLimit).toBe(true);
    expect(report.passed).toBe(true);
  });

  it('evaluates 30 labeled repository tasks including unanswerable queries', () => {
    const report = runRepositoryBaseline(500, true);
    expect(report.cases).toHaveLength(30);
    expect(report.retrieval.answerableQueries).toBe(20);
    expect(report.retrieval.unanswerableQueries).toBe(10);
    expect(report.retrieval.maximumPrecisionAt5).toBe(0.2);
    expect(report.retrieval.precisionGateValid).toBe(false);
    expect(report.passed).toBe(false);
    expect(report.retrieval.staleLeaks).toBe(0);
  });
});
