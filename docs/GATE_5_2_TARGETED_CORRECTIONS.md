# HyperSABMemory — Gate 5.2 Targeted Corrections and Comparative Development Report

- **Report Date**: 2026-11-24
- **Target Branch / Repository**: `feature/sprint2.5-20261106` (`C:\Users\singa\Desktop\hypermemory-sprint2.5`)
- **Pre-Correction Baseline**: Production implementation commit `2ebb9757290b5fe1d31e4f6010af8d44782fa7db` (local `HEAD` before Gate 5.2 fixes: `0c94b3f0c764c103b44bcda7aa4057c7ce8d81b1`, doc-only delta)
- **Evaluated Clean Gate 5.2 Dev Tarball**: `hypersabmemory-1.4.1.tgz` (`194,891` bytes, `171` files, SHA-256 `6a5f9601dc29b21b4fc5e4d3db1970756f665f7f3cbf252cbb64ef75a56201f1`, built in an isolated staging tree excluding the protected unstaged UTF-8 BOM difference in `src/hooks/autoCommit.ts` via clean `git show 2ebb9757290b5fe1d31e4f6010af8d44782fa7db:src/hooks/autoCommit.ts` [`11,760` B, SHA-256 `b8a372917dcc64ec4d3f22a553867177a9f9a8ef572d8db5b134b7f03224f0fa`], the `10` pre-existing untracked files, and sibling maintenance worktrees)
- **Official Frozen Release Status (`scripts/release-preflight.mjs`)**: **`NO-GO`** (exit `1`, `5/12` frozen criteria failing)
- **Shadow Option B Status (`scripts/option-b-shadow-eval.mjs`)**: **`authorizesRelease: false`**, **`officialReleaseStatus: "NO-GO"`**, `candidateContractPassing: false`
- **Permanent Dev/Regression Fixture Governance Notice**: `sindresorhus/p-queue` (`7f272ab5ff2254c0dc2537b7977e88ede1cd55e8`), `unjs/ufo` (`f06c800d0c59f2a4a1b9ba65eb6cb61a84419be6`), and `nanostores/nanostores` (`7b86b32bcff00bf5d08895854765a9076740478a`) were already observed in Gate 5.1 and used here for Gate 5.2 development/regression comparison. They are **permanently dev/regression fixtures only** and **cannot** be reused as an independent or unseen acceptance cohort.

---

## 1. Confirmed Defects vs. Unconfirmed Hypotheses

Gate 5.2 root-cause investigation verified five real implementation/harness defects and explicitly falsified one initial concern:

1. **Forgotten-Memory Serialization Leak & `$`-Pattern Corruption in `Memory.md` (`src/memory/temporalMemory.ts`) — CONFIRMED**:
   - `syncToMemoryFile()` called `this.store.getAll()` instead of `this.store.getActive()`, causing `[forgotten]` and `[superseded]` records to be serialized into `Memory.md` whenever populated or created, and subsequently exposed via `hypersabmemory://memory-log`.
   - In addition, `content.replace(regex, ...)` passed a string replacement template where literal `$&` / `$1` inside recorded memory text triggered recursive regex substitution expansion. When the last active record was forgotten, `Memory.md` also retained the `[forgotten]` entry instead of resetting the section to `No records logged yet.`.
   - Fixed by projecting `this.store.getActive()` with a function replacer `() => ...`.

2. **Unconditional Candidate Backfill & Weak Lexical Noise on Unanswerable Queries (`src/mcp/server.ts`, `src/memory/groundedSearch.ts`, `src/memory/hybridSearch.ts`) — CONFIRMED**:
   - `hypersabmemory_query_evidence` unconditionally backfilled `candidate_excerpt` slots up to `limit = 5` whenever any top-20 workspace artifact matched even a single weak token (`11/15` unanswerable queries emitted backfill; `7/7` cases with `0` grounded source excerpts still emitted `5` backfill items), yielding `15/15` (`1.0000`) strict unanswerable candidate emission in Gate 5.1.
   - Near-miss unanswerable queries touching real library tokens also cleared `GROUNDED_SUPPORT_THRESHOLD = 0.30` (`8/15` returned `unverified_source_evidence`), while verbose `README.md` documentation outranked symbol-defining runtime code files (`nanostores` and `ufo` Grounded Top-1 `22/30 = 0.7333`).
   - Fixed with `distinctiveCodeIdentifiers` + scatter (`< 0.15`) abstention, `isDocOrDecisionQuery` + code/config priority over verbose `README.md`, identifier extraction (`fn()`) + runtime vs `.d.ts`/test preference in `hybridSearch.ts`, and gated `candidate_excerpt` backfill in `server.ts`.

