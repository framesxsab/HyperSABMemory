# HyperSABMemory — Product Requirements Document (PRD)

## 1. Product Vision & Overview
**HyperSABMemory** is an open-source, high-efficiency IDE context harness and persistent memory engine designed for AI coding assistants (Cursor, VS Code, Antigravity, Windsurf, Claude Code, etc.). 

It takes proven temporal-memory-store designs as its core reference architecture for persistent, multi-session memory and marries it with **[can1357/oh-my-pi](https://github.com/can1357/oh-my-pi)** as the baseline reference for real-time state harness, hash-anchored edits, and optimized agent tool calling. The goal is to maximize AI agent focus, provide instant context recovery after file edits or context window wipes, and minimize unnecessary token usage across session shifts.

---

## 2. Target Users & Audience
1. **AI Developers & Engineers**: Looking to stop agents from hallucinating or re-reading entire codebases after every edit.
2. **IDE Extension & Agent Developers**: Seeking a standardized, lightweight Model Context Protocol (MCP) memory & harness backend.
3. **Open Source Community**: Developers wanting a self-hosted, local-first alternative for universal AI agent state management.

---

## 3. Key Functional Requirements

### FR-1: State Harness Engine
- **Dynamic Context Header**: Injects compressed state headers (active file, cursor line, git diff, modified tokens, key architectural focus) into the agent context window.
- **Token Budget Compression**: Enforces a 1,500-token estimate ceiling for harness headers, compressing file state dynamically.
- **Focus Anchor**: Prevents agents from drifting away from the primary file/task being modified.

### FR-2: Persistent Temporal Memory Layer
- **Local-First Memory Store**: Stores structured decisions and project facts in `.hypersabmemory/memory_store.json`; active records use lexical BM25 search, while optional graph results come from externally generated `graph.json` / `GRAPH_REPORT.md`.
- **Session Handoff**: Preserves project decisions and workspace state in the local JSON store and the `Memory.md` human-readable projection across IDE restarts and chat resets.
- **MCP Server Protocol**: Exposes tools including `hypersabmemory_get_context`, `hypersabmemory_remember`, and `hypersabmemory_query` for MCP-compliant clients.

### FR-3: Automatic Event Hooks ("After Every File Edit")
- **File Watcher Hook**: Listens for file save, edit, and create events.
- **Workspace State Refresh**: Updates the in-memory header from changed paths without blocking the user's IDE or editor UI.
- **Event Provenance**: Any durable fact derived from file events must be distinguishable from user-confirmed knowledge and scoped to its source.
- **Graph Freshness**: Reports the source and freshness of externally generated graph data; graph indexing is not performed by the watcher today.

### FR-4: Open Source Publication & CLI
- **HyperSABMemory CLI**: Command-line tools (`hypersabmemory init`, `hypersabmemory status`, `hypersabmemory watch`, `hypersabmemory mcp`).
- **NPM & GitHub Distribution**: Standard package setup, badges, CI/CD GitHub Actions, contributing guidelines, MIT license.

---

## 4. Non-Functional Requirements (NFR)
- **Performance**: Measure state capture, retrieval latency, and file-hook processing before setting release targets.
- **Footprint**: Zero CPU overhead on idle, non-blocking asynchronous event loop.
- **Privacy & Security**: 100% local-first data storage by default, zero telemetry or external API leaks unless configured.
- **Cross-Platform**: Full support for Windows, macOS, and Linux.

---

## 5. Success Metrics
- Retrieval precision@5, recall@5, stale-memory leakage, and p50/p95 query latency on repository-grounded evals.
- Estimated context-header tokens against the existing 1,500 default; future comparisons should use named model tokenizers.
- First-run setup and MCP handshake success by supported host/runtime, measured without default telemetry.

## 6. Current Baseline and V2 Guardrails

- The store is JSON with atomic temp/rename writes and a backup file; `SqliteStore` is a legacy class name, not a SQLite implementation.
- Search is lexical BM25 over active memories plus a substring-matched external graph leg. There is no vector index or built-in code indexer.
- The context header remains capped at an estimated 1,500 tokens. Improve relevance and freshness before considering a larger budget.
- V2 must preserve the JSON record format, existing CLI/MCP contracts, local-first behavior, and the setup/remove flow unless a migration and compatibility decision is explicitly documented.
