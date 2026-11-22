# HyperSABMemory Sprint 4.3 — Evidence Reliability and Developer-Preview Exit Criteria

**Product Release Status**: `NO-GO` (`scripts/release-preflight.mjs` fails closed, exit `1`)

**Option B Governance Status**: `UNAPPROVED` (candidate framework only; does not authorize release)

---

## 1. Starting Git State & Workspace Preservation

- **Repository / Worktree**: `C:\Users\singa\Desktop\hypermemory-sprint2.5`
- **Branch**: `feature/sprint2.5-20261106`
- **Starting HEAD**: `e793844422acf571763469a9bd9e7f12c18abb22` (`test(worktree): add installed-package worktree validation and Sprint 4.2 report`)
- **Pre-existing working-tree modification preserved untouched and unstaged**: `src/hooks/autoCommit.ts` (pre-existing 1-byte UTF-8 BOM removal diff present prior to Sprint 4.3)
- **Pre-existing untracked artifacts preserved** (`10` files untouched): `CLEANUP-RESULTS.md`, `cleanup-inventory.md`, `code-cleanup-audit.md`, `docs/V2_BASELINE.md`, `docs/V2_RESEARCH_AND_SPRINT.md`, `scheduled-tasks-audit.md`, `scheduled-tasks-inventory.csv`, `scheduled-tasks-triage.csv`, `scripts/cleanup-dry-run.ps1`, `scripts/cleanup-safe.ps1`.
- **Sibling maintenance worktrees preserved at `592f054`**:
  - `C:/Users/singa/Desktop/hypermemory` (`[audit/cleanup-20261105]`)
  - `C:/Users/singa/Desktop/hypermemory-cleanup-isolated` (`[maintenance/cleanup-isolated-20261106]`)
  - `C:/Users/singa/Desktop/hypermemory-dependency-review` (`[maintenance/dependency-review-20261106]`)

---

## 2. Reproduced Parameterized Test Attribution Gap (`antfu-collective/ni`)

On pinned `antfu-collective/ni` (`71e261fd497c9e5f7bc925267ff249f5b9f9bc14`):

- `src/catalog/spec.ts:29-39` exports `isVerbatimSpec(spec: string): boolean`.
- `test/programmatic/catalog-spec.spec.ts:2,45-54` imports `isVerbatimSpec` from `../../src/catalog/spec` and invokes `expect(isVerbatimSpec(spec)).toBe(...)` inside two curried Vitest `it.each` calls:
  - Line 48: `it.each(verbatim)('keeps %s as typed', ...)`
  - Line 52: `it.each(['latest', 'next', 'beta', 'canary'])('resolves the dist-tag %s', ...)`
- **Before fix (`e793844`)**: `collectImplementationEvidence` in [src/memory/implementationEvidence.ts](../src/memory/implementationEvidence.ts) only recognized direct `it(name, cb)` / `test(name, cb)` `CallExpression` nodes where `expr.expression` was an identifier. Against `ni`'s `isVerbatimSpec` case (`ni_isverbatim_param`), it returned `linkedTestsCount: 0` (`linkedTestNames: []`, `responseBytes: 869`), even though the implementation symbol was verified and the parameterized Vitest file structurally imported and exercised it.

---

## 3. Production Fix 1 — Curried & Tagged-Template Parameterized Tests (`e7235df`)

Implemented in commit `e7235df7580bcc7443c703ed332c9ba3673c774d` (`fix(evidence): support structurally linked parameterized tests`):

- **[src/memory/implementationEvidence.ts](../src/memory/implementationEvidence.ts)**:
  - Exported `ImplementationEvidenceDiagnostics` (`{ astParsed: number; tsProgramsCreated: number; cacheHit: boolean }`) and added an optional third `diagnostics` parameter to `collectImplementationEvidence` for cache/parser cost observability.
  - Added `resolveTestCall` to inspect `CallExpression` test invocations across:
    1. Direct calls: `it(name, cb)` and `test(name, cb)` (`'vitest'` and `'node:test'`).
    2. Curried table calls: `it.each(data)(name, cb)` and `test.each(data)(name, cb)` (`'vitest'`-only for `.each`, requiring `innerCall.arguments.length >= 1`).
    3. Tagged-template table calls: ``it.each`...`(name, cb)`` and ``test.each`...`(name, cb)`` (`'vitest'`-only for `.each`, requiring string literal or no-substitution template literal `name` and arrow/function callback `cb`).
  - Preserved all TypeScript AST + TypeChecker safeguards (`imported()` declaration symbol binding, module path verification, named-import alias resolution, `import type` exclusion, local parameter/block shadowing rejection, duplicate binding rejection, and `execution: 'unverified'`). Dynamic test execution and pass/fail status remain unverified and honestly labeled.
