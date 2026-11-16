# HyperSABMemory — AI Agent Rules & Boundaries

## 1. Core Principles for AI Agents

When interacting with or extending HyperSABMemory, AI coding agents must strictly obey the following rules:

### R-1: Never Corrupt State or Block IDE Execution
- File watcher hooks and state synthesis **MUST NOT** block the editor event loop.
- A persistence operation that fails **MUST** report failure to its caller and keep the last successfully persisted record state authoritative.
- Background watcher/checkpoint failures may be logged and surfaced through diagnostics, but must not claim that data was persisted or committed.

### R-2: Hyperfrequent Auto-Commit & Checkpointing (3-5 Min Interval)
- HyperSABMemory includes an active Auto-Commit & Git Checkpoint engine.
- Every 3 minutes by default, the current implementation attempts a workspace-wide Git checkpoint; overlapping requests on one engine share one in-flight commit.
- Checkpoint attempts from separate HyperSABMemory engines/processes serialize through a repository lock.
- Checkpoints stage the workspace after merge/rebase and repository-root guards pass. This scope must be clearly disclosed during setup and in documentation.
- Guarded rollback creates a safety checkpoint before reset so prior work can be recovered.

- 

### R-3: Default Context Budget (1,500 Estimated Tokens)
- Generated context headers must stay within the default 1,500-token estimate.
- The current estimator uses approximately four characters per token; do not describe this as a model-tokenizer measurement.
- If the active file context or git diff exceeds token budget, apply lossy compression (summarize diffs, truncate old stack traces, collapse whitespace).


### R-4: Local-First Privacy Preservation
- Do not transmit code snippets, file contents, or developer prompts to external web endpoints unless explicitly configured by the user.
- `.hypersabmemory/memory_store.json` is the authoritative local memory store; `Memory.md` is its human-readable projection plus project guidance.
- 

### R-5: Incremental Memory Updates
- When `Memory.md` is updated after file edits, overwrite only changed sections or append structured state logs. Do not regenerate the entire memory document from scratch unnecessarily.
- Keep transient workspace state separate from durable decisions; generated file-event observations must retain their provenance and must not silently supersede user-confirmed facts.

---

## 2. Codebase Standards & Guidelines

- **Language**: TypeScript with `strict: true` enabled in `tsconfig.json`.
- **No Direct Any**: Avoid using `any` types. Define explicit interfaces for state snapshots, memory items, and MCP tool parameters.
- **Dependencies**: Keep external dependencies lightweight. Avoid heavy native C++ bindings that fail cross-platform installation.
- **Documentation**: Document all public functions with JSDoc headers.
- **Testing**: Every module (`harness`, `memory`, `hooks`, `mcp`, `cli`) must have accompanying unit tests in `tests/`.
