# HyperSABMemory — Release Policy & Unified Release Workflow

## 1. SemVer, Tags, and Distribution Channels

- **Versioning**: Adheres to [Semantic Versioning 2.0.0](https://semver.org/).
- **Preview Releases (`-preview.N`)**:
  - Publish strictly under the npm dist-tag **`preview`** (`npm publish --tag preview`), **never** `--tag latest`.
  - Git tag format: `v<major>.<minor>.<patch>-preview.<n>` (e.g., `v1.5.0-preview.1`) matching `package.json` `version` byte-for-byte.
- **Stable Releases (`X.Y.Z`)**:
  - Publish to `latest` only after passing Profile 2 Stable acceptance criteria and explicit owner sign-off.
- **Pre-Release Verification Rule**: Before assigning any new target version, run `npm view hypersabmemory versions --json` and `git tag -l` to confirm availability.

## 2. Fail-Closed Governance Contract

1. **Profile-Scoped Release Gate**: `scripts/release-preflight.mjs` validates Option B Profile 1 acceptance ledgers (`docs/acceptance/v<version>-acceptance.json`) strictly for `-preview.N` versions bound by live `src/` tree SHA-256 checksums, while keeping stable `X.Y.Z` versions fail-closed (`NO-GO`) under frozen `FROZEN_GATE_SPEC` until Profile 2 acceptance is approved and passed.
2. **Threshold Anti-Relaxation Rule**: Safety gates (`0` unsupported assertions, `0` forgotten/stale leaks, `0` workspace escapes, `0` false test links, atomic rename integrity) are permanent and immutable. Acceptance thresholds cannot be lowered after observing evaluation scores.
3. **Permanent Corpus Separation**: Any repository cohort used during acceptance evaluation (`ni`, `commander`, `p-queue`, `ufo`, `nanostores`, `neverthrow`, `picomatch`, `marked`, `headers-polyfill`, `js-yaml`, `fast-json-stringify`, `rou3`, `tinybench`, `path-to-regexp`, `uuid`) cannot be tuned against and re-submitted as "unseen"; future acceptance cycles require freshly pinned unseen cohorts.

## 3. Unified Release Workflow (`.github/workflows/release.yml`)

| Stage | Mechanism / Owner | Checks Executed | Fail-Closed Guard |
|---|---|---|---|
| **1. Preflight & Parity** | `.github/workflows/release.yml` (`gates` job) | `npm ci`, tag == `package.json` version, zero dirty/secret artifacts | Fails before build/test on mismatch |
| **2. Cross-Platform Build & Regression** | Shared 3x3 matrix (`ubuntu`, `windows`, `macos` × Node `24`) | `npx tsc --noEmit`, `npm test`, `npm run eval`, `npm run eval:baseline` | `fail-fast: false`; any lane failure blocks release |
| **3. Package Content & Smoke Verification** | Existing `npm run package:smoke` | `npm pack`, isolated offline `npm install`, `setup`, `doctor --verify`, stdio MCP & Sprint 3.1 handoff | Fails if offline install, CLI entry check, or stdio MCP fails |
| **4. Profile-Scoped Release Gate** | `npm run release:preflight` | Preview (`-preview.N`) validates Profile 1 ledger + live `src/` tree SHA-256; Stable validates frozen Profile 0 gates | Fails closed if ledger missing, malformed, `src/` hash mismatched, or threshold unmet |
| **5. Authorized Publication** | `.github/workflows/release.yml` (`publish` job) | Runs `npm publish --tag preview` for `-preview.` tags, `npm publish` otherwise | Runs ONLY on authorized tag push |

## 4. Product-Owner Authorization Boundaries

- **Routine Autonomous Execution (Once Version Cycle Is Authorized)**: Engineering edits, RED→GREEN tests, code review, docs updates, local evaluations, `npm pack` smoke runs, and `docs/RELEASE_STATUS.md` updates.
- **Explicit Owner Approval Required Before Execution**: Pushing git tags, creating public GitHub Releases, or running `npm publish`.
