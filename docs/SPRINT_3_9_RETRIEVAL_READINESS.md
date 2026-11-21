# Sprint 3.9: Retrieval Quality and Developer-Preview Readiness

- **Date**: 2026-11-22
- **Worktree**: `C:\Users\singa\Desktop\hypermemory-sprint2.5`
- **Branch**: `feature/sprint2.5-20261106`
- **Starting Commit**: `653ea07c6a917df624db55c505eb4a595938899f` (`653ea07`)
- **Governance Source of Truth**: [docs/SPRINT_3_8_RELEASE_GOVERNANCE.md](file:///C:/Users/singa/Desktop/hypermemory-sprint2.5/docs/SPRINT_3_8_RELEASE_GOVERNANCE.md) (Option B remains unapproved; official release status remains **NO-GO**)

---

## 1. Verified Starting Git State

Repository state in `C:\Users\singa\Desktop\hypermemory-sprint2.5` started at `653ea07c6a917df624db55c505eb4a595938899f` on `feature/sprint2.5-20261106`, with all 10 pre-existing untracked artifacts and all 3 sibling maintenance worktrees (`C:/Users/singa/Desktop/hypermemory`, `C:/Users/singa/Desktop/hypermemory-cleanup-isolated`, `C:/Users/singa/Desktop/hypermemory-dependency-review` at `592f054`) preserved unmodified.

---

## 2. Measured Development-Only Retrieval Failure Diagnosis

Diagnosis was conducted strictly on development-only queries (`DEVELOPMENT` 21 queries + `SPRINT25_DEVELOPMENT` 21 queries = 42 queries: 22 answerable / 77 labeled relevant files, 20 unanswerable) without inspecting `HELD_OUT` reference labels.

### Failure-Mode Frequencies on Combined Development Set (`653ea07`)
- **Total gold relevant files**: `77`
- **Found in raw `HybridSearchEngine` top-5**: `53 / 77` (`raw recall@5 = 0.7856`, `raw MRR = 0.8977`)
- **Returned in `searchGrounded` top-5**: `45 / 77` (`grounded recall@5 = 0.6856`, `grounded MRR = 0.7879`) — **a net drop of 8 relevant files and -0.1098 MRR between raw retrieval and grounded evidence selection**.
- **Root-cause breakdown of the 10 raw top-5 hits dropped by `searchGrounded`**:
  1. **Grounded evidence-selection rank inversion (`7 / 10` lost raw top-5 hits, including four Rank #2–#3 files)**: Line 305 of [src/memory/groundedSearch.ts](file:///C:/Users/singa/Desktop/hypermemory-sprint2.5/src/memory/groundedSearch.ts) ranked accepted current candidates via `1 / (10 + rank) + lexicalSupport / 10`. Because `1 / (10 + rank)` varies by only `0.0409` across Ranks 1–10 while `lexicalSupport / 10` varies by `0.0700` across `[0.30, 1.00]`, verbose lower-ranked files (Ranks 6–10) routinely outscored and displaced concise Rank #1–#5 primary modules — even demoting an `exactPathMatch` Rank #1 file (`src/harness/mcpAccess.ts`) to Rank #3 behind larger test files.
  2. **Threshold rejection on short modules (`3 / 10` lost raw top-5 hits)**: `src/version.ts` (`0.206`), `src/harness/mcpAccess.ts` (`0.252`), and `src/memory/taskLedger.ts` (`0.235`) fell below `GROUNDED_SUPPORT_THRESHOLD = 0.30`.
  3. **Relevant files in raw Ranks 6–20 (`19 / 77`)**: A separate hypothesis to degree-dampen the static import graph in `HybridSearchEngine` was tested on `DEVELOPMENT` + `SPRINT25_DEVELOPMENT` and **rejected** because it reduced raw recall on `SPRINT25_DEVELOPMENT` from `32/56` (`0.5712`) to `27–28/56` (`0.4879–0.5030`).

---

## 3. Production Correction and Regression Test

Selected **Failure Mode 1 (grounded evidence-selection rank inversion)** as the single highest-impact, general-purpose production fix:

- **Failing regression test first**: Added `preserves high-ranked primary source evidence over lower-ranked verbose neighbors across paths and queries` in [tests/groundedSearch.test.ts](file:///C:/Users/singa/Desktop/hypermemory-sprint2.5/tests/groundedSearch.test.ts), verifying that before the fix, verbose rank-6..9 docs displaced Rank #1–#2 primary modules (`docs/overview1.md`, `docs/overview2.md` instead of `src/storage/ledger.ts`, `src/storage/lock.ts`).
- **Production fix ([src/memory/groundedSearch.ts](file:///C:/Users/singa/Desktop/hypermemory-sprint2.5/src/memory/groundedSearch.ts))**: Replaced `1 / (10 + rank) + lexicalSupport / 10` with steeper reciprocal-rank weighting `1 / (2 + rank) + 0.12 * lexicalSupport` during bounded top-5 natural-query evidence selection:
  - Preserves high-ranked primary sources (`Rank 1–3`) against verbose `Rank 6–10` neighbors.
  - Still promotes a decisively stronger current-source full match immediately outside top-5 (`Rank 6` at `1.00` support -> `0.2450` vs. weak `Rank 5` at `0.333` support -> `0.1829`), keeping `selects stronger current evidence beyond the first five` passing.
  - Zero query-specific logic, zero threshold weakening, zero changes to deterministic claim verification, freshness, forgetting, or conflict abstention.

---

## 4. Controlled Development Before vs. After Results

Measured via [scripts/sprint39-dev-retrieval-eval.mjs](file:///C:/Users/singa/Desktop/hypermemory-sprint2.5/scripts/sprint39-dev-retrieval-eval.mjs) on the identical frozen `653ea07` source snapshot across `DEVELOPMENT` (21), `SPRINT25_DEVELOPMENT` (21), and `Combined Dev` (42):

| Metric | Combined Dev Before (`653ea07`) | Combined Dev After (HEAD) | Delta | `SPRINT25_DEV` Before -> After |
|---|---:|---:|---:|---:|
| Raw `precision@5` / `recall@5` / `MRR` | 0.4818 / 0.7856 / 0.8977 | 0.4818 / 0.7856 / 0.8977 | 0.0000 | 0.5818 / 0.5712 / 0.8409 (unchanged) |
| **Grounded `precision@5`** | **0.4091** | **0.4545** | **+0.0454** | **0.4727 -> 0.5636 (+0.0909)** |
| **Grounded macro `recall@5`** | **0.6856** (`45/77`) | **0.7303** (`50/77`) | **+0.0447 (+5 files)** | **0.4621 -> 0.5515 (+0.0894)** |
| **Grounded `MRR`** | **0.7879** | **0.8977** | **+0.1098** | **0.6818 -> 0.8409 (+0.1591)** |
| **Grounded Top-1 Hit Rate** | **0.6364** (`14/22`) | **0.8182** (`18/22`) | **+0.1818** | **0.4545 -> 0.7273 (+0.2728)** |
| Duplicates in top-5 | 0 | 0 | 0 | 0 -> 0 |
| Explicit relationship check | `SUPPORTED` (`1` rel / `3` claims) | `SUPPORTED` (`1` rel / `3` claims) | Preserved | — |
| Unsupported candidate rate | 0.1905 | 0.1905 | 0.0000 | 0.2381 -> 0.2381 |
| Answerable candidate coverage | 1.0000 | 1.0000 | 0.0000 | 1.0000 -> 1.0000 |
| Unsupported assertions | 0 | 0 | 0 | 0 -> 0 |
| Forgotten leaks / Stale leaks | 0 / 0 (`22/22` flagged) | 0 / 0 (`22/22` flagged) | 0 | 0 / 0 |
| Latency `p50` / `p95` (`210` samples) | 19.66 / 37.14 ms | **18.31 / 34.98 ms** | **-1.35 / -2.16 ms** | 18.97/37.20 -> 19.94/35.72 ms |

**Per-query dev breakdown (`42` queries)**: **8 queries improved** (`+5` relevant files gained: `src/memory/taskLedger.ts`, `tests/seeding.test.ts`, `src/harness/taskContext.ts`, `src/memory/hybridSearch.ts`, `tests/autoCommit.test.ts`; **0 relevant files lost**; 4 queries jumped from MRR `0.33–0.50` to `1.00`, including exact-path query #10 `0.3333 -> 1.0000`). Only 1 query (`#41`, Architecture boundaries) shifted MRR (`0.50 -> 0.25`) with identical hit count (`1 -> 1`) and 0 files lost.

---

## 5. Frozen Release Evaluation (Run Once, Untuned)

Executed unchanged `node scripts/repository-task-eval.mjs` (`83` real source files / `84` records, `30` `HELD_OUT` queries) once as the formal assessment:

| Frozen Metric | Before (`653ea07`) | After Sprint 3.9 | Original Gate | Status |
|---|---:|---:|---:|:---:|
| Raw `precision@5` / `recall@5` / `MRR` | 0.4700 / 0.7208 / 0.8750 | 0.4700 / 0.7208 / 0.8750 | `>= 0.50` / `>= 0.85` | Fail |
| **Grounded `precision@5`** | 0.4200 | **0.4400 (+0.0200)** | `>= 0.50` | Fail |
| **Grounded `recall@5`** | 0.6417 (`42/66`) | **0.6708 (+0.0291, `44/66`)** | `>= 0.85` | Fail |
| **Grounded `MRR`** | 0.8292 | **0.8750 (+0.0458)** | — | Improved |
| Grounded `supportedAnswerCoverage` | 0 (`0/20`) | 0 (`0/20`) | `> 0` | Fail |
| Unsupported grounded assertions / No-answer FP | 0 / 0 | 0 / 0 | `<= 1` | Pass |
| Forgotten leaks / Stale leaks (`20/20` flagged) | 0 / 0 | 0 / 0 | `=== 0` | Pass |
| Grounded search `p50` / `p95` (`150` samples) | 20.09 / 33.26 ms | **18.62 / 30.76 ms** | `< 100 ms` | Pass |
| Overall `passed` (exit code) | `false` (exit `1`) | **`false` (exit `1`)** | `true` | **NO-GO** |

*(On the exact 82-file `7ddba87` snapshot in `sprint37-grounding-bench.mjs` `afterSameCorpus`, grounded `precision@5` improved `0.42 -> 0.45`, grounded `recall@5` improved `0.6417 -> 0.6875` (`45/66`), and grounded `MRR` improved `0.8292 -> 0.8750`, with `0` safety/contract diffs across all 30 queries and `9/9` packed-tarball MCP checks passing.)*

---

## 6. CI Workflow Audit and Separation Fix

- **Confirmed workflow defect**: In Sprint 3.8, adding the non-optional `release-readiness` job to `.github/workflows/ci.yml` (`on: [push: [main, master], pull_request]`) caused every ordinary development PR CI run to fail unconditionally because `npm run release:preflight` fails while official release gates are red.
- **Smallest safe fix**:
  - [.github/workflows/ci.yml](file:///C:/Users/singa/Desktop/hypermemory-sprint2.5/.github/workflows/ci.yml): Removed `release-readiness` from PR/branch development CI so the 9-lane `test` matrix (`ubuntu-latest`, `windows-latest`, `macos-latest` × Node `20`, `22`, `24`) gives actionable pass/fail feedback for ordinary code changes.
  - [.github/workflows/release.yml](file:///C:/Users/singa/Desktop/hypermemory-sprint2.5/.github/workflows/release.yml): Added `workflow_dispatch:` alongside `push: tags: ['v*']` so maintainers can trigger mandatory fail-closed 3-OS release-gate verification (`npm run release:preflight`, no `continue-on-error: true`) on demand, while guarding the tag-version check and the `publish` job with `if: github.event_name == 'push' && github.ref_type == 'tag'` + `needs: gates`.
  - Updated [tests/releasePreflight.test.ts](file:///C:/Users/singa/Desktop/hypermemory-sprint2.5/tests/releasePreflight.test.ts) (`11/11` passing) to enforce this separation automatically.
  - `package.json` `prepublishOnly` continues to execute `npm run release:preflight` and block local publishing (`RELEASE BLOCKED — NO-GO`, exit `1`). Remote GitHub Actions remains unverified until pushed/run remotely.

---

## 7. Packaging Review (`dist/eval/*`)

- Audited [src/index.ts](file:///C:/Users/singa/Desktop/hypermemory-sprint2.5/src/index.ts) and [src/cli/evalCommand.ts](file:///C:/Users/singa/Desktop/hypermemory-sprint2.5/src/cli/evalCommand.ts): only `dist/eval/memoryBench.*` and `dist/eval/tokenEfficiency.*` are required by public library exports and `hypersabmemory eval`.
- Updated `package.json` `"files"` with negations `!dist/eval/repositoryBaseline.*`, `!dist/eval/repositoryTaskEvaluation.*`, `!dist/eval/repositoryTaskFixture.*`, and `!dist/eval/sprint25DevelopmentFixture.*`, and added a guard test in [tests/packageMetadata.test.ts](file:///C:/Users/singa/Desktop/hypermemory-sprint2.5/tests/packageMetadata.test.ts).
- Verified via `npm pack --dry-run --json` and `npm run package:smoke`:
  - Tarball reduced from **`183` files (`195.8 kB`) to `167` files (`176.9 kB`)** (`-16` internal eval files, `-18.97 kB`), with zero credentials or untracked dev files packed.
  - Local `dist/eval/*` still builds cleanly so local `eval:baseline`, `repository-task-eval`, `release:preflight`, `option-b-shadow-eval`, and `prepublishOnly` remain unaffected.

---

## 8. Option B Readiness Update & Full Test Summary

- **Option B implications (building on Sprint 3.8 governance)**: Grounded MRR now matches raw MRR (`0.8750` on `HELD_OUT`, `0.8977` on combined dev), top-1 accuracy on dev rose `+18.2` percentage points (`63.6% -> 81.8%`), and grounded top-5 recall improved on both dev (`+0.0447`) and frozen `HELD_OUT` (`+0.0291`). However, grounded `recall@5` (`0.6708`) still omits ~33% of relevant files in top-5 and `noAnswerCandidateRate` remains `40%` (`4/10`). Option B remains **unapproved** (`authorizesRelease: false`).
- **Full Sequential Verification**:
  - `npm.cmd test`: **PASS** (`45` test files, `307` tests)
  - `npx.cmd tsc --noEmit`: **PASS**
  - `npm.cmd run build`: **PASS**
  - `npm.cmd run eval`: **PASS** (`8/8`)
  - `npm.cmd run eval:baseline`: **PASS** (`passed: true`, `p95: 2.39 ms`)
  - `npm.cmd run package:smoke`: **PASS** (`167`-file trimmed tarball installs and passes all CLI/MCP checks)
  - `node scripts/sprint36-handoff-bench.mjs`: **PASS** (`p95: 16.71 / 15.76 ms`)
  - `node scripts/sprint37-grounding-bench.mjs`: **PASS** (`30/30` contract/safety parity with `0` contract diffs, pooled `p50: 19.24 ms / p95: 37.46 ms`, `9/9` MCP regression checks)
  - `node scripts/sprint39-dev-retrieval-eval.mjs`: **PASS** (`+5` dev hits, `+0.1098` MRR, `0` lost files)
  - `node scripts/repository-task-eval.mjs`: **`passed: false` (exit `1`)**
  - `npm.cmd run release:preflight`: **`RELEASE BLOCKED — NO-GO` (exit `1`, `p95: 30.88 ms`)**
  - `npm.cmd run eval:option-b:shadow`: `authorizesRelease: false`, `officialReleaseStatus: "NO-GO"` (exit `0`)

---

## 9. Local Commits & Remaining Blockers

- `531b1f0` — `fix(search): improve bounded project evidence ranking`
- `bdb9cfa` — `ci: separate development checks from mandatory release readiness`
- Commit 3 — `build: exclude internal evaluation artifacts from published package` (`package.json`, `tests/packageMetadata.test.ts`, `docs/SPRINT_3_9_RETRIEVAL_READINESS.md`)

**Remaining Blockers Before Any Release**:
1. Product-owner decision between Option A and Option B (including ratified bounded retrieval thresholds).
2. Raw retrieval recall ceiling (`0.7208` on `HELD_OUT`) and unanswerable candidate rate (`40%`) plus broad synthesis (`0/20` under Option A).
3. Remote Linux/Windows/macOS GitHub Actions verification (native `better-sqlite3` portability) and repository/registry publish-permission hardening.

**Sprint 3.9 Decision**: Engineering objectives **COMPLETED**. Product release remains **NO-GO**.
