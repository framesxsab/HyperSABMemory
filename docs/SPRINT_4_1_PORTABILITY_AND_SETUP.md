# HyperSABMemory Sprint 4.1 — Offline Setup and Cross-Project Portability

## 1. Executive Verdict and Engineering Status

**Sprint 4.1 engineering work is complete; product release remains NO-GO.** All three portability and grounding defects identified during Sprint 4.0 independent-repository testing now have targeted production fixes, regression tests, and installed-tarball verification, alongside a controlled cold-vs-warm latency profile across independent repositories.

- `npm.cmd run release:preflight` continues to fail closed (`Verdict: RELEASE BLOCKED — NO-GO`, `Eligible for publication: NO`, exit `1`) against the untouched frozen evaluator ([src/eval/repositoryTaskEvaluation.ts](../src/eval/repositoryTaskEvaluation.ts) and [src/eval/repositoryTaskFixture.ts](../src/eval/repositoryTaskFixture.ts)).
- `npm.cmd run eval:option-b:shadow` remains informational only (`authorizesRelease: false`, `officialReleaseStatus: NO-GO`, `candidateContractPassing: false`). **Option B remains unapproved.**
- Remote Linux and macOS GitHub Actions workflows have **not** been executed because pushing to remote is unauthorized.

---

## 2. Starting Git State (Verified Pre-Edit)

- **Repository / worktree**: `C:\Users\singa\Desktop\hypermemory-sprint2.5`
- **Branch**: `feature/sprint2.5-20261106`
- **Starting HEAD**: `382559c0352ff312a251ff511ffb35e03b230b58` (`test: validate HyperSABMemory on independent repositories`)
- **Pre-existing untracked artifacts preserved** (`10` files untouched): `CLEANUP-RESULTS.md`, `cleanup-inventory.md`, `code-cleanup-audit.md`, `docs/V2_BASELINE.md`, `docs/V2_RESEARCH_AND_SPRINT.md`, `scheduled-tasks-audit.md`, `scheduled-tasks-inventory.csv`, `scheduled-tasks-triage.csv`, `scripts/cleanup-dry-run.ps1`, `scripts/cleanup-safe.ps1`.
- **Sibling maintenance worktrees preserved at `592f054`**:
  - `C:/Users/singa/Desktop/hypermemory` (`[audit/cleanup-20261105]`)
  - `C:/Users/singa/Desktop/hypermemory-cleanup-isolated` (`[maintenance/cleanup-isolated-20261106]`)
  - `C:/Users/singa/Desktop/hypermemory-dependency-review` (`[maintenance/dependency-review-20261106]`)

---

## 3. Offline MCP Installation Defect Reproduced

On starting HEAD `382559c`, running `hypersabmemory setup` from an installed tarball in a clean consumer directory containing spaces (`"install dir"` -> `"consumer app"`, with no HyperSABMemory source tree inside the consumer directory) wrote:

```json
{"command":"cmd","args":["/c","npx","-y","hypersabmemory","mcp"]}
```

When spawned directly (`shell: false`, matching `readConfiguredLaunch` in [src/cli/doctor.ts](../src/cli/doctor.ts)) under offline/isolated conditions (`npm_config_offline=true`, `npm_config_registry=http://127.0.0.1:1`, empty `npm_config_cache`, empty `npm_config_prefix`, empty global `hypersabmemory` install), launch failed immediately:

- **Exit code**: `1`
- **Captured stderr**: `"npm error code ECONNREFUSED\r\nnpm error syscall connect\r\nnpm error errno ECONNREFUSED\r\nnpm error Fetch failed: GET http://127.0.0.1:1/hypersabmemory..."`

Additionally, [scripts/package-smoke.mjs](../scripts/package-smoke.mjs) previously overwrote `.mcp.json` and `.cursor/mcp.json` manually after running `setup`, hiding this broken default configuration.

---

## 4. Fixes Implemented

### Fix 1 (Primary): Offline Installed-Package MCP Setup (`292159f`)

