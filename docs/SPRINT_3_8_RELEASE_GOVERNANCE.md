# Sprint 3.8: Release Safety and Contract Governance

- **Date**: 2026-11-22
- **Worktree**: `C:\Users\singa\Desktop\hypermemory-sprint2.5`
- **Branch**: `feature/sprint2.5-20261106`
- **Starting Commit**: `47d2829fbcfb1cdcb034c0f7d18439e93c91bea8` (`47d2829`)
- **Product Release Status**: **NO-GO** (official frozen release gates fail; Option B remains unapproved)

---

## 1. Verified Starting Git State

Before editing, repository state in `C:\Users\singa\Desktop\hypermemory-sprint2.5` was confirmed at `47d2829fbcfb1cdcb034c0f7d18439e93c91bea8` on `feature/sprint2.5-20261106` (immediately following Sprint 3.7 commits `3f8df4c` and `47d2829`).

All 10 pre-existing untracked artifacts (`CLEANUP-RESULTS.md`, `cleanup-inventory.md`, `code-cleanup-audit.md`, `docs/V2_BASELINE.md`, `docs/V2_RESEARCH_AND_SPRINT.md`, `scheduled-tasks-audit.md`, `scheduled-tasks-inventory.csv`, `scheduled-tasks-triage.csv`, `scripts/cleanup-dry-run.ps1`, `scripts/cleanup-safe.ps1`) and all 3 sibling maintenance worktrees (`C:/Users/singa/Desktop/hypermemory`, `C:/Users/singa/Desktop/hypermemory-cleanup-isolated`, `C:/Users/singa/Desktop/hypermemory-dependency-review` at `592f054`) remain intact and unmodified.

---

## 2. Release-Safety Defect Closed