3. **Duplicate Search, Repeated Full-Repo Source Capture/Hashing, and Unfiltered Cold AST Parsing (`src/harness/taskSources.ts`, `src/mcp/server.ts`, `src/memory/groundedSearch.ts`, `src/memory/implementationEvidence.ts`) — CONFIRMED**:
   - Each `hypersabmemory_query_evidence` call performed duplicate `searchRecordsWithScores` work, repeated `inspectTaskSourceContents` passes (`~64` tracked files synchronously SHA-256 hashed twice per request), and cold `collectImplementationEvidence` runs created `ts.createProgram` over non-declaring and `.d.ts` files (`14–20` AST parses per repo). This caused Gate 5.1 warm MCP `p95 = 176.16 ms` (`> 100 ms` budget) and cold TS `p95 = 522.45 ms` (`> 500 ms` budget).
   - Fixed via single-pass `captureTaskSourceContents` (with shared `root`/`parentRealCache`/`directStat` and request-local `precomputedCandidates`/`preinspectedSources` reuse), `sha256` excerpt caching on gated backfill, single `searchRecordsWithScores(50)`, pre-filtering `.d.ts`/non-declaring files in `implementationEvidence.ts`, while **strictly preserving** Stage 5 fresh on-disk SHA-256 + symlink/junction re-verification (`initialParentCache.clear(); finalInspectSource = createTaskSourceContentInspector(...)`).

4. **Compact `task_context` Duplication (`src/mcp/taskTools.ts`) — CONFIRMED**:
   - Small `3`-source `hypersabmemory_task_context({ compact: true })` payloads repeated full `sha256`/excerpts inside `decisionEvidence`, verbose prose (`answer`, per-item `attribution`, `taskDecisionMatch`, duplicate `sha256`/`excerpt`) in `linkedConstraints`, per-item `attribution` in `relatedMemories`, redundant `lease.snapshotRevision`/`evaluatedAt`, verbose static disclaimers, and pretty-printed JSON (`2` spaces), yielding only `25.02%` mean byte reduction in Gate 5.1 (`< 50%` budget).
   - Fixed while keeping `compact: false` unchanged and preserving all semantic fields (`sources` holds full 64-hex `sha256` and freshness, restoring omitted `completedWork` when non-empty).

5. **Harness Compact-Completeness Bug (`gate-5-1-acceptance/scripts/run-latency-bench.mjs:148`) — CONFIRMED**:
   - Line `148` checked `cJson.goal === fullJson.goal`, whereas in `compact: false` payloads `goal` lives at `fullJson.answerBundle.recordedTask.goal`. Because `fullJson.goal` was `undefined`, `allCompletenessVerified` falsely evaluated to `false` in Gate 5.1 (`acceptance-metrics.json:1738-1760`) despite `compact: true` returning the exact goal. Fixed in `gate-5-2-dev/scripts/run-dev-comparison.mjs`.

6. **Static Test Attribution Class Failures (`src/memory/implementationEvidence.ts`) — HYPOTHESIS REJECTED (`0/9` MALFUNCTIONS)**:
   - Inspection of all `9` pre-registered positive probes proved **`0/9` failures of declared supported classes**: `pt_ns_1` (`getPath`) linked `4` assertions cleanly with `execution: "unverified"` (`0` false links), and all `8/9` abstentions stem deterministically from unsupported syntax/import idioms (`export class`, `export default`/default import, getter accessors, `export const` arrow functions, barrel re-exports, dynamic loop titles, variable-assigned assertion targets). Attribution rules were kept untouched.

---

## 2. Original Gate 5.1 Baseline Evidence & Pre-Registration Integrity