- **Files**: [src/harness/mcpAccess.ts](../src/harness/mcpAccess.ts), [tests/mcpAccess.test.ts](../tests/mcpAccess.test.ts), [tests/harness.test.ts](../tests/harness.test.ts), [scripts/package-smoke.mjs](../scripts/package-smoke.mjs)
- **Changes**:
  - Introduced `McpLaunchMode` (`'workspace' | 'installed' | 'online_npx'`) and `ResolveMcpLaunchOptions` on `resolveMcpLaunch`.
  - Precedence order:
    1. Workspace-local `dist/cli/index.js` (`mode: 'workspace'`, verified via `validatePackageCliEntry` checking `package.json` `name === 'hypersabmemory'` and `dist/cli/index.js` regular file).
    2. Consumer-installed `<workspace>/node_modules/hypersabmemory/dist/cli/index.js` (`mode: 'installed'`).
    3. Installed CLI package root executing the command, **skipping** ephemeral `npx` cache paths detected by `isEphemeralNpxCache` (`_npx` path segment) (`mode: 'installed'`).
    4. Optional online fallback (`mode: 'online_npx'`) only when `allowOnlineFallback` is not `false`; when `allowOnlineFallback: false`, `resolveMcpLaunch` throws an actionable error telling the user to install `hypersabmemory` in the project (`npm install --save-dev hypersabmemory`) or run `setup` from an installed package.
  - Direct launch uses `process.execPath` and the absolute CLI entrypoint path (preserving spaces without shell quoting/wrapping), and `mergeKeyedConfig` strips internal `mode` metadata before writing `.mcp.json`, `.cursor/mcp.json`, and `.vscode/mcp.json`.
  - Updated `describeFlow` to report explicit offline/online launch mode labels.
  - Removed manual `.mcp.json`/`.cursor/mcp.json` overrides in [scripts/package-smoke.mjs](../scripts/package-smoke.mjs) so `package:smoke` now verifies unmodified `setup` output offline (`npm_config_offline=true`, `npm_config_registry=http://127.0.0.1:1`, empty cache) via both `verifyMcpLaunch` and real MCP clients.

### Fix 2 (Secondary): Cross-Platform Root Documentation Discovery (`5df9386`)

- **Files**: [src/harness/taskSources.ts](../src/harness/taskSources.ts), [tests/taskSources.test.ts](../tests/taskSources.test.ts)
- **Changes**:
  - Replaced single uppercase `ROOT_DOCUMENTS` check (`README.md`) with allowlisted `ROOT_DOCUMENT_GROUPS` (`AGENTS.md`, `Rules.md`, `PRD.md`, `Architecture.md`, `README.md`/`Readme.md`/`readme.md`, `Phases.md`, `Memory.md`, `Design.md`, `CONTRIBUTING.md`/`Contributing.md`/`contributing.md`) and `ROOT_DOCUMENT_RANK`.
  - Exported `selectRootDocumentationNames(entries)` to preserve exact on-disk filenames (`Readme.md` stays `Readme.md`, `README.md` stays `README.md`), keep distinct case variants separate when both appear on case-sensitive filesystems without unrestricted case-insensitive globbing, and filter out non-file symlink directory entries (`item.sha256.length > 0`).
  - Previously, on Windows case-insensitive lookup, `discoverProjectSources` normalized `Readme.md` back to `'README.md'`; after the fix, `commander.js` discovers `"Readme.md"` with exact on-disk casing and valid SHA-256 hash.

### Fix 3 (Tertiary, Deterministic): Explicit Nested and Root JSON Scalar Verification (`1aad678`)

- **Files**: [src/memory/claimVerification.ts](../src/memory/claimVerification.ts), [src/memory/groundedSearch.ts](../src/memory/groundedSearch.ts), [tests/groundedSearch.test.ts](../tests/groundedSearch.test.ts)
- **Changes & Limitations**:
  - Replaced flat regex scanning in `verifyJsonScalarClaim(source, key, { rootOnly? })` with strict `JSON.parse` + TypeScript `ts.parseJsonText` AST traversal (`string`, `number` including negatives like `-5`, `boolean`, `null`), supporting dot/bracket scalar paths (`repository.type`, `keywords[0]`), explicit root selectors (`$.type`, `root type`, `root value of \`type\`` via `CONFIG_QUERY` in `groundedSearch.ts`), and exact 1-based line numbers from the JSON AST.
  - Preserves conservative abstention (`CONFLICTING_EVIDENCE` / `answerVerified: false`) for ambiguous unscoped keys appearing at multiple depths (`What is the value of \`type\` in \`package.json\`?`), duplicate keys within the same JSON object, prototype/unsafe property names (`__proto__`, `constructor`, `prototype`), non-scalar object/array targets, missing keys, malformed JSON, and stale/missing sources.
  - **Intentional limitation**: Only explicit scoped scalar paths and explicit root qualifiers are verified; JSONPath wildcards, filters, and non-scalar object extraction remain unsupported.

---

## 5. Independent Consumer Validation (`antfu-collective/ni` & `tj/commander.js`)

Executed via [scripts/sprint40-independent-eval.mjs](../scripts/sprint40-independent-eval.mjs) from packed `hypersabmemory@1.4.1` (`tarballBytes: 182097`, `packMs: 2009.19`, `installMs: 12599.92`, `node v22.14.0 win32 x64`):

