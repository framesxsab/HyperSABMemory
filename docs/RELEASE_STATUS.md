# HyperSABMemory — Current Release Status Ledger

- **Current Target Release**: **`v1.5.0-preview.2`** — **Integrating & Verifying (Path B Scoped Delta Acceptance)**; `v1.5.0-preview.1` published `--tag preview` at `dcfc8bf1bdf4bd3e59cb2cf6f1e4b504acc5b523` (GitHub prerelease live; `latest` unchanged at `1.4.1`; stable `X.Y.Z` remains `NO-GO`)
- **Published Package State (Verified)**: `npm` versions `1.3.0`, `1.4.0`, `1.4.1` (`latest`), `1.5.0-preview.1` (`preview`); Git tags through `v1.5.0-preview.1` (`1.5.0-preview.2` and `v1.5.0-preview.2` unused)
- **Active Integration Branch**: `feature/v1.5.0-preview.2` (Gate 5.5 evaluated runtime baseline `fc0d3c6fe4476c9c62363b1926e0e7122ddb0aae`; Path B scoped delta limited strictly to `src/cli/index.ts`, `src/cli/oneShotSetup.ts`, `src/harness/mcpAccess.ts`)

---

## 1. Milestone Progress Ledger

| Gate / Phase | Scope | Outcome | Evidence |
|---|---|---|---|
| **Gate 5.1** | Initial unseen acceptance (`p-queue`, `ufo`, `nanostores`) | **`FAIL`** | Uncovered `Memory.md` inactive leaks, compact latency `889 ms`, `0/3` continuation |
| **Gate 5.2–5.3** | Corrective sprint + portability fix (`96d2034`) | **`PASS` (`9/9` CI)** | Run `45682366197`: `49/49` files, `365/365` tests per job |
| **Gate 5.4** | Independent Profile 1 acceptance (`neverthrow`, `picomatch`, `marked`) | **`FAIL` (Strict)** | Continuation `1/3` strict PASS (`marked` failed due to `setup` mutating tracked `AGENTS.md`; `picomatch` pre-reg path typo); `sourceMutationDuringVerification` hook waited for `reads===4` |
| **Phase 1 (P0 Setup Fix)** | `fc0d3c6fe4476c9c62363b1926e0e7122ddb0aae` | **`PASS` (`9/9` CI)** | Non-destructive `preserveTrackedFiles: true` default + `--inject-tracked` opt-in across setup/inject/MCP; `50/50` files, `370/370` Vitest; [CI run `45784340050`](https://github.com/framesxsab/HyperSABMemory/actions/runs/45784340050) `9/9` |
| **Phase 2 (Harness Repair & Preflight)** | `scratch/gate-5-5-acceptance/` | **`PASS`** | Isolated tarball `196,772` bytes (`171` files, SHA-256 `d8ffaf03f5fc68c85e4f5dfb88e6f42af3b89324b8a59c12907953e9ccd0fbf6`); `dev-preflight.mjs` verified clean `setup` `git diff`, `reads === 2` mid-verification `STALE_EVIDENCE`, NTFS junction containment `PASS`, Codex preflight `READY` (`codex-cli 0.171.0`, `gpt-6.2-sol`) |
| **Phase 3 (Gate 5.5 Unseen Acceptance)** | `headers-polyfill`, `js-yaml`, `fast-json-stringify` | **`PASS`** | Pre-reg freeze `5/5` intact; Retrieval `raw R@5=0.85`, `grounded R@5=0.80`, `MRR=0.90`, `Top-1=0.8667`, `unans emit=0.40`, `0` unsupported assertions; Probes `posDet=28/30`, `unsup=15/15`, `negStatic=9/9 (0 false links)`, `sameSize=9/9`, `conflict=6/6`, `forget=9/9`, `Memory.md=3/3+empty`, `midVar=3/3`, `junction=PASS`; Latency `warm p95=34.13 ms`, `cold p95=220.44 ms`, `compact p95=21.54 ms` (`60.44%` mean reduction, `16/16` completeness); Continuation **`3/3` PASS** |
| **Phase 4 (Gate 6 Governance Binding)** | `docs/acceptance/v1.5.0-preview.1-acceptance.json`, `scripts/release-preflight.mjs`, `.github/workflows/release.yml`, `tests/releasePreflight.test.ts` | **`PASS`** | Option B Profile 1 fail-closed verification for `-preview.N` bound to live `src/` tree SHA-256 (`15/15` tests in `releasePreflight.test.ts`), `--tag preview` release workflow, stable `X.Y.Z` kept fail-closed `NO-GO` |
| **Phase 5 (`v1.5.0-preview.1` Release)** | Tag `v1.5.0-preview.1` (`dcfc8bf`), CI `45871369925`, Release `46044614637` | **`PUBLISHED` (`--tag preview`)** | Published to npm `--tag preview` (`integrity=sha512-8Ebj2L+BsAYk+Ew2ChU978ix89wC1CWz/UT4MnnKTEVM0uRC1XPjJwRha0BlFlsSinULvwAFyL++PPAp2VrvCA==`, `latest=1.4.1`) & [GitHub prerelease](https://github.com/framesxsab/HyperSABMemory/releases/tag/v1.5.0-preview.1); historical Option A task-3749 waiver scoped strictly to `preview.1` |
| **Phase 6 (`v1.5.0-preview.2` Integration)** | `feature/v1.5.0-preview.2` (Codex `c89fed0` + Path B Scoped Delta) | **Verifying Candidate** | Atomic MCP setup rollback (`planConfig()`), upgrade regression (`1.4.0`/`1.4.1`/`1.5.0-preview.1`), reliability stress runner, OIDC Trusted Publishing (`npm-preview`), fail-closed `scoped_delta` preflight |
