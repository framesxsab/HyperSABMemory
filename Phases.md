# HyperMemory — Roadmap & Project Phases

## Phase 1: Core Blueprint & Architecture Setup
- [x] Create foundational blueprint documents (`PRD.md`, `Architecture.md`, `Rules.md`, `Phases.md`, `Design.md`, `Memory.md`).
- [x] Initialize TypeScript workspace structure (`package.json`, `tsconfig.json`, `src/`).
- [x] Set up build tooling and unit testing framework (`vitest`).

## Phase 2: Oh-My-Pi Context Harness & State Compressor
- [x] Build AST & file diff parser in `src/harness/ohMyPi.ts`.
- [x] Implement token budget ceiling compressor (`src/harness/tokenCompressor.ts`).
- [x] Generate dynamic context state headers for AI agents (< 1500 tokens).

## Phase 3: Supermemory Persistent Storage & Auto-Commit System
- [x] Build local key-value and SQLite vector storage layer (`src/memory/sqliteStore.ts`).
- [x] Implement Supermemory persistent memory engine (`src/memory/supermemory.ts`).
- [x] Create hyperfrequent auto-commit & checkpoint system (3-5 min timer + git snapshot trigger).

## Phase 4: Real-time IDE Hooks & MCP Server Protocol
- [x] Implement high-performance file watcher hook (`src/hooks/fileWatcher.ts`) triggering after file edits.
- [x] Automatic live updater for `Memory.md`.
- [x] Expose Model Context Protocol (MCP) server endpoints (`src/mcp/server.ts`).

## Phase 5: CLI, Open Source Packaging & Publication
- [x] Complete `hypermemory` CLI (`init`, `watch`/`start`, `connect`, `status`, `checkpoint`, `rollback`, `inject`, `eval`, `mcp`, `publish`).
- [x] GitHub Actions CI (`.github/workflows/ci.yml`). NPM publish remains a maintainer step (`npm publish` after CI is green on GitHub).
- [x] Open-source documentation (`README.md`, `CONTRIBUTING.md`, `LICENSE`).
- [x] Local MemoryBench recall eval (`npm run eval`).
- [x] Direct MCP access (`npx hypermemory connect`).

## Phase 6: Noise-aware Context Block (v1.2.0)
- [x] Relevance-ranked Context Block selection (recency decay × category weight × watcher-noise penalty) in `src/memory/contextBlock.ts`.
- [x] Shared `formatFileEventFact` formatter pinned into `src/hooks/fileWatcher.ts`.
- [x] Regression tests (`tests/contextBlock.test.ts`).

## Phase 7: Hybrid Search Wired into MCP Query (v1.2.0)
- [x] Optional `source: 'memory' | 'graph' | 'all'` field on `hypermemory_query`; graphify hits mapped to synthetic MemoryRecords.
- [x] Byte-identical default response shape preserved (`tests/mcpQuery.test.ts`).

## Phase 8: Crash-safe Memory Store (v1.2.0)
- [x] Atomic tmp+rename saves with `.bak` mirror and layered loud recovery in `src/memory/sqliteStore.ts`.
- [x] Forgotten-fact resurrection guard tests (`tests/sqliteStore.test.ts`).

## Phase 9: Privacy Hardening (v1.2.0)
- [x] `activeFile` path-traversal containment in `get_context` (`resolveActiveFilePath`).
- [x] CORS wildcard removed from the localhost dashboard (`tests/privacy.test.ts`).

## Phase 10: Eval Rigor (v1.2.0)
- [x] Eval gates the shipped BM25 path and the fused search path, not just the substring fallback.
- [x] Hard ≤1500-token header ceiling asserted across empty/typical/worst-case harness states.

## Phase 11: Safe Rollback + History/Diff (v1.2.0)
- [x] Safety checkpoint before every `git reset --hard`, hash existence verification, honest checkpoint statuses.
- [x] `hypermemory history` and read-only `hypermemory diff` preview commands with guarded interactive confirm.

## Phase 12: CLI Completeness & Bugfix Sweep (v1.2.0)
- [x] Terminal memory commands (`remember`, `list`/`recall`, `forget`) and read-only `hypermemory doctor`.
- [x] Version truth from `package.json` (CLI + MCP server), engine-level limit clamps, `--interval` validation, empty-content rejection.
