# HyperSABMemory Architecture

### Task lease transitions

Creation starts at revision 1 and generation 0. Every acquisition increments both, including reacquisition by the same agent. Renewal keeps the generation and increments revision; release clears ownership and increments revision. A checkpoint requires the current unexpired owner, generation and revision, then increments revision. Reported completion also clears ownership and requires evidence and checks. Expiry alone changes no persisted fields; the next acquisition advances the generation. The ledger is distinct from the restored capsule, and unrepresentable capsule state is rejected rather than truncated.

Task mutations hold a `BEGIN IMMEDIATE` transaction in `.hypersabmemory/tasks-coordinator.sqlite` while reading, changing, and atomically replacing `tasks.json`. The temporary ledger file is flushed before replacement; the directory entry is flushed on POSIX. SQLite's OS-managed database locks serialize processes and release ownership when a process exits; recovery rolls back SQLite coordination state before the next transaction. `tasks.json` remains authoritative. The JSON rename and SQLite commit are not a distributed atomic commit: if SQLite commit fails after JSON replacement, the call returns `TASK_COMMIT_UNCERTAIN` and the caller must reread the task revision before retrying. Failures before replacement return an error and leave the ledger unchanged. This coordinator is separate from the existing swarm and memory file locks.

## Current implementation

HyperSABMemory is a local-first TypeScript CLI and MCP server. The existing v1 core remains the foundation for v2.

| Component | Current behavior |
|---|---|
| `ContextHarness` / `TokenCompressor` | Builds a compact state header. The default 1,500-token ceiling uses a four-characters-per-token estimate, not a model tokenizer. |
| `TemporalMemoryEngine` / `SqliteStore` | Stores structured records in `.hypersabmemory/memory_store.json`; `SqliteStore` is a legacy class name. Writes use a shared file lock, temp-file rename, and backup. |
| `HybridSearchEngine` | Runs BM25 over active memory records. Its graph leg matches external graph node names/types and fuses results with RRF. There is no vector index or built-in source-code indexer. |
| `StructuralGraphEngine` | Reads external `graph.json` / `GRAPH_REPORT.md`; graph refresh is performed only by an optional configured external command. |
| `FileWatcherHook` | Observes workspace changes, tracks modified paths, refreshes the local header, and records rate-limited file events. These generated observations must not be treated as user-confirmed architecture. |
| `AutoCommitEngine` | Creates Git checkpoints over the workspace, with merge/rebase and subdirectory guards. A repository lock serializes separate MCP/CLI processes; requests on one engine share an in-flight attempt. |
| `HyperSABMemoryMcpServer` | Exposes tools and resources over MCP stdio. Setup configures the local server for supported agent hosts. |
| `claimVerification` (`src/memory/claimVerification.ts`) | Shares deterministic JSON scalar, exact quotation, recorded Markdown decision/rationale, and explicit source-link verification between general grounded search and task-grounded queries. |
| CLI output | Uses `picocolors` for the terminal colors used by commands, including color opt-out and force settings. |

## Data flow

1. The watcher receives a filesystem event and updates transient modified-file state.
2. Explicit memories and current store mutations are serialized through the local file lock. `remember()` writes its new record and any duplicate supersedes as one transaction; persistence errors reach the caller.
3. At request time, the harness combines current workspace/Git state with the compact memory context and compresses to the configured default limit.
4. MCP memory queries rank active JSON records with BM25. Optional graph results come from the external graph input; context is not cached across workspace changes.
5. `Memory.md` is a human-readable projection of memory records. The JSON store is authoritative for persisted records.

Active-record reads refresh from the JSON store so another process's changes are visible. BM25 reuses bounded, workspace-keyed tokenization derived from exact record text; source evidence is independently re-read and hashed for every grounded query. General grounded queries may assert narrowly verified declarations, exact quotations, unambiguous top-level JSON scalar values, and exact source-recorded decision/rationale lines; lexical similarity alone never verifies a claim.

Captured task sources can supply response-only `source_ref:` candidates without a separate memory record. Natural questions still return candidate evidence unless an exact deterministic claim class applies; lexical similarity alone does not establish entailment. Duplicate normalized paths with different captured hashes block assertions; source containment and freshness are still checked before evidence is returned.

The general evidence query adds `claims`, `relationships`, and `compoundAnswer` fields without changing its input schema. The general grounder and task-scoped cross-file query use the shared verifier in `src/memory/claimVerification.ts`. A compound answer requires a unique explicit `Decision-Source:` reference; its source lines are hashed and rechecked before return. Source text still does not prove implementation compliance.

Task context also exposes a bounded evidence bundle: an agent-reported ledger snapshot and up to five explicitly source-linked constraints. Links reuse the cross-file verifier and require current captured hashes. The association between a ledger decision and source decision is an exact-text match, not a verified identity; these records do not establish implementation compliance. Missing links remain unverified and truncation is reported.

Static relative imports found in indexed JavaScript or TypeScript record text can rerank existing lexical candidates using links to the top three results. Parsed import hints are cached by workspace and exact record text; file paths are resolved against the current candidate paths on each query. The hints are not a current-source dependency proof, and dynamic or unusually long imports are not supported. Grounding independently rechecks captured source hashes.

English lexical tokens use the Porter algorithm from pinned MIT dependency `stemmer@2.0.1`. Common query words and tokens containing digits are preserved. A pure word-to-stem cache holds at most 8,192 words of at most 128 characters each; longer words are processed without memoization. Exact identifiers, file paths, source hashes, and deterministic assertions continue to use original values.

Source inspection resolves the workspace root once per batch and revalidates each file's containment and hash. Grounding may reuse query-independent source token sets only after confirming the current SHA-256; this cache is workspace-scoped with an 8 MiB input/key budget. Final evidence rechecks still read and hash source bytes.

## Compatibility and safety boundaries

- Keep the existing JSON record format, CLI commands, MCP tool names/default response shapes, setup configuration, and local-first behavior backward compatible.
- Keep the 1,500 estimated-token header limit by default. Improve selection and freshness before considering a larger explicit profile.
- Do not add remote services, a required vector database, or a second graph/memory engine without measured user need and a migration plan.
- Any derived-data cache must be bounded, workspace-scoped, and invalidated on writes and graph-source changes. Git/workspace freshness is read for each context build.
- Checkpointing stages the repository workspace. Setup and doctor must make this behavior clear; checkpoint operations must stay serialized.

## Quality evidence

- `npm test` covers unit/integration regressions, including multi-process store behavior and the 1,500 estimated-token limit.
- `npm run eval` gates synthetic memory-retrieval cases on direct, BM25, and fused paths.
- `npm run eval:baseline` reports repository-grounded precision/recall@5, stale leakage, latency p50/p95, corpus size, and estimated context size. Its fixture uses synthetic distractors; it is not a real-user study.
- `npm run package:smoke` packs, installs, and runs the CLI from the tarball.