- **[tests/implementationEvidence.test.ts](../tests/implementationEvidence.test.ts)** (`21/21` passing) and **[tests/groundedSearch.test.ts](../tests/groundedSearch.test.ts)** (`36/36` passing):
  - Added RED-first regressions covering `ni`'s `it.each` `isVerbatimSpec` pattern, aliased imports inside `it.each`, `RateTable.rate` curried calls, tagged-template ``test.each`...` ``, and full `searchGrounded` integration (`execution: 'unverified'`).
  - Verified `9` negative parameterized safeguard cases return `[]`: unimported identifiers, shadowed callback parameters (`(isVerbatimSpec) => ...`), block-scoped inner shadowing (`const isVerbatimSpec = ...`), property/namespace-shadowed calls, `import type` bindings inside `it.each`, empty `it.each()(name, cb)` argument lists, `node:test` `.each` calls (unsupported for `node:test`), dynamic computed test titles, and duplicate conflicting target declarations.

---

## 4. Independent Project Parameterized Test & False-Link Results

Executed [scripts/sprint40-independent-eval.mjs](../scripts/sprint40-independent-eval.mjs) against a freshly packed offline install (`hypersabmemory@1.4.1`, `188,543 B` tarball, `npm_config_offline=true`):

- **`antfu-collective/ni` (`71e261fd`)**:
  - `ni_spec_impl_and_test` (`parsePackageSpec`): `codeFound: true`, `testLinked: true`, `4` direct tests linked in `test/programmatic/catalog-spec.spec.ts` (lines `6, 10, 18, 25`), `execution: "unverified"`, `shaMatch: true`, `latencyMs: 193.75 ms`.
  - `ni_isverbatim_impl_and_test` (`isVerbatimSpec`): `codeFound: true`, `testLinked: true`, `2` parameterized tests linked in `test/programmatic/catalog-spec.spec.ts` (`"keeps %s as typed"` line `48`, `"resolves the dist-tag %s"` line `52`), `execution: "unverified"`, `shaMatch: true`, `latencyMs: 52.60 ms`.
  - `ni_detect_code` (`detect`): `codeFound: true`, `callSites: 5`, `allReturnedTests: []`, `latencyMs: 56.44 ms`.
  - Safety negative probes on `ni`: `shadowedImportRejected: true` and `parameterizedFalseLinksRejected: true` (both callback-parameter shadowed `isVerbatimSpec` inside `it.each` and `import type` inside `it.each` rejected).
  - Overall `ni` retrieval: `precisionAt5: 0.2857`, `macroRecallAt5: 1.0000`, `MRR: 0.8333`, `top1SuccessRate: 0.7143`, `sourceAttributionValid: 38/38`, `noAnswerUnsupportedAssertions: 0`.
- **`tj/commander.js` (`a5a7dc08`)**:
  - `cmd_usecolor_impl_and_test` (`useColor`): `codeFound: true`, `testLinked: true`, `4` `node:test` / `node:assert` tests linked in `tests/useColor.test.js` (lines `28, 38, 43, 50`), `execution: "unverified"`, `shaMatch: true`, `latencyMs: 261.36 ms`.
  - `cmd_dualoptions_impl_and_test` (`DualOptions.valueFromOption`): `codeFound: true`, `testLinked: true`, `4` tests linked in `tests/options.dual-options.test.js` (lines `55, 60, 65, 70`), `execution: "unverified"`, `shaMatch: true`, `latencyMs: 56.39 ms`.
  - `cmd_suggest_code` (`suggestSimilar`): `codeFound: true`, `callSites: 1`, `latencyMs: 10.53 ms`.
  - Safety negative probe on `commander`: `shadowedImportRejected: true`.
  - Overall `commander` retrieval: `precisionAt5: 0.3143`, `macroRecallAt5: 0.9286`, `MRR: 1.0000`, `top1SuccessRate: 1.0000`, `sourceAttributionValid: 50/50`, `noAnswerUnsupportedAssertions: 0`.

