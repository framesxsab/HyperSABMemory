# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Memory writes now surface persistence errors, and remember-plus-supersede persists as one locked transaction.
- Checkpoint requests serialize across engines/processes; overlapping requests on one engine share an in-flight commit.
- Background file watching reports persistence failures and retries subsequent events.
- Builds clear generated output before compilation so removed source modules cannot remain in the package.
- Updated existing MCP SDK v1 and Vitest dependencies plus compatible transitive patches; the clean install reports zero npm advisories.
- Doctor launches MCP checks in the requested workspace and waits for the child process to close.

### Added

- Package/lockfile metadata checks, a packed-install CLI smoke check, and a repository-grounded retrieval/context baseline.

## [1.4.1] - 2026-08-23

### Changed

- Bumped the package version to 1.4.1; this release contained no runtime behavior changes.

## [1.4.0] - 2026-08-23

### Fixed

- Checkpoints no longer overwrite the repo-local git identity; committer identity is passed per-invocation via `-c` flags, so your own commits are never reattributed to the bot
- The memory store is now truly contained: `.hypersabmemory/` is added to `.git/info/exclude` on setup, legacy tracked stores are untracked, and staging can never sweep the decision log into your commits
- Auto-commit logs no longer corrupt the MCP stdio JSON-RPC stream when the checkpoint tool runs inside an IDE
- Generated MCP configs wrap `npx` in `cmd /c` on Windows, fixing ENOENT first-run failures in Cursor/VS Code
- Checkpoints now refuse to fire during a conflicted merge or rebase (`operation-in-progress`) and refuse monorepo subdirectory sweeps (`subdir-of-repo`)
- Dashboard POST endpoints are hardened against CSRF and DNS rebinding (Host allowlist, JSON content-type, custom header)
- Concurrent engines (MCP + dashboard + CLI) no longer suffer last-writer-wins memory loss: all store mutations serialize through a file-lock CAS with atomic tmp+rename writes, dead-holder eviction, and a golden format safety net
- Swarm mesh locks close the check-then-act race: claim/release/broadcast reload under lock, `sync()` is read-only, sessions are garbage-collected, and lock keys are case-folded on Windows
- `remember()` performs one batched store save instead of one per superseded duplicate; watcher ignores `.venv/target/build/out/coverage/vendor` and debounces rapid writes
- README benchmark wording now matches CI reality (the recall gate runs inside the blocking matrix job)

### Added

- Cold-start bootstrap seeding: `setup` derives 5-10 facts from your README/package.json/git history with visible `[seeded]` provenance, never-supersede semantics, and a GENESIS ritual that prints the baseline checkpoint hash
- `handoff` command: paste-ready forward session brief (<=600 tokens) plus deterministic `--story` retrospective mode
- `doctor` now verifies the configured MCP launch command end-to-end via a real stdio handshake and reports measured counters (active/forgotten facts, checkpoints)
- Adversarial eval classes in MemoryBench: negation, superseded-stale, and artifact-linked query fixtures gated at >=0.80 recall with zero leaks across all retrieval paths
- MCP resources: context block and memory log exposed via resources/list + resources/read for resource-aware clients
- `remove` command for clean uninstall of injected sections, MCP entries, and the local store
- Swarm visibility cards on the dashboard: live file-lock TTLs and recent broadcasts via `/api/swarm`
- Ghost Paths: the header warns `[GHOST]` when current edits collide with files from rolled-back checkpoints (opt-out via `HYPERSABMEMORY_GHOST_PATHS=off`)
- Setup success output now prints per-host enable steps; funding file and tag-triggered release workflow added

## [1.3.0] - 2026-08-22

### Changed

- Rebranded to HyperSABMemory: npm package `hypersabmemory`, repository `framesxsab/HyperSABMemory`
- The `publish` command now performs real pre-flight checks instead of a dry pass
- Removed internal codenames from CLI output and generated templates

### Added

- Structured memory record fields: optional `intent`, `artifacts`, `errorsAndFixes`, and `nextSteps` dimensions on remember records, accepted by the MCP tool schema and new CLI flags (`--intent`, `--artifact` (repeatable), `--fixes`, `--next`), rendered in the context block and Memory.md, and indexed by hybrid search
- Community files: security policy, code of conduct, changelog, contributing guide, issue templates, and pull request template

## [1.2.0]

- One-shot `setup` command for new projects and the local MemoryBench recall eval (`npm run eval`)

## [1.1.0]

- Editor adapters (Cursor, Claude Code, Windsurf, Copilot) and the live local dashboard on port 4321

## [1.0.0]

- Initial public release: context harness, persistent memory store, MCP server, and git auto-checkpointing
