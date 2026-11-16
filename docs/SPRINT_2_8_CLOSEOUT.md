# Sprint 2.8 Engineering Closeout

Date: 2026-11-16
Branch: `feature/sprint2.5-20261106`
Verified HEAD before closeout: `a50d66ec7d0139d8aa67eeab18ac8f56e0747da4`

## Decision

Sprint 2.8 engineering is complete. Its shipped temporal memory, grounded source checks, task coordination and restoration, task decision/rationale evidence, explicit cross-file constraint path, general MCP evidence query, deterministic JSON scalar assertions, uncertainty handling, and installed-package MCP restart path were retained and verified. Closing this engineering milestone does not declare broad answer quality or release readiness.

## Fresh verification

- `npm.cmd test`: 276 tests passed across 43 files.
- `npx.cmd tsc --noEmit`: passed.
- `npm.cmd run build`: passed.
- `npm.cmd run eval`: 8 MemoryBench tests passed.
- `npm.cmd run package:smoke`: packed and installed `hypersabmemory@1.4.1`; independent MCP process smoke passed.
- `node scripts/repository-task-eval.mjs`: exited 1 (expected release-gate failure). Raw P@5/recall@5 0.480/0.7375; grounded 0.470/0.725; supported broad assertions 0/20; unsupported no-answer assertions 0/10; forgotten leaks 0; stale leaks 0/20; p50/p95 55.50/80.13 ms over 150 samples.

## Scope boundary and remaining release blockers

The general `hypersabmemory_query_evidence` response supplies hash-checked excerpts and existing deterministic scalar assertions. Cross-file decision/rationale/constraint verification remains in task-specific code; it is not yet a reusable multi-source answer in the general query interface. That gap is the next engineering milestone, Sprint 2.9.

Release remains **NO-GO** under the unchanged frozen gates: broad supported assertions are 0/20, unsupported no-answer assertions are 0/10, and retrieval quality gates fail. Remote CI, registry installation, independent human review, and a completed real coding-agent task are also unverified. This closeout preserves the frozen evaluation and prior Sprint 2.8 reports unchanged.
