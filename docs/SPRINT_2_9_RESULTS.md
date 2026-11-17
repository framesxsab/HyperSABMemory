# Sprint 2.9 — Multi-Source Grounded Answers

Date: 2026-11-17
Branch: `feature/sprint2.5-20261106`
Sprint 2.8 engineering closeout: `32e2c90`

## Implemented

`hypersabmemory_query_evidence` now adds bounded `claims`, `relationships`, and `compoundAnswer` fields. Its input schema is unchanged. Each claim carries the recorded text/value, source path, exact line and excerpt, current SHA-256, direct-recording flag, deterministic line-verification status, and limitations. Relationships are separate and require an explicit `Decision-Source:` line. Ambiguous decisions, duplicate/conflicting links, stale hashes, missing sources, and unsupported question types do not produce a compound answer. The task-grounded cross-file query uses the same verifier; its prior answer citation shape is preserved.

The general query still runs the existing grounded verifier. The new compound answer reports source text and the explicit source link, not semantic correctness or implementation compliance. No dependencies, hosted services, or evaluator labels changed.

## Installed-package MCP example

A fresh independent MCP consumer against the locally packed package returned:

- `docs/decision.md`, SHA-256 `0899c09b3f7ab010a629b3b4bd4630b6dce6b6f056dbafebe36c76d439d06b33`, line 1: `Decision: Use SQLite for task coordination.`
- `docs/decision.md`, same hash, line 2: `Rationale: Preserve atomic task transitions.`
- `docs/architecture.md`, SHA-256 `29fa62c900c73259b4badb522136a3e5a64209a976b33824f5645d2bb2c5f6ff`, line 2: `Constraint: Task updates must use a transactional coordinator.`
- Relationship evidence: `docs/architecture.md`, same hash, line 1: `Decision-Source: docs/decision.md`.

All three claims reported `freshness: current` and `directlyRecorded: true`. The response explicitly said implementation compliance was not verified.

## Rejection and abstention

Two current constraint files pointing to the same decision with different instructions yielded no `compoundAnswer`, claims, or verified relationships. Asking for the task coordinator's retry limit yielded no claims or assertions; candidate excerpts remained labeled insufficient evidence. A forgotten memory record was absent from active query results, and task-scoped stale-source regressions remained green.

## Verification

- `npm test`: 277 tests passed across 43 files; one preceding run hit a Windows `EBUSY` while cleaning a SQLite child-process fixture, then the isolated test passed and the full rerun passed. No timeout or assertion was changed.
- `npx tsc --noEmit`: passed.
- `npm run build`: passed through `npm test`.
- `npm run eval`: 8 MemoryBench tests passed.
- `npm run package:smoke`: locally packed and installed `hypersabmemory@1.4.1`; fresh MCP process exercised the multi-source response.
- Focused cross-file/task/MCP suites: 19 tests passed.
- `scripts/sprint29-latency-probe.mjs`: 30 same-snapshot samples per query. One source p50/p95 8.85/12.32 ms; multi-source 27.63/39.59 ms. Local Windows measurements only.

The unchanged frozen evaluator exited 1: raw P@5/recall@5 0.480/0.7375, grounded 0.460/0.7042, supported broad assertions 0/20, unsupported no-answer false positives 0/10, forgotten leaks 0, and stale leaks 0/20. Latency p50/p95 was 63.91/100.08 ms over 150 samples. Inspection confirmed this evaluator calls `searchGrounded` directly and does not exercise the new MCP claim representation; these MCP checks do not improve its broad assertion score.

## Coding-agent demonstration and status

No authenticated local coding-agent client was available: Codex and Claude reported logged out, and OpenCode could not initialize its config. Therefore no real-agent code edit or independent agent validation is claimed. Scripted independent-process MCP checks covered the compound answer, conflict abstention, unsupported query, and installed package; the full repository and package tests passed separately.

Sprint 2.9 implementation acceptance is met by local tests and installed-package MCP behavior, with the real-agent demonstration still unverified. Release remains **NO-GO** under unchanged gates. The primary release blocker is frozen broad answer quality: 0/20 supported assertions and retrieval metrics below their gates.
