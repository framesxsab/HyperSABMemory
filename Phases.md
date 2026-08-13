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

## Phase 5: CLI, Open Source Packaging & Publication (CURRENT)
- [x] Complete `hypermemory` CLI (`init`, `watch`/`start`, `connect`, `status`, `checkpoint`, `rollback`, `inject`, `eval`, `mcp`, `publish`).
- [x] GitHub Actions CI (`.github/workflows/ci.yml`). NPM publish remains a maintainer step (`npm publish` after CI is green on GitHub).
- [x] Open-source documentation (`README.md`, `CONTRIBUTING.md`, `LICENSE`).
- [x] Local MemoryBench recall eval (`npm run eval`).
- [x] Direct MCP access (`npx hypermemory connect`).
