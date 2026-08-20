# HyperMemory

Local-first **IDE context harness** and **persistent memory** for AI coding agents (Cursor, Claude Code, VS Code, Windsurf, Copilot).

Agents forget work across chat resets and burn tokens re-reading the repo. HyperMemory keeps a compact harness header, a local memory store, and MCP tools so the next session starts with the same facts.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![CI](https://github.com/framesxsab/HyperMemory/actions/workflows/ci.yml/badge.svg)](https://github.com/framesxsab/HyperMemory/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/hypermemory.svg)](https://www.npmjs.com/package/hypermemory)

## Install in any project

Requires Node 18+.

```bash
npx hypermemory setup
```

That command:

1. Injects editor rules (`AGENTS.md`, Cursor `.mdc`, `CLAUDE.md`, Copilot, Windsurf) without wiping your existing text
2. Writes MCP configs (`.cursor/mcp.json`, `.mcp.json`, `.vscode/mcp.json`) and keeps other servers
3. Initializes local memory under `.hypermemory/` (gitignored)

Then **reload the IDE** and **enable** the `hypermemory` MCP server:

- **Cursor:** Settings → MCP → turn on **hypermemory**
- **Claude Code:** `claude mcp add hypermemory -- npx -y hypermemory mcp`
- **VS Code:** reload; check `.vscode/mcp.json`

MCP-only (no full setup):

```bash
npx hypermemory connect
npx hypermemory status
```

### Agent tools

| Tool | What it does |
|---|---|
| `hypermemory_get_context` | Oh-My-Pi harness header + Context Block (< 1500 tokens) |
| `hypermemory_remember` | Save a decision / architecture / bug fact |
| `hypermemory_query` | Search active memories |
| `hypermemory_forget` | Invalidate a fact (dropped from Context Block) |
| `hypermemory_context_block` | Packed dated facts for the prompt |
| `hypermemory_inject_adapters` | Re-sync native rule files |
| `hypermemory_checkpoint` | Git snapshot of the working tree |

## Everyday commands

```bash
npx hypermemory watch --interval 3    # file watcher + 3–5 min checkpoints
npx hypermemory watch --dashboard     # watcher + live dashboard in one process
npx hypermemory dashboard             # dashboard only — http://127.0.0.1:4321 (localhost only)
npx hypermemory checkpoint "reason"   # manual snapshot
npx hypermemory rollback <hash>       # hard reset to a checkpoint hash
npx hypermemory mcp                   # stdio MCP server (used by the IDE)
```

The dashboard shows a live Oh-My-Pi token meter, Graphify structural graph,
Supermemory status, and a git checkpoint timeline with 1-click rollback
(guarded — binds to `127.0.0.1` only).

Checkpoints stay **local**. HyperMemory does not `git push`.

## Develop this repo

```bash
git clone https://github.com/framesxsab/HyperMemory.git
cd HyperMemory
npm install
npm test
npm run eval
npm run build
```

`npm run eval` is a local MemoryBench-style recall gate (no AWS). CI runs the same on every push.

## What it includes

- **Oh-My-Pi harness** — hashline edits, summarized reads, token ceiling
- **Supermemory-style store** — local JSON facts with merge/forget
- **Graphify-style AST summary** — `graph.json`
- **Ponytail YAGNI** — lite / full / ultra intensity in the harness
- **Universal adapters** — Cursor, Claude, Windsurf, Copilot, Antigravity

Blueprint docs in this repo: [`PRD.md`](./PRD.md), [`Architecture.md`](./Architecture.md), [`Rules.md`](./Rules.md), [`Phases.md`](./Phases.md), [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## Privacy

Default is **local-first**: memory lives in `.hypermemory/` and `Memory.md`. No telemetry. The dashboard binds to `127.0.0.1` only.

## License

MIT © [framesxsab](https://github.com/framesxsab)