All five frozen pre-registration artifacts under `C:\Users\singa\.gemini\antigravity\brain\d54941d4-066b-4645-9a1b-e9dac4c88667\scratch\gate-5-1-acceptance\` were preserved unmodified (`PREREGISTRATION_SHA256.txt` verified `5/5` byte-for-byte before edits and re-verified after all Phase 3 commits):

| Frozen Artifact (relative to `gate-5-1-acceptance/`) | Size (Bytes) | Verified SHA-256 Digest |
|---|---:|---|
| `build/hypersabmemory-1.4.1.tgz` | `188,816` | `5f9c7adb85766947b3f8b8a30abe741ca2ade3c849cf2a5d869d935290596596` |
| `artifacts/GATE_5_1_PREREGISTRATION.md` | `4,897` | `ee818756f092c4ad572a177ddf2c163dd5a68b953bd836347717e9795cdb0613` |
| `artifacts/acceptance-manifest.json` | `11,071` | `3c78102ca0b5487c73b8fec8df76d7d8d1d06cd8ebd6c318201be16c9f120a89` |
| `artifacts/acceptance-queries.json` | `14,664` | `ed22474af997033efc299e81e43f6ae01470596e2a7d6588b3966b6842541b48` |
| `artifacts/acceptance-ground-truth.json` | `70,119` | `7083ef2859ed83e13433e891d842e460e348e715584c0eb23eb10ec6317288fa` |

Baseline Gate 5.1 (`2ebb975`) outcome: **`FAIL`** (`5` approved Profile 1 criteria failed: unanswerable strict candidate emission `15/15`, warm MCP `p95 = 176.16 ms`, cold TS `p95 = 522.45 ms`, compact byte reduction `25.02%`, and continuation `0/3` with `cont_ufo`/`cont_nanostores` `UNVERIFIED` due to Codex API outage and `cont_p_queue` `FAIL` due to `300 s` timeout before completion checkpoint).

---

## 3. Evaluation Integrity Audit Summary

Detailed in `gate-5-2-dev/artifacts/evaluation-integrity-audit.md`:

- **Initial vs. Corrected Gate 5.1 Correctness Outputs**: Preserved both `logs/correctness-probes.log` (pre-fix harness) and authoritative `artifacts/acceptance-correctness-probes.json` (post-fix harness; zero product edits between runs):
  - `positiveDeterministic`: `28/30` -> **`30/30`** (fixes `.d.ts` + `.js` dual declaration emission check on `pd_ns_2` `setByKey` and `pd_ns_3` `STORE_UNMOUNT_DELAY`).
  - `forgottenMemoryCanaries`: `0/9` -> **`9/9`** (initial check scanned raw JSON including caller-echoed `"question": query`; corrected check inspects result fields only and records `memoryMdCreatedBySetup: false`).
  - Lease/owner probes: `staleLeaseCheckpointRejected: false` -> **`nonOwnerCheckpointRejected: true` (`NOT_TASK_OWNER`) + `staleGenerationRejected: true` (`OWNERSHIP_CONFLICT`)**.
  - Worktree cleanliness: `mainClean/linkedClean: false` -> **`mainTrackedClean: true, linkedTrackedClean: true, commonExcludeOk: true, gitignoreIgnoredStore: true, storesDistinct: true`** (ignoring intentional untracked `hypersabmemory setup` IDE files).
  - Containment: unprivileged Windows file symlink returned OS `EPERM` (`symlinkEscapeBlocked: null`); added unprivileged NTFS directory junction probe (`junctionEscapeBlocked: true`).
- **Continuation Harness `postSetupUntracked`**: `scripts/run-continuation-tasks.mjs` (`lines 302-305, 329-331, 366-367`) filters untracked files against `postSetupUntracked`; the overwritten pre-fix continuation run log is not preserved separately and is not reconstructed.
- **Compact Verifier Bug (`run-latency-bench.mjs:148`)**: Corrected `fullJson.goal` -> `fullJson.answerBundle.recordedTask.goal` in `gate-5-2-dev/scripts/run-dev-comparison.mjs`.
- **Non-Reuse Boundary**: `p-queue`, `ufo`, and `nanostores` remain permanently dev/regression fixtures only.

---

## 4. RED / GREEN Test and Section 9 Validation Evidence

### RED -> GREEN Workstream Coverage

1. **Memory Safety (`src/memory/temporalMemory.ts`, `tests/temporalMemory.test.ts`, `tests/mcpResources.test.ts`)**:
   - *RED*: `npx.cmd vitest run tests/temporalMemory.test.ts tests/mcpResources.test.ts` failed `3/13` tests across `[forgotten]`/`[superseded]` `Memory.md` leaks (`CANARY_MCP_FORGET_7719_SIGMA`, `CANARY_MCP_SUPERSEDED_OLD_8821`), `$&` recursive replacement corruption, and last-active-record forget retention (`CANARY_LAST_ACTIVE_RECORD_31415`).
   - *GREEN*: `5/5` targeted Vitest files (`41/41` tests) passed exit `0` after fix (`contextBlock` `9`, `sqliteStore` `11`, `temporalMemory` `8`, `memorybench` `8`, `mcpResources` `5`), including end-to-end 7-step CLI MCP restart verification (`node dist/cli/index.js mcp`).

2. **Retrieval & Latency (`src/harness/taskSources.ts`, `src/memory/hybridSearch.ts`, `src/memory/groundedSearch.ts`, `src/mcp/server.ts`, `src/memory/implementationEvidence.ts`, `tests/{groundedSearch,mcpQuery,taskSources}.test.ts`)**:
   - *RED*: `vitest run tests/mcpQuery.test.ts tests/groundedSearch.test.ts tests/taskSources.test.ts` failed `6` new RED tests targeting `captureTaskSourceContents`, near-miss `README.md` abstention, `README.md` vs `src/parse.js` ranking, backfill gating, and duplicate `searchRecordsWithScores` calls.
   - *GREEN*: All retrieval/source/evidence/MCP query suites pass (`groundedSearch` `39/39` with NTFS junction check, `taskSources`, `mcpQuery`, `implementationEvidence`, `hybridSearch`, `practicalRetrieval`, `pathBoundaryRanking`, `crossFileGrounded`, `efficientDecisionEvidence`, `sprint28FactReconciliation`, `repositoryTaskEvaluation`).

3. **Compact Handoff (`src/mcp/taskTools.ts`, `tests/taskAnswerBundle.test.ts`)**:
   - *RED*: Gate 5.1 3-source fixture test in `tests/taskAnswerBundle.test.ts:330` failed at `0.2502 < 0.50`.
   - *GREEN*: `tests/taskAnswerBundle.test.ts` (`8/8`), `tests/taskProcesses.test.ts` (`13/13`), `tests/taskLedger.test.ts` (`18/18`), `tests/worktreePortability.test.ts` (`6/6`), `tests/efficientDecisionEvidence.test.ts` (`2/2`), `tests/decisionMarkdownSafety.test.ts` (`2/2`).

### Full Section 9 Validation Commands (`C:\Users\singa\Desktop\hypermemory-sprint2.5`)

| Command | Exit | Observed Result |
|---|---:|---|
| `npx.cmd tsc --noEmit` | `0` | Clean typecheck across `src/` |
| `npm.cmd run build` | `0` | Clean `dist/` build via `scripts/build.mjs` |
| `npm.cmd test` (`vitest run --maxWorkers=2`) | `0` | **`49/49` test files, `365/365` tests passed** (run with `BypassSandbox: true` for Windows junction tests; in sandbox `45/49` files / `360/365` passed with `5` `EPERM` junction errors) |
| `npm.cmd run eval` | `0` | `tests/memorybench.test.ts` `8/8` passed |
| `npm.cmd run eval:baseline` | `0` | `passed: true`, `recallAt5: 1`, `precisionAt5: 0.2`, `mrr: 1`, `p50: 1.54 ms`, `p95: 2.73 ms`, `estimatedTokens: 243` |
| `npm.cmd run package:smoke` | `0` | Packed `hypersabmemory@1.4.1` (`171` files), isolated install & Sprint 3.1 MCP handoff passed |
| `node scripts/sprint42-worktree-eval.mjs` | `0` | `passed: true`, all worktree/containment/staleness checks verified (`crossWorktreeSymlinkTested: false`, `caseSensitiveDistinctDocsTested: false`) |
| `node scripts/sprint36-handoff-bench.mjs` | `0` | `matrixPassed: true`; `watcher-provenance` compact `3,139 B` (`-72.7%` vs multi-step, `p95=40.39 ms`), `linked-constraints` compact `3,238 B` (`-73.5%` vs multi-step, `p95=20.20 ms`) |
| `node scripts/repository-task-eval.mjs` | `1` | Official **`passed: false`**; `89` records / `88` files; `staleProbe 20/20 (0 leaks)`; `forgottenLeaks=0`; `unsupportedAssertions=0`; Raw `P@5 0.4700`, `R@5 0.7250`, `MRR 0.8750`; Grounded `P@5 0.4700`, `R@5 0.7250`, `MRR 0.9000`, `noAnswerCandidateRate 0.30`; `p50=35.13 ms`, `p95=66.04 ms` (`n=150`) |
| `npm.cmd run release:preflight` | `1` | **`Verdict: RELEASE BLOCKED — NO-GO`** (`5/12` frozen criteria failing, `7/12` passing, preflight evaluator `p95=74.43 ms`) |
| `npm.cmd run eval:option-b:shadow` | `0` | `authorizesRelease: false`, `officialReleaseStatus: "NO-GO"`, `candidateContractPassing: false` |
| `node .../gate-5-2-dev/scripts/run-dev-comparison.mjs` | `0` | Full comparative run on clean `gate-5-2-dev/build/hypersabmemory-1.4.1.tgz` (`DEV_COMPARISON_REPORT.md`, `dev-metrics.json`, `dev-correctness-probes.json`, `dev-comparison-summary.json`) |

---

## 5. Before / After Comparative Development Metrics (Dev Fixtures Only)

### Overall 45-Query Retrieval (`30` Answerable / `70` Pairs, `15` Unanswerable)

| Metric | Gate 5.1 (`2ebb975`) | Gate 5.2 Dev (`hypersabmemory-1.4.1.tgz`) | Delta / Notes |
|---|---:|---:|---|
| Raw Macro R@5 | `0.8944` (`[0.8206, 0.9583]`) | `0.9028` (`[0.8294, 0.9667]`) | `+0.0084` (Raw `59/70`, `+1 / -0`) |
| Raw Micro R@5 / Agg Norm P@5 | `0.8286` (`58/70`) | `0.8429` (`59/70`) | `+0.0143` |
| Grounded Macro R@5 | `0.8250` (`[0.7350, 0.9117]`) | **`0.8983`** (`[0.8272, 0.9611]`) | **`+0.0733`** (`51/70 -> 59/70`, **`+9 / -1`**) |
| Grounded Micro R@5 / Agg Norm P@5 | `0.7286` (`51/70`) | **`0.8429`** (`59/70`) | **`+0.1143`** (Abs P@5 `0.3400 -> 0.3933`) |
| Grounded Per-Query Norm P@5 (Diag) | `0.8250` | `0.8983` | `+0.0733` |
| Grounded MRR@5 | `0.8278` (`[0.7167, 0.9250]`) | **`1.0000`** (`[1.0000, 1.0000]`) | **`+0.1722`** |
| Grounded Top-1 (`k/30`) | `22/30 = 0.7333` (`[0.5555, 0.8582]`) | **`30/30 = 1.0000`** (`[0.8865, 1.0000]`) | **`+8` queries (`100%`)** |
| Grounded Excerpt-Only Macro R@5 | `0.5261` (`31/70` micro) | `0.8817` (`58/70` micro) | `+0.3556` (`top1 30/30`) |
| Unanswerable Strict Candidate Emit (`packet.evidence.length > 0`) | **`15/15 = 1.0000`** (`[0.7961, 1.0000]`) | **`1/15 = 0.0667`** (`[0.0119, 0.2982]`) | **`-14` noisy queries** (`weakBackfill 0/15`, `honestAbstention 15/15`, only `pq_q15` real-symbol `unverified_source_evidence`) |
| Unsupported Verified Assertions | `0` | `0` | `0` across all queries |
| Source Provenance Verified | `225/225` | `147/147` (`142/142` answerable) | `100%` match (`fewer` unanswerable emissions -> `147` vs `225` total items) |

### Per-Repository Retrieval Breakdown (Dev Fixtures)

| Repo (`10` ans, `5` unans) | Gate 5.1 Grounded R@5 / Norm P@5 / MRR / Top-1 / Unans | Gate 5.2 Grounded R@5 / Norm P@5 / MRR / Top-1 / Unans | Exact Grounded File Diff vs Gate 5.1 |
|---|---|---|---|
| `p-queue` (`23` pairs) | `0.8083` / `0.7391` / `1.0000` / `10/10` / `5/5` (`17/23`) | **`0.9083` / `0.8696` / `1.0000` / `10/10` / `1/5`** (`20/23`) | `+3`: `pq_q4` (`source/options.ts`), `pq_q5` (`source/priority-queue.ts`), `pq_q7` (`test/priority-queue.ts`) |
| `ufo` (`23` pairs) | `0.8517` / `0.7826` / `0.8750` / `8/10` / `5/5` (`18/23`) | **`0.9050` / `0.8696` / `1.0000` / `10/10` / `0/5`** (`20/23`) | `+2`: `ufo_q4` (`src/query.ts`), `ufo_q7` (`test/normalize.test.ts`); Top-1 improved on `ufo_q3`, `ufo_q4` |
| `nanostores` (`24` pairs) | `0.8150` / `0.6667` / `0.6083` / `4/10` / `5/5` (`16/24`) | **`0.8817` / `0.7917` / `1.0000` / `10/10` / `0/5`** (`19/24`) | `+4 / -1` (`ns_q4` `+clean-stores/index.js`, `+lifecycle/index.js`; `ns_q5` `+deep-map/index.js`, `+deep-map/path.js`; **`ns_q7` lost `effect/index.js`**); Raw `+1` (`ns_q4` `computed/index.js`) |

- **Tradeoff Note (`ns_q7` `effect/index.js`)**: Tightening grounded/backfill noise admission dropped `effect/index.js` from `ns_q7` grounded output (`-1`), while Raw `ns_q7` still found it and overall grounded coverage rose from `51/70` to `59/70` (`+9 / -1`, Top-1 `22/30 -> 30/30`).
- **Internal `repository-task-eval.mjs` Shift (Unfrozen/Regression Floor Only)**: Shifted from Gate 5.1 Raw `0.7375` (`48/66`), `P@5 0.4800` / Grounded `0.7042` (`46/66`), `P@5 0.4600` (`noAnswerCandidateRate 0.4000`, `p95 70.62 ms`) to Gate 5.2 Raw `0.7250` (`47/66`), `P@5 0.4700` / Grounded `0.7250` (`47/66`), `P@5 0.4700`, `MRR 0.9000` (`noAnswerCandidateRate 0.3000`, `p50 35.13 ms`, `p95 66.04 ms`), remaining above Option B floors (`0.72`/`0.70`/`0.45`) and **below frozen `0.85` recall (`passed: false`)**.

---

## 6. Safety Regression & Correctness Probes

Executed offline against `gate-5-2-dev/build/hypersabmemory-1.4.1.tgz` (`dev-correctness-probes.json`):

- **Deterministic Verification**: `positiveDeterministic` **`30/30`** (`0` wrong assertions); `unsupportedDeterministic` **`15/15`** (`0` assertions).
- **Populated `Memory.md` + Restarted CLI MCP Safety (`3/3` Repos)**: Pre-populated `Memory.md` + active store, verified presence across all active surfaces, then ran `forget` and `supersede`, restarted child-process CLI MCP (`dist/cli/index.js mcp`), and verified **`0` leaks** across `diskMemoryMd`, `rawQuery`, `groundedQueryEvidence`, `taskGroundedQuery`, `taskContextDefault`, `taskContextCompact`, `contextBlockTool`, `getContextTool`, `resourceContextBlock`, `resourceMemoryLog`, and `resourceTasks` on `p-queue`, `ufo`, and `nanostores`. Also verified **`emptyAfterLastForgetEdge: true`** (forgetting last active record rewrites index cleanly without leaked `[forgotten]` entries) and preserved internal audit tags.
  - **Logical vs. Physical Forgetting Distinction**: `forget()` and `remember()` supersede enforce **logical forgetting** across active projections (`Memory.md`, `memory-log`, `context-block`, `query`, `query_evidence`, `task_context`). Underlying audit entries intentionally remain **physically persisted** in `.hypersabmemory/memory_store.json`, `.hypersabmemory/memory_store.json.bak`, and Git history for provenance and resurrection guards.
- **Staleness & Conflict Protection**: `sameSizeSourceModification` **`9/9`** (`0` leaks, `9/9` refreshed), `sourceMutationDuringVerification` **`3/3`** (deterministic mid-check hook `STALE_EVIDENCE`, `6` live race iterations, `0` stale assertions), `conflictingEvidence` **`6/6`** (`INSUFFICIENT_EVIDENCE` / `CONFLICTING_EVIDENCE`), standard `forgottenCanariesZeroLeak` **`9/9`**.
- **Installed-Package Invariants**: `traversalBlocked: true`, `getContextEscapeBlocked: true`, `junctionEscapeBlocked: true` (`symlinkEscapeBlocked: null / EPERM` unprivileged Windows file symlink, POSIX symlinks verified in Gate 4 CI `9/9`), `leaseConflictRejected: true`, `nonOwnerCheckpointRejected: true`, `staleGenerationRejected: true`, `activeOnlyFilteringOk: true`, `linkedWorktreeIsolation.passed: true`.

---

## 7. Performance Measurements (`gate-5-2-dev/artifacts/dev-metrics.json`)

Nearest-rank `p95 = sorted[Math.ceil(0.95 * n) - 1]`, `0` errors, `0` timeouts (`win32`, `Node v22.14.0`, `AMD Ryzen 7 7435HS`):

| Workload | Gate 5.1 p50 / p95 | Gate 5.2 Dev p50 / p95 (Max) | Budget | Status |
|---|---:|---:|---:|---|
| **Warm MCP `query_evidence` (`n=90`)** | `97.39 / 176.16 ms` | **`22.03 / 42.24 ms`** (`mean 30.14`, `max 323.23`) | `<= 100 ms` | **PASS** |
| — `p-queue` (`n=30`) | `93.66 / 139.10 ms` | `22.20 / 42.24 ms` (`max 323.23`) | `<= 100 ms` | PASS |
| — `ufo` (`n=30`) | `89.47 / 176.16 ms` | `19.08 / 105.53 ms` (`mean 25.81`, `max 108.93`) | *(repo outlier)* | Note* |
| — `nanostores` (`n=30`) | `108.20 / 254.08 ms` | `23.96 / 34.38 ms` (`max 156.55`) | `<= 100 ms` | PASS |
| **Cold TS Evidence (`n=30`, excl. startup)** | `367.69 / 522.45 ms` | **`232.60 / 306.28 ms`** (`max 331.24`) | `<= 500 ms` | **PASS** |
| — `p-queue` / `ufo` / `nanostores` (`n=10` ea.) | p95 `531.13 / 367.69 / 417.06 ms` | p95 `331.24 / 241.25 / 240.16 ms` | `<= 500 ms` | All PASS |
| *Separated Cold Process Startup (`n=30`)* | `1,855.17 / 2,088.53 ms` | `1,512.20 / 1,837.96 ms` (`max 1,884.58`) | *(separated)* | Diagnostic |
| **Compact `task_context` Latency (`n=60`)** | `36.01 / 42.16 ms` | **`17.47 / 28.18 ms`** (`max 30.15`) | `<= 50 ms` | **PASS** |
| — `p-queue` / `ufo` / `nanostores` (`n=20` ea.) | — | p95 `28.69 / 18.42 / 23.00 ms` | `<= 50 ms` | All PASS |

\*`ufo` warm MCP `p95 = 105.53 ms` outlier (`n=30`): median is `19.08 ms` (`mean 25.81 ms`), with only tail jitter at `rank 29` (`105.53 ms`) and `max = 108.93 ms` pushing the per-repo `p95` `5.53 ms` over `100 ms` while overall `90`-sample `p95 = 42.24 ms` passes comfortably.

---

## 8. Compact Payload Reduction & Semantic Completeness

| Repo | Full Pretty (`Full Min`) | Compact Wire (`Compact Pretty`) | Wire UTF-8 Reduction | Same-Format Pretty Reduction | Same-Format Min Reduction | Completeness (`16/16` Checks) |
|---|---:|---:|---:|---:|---:|---|
| `p-queue` | `6,063 B` (`5,026 B`) | `2,355 B` (`2,869 B`) | **`61.16%`** | `52.68%` | `53.14%` | **PASS (`true`)** |
| `ufo` | `5,955 B` (`4,918 B`) | `2,287 B` (`2,801 B`) | **`61.60%`** | `52.96%` | `53.50%` | **PASS (`true`)** |
| `nanostores` | `6,144 B` (`5,107 B`) | `2,406 B` (`2,920 B`) | **`60.84%`** | `52.47%` | `52.89%` | **PASS (`true`)** |
| **Mean (`Gate 5.2`)** | `6,054 B` (`5,017 B`) | `2,349 B` (`2,863 B`) | **`61.20%`** (vs Gate 5.1 `25.02%`) | **`52.70%`** | `53.18%` | **`allCompletenessVerified: true`** |

Verified all `16/16` semantic completeness fields per repo (`compactFlag`, `taskId`, `revision`, `state`, `goal`, `leaseStatusAndGeneration`, `decisions`, `constraints`, `acceptanceCriteria`, `nextAction`, `decisionsStatus`, `decisionEvidence`, `linkedConstraints`, `relatedMemories`, `sourcesAndFreshness`, `warningsAndConflicts`), with `decisionEvidence` `sha256` resolving 1:1 via `sources` and `compact: false` behavior unchanged.

---

## 9. Static Test-Attribution Findings (`gate-5-2-dev/artifacts/static-test-attribution-diagnostic.md`)

- **Observed Scores**: `positiveStaticTestAttribution` **`1/9`** (`pt_ns_1` `getPath` -> `deep-map/path.test.ts` linked `4` assertions, `execution: "unverified"`), `codeFound: true` on `5/9` probes (`pt_ufo_1` `toASCII`, `pt_ufo_2` `parseFilename`, `pt_ufo_3` `resolveURL`, `pt_ns_1` `getPath`, `pt_ns_2` `setPath` in `dev-correctness-probes.json` and `static-test-attribution-diagnostic.md`; `GATE_5_1_ACCEPTANCE_REPORT.md:142` noted `4/9` in summary prose), `0` false links, `negativeStaticTestAttribution` **`9/9`** (`0` false links).
- **All `8/9` Abstentions Classified Without Declared-Class Defects**: `pt_pq_1` (`export class` queried by class name + `assert.rejects(..., TimeoutError)`), `pt_pq_2` (`export default class` + default import), `pt_pq_3` (`export default class` + `GetAccessorDeclaration` + variable prop assert), `pt_ufo_1` (dynamic `for...of` `BinaryExpression` title), `pt_ufo_2` & `pt_ufo_3` (directory barrel `../src` -> `src/index.ts`), `pt_ns_2` (`initial = setPath(...); deepStrictEqual(initial, ...)` variable dataflow), `pt_ns_3` (`export const effect = (...) => ...` arrow function expression).
- **Deferred Roadmap (No Call-Graph Engine)**: Prioritized P1–P6 roadmap (`P1` `export const` arrows, `P2` single-hop barrel re-exports, `P3` default export/import bindings, `P4` `export class` + constructor/`assert.rejects`, `P5` single-assignment intra-test variable bridge, `P6` optional dynamic loop titles), preserving `TypeChecker` binding isolation and `execution: "unverified"`.

---

## 10. Continuation Harness v2 & Verification Boundary

Implemented in `gate-5-2-dev/scripts/run-continuation-tasks-v2.mjs` and `gate-5-2-dev/artifacts/CONTINUATION_HARNESS_V2_PROTOCOL.md`:

- **Seven Improvements**: (a) fast `INFRA_UNAVAILABLE` Codex connectivity preflight, (b) phase-bounded timeouts (`Session A 180 s`, `Session B 420 s`, separated external verification budgets), (c) strict separation between fast Session B targeted tests/`tsc` and external `fullRegressionCommand`, (d) mandatory `verifyCompletionCheckpoint` (`state === 'reported_complete'`, cleared lease, absent from active `tasks` resource), (e) structured partial-progress and infra-error capture, (f) `assertNeutralSessionBPrompt` anti-hint guard, and (g) clean `PASS` / `UNVERIFIED` / `FAIL` taxonomy separation.
- **Verification**: `node --check` passed on all `4` dev harness scripts; `node .../scripts/test-gate52-harnesses.mjs` returned `{"gate52DiagHarnessUnitTests":"PASS","checksVerified":5}`; invoking `run-continuation-tasks-v2.mjs` without `--execute-live` exited `2`. **ZERO live Codex sessions executed during Gate 5.2.**

---

## 11. Remaining Release Blockers & Governance Status

- **Official Frozen Release Status (`scripts/release-preflight.mjs`)**: **`NO-GO`** (exit `1`, `5/12` frozen criteria failing: raw & grounded `P@5` `0.4700 < 0.50`, raw & grounded `R@5` `0.7250 < 0.85`, `supportedAnswerCoverage` `0 <= 0`).
- **Shadow Option B (`scripts/option-b-shadow-eval.mjs`)**: **`authorizesRelease: false`**, **`candidateContractPassing: false`**.
- **Unresolved Acceptance Gates**:
  1. **Cross-Session Continuation (`0/3` verified in Gate 5.1)**: `cont_p_queue` remains `FAIL` (`300 s` timeout before checkpoint), and `cont_ufo` / `cont_nanostores` remain **`UNVERIFIED`** pending live Codex v2 execution after API preflight passes.
  2. **Fresh Unseen 3-Repo Acceptance & Product-Owner Ratification (Gate 6)**: Because `p-queue`, `ufo`, and `nanostores` are permanently restricted to dev/regression only, Gate 6 requires pre-registering 3 brand-new unseen repositories plus remote Linux/Windows/macOS CI verification (`Node 20/22/24`).