---

## 5. Unanswerable Candidate Noise Analysis & Classification Fix (`8f44a10`)

### Reproduced Contract Problem

Testing unanswerable queries against pinned `ni` through live MCP (`hypersabmemory_query_evidence`) before fixing showed that:

- A query with no repository support (`'Which PostgreSQL schema migration runner does ni use for version tracking?'`) returned `"status": "evidence_found"` and `"answerVerified": false` alongside a backfilled `candidate_excerpt` item carrying `verification: "insufficient_evidence"` and `lexicalSupport: 0`.
- At the top-level MCP tool contract, `"status": "evidence_found"` was therefore returned identically for verified answers (`canAssert: true`), source-excerpt matches without claims, weak lexical candidates (`lexicalSupport: 0`), memory-only matches without source excerpts, and conflicting evidence — creating ambiguous agent-facing signaling whenever callers checked `status` without inspecting nested `candidate_excerpt` / `grounded.status` fields.

### Production Fix (`8f44a10dbb84ed36259133374da2e1296f24de4a`, `fix(mcp): classify unverified and weak candidate evidence explicitly`)

- Exported `EvidenceClassification` (`'verified_answer' | 'unverified_source_evidence' | 'weak_lexical_candidates' | 'memory_only_no_source_evidence' | 'stale_evidence' | 'conflicting_evidence' | 'insufficient_evidence'`), `ClassifyQueryEvidenceInput`, and `classifyQueryEvidence` from [src/mcp/server.ts](../src/mcp/server.ts).
- Updated `hypersabmemory_query_evidence` to return additive structured fields:
  - `evidenceClassification`
  - `evidenceSummary`: `{ groundedStatus, verifiedAssertions, groundedSourceExcerpts, weakCandidateExcerpts, staleSources }`
  - `conflictPaths` (when conflicts are present)
  - Classification-specific `limitations` messages distinguishing verified claims, unverified source excerpts, weak lexical candidates, memory-only hits, stale sources, conflicts, and empty results.
- Preserved backward compatibility: legacy `status`, `answerVerified`, `canAssert`, candidate selection/backfill behavior, MCP `inputSchema`, and frozen evaluators remain unchanged. Verified via [tests/mcpQuery.test.ts](../tests/mcpQuery.test.ts) (`12/12`), [tests/groundedSearch.test.ts](../tests/groundedSearch.test.ts) (`36/36`), and [tests/mcpResources.test.ts](../tests/mcpResources.test.ts) (`4/4`).

### Independent Repo Unanswerable Outcomes (`6` Queries)

Across all `6/6` unanswerable queries in [scripts/sprint40-independent-eval.mjs](../scripts/sprint40-independent-eval.mjs), `answerVerified` was `false`, `assertionsCount` was `0`, and `noAnswerUnsupportedAssertions` was `0`:

| Repo | Query ID | Legacy `status` | New `evidenceClassification` | `groundedSourceExcerpts` | `weakCandidateExcerpts` | `recordCount` |
| --- | --- | --- | --- | ---: | ---: | ---: |
| `ni` | `ni_unans_redis` | `insufficient_evidence` | `insufficient_evidence` | `0` | `0` | `0` |
| `ni` | `ni_unans_k8s` | `evidence_found` | `memory_only_no_source_evidence` | `0` | `0` | `1` |
| `ni` | `ni_unans_pg` | `evidence_found` | `weak_lexical_candidates` | `0` | `3` | `3` |
| `commander` | `cmd_unans_graphql` | `evidence_found` | `weak_lexical_candidates` | `0` | `5` | `5` |
| `commander` | `cmd_unans_oauth` | `evidence_found` | `weak_lexical_candidates` | `0` | `5` | `5` |
| `commander` | `cmd_unans_sqlite` | `evidence_found` | `unverified_source_evidence` | `2` | `3` | `5` |

