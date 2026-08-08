# HyperMemory — Roadmap & Project Phases

## Phase 1: Core Blueprint & Architecture Setup (CURRENT)
- [x] Create foundational blueprint documents (`PRD.md`, `Architecture.md`, `Rules.md`, `Phases.md`, `Design.md`, `Memory.md`).
- [ ] Initialize TypeScript workspace structure (`package.json`, `tsconfig.json`, `src/`).
- [ ] Set up build tooling and unit testing framework (`vitest`).

## Phase 2: Oh-My-Pi Context Harness & State Compressor
- [ ] Build AST & file diff parser in `src/harness/ohMyPi.ts`.
- [ ] Implement token budget ceiling compressor (`src/harness/tokenCompressor.ts`).
- [ ] Generate dynamic context state headers for AI agents (< 1500 tokens).

## Phase 3: Supermemory Persistent Storage & Auto-Commit System
- [ ] Build local key-value and SQLite vector storage layer (`src/memory/sqliteStore.ts`).
- [ ] Implement Supermemory persistent memory engine (`src/memory/supermemory.ts`).
- [ ] Create hyperfrequent auto-commit & checkpoint system (3-5 min timer + git snapshot trigger).

## Phase 4: Real-time IDE Hooks & MCP Server Protocol
- [ ] Implement high-performance file watcher hook (`src/hooks/fileWatcher.ts`) triggering after file edits.
- [ ] Automatic live updater for `Memory.md`.
- [ ] Expose Model Context Protocol (MCP) server endpoints (`src/mcp/server.ts`).

## Phase 5: CLI, Open Source Packaging & Publication
- [ ] Complete `hypermemory` CLI binary (`src/cli/index.ts`) with `init`, `start`, `watch`, `status`, `rollback`, and `publish` commands.
- [ ] Configure GitHub Actions for CI/CD, testing, and NPM automated deployment.
- [ ] Polish open-source documentation (`README.md`, `CONTRIBUTING.md`, `LICENSE`).
