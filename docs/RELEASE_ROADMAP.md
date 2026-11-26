# HyperSABMemory — Versioned Release Roadmap

- **Published npm History (Verified)**: `1.3.0`, `1.4.0`, `1.4.1`
- **Existing Git Tags (Verified)**: `v1.0.1`, `v1.1.0`, `v1.1.1`, `v1.3.0`, `v1.4.0`, `v1.4.0-baseline`, `v1.4.1`
- **Upcoming SemVer Sequence (Verified Available on npm & Git)**: `v1.5.0-preview.1` -> `v1.5.0` -> `v1.6.0` -> `v1.7.0` -> `v1.8.0` -> `v2.0.0`
- **Governance Rule**: Future-version P1/P2 capabilities **never** block an earlier version once its P0 acceptance criteria are satisfied.

---

## `v1.5.0-preview.1` — Local-First Agent Memory & Task Continuation (Developer Preview)

- **P0 Mandatory Requirements (Completed / Verified Locally & on Candidate CI)**:
  - Fix P0 non-destructive setup so Git-tracked instruction files remain untouched by default (`preserveTrackedFiles: true`, opt-in `--inject-tracked`) while MCP wiring and idempotent store seeding work (`fc0d3c6`, CI run `45784340050` `9/9` PASS).
  - Pass Gate 5.5 fresh independent acceptance on 3 unseen MIT repos (`mswjs/headers-polyfill`, `nodeca/js-yaml`, `fastify/fast-json-stringify`) under **Option B Profile 1** (`0` unsupported assertions, `0` forgotten/stale leaks including populated `Memory.md` + restarted CLI MCP, `raw R@5=0.85`, `grounded R@5=0.80`, `MRR=0.90`, `Top-1=0.8667`, `0.40` unanswerable emit rate, warm `p95=34.13 ms`, cold `p95=220.44 ms`, compact `p95=21.54 ms` / `60.44%` mean byte reduction / `16/16` completeness, **`3/3` live Codex continuation tasks PASS**).
  - Activate fail-closed Option B Profile 1 preflight binding in `scripts/release-preflight.mjs` + `docs/acceptance/v1.5.0-preview.1-acceptance.json` (`--tag preview` workflow in `.github/workflows/release.yml`, keeping stable `X.Y.Z` fail-closed `NO-GO`).
  - Align `README.md`, `CHANGELOG.md`, `package.json`, `docs/KNOWN_LIMITATIONS.md`, `AGENTS.md`, and release governance docs.
- **Release Deliverables**: `v1.5.0-preview.1` release-prepared commit + verified `hypersabmemory-1.5.0-preview.1.tgz` tarball, SHA-256 checksums, updated `CHANGELOG.md`; Git tag & npm prerelease publish (`--tag preview`) await explicit product-owner authorization.

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
