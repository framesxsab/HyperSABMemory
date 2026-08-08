# HyperMemory — System Architecture & Flow

## 1. High-Level Architecture

HyperMemory sits as a high-performance middleware between the IDE / Editor environment, the local filesystem, and the AI agent session.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           IDE / EDITOR LAYER                            │
│           (Cursor / VS Code / Antigravity / Claude Code / CLI)          │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
                 File Events & State │ Agent Prompt Queries / MCP Tools
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           HYPERMEMORY ENGINE                            │
│                                                                         │
│  ┌─────────────────────────────┐       ┌─────────────────────────────┐  │
│  │     Oh-My-Pi Harness        │       │   Supermemory Base Engine   │  │
│  │                             │       │                             │  │
│  │ - State Compressor          │       │ - Local Vector / SQLite Store│ │
│  │ - Token Budget Manager      │ ◄───► │ - Entity & Context Graph    │  │
│  │ - Git Diff & Focus Anchor   │       │ - Multi-Session Persistence │  │
│  └──────────────┬──────────────┘       └──────────────┬──────────────┘  │
│                 │                                     │                 │
│                 └──────────────────┬──────────────────┘                 │
│                                    ▼                                    │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                File Watcher & Real-Time Event Hook                │  │
│  │               (Triggers after EVERY file edit/save)              │  │
│  └─────────────────────────────────┬─────────────────────────────────┘  │
└────────────────────────────────────┼────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                            OUTPUT ARTIFACTS                             │
│       • Memory.md (Live Context Log for AI Agents)                      │
│       • MCP Server JSON-RPC Protocol (Tool Bindings)                    │
│       • HyperMemory CLI Context Snapshots                               │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Directory & Module Structure

```
hypermemory/
├── PRD.md                       # Product Requirements Document
├── Architecture.md              # System Architecture & Technical Specifications
├── Rules.md                     # AI Agent Operating Rules & Constraints
├── Phases.md                    # Detailed Multi-Phase Roadmap
├── Design.md                    # Visual & Prompt Aesthetic Guidelines
├── Memory.md                    # Live Persistent Context Log
├── README.md                    # Open-Source Documentation & Setup Guide
├── package.json                 # Node.js NPM Manifest & Dependencies
├── tsconfig.json                # TypeScript Strict Compiler Options
├── src/
│   ├── index.ts                 # Main Library Export Entry Point
│   ├── harness/                 # Oh-My-Pi Context Harness & State Compressor
│   │   ├── ohMyPi.ts            # Dynamic Prompt & State Harness Formatter
│   │   └── tokenCompressor.ts   # Token Ceiling & State Truncation Utilities
│   ├── memory/                  # Supermemory Base Persistent Storage
│   │   ├── supermemory.ts       # Supermemory Core Manager
│   │   ├── sqliteStore.ts       # Local SQLite / Key-Value Memory Store
│   │   └── graphIndexer.ts      # Project Symbol & Relationship Graph
│   ├── hooks/                   # Real-time Event System
│   │   └── fileWatcher.ts       # Chokidar File Watcher & Auto-updater Hook
│   ├── mcp/                     # Model Context Protocol Interface
│   │   └── server.ts            # MCP Server Implementation & Tool Exposer
│   └── cli/                     # Command Line Interface
│       └── index.ts             # Commander CLI Binary Entry Point
└── tests/                       # Automated Test Suite
    ├── harness.test.ts
    ├── memory.test.ts
    └── watcher.test.ts
```

---

## 3. Technology Stack

- **Language**: TypeScript (Node.js ES2022 / CommonJS dual build)
- **State Harness Engine**: Custom Oh-My-Pi AST & state compression algorithm
- **Persistent Storage**: Local SQLite (`better-sqlite3` / in-memory fallback) + JSON file store
- **File System Hook**: `chokidar` high-performance watcher
- **Agent Integration**: `@modelcontextprotocol/sdk` (Model Context Protocol standard)
- **CLI Toolkit**: `commander` + `picocolors` + `ora`
- **Testing**: `vitest`

---

## 4. Execution Data Flow

1. **File Edit Event**: Developer or AI edits a file and saves.
2. **Hook Trigger**: `fileWatcher.ts` catches the change event within < 10ms.
3. **Diff & AST Analysis**: `ohMyPi.ts` calculates line delta, active symbol focus, and token usage.
4. **Memory Graph Update**: `supermemory.ts` updates symbol relationships and saves high-level summary into `Memory.md` and local SQLite store.
5. **Context Header Generation**: When AI agent calls MCP tool or starts next prompt turn, `ohMyPi.ts` provides a compact state snapshot header (< 1000 tokens) ready for context injection.
