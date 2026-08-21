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
- **Token Budget Compression**: Enforces strict token ceilings (< 1500 tokens) for harness prompts, compressing file states dynamically.
- **Focus Anchor**: Prevents agents from drifting away from the primary file/task being modified.

### FR-2: Persistent Temporal Memory Layer
- **Local-First Knowledge Graph & Vector Store**: Stores code symbols, semantic memories, architectural decisions, and bug history locally using fast SQLite / vector search.
- **Universal Session Handoff**: Preserves project state (`Memory.md` + database) across IDE restarts, branch switches, and chat resets.
- **MCP Server Protocol**: Exposes standardized tools (`hypersabmemory_get_context`, `hypersabmemory_remember`, `hypersabmemory_search`) for any MCP-compliant client.

### FR-3: Automatic Event Hooks ("After Every File Edit")
- **File Watcher Hook**: Listens for file save, edit, and create events.
- **Instant State Re-synthesis**: Automatically updates project `Memory.md` and memory graph after every file edit without blocking the user's IDE or editor UI.
- **Incremental Diff Tracking**: Tracks modified lines and updates symbol index incrementally.

### FR-4: Open Source Publication & CLI
- **HyperSABMemory CLI**: Command-line tools (`hypersabmemory init`, `hypersabmemory status`, `hypersabmemory watch`, `hypersabmemory mcp`).
- **NPM & GitHub Distribution**: Standard package setup, badges, CI/CD GitHub Actions, contributing guidelines, MIT license.

---

## 4. Non-Functional Requirements (NFR)
- **Performance**: State capture and file hook processing completed in under 50ms.
- **Footprint**: Zero CPU overhead on idle, non-blocking asynchronous event loop.
- **Privacy & Security**: 100% local-first data storage by default, zero telemetry or external API leaks unless configured.
- **Cross-Platform**: Full support for Windows, macOS, and Linux.

---

## 5. Success Metrics
- 70%+ reduction in agent token consumption during multi-turn coding sessions.
- 0% context loss when starting new chat threads.
- Sub-50ms execution speed for context generation after file saves.