Notably, `cmd_unans_sqlite` (`"What SQLite write-ahead log checkpoint threshold does Commander enforce?"`) surfaces `2` `source_excerpt` entries in `commander` files with `lexicalSupport >= 1` because `"Commander"` matches indexed files despite SQLite WAL not existing in the codebase; `evidenceClassification: "unverified_source_evidence"` explicitly communicates that no claim was verified (`verifiedAssertions: 0`, `answerVerified: false`) while honestly reflecting the lexical vs. semantic boundary.

---

## 6. Performance Benchmark (`scripts/sprint43-evidence-bench.mjs`)

Matched before (`e793844`) vs. after (`HEAD`) benchmark on Windows 11 (`win32 x64`, Node `v22.14.0`, installed `hypersabmemory@1.4.1`).

*Measurement caveat*: `coldDiagnostics` (`astParsed`, `tsProgramsCreated`) was introduced in commit `e7235df`; baseline `e793844` reports `0` only because it lacked the `diagnostics` output parameter, not because `e793844` performed zero parses.

### In-Process `collectImplementationEvidence` (Before `e793844` vs. After `HEAD`)

| Case | Baseline (`e793844`) Linked | After (`HEAD`) Linked | Cold ms (Before -> After) | Warm Cached `n=50` p50/p95 ms (Before -> After) | Warm Uncached `n=20` p50/p95 ms (Before -> After) | After Cold `astParsed` / `tsProgramsCreated` | Bytes (Before -> After) |
| --- | ---: | ---: | --- | --- | --- | --- | ---: |
| `ni_isverbatim_param` | `0` | `2` (`unverified`) | `121.12 -> 111.63` | `0.024/0.143 -> 0.014/0.128` | `12.338/17.843 -> 13.414/19.461` | `4 / 1` (`20 / 20` over 20 uncached) | `869 -> 3128` |
| `ni_parsespec_direct` | `4` | `4` (`unverified`) | `10.45 -> 10.72` | `0.027/0.069 -> 0.017/0.047` | `9.908/16.995 -> 8.880/14.245` | `1 / 1` (`20 / 20` over 20 uncached) | `5858 -> 5858` |
| `commander_usecolor_node_assert` | `4` | `4` (`unverified`) | `208.11 -> 234.87` | `0.052/0.168 -> 0.037/0.107` | `10.070/13.677 -> 10.482/15.558` | `5 / 1` (`20 / 20` over 20 uncached) | `5123 -> 5123` |
| `commander_dualoptions_node_assert` | `4` | `4` (`unverified`) | `10.40 -> 9.89` | `0.028/0.038 -> 0.028/0.045` | `11.842/13.613 -> 9.542/12.444` | `1 / 1` (`20 / 20` over 20 uncached) | `5477 -> 5477` |

False links observed across both repos: `0` before, `0` after.

### Installed-Package Offline MCP Latency (`hypersabmemory@1.4.1`, `HEAD`)

| Repo | Category | Cold First Call `n=3` p50 / p95 (ms) | Warm `n=50` p50 / p95 (ms) | Linked Tests | Response Bytes |
| --- | --- | --- | --- | ---: | ---: |
| `ni` | `parameterizedTest` (`isVerbatimSpec`) | `126.36 / 140.39` | `7.71 / 9.32` | `2` | `7445` |
| `ni` | `directTest` (`parsePackageSpec`) | `148.28 / 158.19` | `12.18 / 14.86` | `4` | `11679` |
| `ni` | `ordinarySource` | `40.27 / 40.63` | `10.96 / 13.51` | `0` | `4911` |
| `commander` | `nodeAssertTest` (`useColor`) | `279.78 / 294.54` | `14.18 / 18.62` | `4` | `10949` |
| `commander` | `ordinarySource` | `60.52 / 70.27` | `12.96 / 16.79` | `0` | `5112` |

---

## 7. Cross-Platform Verification & Unverified Platforms

