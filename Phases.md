# HyperSABMemory — Roadmap & Project Phases

## Sprint 2.8: Grounded MCP Evidence — Engineering Complete
- [x] General evidence query, deterministic scalar assertions, current-source hashing, and installed-package restart path verified; details in `docs/SPRINT_2_8_CLOSEOUT.md`.
- Release remains NO-GO under unchanged frozen answer-quality gates.

## Sprint 2.9: Unified Deterministic Grounding — Engineering Complete
- [x] Shared JSON scalar, quotation, recorded decision/rationale, and explicit-link verification feeds both general grounded search and MCP claims; input schema preserved.
- [x] Task role assertions remain role-specific and unresolved when their relationships are not verified.
- [x] Full local regression, frozen evaluator, packed MCP consumer, and closeout documented in `docs/SPRINT_2_9_GROUNDING_CLOSEOUT.md`.
- Release remains NO-GO under unchanged frozen broad-answer and retrieval gates.

## Sprint 3.0: Implementation Evidence
- Code locations, observed statements, and structurally linked test assertions are available through grounded search and MCP. See `docs/SPRINT_3_0_IMPLEMENTATION_EVIDENCE.md` for verification and release status.

## Sprint 2.7: Retrieval Usefulness
Sprint 2.7 local implementation and validation: source-aware task retrieval, import ranking hints, and declaration excerpts are implemented. The 20% quality and latency targets remain unmet; release is NO-GO. Evidence: `docs/SPRINT_2_7_RESULTS.md`.

## Phase 1: Core Blueprint & Architecture Setup
- [x] Create foundational blueprint documents (`PRD.md`, `Architecture.md`, `Rules.md`, `Phases.md`, `Design.md`, `Memory.md`).
- [x] Initialize TypeScript workspace structure (`package.json`, `tsconfig.json`, `src/`).
- [x] Set up build tooling and unit testing framework (`vitest`).

## Phase 2: context-harness Context Harness & State Compressor
- [x] Build the current state/header formatter and hashline support in `src/harness/ohMyPi.ts`.
- [x] Implement token budget ceiling compressor (`src/harness/tokenCompressor.ts`).
- [x] Generate dynamic context state headers for AI agents (<= 1500 estimated tokens).

## Phase 3: Persistent Temporal Memory & Auto-Commit System
- [x] Build the local JSON memory store with shared file locking and crash recovery (`src/memory/sqliteStore.ts`).
- [x] Implement Temporal Memory Store persistent memory engine (`src/memory/temporalMemory.ts`).
- [x] Create hyperfrequent auto-commit & checkpoint system (3-5 min timer + git snapshot trigger).

## Phase 4: Real-time IDE Hooks & MCP Server Protocol
- [x] Implement high-performance file watcher hook (`src/hooks/fileWatcher.ts`) triggering after file edits.
- [x] Synchronize the human-readable `Memory.md` projection when explicit memory records change.
- [x] Expose Model Context Protocol (MCP) server endpoints (`src/mcp/server.ts`).

## Phase 5: CLI, Open Source Packaging & Publication
- [x] Complete `hypersabmemory` CLI (`init`, `watch`/`start`, `connect`, `status`, `checkpoint`, `rollback`, `inject`, `eval`, `mcp`, `publish`).
- [x] GitHub Actions CI (`.github/workflows/ci.yml`). NPM publish remains a maintainer step (`npm publish` after CI is green on GitHub).
- [x] Open-source documentation (`README.md`, `CONTRIBUTING.md`, `LICENSE`).
- [x] Local MemoryBench recall eval (`npm run eval`).
- [x] Direct MCP access (`npx hypersabmemory connect`).

## Phase 6: Noise-aware Context Block (v1.2.0)
- [x] Relevance-ranked Context Block selection (recency decay × category weight × watcher-noise penalty) in `src/memory/contextBlock.ts`.
- [x] Shared `formatFileEventFact` formatter pinned into `src/hooks/fileWatcher.ts`.
- [x] Regression tests (`tests/contextBlock.test.ts`).

## Phase 7: Hybrid Search Wired into MCP Query (v1.2.0)
- [x] Optional `source: 'memory' | 'graph' | 'all'` field on `hypersabmemory_query`; knowledge-graph hits mapped to synthetic MemoryRecords.
- [x] Byte-identical default response shape preserved (`tests/mcpQuery.test.ts`).

## Phase 8: Crash-safe Memory Store (v1.2.0)
- [x] Atomic tmp+rename saves with `.bak` mirror and layered loud recovery in `src/memory/sqliteStore.ts`.
- [x] Forgotten-fact resurrection guard tests (`tests/sqliteStore.test.ts`).

## Phase 9: Privacy Hardening (v1.2.0)
- [x] `activeFile` path-traversal containment in `get_context` (`resolveActiveFilePath`).
- [x] CORS wildcard removed from the localhost dashboard (`tests/privacy.test.ts`).

## Phase 10: Eval Rigor (v1.2.0)
- [x] Eval gates the shipped BM25 path and the fused search path, not just the substring fallback.
- [x] 1,500 estimated-token header ceiling asserted across empty/typical/worst-case harness states.

## Phase 11: Safe Rollback + History/Diff (v1.2.0)
- [x] Safety checkpoint before every `git reset --hard`, hash existence verification, honest checkpoint statuses.
- [x] `hypersabmemory history` and read-only `hypersabmemory diff` preview commands with guarded interactive confirm.

## Phase 12: CLI Completeness & Bugfix Sweep (v1.2.0)
- [x] Terminal memory commands (`remember`, `list`/`recall`, `forget`) and read-only `hypersabmemory doctor`.
- [x] Version truth from `package.json` (CLI + MCP server), engine-level limit clamps, `--interval` validation, empty-content rejection.

## V2 Sprint 1: Reliability, Release Confidence, and Retrieval Baseline
- [x] Reconcile package and lockfile name, binary, version, and Node engine fields; add a package-metadata regression test and release tag/version guard.
- [x] Add the 1.4.1 changelog entry and expand blocking CI configuration to Windows, macOS, and Linux on Node 20 compatibility and Node 22/24 LTS lanes.
- [x] Surface memory persistence failures without exposing an unpersisted in-memory record; persist remember-plus-supersede under one lock and one atomic write.
- [x] Serialize overlapping checkpoint requests without changing their result shape or workspace-wide staging behavior.
- [x] Add a repository-grounded retrieval/context baseline and packed-tarball CLI install smoke check.
- [x] Local evidence (2026-10-26): clean `npm ci` with zero advisories; full `npm test` (171 tests), `npm run eval` (8 tests), `npm run eval:baseline`, and tarball CLI recall/MCP-handshake smoke passed on Windows/Node 22.14.0.
- Release gate: confirm the configured Node 20/22/24 × Windows/macOS/Linux matrix passes in GitHub Actions before publication; no workflow run was triggered from this checkout.