Prior to Sprint 3.8, the frozen repository release evaluator ([repository-task-eval.mjs](file:///C:/Users/singa/Desktop/hypermemory-sprint2.5/scripts/repository-task-eval.mjs) / [repositoryTaskEvaluation.ts](file:///C:/Users/singa/Desktop/hypermemory-sprint2.5/src/eval/repositoryTaskEvaluation.ts)) reported `passed: false`, yet neither npm publishing nor GitHub Actions release workflows enforced it:

1. `package.json` `prepublishOnly` ran `npm test && npm run eval && npm run eval:baseline && npm run package:smoke` — all four passed even while `repository-task-eval.mjs` failed 5 release gates.
2. `.github/workflows/release.yml` ran `gates` only on `ubuntu-latest` (without Windows/macOS checks or `repository-task-eval.mjs`) and then immediately allowed `publish` (`npm publish`) on any pushed `v*` tag matching `package.json`.
3. `.github/workflows/ci.yml` ran ordinary development tests and `package:smoke`, with no separate visibility into release eligibility.

---

## 3. Fail-Closed Release Preflight Implementation

Implemented [scripts/release-preflight.mjs](file:///C:/Users/singa/Desktop/hypermemory-sprint2.5/scripts/release-preflight.mjs) and wired it to `npm run release:preflight` in [package.json](file:///C:/Users/singa/Desktop/hypermemory-sprint2.5/package.json):

- Executes the unchanged, approved `scripts/repository-task-eval.mjs` offline against local dependencies without mutating the repository or running `build` (fails closed with `MISSING_BUILD_ARTIFACT` if `dist/eval/repositoryTaskEvaluation.js` is absent).
- Never trusts process exit code alone: parses stdout JSON, requires a plain object with boolean `passed`, and independently validates all 12 frozen criteria from `src/eval/repositoryTaskEvaluation.ts` (`FROZEN_GATE_SPEC`).
- Fails closed (`eligible: false`, verdict `RELEASE BLOCKED — NO-GO`, exit code `1`) on:
  - `passed: false` (even when exit code is `0`)
  - Nonzero evaluator exit code (even if stdout claims `passed: true`)
  - `passed: true` contradicting any unmet or missing frozen metric (`EVALUATOR_CONTRACT_MISMATCH`)
  - Empty output (`EVALUATOR_EMPTY_OUTPUT`) or invalid JSON (`EVALUATOR_MALFORMED_OUTPUT`)
  - Timeout (`EVALUATOR_TIMEOUT`), spawn failure (`EVALUATOR_SPAWN_ERROR`), or signal termination (`EVALUATOR_SIGNAL`)
- Covered by 11 automated tests in [tests/releasePreflight.test.ts](file:///C:/Users/singa/Desktop/hypermemory-sprint2.5/tests/releasePreflight.test.ts).

---

## 4. Local Blocking Demonstration and Remaining Bypasses

### 4.1 Observed Local Blocking (`RELEASE BLOCKED — NO-GO`)

Both `npm.cmd run release:preflight` and `npm.cmd run prepublishOnly` (executed locally without invoking `npm publish`) blocked publication cleanly:

- `npm.cmd run release:preflight` -> **exit code `1`**, verdict **`RELEASE BLOCKED — NO-GO`**
- `npm.cmd run prepublishOnly` -> passed `npm test`, `npm run eval`, `npm run eval:baseline`, and `npm run package:smoke`, then **failed closed at `npm run release:preflight` with exit code `1`** (`PREPUBLISH_ONLY_EXIT=1`)

Observed failing frozen criteria (`5 / 12` failing, `7 / 12` passing):
- `retrieval.precisionAt5`: observed `0.4700`, required `>= 0.5`
- `retrieval.recallAt5`: observed `0.7208`, required `>= 0.85`
- `grounded.recallAt5`: observed `0.6417`, required `>= 0.85`
- `grounded.precisionAt5`: observed `0.4200`, required `>= 0.5`
- `grounded.supportedAnswerCoverage`: observed `0`, required `> 0`

Passing frozen criteria (`7 / 12`):
- `retrieval.maximumPrecisionAt5 = 0.6600` (`>= 0.5`)
- `grounded.noAnswerFalsePositives = 0` (`<= 1`)
- `retrieval.forgottenLeaks = 0` (`=== 0`)
- `methodology.staleSourceTested = true` (`=== true`)
- `staleProbe.leaks = 0` (`=== 0`)
- `latencyMs.samples = 150` (`> 0`)
- `latencyMs.p95 = 32.43–35.46 ms` (`< 100`)

### 4.2 Residual Bypass Paths Outside Normal `npm publish` & Recommended Controls

Local `prepublishOnly` and GitHub Actions `gates` block ordinary publication, but cannot prevent out-of-band bypasses without repository and registry controls:
1. **`npm publish --ignore-scripts`**: skips `prepublishOnly` locally.
2. **Publishing a pre-packed tarball (`npm publish hypersabmemory-1.4.1.tgz`)**: bypasses source lifecycle hooks.
3. **Direct local publish with a personal npm token**: bypasses `.github/workflows/release.yml`.
4. **Pushing a forged `v*` tag or editing workflow files on a branch**: could alter CI checks if tag/branch protection is absent.

**Recommended governance controls** (for repository/registry owner):
- Restrict `v*` tags via GitHub Tag Protection rules so only maintainers/release managers can create release tags.
- Require a protected GitHub Environment (e.g. `npm-release`) with mandatory reviewer approval before `release.yml`'s `publish` job can access `NODE_AUTH_TOKEN`.
- Prefer npm Trusted Publishing (OIDC from GitHub Actions `release.yml` only) or a short-lived automation-only granular npm token with 2FA enforced for interactive publishes, eliminating local personal publish tokens.

---

## 5. CI, Packaging, and Cross-Platform Preparedness

### 5.1 Workflow Updates
- [package.json](file:///C:/Users/singa/Desktop/hypermemory-sprint2.5/package.json): added `"release:preflight": "node scripts/release-preflight.mjs"`, `"eval:option-b:shadow": "node scripts/option-b-shadow-eval.mjs"` (diagnostic only, excluded from `prepublishOnly`), and appended `&& npm run release:preflight` to `"prepublishOnly"`.
- [.github/workflows/ci.yml](file:///C:/Users/singa/Desktop/hypermemory-sprint2.5/.github/workflows/ci.yml): kept the 9-lane `test` matrix (`ubuntu-latest`, `windows-latest`, `macos-latest` x Node `20`, `22`, `24`) for ordinary development verification, and added a distinct, non-optional `release-readiness` job (`ubuntu-latest`, `windows-latest`, `macos-latest`, Node `24`) running `npm run build` and `npm run release:preflight` (no `continue-on-error: true`).
- [.github/workflows/release.yml](file:///C:/Users/singa/Desktop/hypermemory-sprint2.5/.github/workflows/release.yml): added `permissions: contents: read`, expanded `gates` to `[ubuntu-latest, windows-latest, macos-latest]` (Node `24`), added `npx tsc --noEmit`, `npm run eval`, and mandatory `npm run release:preflight` before `publish` (`needs: gates`).

### 5.2 Package Tarball Audit (`npm pack --dry-run --json`)
- Total files: `183` (`195.8 kB` packed, `891.4 kB` unpacked).
- Non-`dist/` files: `CHANGELOG.md`, `CONTRIBUTING.md`, `LICENSE`, `README.md`, `SECURITY.md`, `docs/AGENT_HANDOFF.md`, `package.json`.
- **Credential & hygiene audit**: Zero `.env`, secrets, tokens, `.git`, `.hypersabmemory`, `tests/`, `scripts/`, or any of the 10 untracked audit/cleanup files are packed.
- **Noted packaging item**: `dist/eval/*` (including `repositoryTaskEvaluation.*`, `repositoryTaskFixture.*`, `sprint25DevelopmentFixture.*`, `repositoryBaseline.*`) is currently compiled into `dist/` via `tsconfig.json` and included in the tarball (`dist/cli/evalCommand.js` only requires `memoryBench.js` and `tokenEfficiency.js`). Trimming internal fixture modules from published `dist/` is a clean follow-up once release gating is ratified.

### 5.3 Cross-Platform Verification Status
- **Local Windows x64 (`Node v22.14.0`)**: Verified (`better-sqlite3@12.9.0` native addon, `package:smoke`, 9/9 MCP regression, `release:preflight`).
- **Linux (`ubuntu-latest`) and macOS (`macos-latest`)**: CI/release workflow configuration has been **committed locally but is unverified remotely** in this sprint because no push or remote Actions trigger was performed. Native `better-sqlite3` portability on Linux/macOS and public-registry installation are **unverified** until remote CI executes cleanly.

---

## 6. Full Sequential Verification Results

All checks ran sequentially after the Sprint 3.8 changes:

| Command | Exit Code | Observed Result |
|---|---:|---|
| `npm.cmd test` | `0` | **45 test files passed, 304 tests passed** (includes 10/10, then 11/11 in `tests/releasePreflight.test.ts`) |
| `npx.cmd tsc --noEmit` | `0` | Clean typecheck |
| `npm.cmd run build` | `0` | Clean `dist/` build |
| `npm.cmd run eval` | `0` | **8 / 8** MemoryBench tests passed (`recall >= 0.80`, `0` forgotten leaks) |
| `npm.cmd run eval:baseline` | `0` | `passed: true`, 500 records, `recallAt5: 1.0`, `staleLeaks: 0`, `p50: 1.59 ms`, `p95: 2.76 ms` |
| `npm.cmd run package:smoke` | `0` | `Packed install smoke passed: hypersabmemory@1.4.1` (CLI, dual stdio MCP, lease fencing, handoff, implementation evidence) |
| `node scripts/sprint36-handoff-bench.mjs` | `0` | Compact handoff `p50: 13.08 / 10.81 ms`, `p95: 16.71 / 15.76 ms`, `65.4% / 65.2%` bytes saved |
| `node scripts/sprint37-grounding-bench.mjs` | `0` | Alternating pooled `p50: 21.96 ms` (`-70.6%`), `p95: 43.18 ms` (`-81.8%`), `30/30` query parity (`0` diffs), `9/9` MCP regression checks |
| `node scripts/repository-task-eval.mjs` | `1` | `passed: false` (83 real source files / 84 records; 5 frozen gates fail, 7 pass including `p95 < 100 ms`) |
| `npm.cmd run release:preflight` | `1` | **`RELEASE BLOCKED — NO-GO`** (`p95 = 32.43 ms`; blocks on the 5 failing frozen criteria) |
| `npm.cmd run prepublishOnly` | `1` | Passed `test`, `eval`, `eval:baseline`, `package:smoke`; **blocked at `release:preflight`** (`p95 = 32.66 ms`) |
| `npm.cmd run eval:option-b:shadow` | `0` | `authorizesRelease: false`, `officialReleaseStatus: "NO-GO"`, `candidateContractPassing: false` |

---

## 7. Candidate Option B Shadow Assessment (`scripts/option-b-shadow-eval.mjs`)

[scripts/option-b-shadow-eval.mjs](file:///C:/Users/singa/Desktop/hypermemory-sprint2.5/scripts/option-b-shadow-eval.mjs) reports shadow diagnostics without authorizing release (`authorizesRelease: false`, `officialReleaseStatus: "NO-GO"`), keeping **raw retrieval**, **grounded retrieval**, and **answer synthesis** strictly separate:

| Dimension | Scope | Local Evidence Status | Approval Status |
|---|---|---|---|
| Deterministic claim correctness (`symbol`, `json_scalar`, `quoted_text`, Markdown `Decision:`) | Harness verification | Supported locally (`0` unsupported assertions, 9/9 MCP) | Proposed candidate |
| Source provenance (`sha256`, freshness, unique line/excerpt) | Harness verification | Supported locally | Proposed candidate |
| Freshness & same-size rewrite protection | Harness verification | `20/20` stale flagged, `0` leaks, same-size rewrite detected | Proposed candidate |
| Forgotten & superseded exclusion | Harness verification | `0` leaks across `MemoryBench`, `repository-task-eval`, MCP | Proposed candidate |
| Conflict abstention (`CONFLICTING_EVIDENCE`, `canAssert: false`) | Harness verification | Supported locally | Proposed candidate |
| Explicit cross-file relationships (`Decision-Source:`) | Harness verification | Supported locally | Proposed candidate |
| Implementation & TypeScript test evidence (`execution: 'unverified'`) | Harness verification | Supported locally (batched `TypeChecker`, shadowed/type-only excluded) | Proposed candidate |
| Task restoration & compact handoff (`task_context({ compact: true })`) | Harness verification | `p95: 15.76–16.71 ms`, `0` ledger shell reads, `65.2–65.4%` smaller | Proposed candidate |
| Grounded search & handoff latency | Harness verification | `p95: 32.43–37.25 ms` (`< 100 ms`) | Proposed candidate |
| **Bounded top-5 retrieval quality** | **Retrieval quality** | Raw `P@5: 0.47`, `R@5: 0.7208`, `MRR: 0.875`, raw no-answer FP `9/10`; Grounded `P@5: 0.42`, `R@5: 0.6417`, `MRR: 0.8292`, no-answer candidate rate `40% (4/10)` | **UNAPPROVED** |
| **Cross-platform MCP packaging & native `better-sqlite3`** | **Portability** | Windows x64 verified locally; Linux & macOS remote CI not yet executed | **UNAPPROVED / UNVERIFIED REMOTELY** |
| **End-to-end coding-agent reliability** | **Agent reasoning** | `2/2` historical-context patches vs `0/2` repo-only (Sprint 3.5); `1/1` compact handoff (Sprint 3.6); `n = 2` tasks with Sprint 3.5 scorer edits and Task B deadline hit | **UNAPPROVED** |

**Explicit quality boundary**: `answerableCandidateCoverage = 1.0` does **not** certify retrieval quality. Grounded top-5 retrieval currently misses ~36% of labeled relevant files (`recallAt5 = 0.6417`) and surfaces candidate excerpts on 40% (`4/10`) of unanswerable queries. Inventing a relaxed passing threshold to make Option B look green is explicitly rejected.

---

## 8. Release-Contract Decision Record (Product-Owner Approval Required)

### Option A — Retain Original Frozen Release Contract
- **Scope**: Keep `src/eval/repositoryTaskEvaluation.ts` and all 12 thresholds unchanged (`raw P@5 >= 0.50`, `raw R@5 >= 0.85`, `grounded P@5 >= 0.50`, `grounded R@5 >= 0.85`, `supportedAnswerCoverage > 0`, `p95 < 100 ms`, safety checks).
- **Status**: **NO-GO**. Latency now passes (`~33 ms < 100 ms`), leaving raw/grounded retrieval precision & recall and broad prose `supportedAnswerCoverage` (`0/20`) unresolved.
- **Implication**: Requires substantial semantic retrieval/reranking and multi-file answer-synthesis engineering before any release.

### Option B — Adopt Evidence-Harness Release Contract (Requires Explicit Product-Owner Sign-Off)
- **Architectural Separation**:
  - **Harness Verification (owned by HyperSABMemory)**: deterministic exact-source claims, cryptographic provenance, freshness/same-size rewrite rejection, forgotten-memory exclusion, conflict abstention, explicit cross-file references, AST/TypeChecker code-test links (`execution: 'unverified'`), lease-fenced compact task restoration, MCP packaging, and bounded latency (`p95 < 100 ms`).
  - **Agent Reasoning (owned by the calling coding agent)**: broad multi-file prose synthesis, architectural tracing, implementation planning, and patch generation using retrieved context.
- **Required Retrieval-Quality Gate (currently UNAPPROVED)**: Option B must still include a concrete, justified bounded top-5 retrieval quality floor (e.g., grounded `recall@5`, grounded `MRR`, and bounded unanswerable candidate noise) rather than relying on `answerableCandidateCoverage = 1.0`.
- **Minimum Safe Scope for an Initial Developer Preview (if Option B is approved)**:
  1. Explicit preview / experimental label (`0.x` or `prerelease` tag, not production GA) positioned strictly as a **local-first MCP context harness and task-handoff tool**, not an autonomous semantic QA engine.
  2. Verified green remote GitHub Actions runs across **Linux, Windows, and macOS** (confirming `better-sqlite3` prebuilds/compilation and `package:smoke` on all 3 OSes).
  3. Product-owner ratification of explicit bounded retrieval-quality thresholds (or completion of targeted retrieval improvements to meet them) and removal of non-runtime fixtures from packed `dist/eval/`.
  4. Protected GitHub release environment + tag protection + OIDC/automation-only npm publishing.

**Governance restriction honored**: Option B has **not** been approved or enacted, original release thresholds remain untouched, and no alternate publishing path exists under unapproved criteria.

---

## 9. Commits and Remaining Work

- **Commit 1**: `ef9d332` — `feat(release): enforce fail-closed release preflight and tests` (`scripts/release-preflight.mjs`, `tests/releasePreflight.test.ts`, `package.json`).
- **Commit 2**: CI cross-platform release gates, shadow Option B diagnostic script, workflow assertions, and this Sprint 3.8 governance record (`docs/SPRINT_3_8_RELEASE_GOVERNANCE.md`, `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `scripts/option-b-shadow-eval.mjs`, `package.json`, `tests/releasePreflight.test.ts`).

**Remaining Engineering Work Before Any Release**:
1. Product-owner decision between Option A and Option B (including explicit numeric approval for bounded top-5 retrieval quality gates).
2. Remote GitHub Actions verification of Linux, Windows, and macOS test/package/preflight workflows (native `better-sqlite3` portability).
3. Targeted retrieval-quality improvements (improving grounded top-5 recall from `0.6417` and reducing unanswerable candidate rate from `40%`) and broader multi-task coding-agent evaluation beyond `n = 2`.
4. Packaging hygiene follow-up (excluding non-runtime internal evaluation fixtures from published `dist/eval/`) and GitHub/npm release-permission hardening.