| Environment | Commands Executed | Exact Observed Results |
| --- | --- | --- |
| **Windows 11 (`win32 x64`, Node `v22.14.0`, npm `10.9.2`, Git `2.47.1.windows.1`, NTFS)** | Full `16`-command sequential matrix (see §8) | `s01`–`s13` and `s16` exited `0`; `s14` (`repository-task-eval.mjs`) and `s15` (`release:preflight`) exited `1` (expected frozen failures). Full Vitest suite: `48/48` files, `341/341` tests passed (`86.51s`). Tarball `hypersabmemory@1.4.1`: `188.5 kB` / `850.0 kB` unpacked / `171` files. *Concurrency observation*: An earlier run of `sprint40-independent-eval.mjs` executed concurrently with WSL2 Ubuntu Linux VM verification aborted during installed `cli setup` with V8 `NewSpace::EnsureCurrentCapacity Allocation failed - JavaScript heap out of memory` (`exit 134`); run standalone in the sequential pass, `sprint40-independent-eval.mjs` completed cleanly in `47563 ms` (`exit 0`). |
| **Linux (`WSL2 Ubuntu`, `Linux 6.6.87.2-microsoft-standard-WSL2 x86_64`, Node `v24.14.1`, npm `11.11.0`, Git `2.43.0`, native `ext4`)** | `npm ci`, `npx tsc --noEmit`, `npm run build`, `npm test`, focused Sprint 4.3 `vitest`, `npm run eval`, `npm run eval:baseline`, `npm run package:smoke`, `node scripts/sprint42-worktree-eval.mjs` inside ephemeral `/tmp/hm-sprint43-linux-Q0IG7f` (cleaned on exit) | **All `9` commands exited `0`**: `npm ci` (`181` packages in `12s`, `better-sqlite3` operational on Node 24 Linux x64); `tsc` clean; `build` clean; `npm test` `48/48` files / `341/341` tests (`48.65s`); focused Vitest (`implementationEvidence`, `groundedSearch`, `mcpQuery`) `3/3` files / `69/69` tests (`2.08s`); `eval` (`memorybench`) `1/1` file / `8/8` tests (`824ms`); `eval:baseline` `passed: true` (`p50/p95: 0.804/1.634 ms`); `package:smoke` `188.5 kB` / `850.2 kB` / `171` files (`code` `6.392/9.795 ms`, `code-and-test` `5.517/6.765 ms`, `unsupported` `5.380/6.877 ms`); `sprint42-worktree-eval` `passed: true` (all `15` checks including POSIX `crossWorktreeSymlinkTested: true` and `caseSensitiveDistinctDocsTested: true`). |
| **Unverified Platforms (Explicitly Reported)** | Not executed locally or remotely | **`macos-latest`**, **Node `20`** across all OSes, **Linux Node `22`**, **Windows Node `24`**, and **remote GitHub Actions CI workflows** ([.github/workflows/ci.yml](../.github/workflows/ci.yml), [.github/workflows/release.yml](../.github/workflows/release.yml)) remain **unverified** (remote push/publish prohibited). |

---

## 8. Full Sequential Windows Verification Matrix (`win32 x64`, Node `v22.14.0`)

