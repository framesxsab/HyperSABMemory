# Plan

Evidence: Apify scrape 2026-08-13 (37 features).

**Task 5 path (OSS publication):** local MemoryBench-style eval. SageMaker evaluate-first / fine-tune is out of scope for public CI.

1. ✅ **Harness parity** — Hashline, summarized reads, Context Block.
2. ✅ **Memory semantics** — Merge/forget, temporal invalidation, MCP forget/context_block.
3. ✅ **Operable YAGNI** — Ponytail lite/full/ultra.
4. ✅ **Adapters** — Native MDC/AGENTS.md ingest + auto-inject.
5. ✅ **Eval (local MemoryBench)** — Fixture ≥10 facts, ≥1 forgotten; recall ≥ 0.8; zero forgotten leaks.
6. ✅ **Direct MCP access** — `connect` / `setup` writes Cursor, Claude Code, VS Code MCP configs; `status` lists tools.
7. ✅ **OSS hygiene** — Real CI badge, `.vscode/mcp.json` allowed in git, scrape dumps gitignored, `prepublishOnly` gate.

## Verification loop (13 Aug 2026)

| Step | Command | Expected | Result |
|---|---|---|---|
| 1–4 | `npm test` | 13 pass | 13 pass |
| 5 | `npm run eval` + `hypermemory eval` | recall ≥ 0.8, 0 leaks | recall **1.00**, leaks **0**, passed |
| 5 | `npm run build` | tsc exit 0 | pass |
| 6 | `hypermemory status` | 3 MCP files present | all ✔ |
| 6 | `.cursor/mcp.json` | portable `node dist/cli/index.js mcp` | pass |
| OSS | `hypermemory start --help` | alias of watch | pass |

Maintainer leftover: push to GitHub so CI runs, then `npm publish` when ready.
