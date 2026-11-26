# HyperSABMemory — Current Release Status Ledger

- **Current Target Release**: **`v1.5.0-preview.1`** — **Release-Prepared / Preflight `GO` Locally** (awaiting final CI verification & explicit owner authorization for Git tag / `npm publish --tag preview`)
- **Published Package State (Verified)**: `npm` versions `1.3.0`, `1.4.0`, `1.4.1`; Git tags through `v1.4.1` (`1.5.0-preview.1` and `v1.5.0-preview.1` confirmed unused)
- **Active Development Branch**: `feature/sprint2.5-20261106` (evaluated candidate source SHA `fc0d3c6fe4476c9c62363b1926e0e7122ddb0aae`, `src/` tree SHA-256 `4e0db8856f4481f322ed79e731d6955c3af264c49db5a5467165694c1e2f9dea`, `47` files)

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
| **Phase 5 (`v1.5.0-preview.1` Preparation)** | `package.json`, `AGENTS.md`, `docs/*`, `README.md`, `CHANGELOG.md` | **Verifying Final Build/CI** | Preparing final tarball, sequential full validation (`tsc`, `npm test`, `eval`, `eval:baseline`, `package:smoke`, `release:preflight`), and Push #3 CI check |