| # | Command | Process Exit | Structured `passed` / Key Observed Outcome |
| --- | --- | ---: | --- |
| 1 | `npm.cmd test` | `0` | `48/48` test files, `341/341` tests passed (`86.51s`), including `implementationEvidence` (`21`), `groundedSearch` (`36`), `mcpQuery` (`12`) |
| 2 | `npx.cmd tsc --noEmit` | `0` | `0` TypeScript errors (`6537.5 ms`) |
| 3 | `npm.cmd run build` | `0` | Clean build (`6798.3 ms`) |
| 4 | `npm.cmd run eval` | `0` | `tests/memorybench.test.ts`: `1/1` file, `8/8` tests passed (`3.46s`) |
| 5 | `npm.cmd run eval:baseline` | `0` | `passed: true` (`500` records / `493` distractors, `recallAt5: 1`, `MRR: 1`, `staleLeaks: 0`, `precisionGateValid: false`, `p50/p95: 1.342/2.150 ms`, `estimatedTokens: 243`) |
| 6 | `npm.cmd run package:smoke` | `0` | `188.5 kB` tarball / `850.0 kB` unpacked / `171` files, `code` p50/p95 `37.95/43.42 ms`, `code-and-test` `39.84/55.46 ms`, `unsupported` `32.73/42.57 ms`, Sprint 3.1 handoff passed |
| 7 | `node scripts/sprint36-handoff-bench.mjs` | `0` | `matrixPassed: true`; compact one-call p50/p95 `10.55/15.08 ms` (`-66.1%`) & `11.24/18.58 ms` (`-65.9%`) |
| 8 | `node scripts/sprint37-grounding-bench.mjs` | `0` | `9/9` MCP regression checks passed; alternating `after` (`450` samples) p50 `18.38 ms` / p95 `33.55 ms`; `repositoryTaskEvalComparison.after` `passed: false`, p50 `14.61 ms` / p95 `24.53 ms` |
| 9 | `node scripts/sprint39-dev-retrieval-eval.mjs` | `0` | `combinedDev42` grounded `P@5: 0.4545`, `R@5: 0.7303`, `MRR: 0.8977`, `top1HitRate: 0.8182`, `staleProbe.leaks: 0` (`22/22` flagged), `forgottenLeaks: 0`, `p50/p95: 14.27/26.51 ms` |
| 10 | `node scripts/sprint40-independent-eval.mjs` | `0` | `ni` (`R@5 1.0000`, `MRR 0.8333`, `38/38` attribution, `2/2` parameterized tests linked, `parameterizedFalseLinksRejected: true`) & `commander` (`R@5 0.9286`, `MRR 1.0000`, `50/50` attribution, `shadowedImportRejected: true`), `0` unsupported assertions across `6/6` unanswerable queries |
| 11 | `node scripts/sprint41-mcp-latency-profile.mjs` | `0` | Warm MCP p50/p95: `19.79/23.33` (`ni` ord), `17.08/22.22` (`ni` JSON), `19.76/24.10` (`ni` impl); `20.70/25.00` (`cmd` ord), `7.55/9.03` (`cmd` JSON), `11.14/14.75 ms` (`cmd` impl) |
| 12 | `node scripts/sprint42-worktree-eval.mjs` | `0` | `passed: true` (worktree containment, offline restart, compact restore, provenance, same-size rewrite, forgetting, main isolation) |
| 13 | `node scripts/sprint43-evidence-bench.mjs` | `0` | `ni_isverbatim_param` `0 -> 2` linked tests (`0` false links), warm cached p50 `0.014 ms`, MCP parameterized cold/warm p50 `126.36 / 7.71 ms`; `commander` `4 -> 4` linked tests (`0` false links) |
| 14 | `node scripts/repository-task-eval.mjs` | `1` *(expected)* | `passed: false` (frozen contract; `88` records / `87` real files): raw `P@5: 0.4800`, `R@5: 0.7375`, `MRR: 0.8750`, `noAnswerFalsePositives: 9`; grounded `P@5: 0.4500`, `R@5: 0.6917`, `MRR: 0.8750`, `noAnswerCandidateRate: 0.4000`, `supportedAnswerCoverage: 0`, `unsupportedAssertions: 0`, `forgottenLeaks: 0`, `staleProbe.leaks: 0` (`20/20`), `p50/p95: 14.22/23.31 ms` |
| 15 | `npm.cmd run release:preflight` | `1` *(expected)* | `Verdict: RELEASE BLOCKED — NO-GO`, `Eligible for publication: NO` (`5` failing / `7` passing frozen criteria; `latencyMs.p95: 22.3242 ms`) |
| 16 | `npm.cmd run eval:option-b:shadow` | `0` | `mode: SHADOW_CANDIDATE_INFORMATIONAL_ONLY`, `authorizesRelease: false`, `officialReleaseStatus: NO-GO`, `candidateContractPassing: false` (`repositoryTaskEval p50/p95: 14.55/22.88 ms`) |

---

## 9. Frozen Release Gate Status (`NO-GO`)

[src/eval/repositoryTaskEvaluation.ts](../src/eval/repositoryTaskEvaluation.ts), [src/eval/repositoryTaskFixture.ts](../src/eval/repositoryTaskFixture.ts), `release:preflight`, and `prepublishOnly` remain **untouched and fail-closed**:

- **Failing frozen criteria (`5/12`)**:
  - `retrieval.precisionAt5`: observed `0.4800`, required `>= 0.5`
  - `retrieval.recallAt5`: observed `0.7375`, required `>= 0.85`
  - `grounded.recallAt5`: observed `0.6917`, required `>= 0.85`
  - `grounded.precisionAt5`: observed `0.4500`, required `>= 0.5`
  - `grounded.supportedAnswerCoverage`: observed `0`, required `> 0`
