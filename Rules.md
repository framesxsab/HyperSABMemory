# HyperSABMemory — AI Agent Rules & Boundaries

## 1. Core Principles for AI Agents

When interacting with or extending HyperSABMemory, AI coding agents must strictly obey the following rules:

### R-1: Never Corrupt State or Block IDE Execution
- File watcher hooks, state synthesis, and auto-commit tasks **MUST NEVER** throw uncaught errors or block the main thread.
- If a file write or diff analysis fails, log silently to internal diagnostics and return the previous valid context snapshot.

### R-2: Hyperfrequent Auto-Commit & Checkpointing (3-5 Min Interval)
- HyperSABMemory includes an active Auto-Commit & Git Checkpoint engine.
- Every 3-5 minutes (or on significant file save milestones), staged changes are automatically checkpointed with concise micro-commit messages (e.g., `hypersabmemory(snapshot): auto-checkpoint [active_file]`).
- Provides bulletproof rollback safety so developers and agents can revert to exact historical states at any minute.

- 

### R-3: Strict Token Ceilings (< 1500 Tokens)
- Generated context-harness context headers must stay within the 1500 token limit by default.
- If the active file context or git diff exceeds token budget, apply lossy compression (summarize diffs, truncate old stack traces, collapse whitespace).


### R-4: Local-First Privacy Preservation
- Do not transmit code snippets, file contents, or developer prompts to external web endpoints unless explicitly configured by the user.
- Local SQLite database and `Memory.md` are the single source of truth.
- 

### R-5: Incremental Memory Updates
- When `Memory.md` is updated after file edits, overwrite only changed sections or append structured state logs. Do not regenerate the entire memory document from scratch unnecessarily.

---

## 2. Codebase Standards & Guidelines

- **Language**: TypeScript with `strict: true` enabled in `tsconfig.json`.
- **No Direct Any**: Avoid using `any` types. Define explicit interfaces for state snapshots, memory items, and MCP tool parameters.
- **Dependencies**: Keep external dependencies lightweight. Avoid heavy native C++ bindings that fail cross-platform installation.
- **Documentation**: Document all public functions with JSDoc headers.
- **Testing**: Every module (`harness`, `memory`, `hooks`, `mcp`, `cli`) must have accompanying unit tests in `tests/`.
