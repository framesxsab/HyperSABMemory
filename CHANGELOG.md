# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