- **Passing frozen criteria (`7/12`)**: `retrieval.maximumPrecisionAt5: 0.6600`, `grounded.noAnswerFalsePositives: 0`, `retrieval.forgottenLeaks: 0`, `methodology.staleSourceTested: true`, `staleProbe.leaks: 0`, `latencyMs.samples: 150`, `latencyMs.p95: 22.3242 ms`.

---

## 10. Developer-Preview Exit-Criteria Decision Record (`Option B UNAPPROVED`)

### Category Separation

1. **Verified locally**:
   - Deterministic evidence linking (symbols, nested/root JSON scalars, explicit Decision-Source links, direct/curried/tagged-template Vitest tests, `node:test`/`node:assert` tests) with current SHA-256 provenance and `execution: "unverified"` honesty.
   - Freshness (same-size rewrite detection), forgotten-memory exclusion, declared-conflict abstention, and workspace/worktree path + symlink containment.
   - Additive MCP `evidenceClassification` separating verified claims, unverified source excerpts, weak lexical candidates, and memory-only hits while preserving `canAssert: false` on unsupported queries.
   - Offline installed-package (`hypersabmemory@1.4.1`) setup, zero-commit discipline, `compact: true` task restoration, git worktree isolation, and Linux `ext4` (`WSL2 Ubuntu`, Node `v24.14.1`) + Windows 11 (`win32 x64`, Node `v22.14.0`) execution.
2. **Still requiring evidence**:
   - **Cross-platform CI**: `macos-latest`, Node `20` (all OSes), Linux Node `22`, Windows Node `24`, and remote GitHub Actions workflows (`.github/workflows/ci.yml`, `.github/workflows/release.yml`).
   - **Product-owner decision on bounded top-5 retrieval thresholds**: Frozen `repositoryTaskEvaluation` grounded `R@5` is `0.6917` (target `0.85`), `P@5` is `0.4500` (target `0.50`), and `supportedAnswerCoverage` is `0` (`noAnswerCandidateRate: 0.4000`). Product owner must decide whether to replace those frozen thresholds with a formal Option B contract or require further retrieval work.
   - **Multi-task end-to-end agent evaluation**: Historical Sprint 3.5 (`n = 2` tasks) and Sprint 4.0 Commander (`n = 1` manual session) sample sizes are too small to validate general agent improvement.
3. **Not an intended core guarantee under proposed Option B**:
   - Free-form semantic answer synthesis over arbitrary unstructured prose (`supportedAnswerCoverage > 0` on open-ended architecture questions).
   - Runtime test-execution pass/fail certification (`it.each` / `node:test` linking proves structural import+call correspondence only; `execution` intentionally remains `"unverified"`).
   - Zero weak-candidate lexical overlap when an unanswerable question shares repository keywords (e.g., `"Commander"` in `cmd_unans_sqlite`), mitigated operationally via `evidenceClassification` and `answerVerified: false` rather than candidate suppression.

### Exit-Criteria Decision Table