| Validation Check | `antfu-collective/ni` (`71e261f`) | `tj/commander.js` (`a5a7dc0`) |
| --- | --- | --- |
| Offline MCP configs generated by `setup` & verified | `true` (`.mcp.json`, `.cursor/mcp.json`, `.vscode/mcp.json`) | `true` (`.mcp.json`, `.cursor/mcp.json`, `.vscode/mcp.json`) |
| Offline MCP restart (`npm_config_offline=true`, blocked registry) | `true` | `true` |
| Root doc discovered (`hypersabmemory_scope_sources`) | `"README.md"` (`shaMatch: true`) | `"Readme.md"` (`shaMatch: true`) |
| `setup` latency (first / repeat) / `zeroCommitsCreated` | `1699.62 ms` / `1505.48 ms` / `true` | `1653.76 ms` / `1513.91 ms` / `true` |
| MCP startup + discovery (`17` tools, `3` resources) | `1461.16 ms` | `1378.81 ms` |
| Retrieval `P@5` / `macro R@5` / `MRR` / `top1` | `0.2857` / `1.0000` / `0.8333` / `0.7143` | `0.3143` / `0.9286` / `1.0000` / `1.0000` |
| Unanswerable unsupported assertions / attribution valid | `0 / 3` / `38 / 38` | `0 / 3` / `50 / 50` |
| JSON `name` / `version` | `@antfu/ni` (L2) / `30.6.0` (L4) | `commander` (L2) / `15.1.0` (L3) |
| JSON unscoped `type` (`package.json`) | Abstained (`answerVerified: false`) | Abstained (`answerVerified: false`) |
| JSON `repository.type` | `"git"` (L11, `answerVerified: true`) | `"git"` (L18, `answerVerified: true`) |
| JSON `$.type` & `root type` | `"module"` (L3, `answerVerified: true`) | `"module"` (L40, `answerVerified: true`) |
| Symbol & impl/test attribution (`execution: unverified`) | `parsePackageSpec` (L11) + `4` Vitest tests linked | `suggestSimilar` (L56), `useColor` (`4` tests) & `DualOptions.valueFromOption` (`4` tests) |
| Safety checks (`sameSizeRewrite`, `missingFile`, `forgottenMemoryExcluded`, `conflictAbstained`, `workspaceContainmentRejected`) | All `true` (`shadowedImportRejected: true`) | All `true` (`shadowedImportRejected: true`) |

---

## 6. Performance Findings & Cold vs. Warm Latency Profile

Executed via [scripts/sprint41-mcp-latency-profile.mjs](../scripts/sprint41-mcp-latency-profile.mjs) using installed `hypersabmemory@1.4.1` against `ni` (`10` indexed source/test/doc records) and `commander` (`10` records) across `3` matched query classes (`ordinary`, `exactJson`, `implAndTest`):

| Repo & Query Class | Cold MCP (`n = 3`) p50 / p95 / max | Warm MCP (`n = 50`) p50 / p95 / max | Warm In-Process Mean Stages (`ms`, `n = 50`) |
| --- | --- | --- | --- |
| `ni` — `ordinary` | `47.28` / `60.11` / `60.11 ms` | `19.05` / `23.58` / `24.58 ms` | `total 11.32` (`captureRef 5.24`, `path 2.58`, `read 1.48`, `decision 0.75`, `candidate 0.67`, `hash 0.21`, `indexing 0.19`, `ranking 0.19`, `excerpt 0.18`) |
| `ni` — `exactJson` | `58.31` / `58.77` / `58.77 ms` | `17.22` / `20.65` / `21.71 ms` | `total 14.19` (`captureRef 6.14`, `path 2.88`, `read 2.12`, `decision 1.66`, `candidate 0.60`, `hash 0.32`, `excerpt 0.27`, `ranking 0.18`, `indexing 0.12`) |
| `ni` — `implAndTest` | `190.79` / `196.66` / `196.66 ms` | `21.38` / `25.54` / `28.12 ms` | `total 10.91` (`captureRef 5.07`, `path 2.43`, `read 1.50`, `decision 0.66`, `candidate 0.56`, `excerpt 0.23`, `hash 0.22`, `ranking 0.22`, `indexing 0.10`) |
| `commander` — `ordinary` | `85.21` / `238.92` / `238.92 ms` | `18.39` / `23.92` / `33.58 ms` | `total 18.19` (`captureRef 7.43`, `path 2.90`, `read 2.68`, `decision 1.99`, `excerpt 1.65`, `candidate 0.71`, `hash 0.61`, `ranking 0.21`, `indexing 0.18`) |
| `commander` — `exactJson` | `44.72` / `47.64` / `47.64 ms` | `6.19` / `9.55` / `10.60 ms` | `total 6.07` (`captureRef 1.83`, `path 1.37`, `decision 1.10`, `read 0.81`, `candidate 0.60`, `hash 0.14`, `indexing 0.12`, `excerpt 0.12`, `ranking 0.10`) |
| `commander` — `implAndTest` | `292.26` / `299.80` / `299.80 ms` | `13.72` / `17.94` / `19.54 ms` | `total 8.42` (`captureRef 2.60`, `path 1.86`, `read 1.02`, `excerpt 1.05`, `decision 0.87`, `candidate 0.57`, `hash 0.29`, `ranking 0.15`, `indexing 0.10`) |

