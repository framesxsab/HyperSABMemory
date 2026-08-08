# ⚡ HyperMemory

> **Universal Open-Source IDE Context Harness & Persistent Memory Engine for AI Coding Agents**  
> *Combining Supermemory's universal persistence, Graphify's structural AST graph, Oh-My-Pi's real-time prompt harness, Ponytail's YAGNI anti-bloat ladder, Universal IDE Adapters, and 3-5 minute hyperfrequent auto-commit checkpointing.*

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Build Status](https://img.shields.io/badge/build-passing-brightgreen.svg)]()
[![Repository](https://img.shields.io/badge/GitHub-framesxsab%2FHyperMemory-blue.svg)](https://github.com/framesxsab/HyperMemory)

---

## 🌟 Why HyperMemory?

When using AI coding assistants (Cursor, Claude Code, VS Code, Windsurf, Antigravity, GitHub Copilot), agents lose context across chat resets or waste token budgets re-reading whole codebases.

**HyperMemory** is the ultimate all-in-one context operating harness:

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                             HYPERMEMORY UNIFIED POWERHOUSE                               │
│                                                                                          │
│ ┌───────────────────────────┐ ┌───────────────────────────┐ ┌───────────────────────────┐ │
│ │  1. Structural Graph    │ │  2. Temporal Memory       │ │  3. Ponytail YAGNI Engine │ │
│ │  (Graphify-Labs/graphify) │ │  (Supermemory Base)       │ │  (DietrichGebert/ponytail)│ │
│ │  Codebase AST & Classes   │ │  Decisions & Bug Fixes    │ │  Zero Bloat / Minimal Code│ │
│ └─────────────┬─────────────┘ └─────────────┬─────────────┘ └─────────────┬─────────────┘ │
│               │                             │                             │               │
│               └─────────────────────────────┼─────────────────────────────┘               │
│                                             ▼                                             │
│ ┌───────────────────────────────────────────────────────────────────────────────────────┐ │
│ │  4. Oh-My-Pi Harness Header + Quad-Hybrid Search + 3-5 Min Auto-Commit Safety         │ │
│ │  5. Universal IDE Adapters (Cursor .mdc, Claude Code, Windsurf, Copilot, Antigravity) │ │
│ │  6. Live Web Dashboard (http://localhost:4321)                                        │ │
│ └───────────────────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🚀 Key Features

1. **One-Shot Setup (`npx hypermemory setup`)**: Single command configuring skill `.agents/skills/hypermemory/SKILL.md`, rules, engines, and auto-commits in one step.
2. **Universal IDE Adapters**: Automatically generates rules across all major AI editors:
   - **Cursor IDE**: `.cursor/rules/hypermemory.mdc`
   - **Claude Code**: `.claude.json`
   - **Windsurf**: `.windsurfrules`
   - **GitHub Copilot**: `.github/copilot-instructions.md`
   - **Antigravity / GSD**: `.agents/skills/hypermemory/SKILL.md` & `AGENTS.md`
3. **Oh-My-Pi Prompt Harness** (Baseline: [`can1357/oh-my-pi`](https://github.com/can1357/oh-my-pi)): Compact, token-budgeted (< 1500 tokens) prompt header detailing active file focus, modified files, git diff, and hash-anchored edits.
4. **Ponytail YAGNI Engine** (Baseline: [`DietrichGebert/ponytail`](https://github.com/DietrichGebert/ponytail)): Enforces lazy senior dev YAGNI decision ladder (re-use existing components, write minimal code, zero bloat).
5. **Graphify Structural Knowledge** (Baseline: [`Graphify-Labs/graphify`](https://github.com/Graphify-Labs/graphify)): Indexes codebase AST relationships, function dependencies, and class hierarchies (`graph.json`).
6. **Supermemory Temporal Layer**: Persistent multi-session decision log synced in real-time to `Memory.md`.
7. **Hyperfrequent Auto-Commit Engine**: Auto-checkpoints micro-snapshots every **3 to 5 minutes** under configured git author for 1-click rollbacks.
8. **Quad-Hybrid Search Engine**: Fuses AST nodes, decision records, and BM25 token matching with Reciprocal Rank Fusion.
9. **Live Web Visualizer Dashboard**: Local Web dashboard on `http://localhost:4321` featuring real-time token meters and git commit scrubbers.

---

## 📁 Blueprint Documentation Standards

HyperMemory comes pre-structured with 6 core architectural blueprint files:

1. **[`PRD.md`](./PRD.md)** — Product Requirements Document: Vision, target users, and functional specifications.
2. **[`Architecture.md`](./Architecture.md)** — System Architecture & Flow: Component breakdown and data flow diagram.
3. **[`Rules.md`](./Rules.md)** — AI Agent Rules: Strict token ceilings (<1500 tokens), privacy, and auto-commit rules.
4. **[`Phases.md`](./Phases.md)** — Multi-Phase Roadmap: From core engine to open-source distribution.
5. **[`Design.md`](./Design.md)** — Visual & Prompt Aesthetics: Oh-My-Pi status headers and dark mode theme tokens.
6. **[`Memory.md`](./Memory.md)** — Live Persistent Context Log: Updated in real-time after file edits for AI agent reading.

---

## ⚡ Quick Start & Usage

### 1. Installation

```bash
git clone https://github.com/framesxsab/HyperMemory.git
cd HyperMemory
npm install
npm run build
```

### 2. One-Shot Setup on Any Project

```bash
npx hypermemory setup
```

### 3. Start Real-Time Watcher & 3-5 Min Auto-Commit Engine

```bash
npx hypermemory watch --interval 3
```

### 4. Launch Live Web Visualizer Dashboard

```bash
npx hypermemory dashboard --port 4321
```

### 5. Create Manual Checkpoint & Rollback

```bash
# Manual checkpoint commit
npx hypermemory checkpoint "Added new feature module"

# Rollback workspace to historical commit
npx hypermemory rollback <commit_hash>
```

### 6. Launch Model Context Protocol (MCP) Server

```bash
npx hypermemory mcp
```

---

## ⚡ Oh-My-Pi + Ponytail Harness Output Example

```
⚡ [HYPERMEMORY :: OH-MY-PI + PONYTAIL HARNESS]
┌─ Workspace: hypermemory | Branch: main | Checkpoint: 3a020d1 (3m ago)
├─ Active Focus: src/harness/ohMyPi.ts (L15:C1)
├─ Modified Files: [src/hooks/autoCommit.ts, Memory.md]
├─ Structural Knowledge: Graphify: 24 nodes mapped
├─ Temporal Memory: 5 items recorded. Latest: [architecture] Initialized Universal Adapters
└─ Diff Snapshot:
... [compact diff snippet] ...

🎯 [PONYTAIL YAGNI DECISION LADDER]
1. Does this feature need to exist at all? (Default NO unless requested)
2. Re-use existing Graphify codebase components first.
3. Use standard libraries — zero unnecessary dependencies.
4. Write minimum working code. Zero fluff, zero over-engineering.
```

---

## 👤 Author & Open Source Community

- **Maintainer**: `framesxsab`
- **Repository**: [https://github.com/framesxsab/HyperMemory](https://github.com/framesxsab/HyperMemory)

---

## 📄 License

MIT © [framesxsab](https://github.com/framesxsab)