| Capability | Evidence | Risk | Proposed acceptance requirement | Verification status | Release impact |
| --- | --- | --- | --- | --- | --- |
| Deterministic claim verification & provenance (`canAssert`, `sha256`, `line`) | `tests/groundedSearch.test.ts` (`36/36`), `tests/implementationEvidence.test.ts` (`21/21`), `ni` & `commander` exact JSON/symbol checks (`38/38`, `50/50`), `package:smoke` | Claiming unverified prose or wrong JSON nesting depth | `0` unsupported assertions on held-out eval & `100%` pass on deterministic regression suite | **Verified locally** (Win Node 22 + Linux Node 24) | Meets candidate harness standard (`PROPOSED_CANDIDATE`) |
| Parameterized & `node:test` impl-to-test linking (`execution: 'unverified'`) | `e7235df`, `ni` (`isVerbatimSpec` `2` tests), `commander` (`useColor` `4` tests), `9` negative safeguard tests + live shadowed/`import type` probes (`0` false links) | Over-linking shadowed/`type` imports or implying dynamic test pass | Direct + curried/tagged `.each` resolved via TypeChecker value bindings; `0` false links; `execution === 'unverified'` | **Verified locally** (Win Node 22 + Linux Node 24) | Resolves Sprint 4.2 parameterized gap |
| Unverified / weak candidate signaling (`evidenceClassification`) | `8f44a10`, `tests/mcpQuery.test.ts` (`12/12`), `6/6` unanswerable independent queries (`0` unsupported assertions; explicit `weak_lexical_candidates` / `memory_only` / `unverified_source_evidence`) | Agents misreading `status: "evidence_found"` or lexical token overlap (`cmd_unans_sqlite`) as verified proof | `answerVerified: false` on unsupported queries; structured `evidenceClassification` & `evidenceSummary` emitted | **Verified locally** (Win Node 22 + Linux Node 24) | Mitigates ambiguity without changing `canAssert` |
| Freshness, forgetting, conflict & worktree isolation | `repositoryTaskEval` (`staleProbe 20/20`, `forgottenLeaks 0`), `sprint42-worktree-eval` (`passed: true` on Win & Linux ext4 symlink/case-sensitivity) | Stale cache reuse or cross-worktree file escape | `0` stale leaks (including same-size rewrites), `0` forgotten leaks, canonical symlink containment, worktree `info/exclude` & checkpoint isolation | **Verified locally** (Win Node 22 + Linux Node 24) | Meets candidate safety standard |
| Offline setup, MCP handoff (`compact: true`), & query latency | `sprint36-handoff-bench` (`-65.9%` to `-66.1%` bytes), `sprint40`, `sprint41`, `sprint43` (`ni` parameterized MCP warm p50/p95 `7.71/9.32 ms`), `eval` p95 `22.32–24.53 ms` | Setup mutating git/network or violating `< 100 ms` warm latency; V8 NewSpace heap OOM under extreme host memory pressure | Offline direct Node config, `0` setup commits, `repositoryTaskEval` p95 `< 100 ms` | **Verified locally** (note: `setup` OOM observed once during parallel WSL2 host memory stress; passed standalone in `1.9s`) | Meets candidate latency/packaging locally |
| Bounded top-5 retrieval on held-out 30 queries | `repository-task-eval.mjs`: raw `P@5 0.4800` / `R@5 0.7375`, grounded `P@5 0.4500` / `R@5 0.6917`, `noAnswerCandidateRate 0.4000`, `supportedAnswerCoverage 0` | Missing relevant files in top-5 on open-ended repository queries | Product-owner sign-off replacing frozen thresholds (`0.85` / `0.50` / `>0`) with approved Option B contract, or additional retrieval improvements | **Failing frozen contract**; Option B **UNAPPROVED** | **Blocks release & preview (`NO-GO`)** |
| Cross-platform CI matrix (`ubuntu`, `windows`, `macos` x Node `20`/`22`/`24`) | `.github/workflows/ci.yml`, `.github/workflows/release.yml`; locally only Win11 Node `22.14.0` + WSL2 Linux Node `24.14.1` verified | Native `better-sqlite3` ABI or OS filesystem regressions on macOS / Node 20 / unrun combos | Green remote GitHub Actions CI run across full matrix on authorized branch push | **Still requiring evidence** (local Win22 + Linux24 only) | **Blocks release & preview (`NO-GO`)** |
| End-to-end multi-task agent evaluation | Sprint 3.5 (`n=2` tasks) + Sprint 3.6 (`n=1`) + Sprint 4.0 Commander (`n=1`) | Overclaiming general coding-agent pass-rate gains from tiny sample | Scoped product claims (evidence lookup + verified facts) OR larger pre-registered benchmark | **Not intended as broad autonomous synthesis guarantee; unapproved for general claim** | Scope restriction required before preview |

---

## 11. Next Decision Required

- **Sprint 4.3 engineering work is complete**, while **product release remains `NO-GO`** and **Option B remains `UNAPPROVED`**.
- **Next decision rests with the product owner**:
  1. Approve/reject an explicit Option B developer-preview contract (separating deterministic verification/provenance/worktree guarantees from open-ended semantic synthesis and deciding whether held-out grounded `R@5: 0.6917` / `P@5: 0.4500` is accepted or requires a further retrieval sprint); **and**
  2. Authorize pushing the validated branch to trigger remote `.github/workflows/ci.yml` across `ubuntu-latest`, `macos-latest`, and `windows-latest` (`Node 20/22/24`). No npm publication, release creation, or push should occur beforehand.