- **Root explanation**: Sprint 4.0's high p95 values (`328–515 ms` over `n = 10`) came from including the **single cold first query** inside tiny 10-call samples, not steady-state search latency. Warm MCP latency across `300` measured warm calls stays at **`6.19–21.38 ms` p50** and **`9.55–25.54 ms` p95**.
- **Slowest query class**: Cold **`implAndTest`** (`190.79 ms` p50 / `196.66 ms` p95 on `ni`; `292.26 ms` p50 / `299.80 ms` p95 on `commander`; in-process cold totals `108.98 ms` and `214.67 ms`) due to first-call TypeScript Compiler AST/Program + TypeChecker initialization, alongside cold `commander` ordinary read of `lib/command.js`.
- **Stage attribution**: In steady state, `indexingMs` (`0.10–0.19 ms`), `rankingMs` (`0.10–0.22 ms`), and `candidateMs` (`0.56–0.71 ms`) are negligible; per-query source re-capture/containment/read (`captureRefMs` + `pathMs` + `readMs`) accounts for ~70–85% of warm in-process work.
- **Performance backlog item**: No search-engine rewrite is warranted. Future developer-preview optimization can lazily cache TypeScript AST program setup or deduplicate repeated `captureTaskSources` hashing within a query without weakening freshness verification.

---

## 7. Full Verification Results (Sequential Post-Fix Run on `win32 x64`, Node `v22.14.0`)

| # | Command | Process Exit | Structured `passed` / Outcome & Key Metrics |
| --- | --- | --- | --- |
| 1 | `npm.cmd test` | `0` | `47` test files passed (`47/47`), `322` tests passed (`322/322`), duration `78.45s` (`mcpAccess` 7/7, `harness` 15/15, `taskSources` 6/6, `groundedSearch` 35/35, `storeContainment` 3/3, `doctorVerify` 6/6, `memorybench` 8/8, `handoffCommand` 4/4, `taskAnswerBundle` 7/7) |
| 2 | `npx.cmd tsc --noEmit` | `0` | Clean TypeScript typecheck |
| 3 | `npm.cmd run build` | `0` | Clean build to `dist/` |
| 4 | `npm.cmd run eval` | `0` | `tests/memorybench.test.ts`: `8 passed (8)` |
| 5 | `npm.cmd run eval:baseline` | `0` | `passed: true` (`500` records, `493` distractors, `precisionAt5: 0.2`, `recallAt5: 1`, `MRR: 1`, `staleLeaks: 0`, `p50: 1.21 ms`, `p95: 1.88 ms`, `estimatedTokens: 243`) |
| 6 | `npm.cmd run package:smoke` | `0` | `167` files, `182.1 kB` tarball (`818.7 kB` unpacked), unmodified `setup` offline verification passed, `code` p50/p95 `22.89/32.33 ms`, `code-and-test` `22.35/29.92 ms`, `unsupported` `25.30/29.77 ms` |
| 7 | `node scripts/sprint36-handoff-bench.mjs` | `0` | `matrixPassed: true`; compact one-call p50/p95 `10.35/12.00 ms` (`watcher-provenance`, `-65.4%` bytes) & `9.77/12.33 ms` (`linked-constraints`, `-65.2%` bytes) |
| 8 | `node scripts/sprint37-grounding-bench.mjs` | `0` | `9/9` MCP regression checks passed; alternating `after` (`450` samples) p50 `17.12 ms` / p95 `32.36 ms` (baseline `189.38 ms` p95); `repositoryTaskEvalComparison.after` p50 `15.49 ms` / p95 `27.57 ms` |
| 9 | `node scripts/sprint39-dev-retrieval-eval.mjs` | `0` | `combinedDev42` grounded `P@5: 0.4545`, `R@5: 0.7303`, `MRR: 0.8977`, `top1HitRate: 0.8182`, `staleProbe.leaks: 0` (`22/22` flagged), `forgottenLeaks: 0`, `unsupportedAssertions: 0`, p95 `32.14 ms` |
| 10 | `node scripts/sprint40-independent-eval.mjs` | `0` | All offline MCP, restart, root doc casing, nested/root JSON, attribution, and safety checks passed on `ni` and `commander` (Table in §5) |
| 11 | `node scripts/sprint41-mcp-latency-profile.mjs` | `0` | Warm (`50` calls/class) vs cold (`3` starts/class) + stage breakdown profiled on `ni` and `commander` (Table in §6) |
| 12 | `node scripts/repository-task-eval.mjs` | `1` *(expected)* | `passed: false` (frozen contract): raw `P@5: 0.4700`, `R@5: 0.7208`, `MRR: 0.8750`; grounded `P@5: 0.4400`, `R@5: 0.6708`, `MRR: 0.8750`, `supportedAnswerCoverage: 0`, `unsupportedAssertions: 0`, `forgottenLeaks: 0`, `staleProbe.leaks: 0` (`20/20` flagged), `p50: 17.49 ms`, `p95: 25.95 ms` |
| 13 | `npm.cmd run release:preflight` | `1` *(expected)* | `Verdict: RELEASE BLOCKED — NO-GO`, `Eligible for publication: NO` (`5` failing / `7` passing frozen criteria; `latencyMs.p95: 30.0257 ms`) |
| 14 | `npm.cmd run eval:option-b:shadow` | `0` | `mode: SHADOW_CANDIDATE_INFORMATIONAL_ONLY`, `authorizesRelease: false`, `officialReleaseStatus: NO-GO`, `candidateContractPassing: false` (`repositoryTaskEval p50/p95: 16.29/25.27 ms`) |

