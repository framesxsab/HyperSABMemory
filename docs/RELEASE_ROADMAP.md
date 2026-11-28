# HyperSABMemory — Versioned Release Roadmap

- **Published npm History (Verified)**: `1.3.0`, `1.4.0`, `1.4.1` (`latest`); `1.5.0-preview.1` (`preview`)
- **Existing Git Tags (Verified)**: `v1.0.1`, `v1.1.0`, `v1.1.1`, `v1.3.0`, `v1.4.0`, `v1.4.0-baseline`, `v1.4.1`, `v1.5.0-preview.1`
- **Upcoming SemVer Sequence (Verified Available on npm & Git)**: `v1.5.0-preview.2` (Next Target) -> `v1.5.0` -> `v1.6.0` -> `v1.7.0` -> `v1.8.0` -> `v2.0.0`
- **Governance Rule**: Future-version P1/P2 capabilities **never** block an earlier version once its P0 acceptance criteria are satisfied.

---

## `v1.5.0-preview.1` — Local-First Agent Memory & Task Continuation (Published Developer Preview)

- **Status**: **Published & Closed** on `2026-11-28` (`npm --tag preview`, Git tag `v1.5.0-preview.1` → `dcfc8bf1bdf4bd3e59cb2cf6f1e4b504acc5b523`, `latest` unchanged at `1.4.1`).

## `v1.5.0-preview.2` — Trusted Publishing, Upgrade Safety & Setup Hardening (Developer Preview)

- **P0 Mandatory Requirements (Path B Scoped Delta Acceptance)**:
  - Migrate preview publication to **npm OIDC Trusted Publishing** (`environment: npm-preview`, `id-token: write`, zero `NODE_AUTH_TOKEN`/`NPM_TOKEN`, `latest` preserved at `1.4.1`).
  - Enforce **checked release-candidate preparation & post-publication verification** (`scripts/release-candidate.mjs` `prepare`/`verify`/`published` + `smoke-published` byte-identical tarball `cmp` + `package:smoke`).
  - Verify **backward-compatible upgrades** (`npm run test:upgrade`) across `1.4.0`, `1.4.1`, and `1.5.0-preview.1` plus **non-destructive atomic MCP config setup/rollback** (`src/cli/index.ts`, `src/cli/oneShotSetup.ts`, `src/harness/mcpAccess.ts`) and **reliability stress checks** (`npm run test:reliability`).
  - Bind protected runtime subtrees (`src/memory/*`, `src/mcp/*`, `src/harness/task*`, `src/hooks/*`, `src/server/*`, `src/eval/*`) unchanged to Gate 5.5 baseline `fc0d3c6` via fail-closed `scoped_delta` governance (without inheriting the `preview.1` waiver).

## `v1.5.0` — Stable Foundation

- **P0 Mandatory**: Option B Profile 2 thresholds (`>= 0.85` macro R@5, `>= 0.50` P@5 where `maxP@5 >= 0.50`, `MRR >= 0.85`, `Top-1 >= 0.75`, `<= 0.25` unanswerable candidate noise, `>= 0.95` deterministic positive coverage); `50`-iteration multi-OS concurrency soak; `>= 500`-file TypeChecker latency verification; `sprint42-worktree-eval` automated in CI; `>= 6` unseen continuation tasks across `>= 3` repos; GitHub tag/environment protection + npm OIDC Trusted Publishing.

## `v1.6.0` — Broader Source & Test Intelligence

- **P0**: Implement approved P1–P4 static test attribution expansions (`export const` arrow functions, single-hop barrel re-exports, default export/import bindings, `export class` constructor/`assert.rejects` links) with `0` false positives and explicit `execution: "unverified"`.

## `v1.7.0` — Multi-Agent Coordination

- **P0**: Productionize multi-agent lease contention recovery, conflict surfacing across `task_checkpoint` / swarm locks, and multi-worktree dashboard diagnostics (`/api/swarm`).

## `v1.8.0` — Developer Experience & Integrations

- **P0**: Streamlined `setup` / `doctor --verify` / `remove` diagnostics, verified template parity across IDEs, plus `handoff --story` ergonomics and startup profiling.

## `v2.0.0` — Extensible Memory Infrastructure

- **P0**: Versioned storage schema migration framework (`SqliteStore` / JSON ledger upgrades with automatic pre-migration backups) and clean pluggable retrieval/verifier provider interfaces.
