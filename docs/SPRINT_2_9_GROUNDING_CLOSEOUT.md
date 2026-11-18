# Sprint 2.9 Grounding Closeout

Date: 2026-11-18
Branch: `feature/sprint2.5-20261106`

## Engineering result

The deterministic claim verifier in `src/memory/claimVerification.ts` now feeds both `searchGrounded` and the existing evidence MCP tool. It supports unique top-level JSON scalars, exact quotations, exact Markdown `Decision:` / adjacent `Rationale:` lines, and explicit `Decision-Source:` relationships. Claims carry their verification type, current source hash, exact line/excerpt, direct-recording status, and limitations. General claims are added only from current sources reached through existing ranked records; their relevance does not become entailment. Task-grounded `canAssert` continues to depend on role-specific verification, so a recorded decision alone does not assert implementation, test, or interface compliance.

The general-grounder integration was first run against the old code: a ranked current decision source returned `INSUFFICIENT_EVIDENCE`, no assertion, and no claims. The same development case now returns a `recorded_decision` claim with the exact source line and SHA-256. A two-source case returns the decision, adjacent rationale, linked constraint, and relationship evidence through `searchGrounded`.

Example from `searchGrounded`: “The source records the decision: Use SQLite for task coordination.” Source: `decisions/task-storage.md`, SHA-256 `5bdc94f0f459ca859d44dba26de825b3053f863520fb24af3f41a56877163f93`, line 1; verification `exact_markdown_line`, freshness `current`.

## Verification

- `npm test`: 279 tests passed across 43 files; includes a clean build.
- `npx tsc --noEmit`: passed.
- `npm run build`: passed.
- `npm run eval`: 8 MemoryBench tests passed.
- `npm run package:smoke`: packed and installed `hypersabmemory@1.4.1`; the fresh MCP process verified scalar and recorded-decision claims, the explicit multi-source link, conflict abstention, and task recovery.
- Focused grounding, task, and MCP regressions: 51 tests passed across six files. The MCP-only regression file also passed 11/11 in isolation.
- Unchanged frozen evaluator exited 1: raw P@5/recall@5 0.480/0.7375; grounded 0.450/0.6917; supported broad assertions 0/20; unsupported no-answer false positives 0/10; forgotten leakage 0; stale leakage 0/20. Evaluator p50/p95 was 57.97/95.71 ms over 150 samples.

The frozen evaluator directly calls `searchGrounded`, so the new claim classes were visible to it. Its 0/20 result establishes that the reviewed labels still require broader implementation/behavior relationships than the exact JSON, declaration, quotation, and source-recorded claim classes safely verify. No questions, labels, scoring, or thresholds were changed. It ran on the current source corpus, which includes this implementation; no paired same-corpus baseline was run, and no generic entailment rule was added.

## Performance

With the existing one-source/two-source probe and the same local source fixture, 30 samples measured one-source p50/p95 at 8.40/11.39 ms and multi-source at 14.22/16.89 ms. An earlier run of the same fixture measured 8.85/12.32 and 27.63/39.59 ms. Runs were not simultaneous and host load was uncontrolled, so this comparison does not establish a causal performance change or a production latency guarantee.

## Status

Sprint 2.9 engineering is complete for this scope. Release remains **NO-GO** under the unchanged criteria. The primary blocker is still the frozen answer-quality gate: 0/20 supported broad assertions, alongside retrieval metrics below their targets. Remote CI, registry installation, and independent human review remain unverified.