---

## 8. Cross-Platform Workflows and Remote CI Limitations

Inspected [.github/workflows/ci.yml](../.github/workflows/ci.yml) and [.github/workflows/release.yml](../.github/workflows/release.yml):

- `.github/workflows/ci.yml` defines a `3x3` matrix (`ubuntu-latest`, `windows-latest`, `macos-latest` x Node `20`, `22`, `24`) running `npm ci`, `npx tsc --noEmit`, `npm test`, `npm run eval:baseline`, and `npm run package:smoke`.
- `.github/workflows/release.yml` gates `v*` tags / `workflow_dispatch` on all `3` OSes at Node `24`, requiring `npm run release:preflight` before `publish` (`needs: gates`).
- **Remote CI status**: **Linux and macOS CI remain unverified.** Case-sensitive filesystem behavior and POSIX path normalization were verified via unit tests and path simulations locally on Windows `v22.14.0`, not on native Linux/macOS runners, and no branch was pushed.
- **Remaining portability risks**: `better-sqlite3@12.9.0` depends on native prebuilds or a C++ toolchain (`prebuild-install@7.1.3` deprecation warning observed during `package:smoke`); linked `.git` pointer-file worktrees still skip `.git/info/exclude` in `containStoreInGit`.

---

## 9. Commits Created & Remaining Developer-Preview Blockers

### Local Commits Created (`feature/sprint2.5-20261106`, Unpushed)

1. `292159f` — `fix(mcp): support offline installed-package launch`
2. `5df9386` — `fix(sources): discover root documentation safely across platforms`
3. `1aad678` — `fix(grounding): verify explicitly scoped JSON scalar paths`
4. Validation & documentation commit adding/updating `scripts/sprint40-independent-eval.mjs`, `scripts/sprint41-mcp-latency-profile.mjs`, and `docs/SPRINT_4_1_PORTABILITY_AND_SETUP.md`.

### Remaining Developer-Preview / Release Blockers

1. **Product-owner release-contract decision (Option B remains UNAPPROVED)**: Frozen contract gates (`P@5 >= 0.5`, `R@5 >= 0.85`, `supportedAnswerCoverage > 0`) continue to block release (`NO-GO`).
2. **Remote cross-platform CI execution**: Requires explicit push authorization to run `.github/workflows/ci.yml` on `ubuntu-latest` and `macos-latest` across Node `20`/`22`/`24` (verifying `better-sqlite3` installation and native POSIX case sensitivity).
3. **Logged secondary backlog (non-blocking for Sprint 4.1)**: Cold-start TypeScript AST / `captureTaskSources` caching to reduce cold `implAndTest` latency; bounded top-5 precision / unanswerable candidate noise; dynamic `it.each` curried test attribution; `.git` worktree pointer handling in `containStoreInGit`.
