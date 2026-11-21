# Sprint 3.7: Grounded Search Performance and Release Readiness

- **Date**: 2026-11-22
- **Worktree**: `C:\Users\singa\Desktop\hypermemory-sprint2.5`
- **Branch**: `feature/sprint2.5-20261106`
- **Base Commit**: `7ddba87` (`test(eval): validate one-call handoff efficiency and report Sprint 3.6`)
- **Product Release Status**: **NO-GO** (pending product-owner decision on release contract; frozen release gate in `src/eval/repositoryTaskEvaluation.ts` remains unaltered)

---

## 1. Repository State and Preservation Verification

Before implementation and verification, Git state in `C:\Users\singa\Desktop\hypermemory-sprint2.5` was confirmed at `7ddba87c9ae9f9fb618df3291bc693764020007c` (`7ddba87`) on branch `feature/sprint2.5-20261106`, with recent commits `8ef93f2` and `7ddba87` (plus Sprint 3.5 `1b18ef7` / `6200b7e` and Sprint 3.4 `2845e98`).

All 10 pre-existing untracked files (`CLEANUP-RESULTS.md`, `cleanup-inventory.md`, `code-cleanup-audit.md`, `docs/V2_BASELINE.md`, `docs/V2_RESEARCH_AND_SPRINT.md`, `scheduled-tasks-audit.md`, `scheduled-tasks-inventory.csv`, `scheduled-tasks-triage.csv`, `scripts/cleanup-dry-run.ps1`, `scripts/cleanup-safe.ps1`) and all three sibling worktrees (`C:/Users/singa/Desktop/hypermemory`, `C:/Users/singa/Desktop/hypermemory-cleanup-isolated`, `C:/Users/singa/Desktop/hypermemory-dependency-review` at `592f054`) remain preserved and unmodified.

---

## 2. Baseline `searchGrounded` Latency and Stage Breakdown (`7ddba87`)

Measured in `scripts/sprint37-grounding-bench.mjs` and `scripts/repository-task-eval.mjs` on Windows x64 (`Node v22.14.0`):

### 2.1 Frozen Repository Task Evaluation Baseline (`7ddba87`, 82 source files + 1 forgotten record = 83 records, 30 `HELD_OUT` queries x 5 samples = 150 timed samples after 1 warmup/query)

| Measurement | `p50` (ms) | `p95` (ms) | `passed` | Exit code |
|---|---:|---:|:---:|:---:|
| Initial `runRepositoryTaskEvaluation` at `7ddba87` (live process run) | 83.35 | 241.50 | `false` | 1 |
| Controlled worker `before` in `sprint37-grounding-bench.mjs` (`baselineRepo`, 82 files) | 64.41 | 169.35 | `false` | — |
| `node scripts/sprint29-latency-probe.mjs` (at `7ddba87`, 30 samples) — `one-source` | 10.64 | 14.49 | — | 0 |
| `node scripts/sprint29-latency-probe.mjs` (at `7ddba87`, 30 samples) — `multi-source` | 18.63 | 26.06 | — | 0 |

### 2.2 Stage-Level Breakdown at Baseline (`7ddba87`, alternating benchmark corpus = 109 tracked `.ts`/`.md` files, 450 pooled samples across 3 repetitions)

| Stage / Phase | Mean per call (ms) | Share of `totalMs` | Primary source in `src/` |
|---|---:|---:|---|
| `pathMs` | 25.71 | 29.8% | `resolveSource` / `createTaskSourceContentInspector` (`src/harness/taskSources.ts`) |
| `candidateMs` (total) | 20.83 | 24.1% | `SqliteStore.getActive()` + `HybridSearchEngine.searchRecordsWithScores` |
| — `indexingMs` (subset of `candidateMs`) | 12.80 | 14.8% | Per-query tokenization & term scanning in `src/memory/hybridSearch.ts` |
| — `memory.getActive()` + overhead | ~8.03 | ~9.3% | UTF-8 read + full 1 MB string compare in `src/memory/sqliteStore.ts` |
| `decisionMs` | 17.44 | 20.2% | `collectImplementationEvidence` (`src/memory/implementationEvidence.ts`) + claim checks |
| `excerptMs` | 8.25 | 9.6% | Uncached per-line `tokenizeSearchText(line)` in `excerptFor` (`src/memory/groundedSearch.ts`) |
| `readMs` | 6.91 | 8.0% | `statSync` + `readFileSync` in `readContent` (`src/harness/taskSources.ts`) |
| `rankingMs` | 6.13 | 7.1% | Path term tokenization, import graph normalization in `hybridSearch.ts` |
| `hashMs` | 1.01 | 1.2% | SHA-256 hashing of verified source bytes (`taskSources.ts`) |
| **`totalMs`** | **86.32** | **100%** | Pooled baseline: **`p50 = 71.02 ms`**, **`p95 = 220.04 ms`**, `max = 321.41 ms` |

### 2.3 Slowest Baseline Queries and Root-Cause Diagnosis

1. **`qi: 14`** (*"Find the context header budget and compression tests for workspace state."*): median `p50 = 269.53 ms`, worst `max = 321.41 ms` (`decisionMs = 218.20 ms` in stage profile).
   - **Root cause**: Matches `wantsImplementationEvidence(query)`. `collectImplementationEvidence()` ran `ts.createSourceFile` from scratch across 20 TypeScript files and created separate `ts.createCompilerHost` + `ts.createProgram` + `getTypeChecker()` instances per matching test file without SHA-256 caching.
2. **`qi: 7`** (*"Locate artifact-linked memory search implementation and its regression tests."*): median `p50 = 220.04 ms`, worst `max = 298.15 ms` (`decisionMs = 139.94 ms` in stage profile).
   - **Root cause**: Same uncached TypeScript AST parsing and per-test-file `ts.createProgram` initialization across multiple matching test files (`implCodeCount = 3`, `implTestCount = 4`).
3. **`qi: 9`** (*"Find task resource registration, bounded active list and resource tests."*): median `p50 = 142.01 ms`, worst `max = 159.37 ms` (`decisionMs = 73.09 ms` in stage profile).
   - **Root cause**: `ts.createSourceFile` across 20 files + TypeScript checker startup on matching candidate files.
4. **`qi: 29` & `qi: 23`** (*"What is the next quarterly revenue target?"*, *"Who approved the cloud deployment budget last Tuesday?"*): median `p50 = 122.12 ms` / `117.34 ms`, worst `max = 153.34 ms` / `156.78 ms` (`pathMs = 62.66 ms` / `47.83 ms`, `readMs = 18.31 ms` / `14.51 ms`).
   - **Root cause**: Unanswerable queries keep `lexicalEvidenceCount < 5`, causing `searchGrounded` to inspect all 50 candidate files. Each inspected file ran 5 synchronous syscalls (`lstatSync`, non-native `fs.realpathSync` walking ancestor junctions on Windows, redundant `statSync`, and `readFileSync`), plus an additional `fs.realpathSync(workspaceDir)` on the final recheck.
5. **Across all 30 queries**: `HybridSearchEngine` re-concatenated `recordSearchText(record)` (~1 MB/query), scanned ~120,000 tokens linearly per query instead of looking up query terms in precomputed `termFrequency` maps, and rebuilt `lowercase` / `pathTerms` / normalized paths on every call; `SqliteStore` decoded 1 MB UTF-8 strings and cloned arrays even when file bytes were identical; `excerptFor` re-tokenized every line of the top-5 evidence files (`excerptMs` up to `27.00 ms` on `qi: 2`).

---

## 3. Production Optimizations and Correctness-Preserving Trade-offs

All production changes are strictly local, bounded in memory, and keyed by cryptographic content hashes or exact byte/field equality so stale files, same-size rewrites, symlink escapes, forgotten records, and late mutations behave identically to baseline:

1. **Fast Path Containment and Single-Stat Content Reads ([taskSources.ts](file:///C:/Users/singa/Desktop/hypermemory-sprint2.5/src/harness/taskSources.ts), [groundedSearch.ts](file:///C:/Users/singa/Desktop/hypermemory-sprint2.5/src/memory/groundedSearch.ts))**:
   - Switched `fs.realpathSync` to `fs.realpathSync.native` (already standard in `autoCommit.ts` for Windows junctions/short paths).
   - Added a fast leaf path check (`fs.lstatSync(absolute)`) before walking missing ancestors: non-symlink files reuse `directStat` for `isFile()` / `size <= 16 MiB` without a redundant `fs.statSync(absolute)` call and check `path.dirname(absolute)` realpath containment.
   - `searchGrounded` reuses a single `inspectSource` closure for both initial inspection (with a per-pass `initialParentCache` for non-symlink ancestor realpaths) and final recheck — **clearing `initialParentCache.clear()` immediately before the final `inspectSource([...finalSources.values()])` recheck**, so every final source re-verifies ancestor symlinks, file bytes, and SHA-256 digests directly against the OS.
   - **Security invariant**: Direct callers of `createTaskSourceContentInspector` still allocate a fresh per-invocation `parentRealCache` inside every `inspect(sources)` call, preserving detection when a junction/symlink is swapped between consecutive `inspect()` calls.

2. **Buffer-Verified Store Reloads and Precomputed Per-Record Retrieval Index ([sqliteStore.ts](file:///C:/Users/singa/Desktop/hypermemory-sprint2.5/src/memory/sqliteStore.ts), [hybridSearch.ts](file:///C:/Users/singa/Desktop/hypermemory-sprint2.5/src/memory/hybridSearch.ts))**:
   - `SqliteStore.tryLoadFrom()` reads the file once as a `Buffer` (`fs.readFileSync(file)` without pre-checking `existsSync`), compares `rawBuf.equals(this.loadedBuffer)` in native C++ without decoding a 1 MB UTF-8 string on unchanged reads, and caches `cachedActive` until mutated or cleared. Same-size byte rewrites still invalidate immediately because every `getActive()` still reads and byte-compares the file on disk.
   - `HybridSearchEngine` caches a bounded `CachedDocumentEntry` (8 MB LRU budget) per active record containing `tokensLength`, `termFrequency: Map<string, number>`, `lowerContent`, `paths`, `lowerPaths`, `normalizedPaths`, and `pathTerms`, verified against exact string identity/equality on `content`, `category`, `tags`, `intent`, `artifacts`, `errorsAndFixes`, and `nextSteps`. `searchRecordsWithScores()` looks up only `queryTerms` (`O(|queryTerms|)`) instead of scanning all corpus tokens (`O(|corpus tokens|)`).

3. **SHA-256-Keyed Excerpt Line Token Cache ([groundedSearch.ts](file:///C:/Users/singa/Desktop/hypermemory-sprint2.5/src/memory/groundedSearch.ts))**:
   - `excerptFor(query, content, filename, contentSha256)` accepts optional `contentSha256` (already computed by `taskSources.ts` in `searchGrounded`), caching pre-split lines, lazily computed per-line token `Set`s, and `strippedLines` in a bounded 8 MB map keyed by `${filename}\0${contentSha256}`.

4. **SHA-256-Keyed Unbound AST Cache, Batched Test `ts.createProgram`, and Result Cache ([implementationEvidence.ts](file:///C:/Users/singa/Desktop/hypermemory-sprint2.5/src/memory/implementationEvidence.ts))**:
   - Caches read-only unbound `ts.SourceFile` ASTs by `${source.path}\0${source.currentSha256}` (256-entry bound) so non-test and non-matching files never re-parse. Unbound ASTs are **never** mutated by `ts.createProgram`; only test files passing the relative named-import syntactic check re-parse into a dedicated `programAst` and run inside **one batched `ts.createProgram`** per call (module-isolated because every candidate has a top-level ES `import`).
   - Caches deep-cloned `{ code, tests, limitations }` by `(query.trim(), ordered eligible path:sha256 pairs)` in a 128-entry LRU cache. Any single-byte edit to any inspected `.ts` or `.test.ts` file changes `currentSha256` and bypasses both caches, while `searchGrounded` still re-verifies all returned code/test files from disk before emission.

**Trade-offs**: Caches add up to ~16 MB total module-level memory across `hybridSearch.ts` (8 MB), `groundedSearch.ts` (8 MB + 8 MB token cache), and `implementationEvidence.ts` (256 ASTs / 128 results), all bounded with eviction and keyed deterministically by verified content hashes or exact record fields.

---

## 4. Controlled Before vs. After Benchmark Results

Executed via `node scripts/sprint37-grounding-bench.mjs` (`3` alternating repetitions `before -> after` on an identical frozen 109-file workspace snapshot, `1` warmup + `5` timed samples per query x `30` `HELD_OUT` queries = `150` samples/run, `450` pooled samples per condition):

### 4.1 Overall Latency Comparison

| Benchmark | Before (`7ddba87`) | After (Candidate) | Delta |
|---|---:|---:|---:|
| **Alternating Pooled (`450` samples)** `p50` | **71.02 ms** | **18.85 ms** | **-73.5%** |
| **Alternating Pooled (`450` samples)** `p95` | **220.04 ms** | **34.59 ms** | **-84.3%** |
| **Alternating Pooled (`450` samples)** `mean` | **86.32 ms** | **19.89 ms** | **-77.0%** |
| Alternating Per-Rep `p50` (Reps 1 / 2 / 3) | 71.62 / 69.23 / 71.69 ms | 20.43 / 15.24 / 19.70 ms | -71.5% to -78.0% |
| Alternating Per-Rep `p95` (Reps 1 / 2 / 3) | 220.04 / 210.56 / 229.13 ms | 36.25 / 31.53 / 37.48 ms | -83.5% to -85.0% |
| **Frozen `runRepositoryTaskEvaluation` (`afterSameCorpus`, 82 files)** `p50` | 64.41 ms | 19.34 ms | **-70.0%** |
| **Frozen `runRepositoryTaskEvaluation` (`afterSameCorpus`, 82 files)** `p95` | 169.35 ms | 32.30 ms | **-80.9%** |
| **Live `node scripts/repository-task-eval.mjs` (`repoRoot`, 82 files)** `p50` | 83.35 ms | 20.09 ms | **-75.9%** |
| **Live `node scripts/repository-task-eval.mjs` (`repoRoot`, 82 files)** `p95` | 241.50 ms | 33.26 ms | **-86.2%** |
| `node scripts/sprint29-latency-probe.mjs` `one-source` (`p50` / `p95`) | 10.64 / 14.49 ms | 3.29 / 6.03 ms | -69.1% / -58.4% |
| `node scripts/sprint29-latency-probe.mjs` `multi-source` (`p50` / `p95`) | 18.63 / 26.06 ms | 6.35 / 11.15 ms | -65.9% / -57.2% |

### 4.2 Per-Stage Mean Latency Comparison (Alternating Pooled)

| Stage | Before Mean (ms) | After Mean (ms) | Delta |
|---|---:|---:|---:|
| `candidateMs` | 20.83 | 2.06 | -90.1% |
| `indexingMs` (within `candidateMs`) | 12.80 | 1.20 | -90.6% |
| `rankingMs` | 6.13 | 3.11 | -49.3% |
| `pathMs` | 25.71 | 6.02 | -76.6% |
| `readMs` | 6.91 | 4.29 | -37.9% |
| `hashMs` | 1.01 | 0.79 | -21.8% |
| `excerptMs` | 8.25 | 0.82 | -90.1% |
| `decisionMs` | 17.44 | 2.80 | -83.9% |
| **`totalMs`** | **86.32** | **19.89** | **-77.0%** |

### 4.3 Top Slowest Queries After Optimization

Even the slowest queries (unanswerable queries inspecting all 50 candidates, where I/O and hashing dominate cleanly) now run well under `50 ms`:

| Query Index | Query | Before Median `p50` | After Median `p50` | After Worst `max` |
|---:|---|---:|---:|---:|
| `qi: 29` | What is the next quarterly revenue target? | 122.12 ms | 40.95 ms | 47.99 ms |
| `qi: 23` | Who approved the cloud deployment budget last Tuesday? | 117.34 ms | 37.06 ms | 42.77 ms |
| `qi: 0` | Trace how task leases are claimed through MCP and verified by separate processes. | — | 30.82 ms | 40.03 ms |
| `qi: 27` | What is the unreleased project acquisition price? | 85.48 ms | 29.36 ms | 35.91 ms |
| `qi: 14` | Find the context header budget and compression tests for workspace state. | **269.53 ms** | **< 21.5 ms** | — |
| `qi: 7` | Locate artifact-linked memory search implementation and its regression tests. | **220.04 ms** | **< 21.5 ms** | — |

---

## 5. Evidence, Claim, Relationship, and Assertion Correctness Comparison

In `scripts/sprint37-grounding-bench.mjs`, a deep field-by-field comparison across all `30` `HELD_OUT` queries between `7ddba87` and the optimized implementation verified **30 / 30 identical queries (`0` diffs)** across `status`, `canAssert`, `conflictOrigin`, `conflictPaths`, `candidates`, `evidence` (IDs, paths, hashes, statuses, lines, excerpts, lexical support), `assertions`, `claims`, `relationships`, `compoundAnswer`, `implementationEvidence`, and `staleSources`.

On `runRepositoryTaskEvaluation` (`before` vs `afterSameCorpus` and live `repoRoot`):
- `raw`: `precisionAt5 = 0.47`, `recallAt5 = 0.7208`, `microPrecisionAt5 = 0.47`, `microRecallAt5 = 0.7121`, `meanReciprocalRank = 0.875`, `relevantReturned = 47 / 66`, `forgottenLeaks = 0` — **unchanged**.
- `grounded`: `precisionAt5 = 0.42`, `recallAt5 = 0.6417`, `microPrecisionAt5 = 0.42`, `microRecallAt5 = 0.6364`, `meanReciprocalRank = 0.8292`, `relevantReturned = 42 / 66`, `noAnswerFalsePositives = 0`, `noAnswerUnsupportedAssertionRate = 0`, `answerableCandidateCoverage = 1.0`, `staleProbe = { attempted: 20, candidates: 20, flagged: 20, leaks: 0 }` — **unchanged**.

---

## 6. Independent-Process MCP Compatibility & Grounded Regression Verification

Verified by packing `hypersabmemory-1.4.1.tgz`, installing it in an isolated temporary workspace, and querying an independent stdio MCP server process (`node .../dist/cli/index.js mcp`) in `scripts/sprint37-grounding-bench.mjs`:

| # | Regression Category | Tool(s) Called | Observed Result | Status |
|---:|---|---|---|---|
| 1 | Exact symbol definition | `hypersabmemory_query_evidence` | `answerVerified: true`, `assertions[0].sourcePath = "widget.ts"` | **PASS** |
| 2 | Exact JSON value | `hypersabmemory_query_evidence` | `answerVerified: true`, `claims[0] = { type: "json_scalar", value: "4321" }` | **PASS** |
| 3 | Exact Markdown decision | `hypersabmemory_query_evidence` | `answerVerified: true`, `claims[0].type = "recorded_decision"`, `"Use SQLite for task coordination."` | **PASS** |
| 4 | Explicit cross-file decision-to-constraint | `hypersabmemory_task_grounded_query` | `status: "SUPPORTED"`, `canAssert: true`, `relationships[0].status = "verified"` | **PASS** |
| 5 | Implementation & TypeScript test attribution | `hypersabmemory_query_evidence` | `code[0].symbol = "tallyCrates"`, `tests[0] = { name: "totals stock", execution: "unverified" }` | **PASS** |
| 6 | Stale-source after file edit | `hypersabmemory_task_grounded_query` | `status: "STALE_EVIDENCE"`, `canAssert: false`, `design/storage-choice.md` flagged `modified` | **PASS** |
| 7 | Same-size file rewrite | `hypersabmemory_task_grounded_query` | `status: "STALE_EVIDENCE"`, `canAssert: false`, `config.json` flagged `modified` (`4321` -> `4322`) | **PASS** |
| 8 | Forgotten memory excluded | `hypersabmemory_forget` + `query` + `query_evidence` | `answerVerified: false`, `records: []`, `0` token/id leaks in records/evidence/claims | **PASS** |
| 9 | Unanswerable & evaluative compliance abstention | `hypersabmemory_query_evidence` | `answerVerified: false`, `assertions: []`, clean abstention | **PASS** |

`npm run package:smoke` also passed end-to-end against the freshly packed `hypersabmemory-1.4.1.tgz` (`183` files, `195.8 kB` packed, `891.4 kB` unpacked), verifying two concurrent stdio MCP agents, lease fencing, stale-source detection, cross-file links, compact handoff, and implementation evidence (`code` latency `p50: 25.72 ms / p95: 36.04 ms`, `code-and-test` `p50: 28.75 ms / p95: 38.36 ms`).

---

## 7. Full Engineering Verification Results

All engineering verification commands ran sequentially on the final optimized codebase:

- `npx.cmd tsc --noEmit`: **PASS** (exit 0)
- `npm.cmd run build`: **PASS** (exit 0)
- `npm.cmd test`: **PASS** — **44 test files passed, 294 tests passed** (includes new optimization invariance & batch isolation tests in `tests/groundedSearch.test.ts` and `tests/implementationEvidence.test.ts`)
- `npm.cmd run eval` (`tests/memorybench.test.ts`): **PASS** — **8 / 8 tests passed** (meets recall >= 0.8, 0 forgotten-fact leaks, adversarial F4 classes pass)
- `npm.cmd run eval:baseline` (`scripts/retrieval-baseline.mjs`): **PASS** (`passed: true`, 500 records, `recallAt5: 1.0`, `meanReciprocalRank: 1.0`, `staleLeaks: 0`, `latencyMs p50: 1.55 ms / p95: 2.93 ms`, `estimatedTokens: 243 <= 1500`; note `precisionGateValid: false` on the 7-case default subset because 1 relevant record / top-5 caps max precision at `0.2`)
- `npm.cmd run package:smoke`: **PASS** (exit 0)
- `node scripts/sprint29-latency-probe.mjs`: **PASS** (`one-source p50: 3.29 ms / p95: 6.03 ms`, `multi-source p50: 6.35 ms / p95: 11.15 ms`)
- `node scripts/sprint36-handoff-bench.mjs`: **PASS** (`watcher-provenance` compact `p50: 11.33 ms / p95: 16.37 ms`, `65.4%` bytes saved; `linked-constraints` compact `p50: 11.51 ms / p95: 15.91 ms`, `65.3%` bytes saved)
- `node scripts/sprint37-grounding-bench.mjs`: **PASS** (30/30 identical query outputs, pooled `p50: 18.85 ms / p95: 34.59 ms`, 9/9 MCP regression checks pass)
- `node scripts/repository-task-eval.mjs`: **`passed: false`, exit code `1`** (`latencyMs.p95` now passes at `33.26 ms < 100 ms`; retrieval precision/recall and broad `supportedAnswerCoverage` gates remain below the original thresholds — analyzed in Sections 8–9 below).

---

## 8. Audit of Existing Evaluation, Packaging, and CI Flows

Inspection of [package.json](file:///C:/Users/singa/Desktop/hypermemory-sprint2.5/package.json), [.github/workflows/ci.yml](file:///C:/Users/singa/Desktop/hypermemory-sprint2.5/.github/workflows/ci.yml), [src/eval/repositoryBaseline.ts](file:///C:/Users/singa/Desktop/hypermemory-sprint2.5/src/eval/repositoryBaseline.ts), and [src/eval/repositoryTaskEvaluation.ts](file:///C:/Users/singa/Desktop/hypermemory-sprint2.5/src/eval/repositoryTaskEvaluation.ts) identified the following governance gaps:

1. **`repository-task-eval.mjs` is decoupled from CI and `prepublishOnly`**:
   - `package.json` `prepublishOnly` runs `npm test && npm run eval && npm run eval:baseline && npm run package:smoke`.
   - `.github/workflows/ci.yml` (`ubuntu-latest`, `windows-latest`, `macos-latest` on Node `20`, `22`, `24`) runs `npx tsc --noEmit`, `npm test`, `npm run eval:baseline`, and `npm run package:smoke`.
   - Neither CI nor `prepublishOnly` executes `node scripts/repository-task-eval.mjs`. An automated publish gate today would appear green even while `repository-task-eval.mjs` returns `passed: false` (exit `1`).
2. **`eval:baseline` (`repositoryBaseline.ts`) defaults to the 7-query legacy subset**:
   - Without `--30`, `precisionGateValid` is `false` (`maximumPrecisionAt5 = 0.2`) and `noAnswerFalsePositiveRate = 1.0`, yet `passed` returns `true` (`recallAt5 >= 0.8 && staleLeaks === 0 && withinLimit`).
3. **Nature of the remaining `repository-task-eval.mjs` failures**:
   - The `latencyMs.p95 < 100 ms` gate now passes by ~3x (`33.26 ms` vs `100 ms`).
   - All safety/provenance checks in `repository-task-eval.mjs` pass (`forgottenLeaks: 0`, `staleSourceTested: true`, `staleProbe: 20/20 flagged, 0 leaks`, `noAnswerFalsePositives (grounded assertions): 0`, `noAnswerUnsupportedAssertionRate: 0`, `unsupportedAssertions: 0`, `answerableCandidateCoverage: 1.0`).
   - What fails is expecting **broad semantic prose synthesis** (`mean(precision) >= 0.50`, `mean(recall) >= 0.85`, `groundedPrecisionAt5 >= 0.50`, `groundedRecallAt5 >= 0.85`, and `supportedAnswerCoverage > 0`) from an engine deliberately architected around deterministic lexical retrieval and narrow exact-claim verification (`json_scalar`, `quoted_text`, `recorded_decision`/`rationale`/`constraint`, explicit symbol definitions, and local TypeScript import links). The 20 answerable `HELD_OUT` prompts (e.g., *"Trace how task leases are claimed through MCP and verified by separate processes."*) require 3–4 multi-file prose explanations, yielding `0 / 20` deterministic assertions (`supportedAnswerCoverage = 0`).

---

## 9. Release-Contract Decision Options for Product-Owner Approval

Because HyperSABMemory's empirical value in Sprints 3.4–3.7 lies in **deterministic cross-session context preservation, stale/forgotten safety enforcement, explicit provenance, and sub-35 ms grounded search** rather than broad natural-language answer synthesis, there are two explicit product paths:

| Dimension | Option A: Retain Original Release Contract (No Change) | Option B: Adopt Evidence-Harness & Provenance Release Contract |
|---|---|---|
| **Core Product Claim** | General semantic multi-file retrieval & grounded answer synthesis (`precision@5 >= 0.50`, `recall@5 >= 0.85`, `supportedAnswerCoverage > 0` on `HELD_OUT` traces) | Deterministic cross-session context harness, verified exact-source claims (`symbol`, `JSON`, `Markdown`), explicit cross-file links, stale/forgotten rejection, and bounded agent handoff (`task_context`) |
| **Current Status** | **NO-GO** (Blocked on retrieval accuracy & answer coverage) | **Candidate Ready for Owner Sign-Off** (currently remains **NO-GO** until owner formally approves & updates release gates) |
| **Current Performance vs Gate** | **Fails 5 gates**: raw P@5 (`0.47 < 0.50`), raw R@5 (`0.72 < 0.85`), grounded P@5 (`0.42 < 0.50`), grounded R@5 (`0.64 < 0.85`), `supportedAnswerCoverage` (`0 <= 0`) | **Meets all proposed deterministic, provenance, safety, compatibility, packaging, and latency targets** (`p95 = 33.26 ms < 100 ms`) |
| **Engineering Cost to Reach GO** | High / speculative: requires embeddings/semantic reranker + LLM or formal static-analysis synthesizer (violating lightweight zero-inference local guarantees) | Low / governance-focused: formally ratify narrower release contract, wire deterministic release checks into CI/`prepublishOnly`, and continue keeping semantic synthesis out of `canAssert` |
| **How Broad Multi-File Reasoning Is Verified** | Inside static `repository-task-eval.mjs` fixture thresholds | Evaluated separately via integrated coding-agent maintenance benchmarks (Sprints 3.5–3.6 methodology: repo-only vs HyperSABMemory completion) |

### Proposed Option B Release Contract (Concrete Verification Gates & Numeric Thresholds)

If approved by the product owner in a future milestone, Option B would govern releases via explicit, verifiable contracts across 8 dimensions:

1. **Deterministic Verifiable Claims**: `100%` pass rate and `0` unsupported assertions (`canAssert === false` on negative/compound/conflicting/missing-source cases) across `widget`/symbol declarations, JSON scalars (`unique_json_scalar`), quoted strings (`exact_quotation`), and Markdown `Decision:`/`Rationale:`/`Constraint:` claims (verified in `tests/groundedSearch.test.ts` + 9-case MCP regression).
2. **Candidate Retrieval & Provenance (`repository-task-eval.mjs`)**: `answerableCandidateCoverage === 1.0`, `grounded.unsupportedAssertions === 0`, `grounded.noAnswerUnsupportedAssertionRate === 0`, and non-regressing baseline candidate ranking (`raw.recallAt5 >= 0.70`, `raw.meanReciprocalRank >= 0.80`, `grounded.meanReciprocalRank >= 0.80`) with every evidence citation carrying current 64-hex `sha256` + `freshness: 'current'`.
3. **Freshness & Same-Size Rewrite Detection**: `staleSourceTested === true` with `100%` detection (`staleProbe.flagged === staleProbe.attempted`, `staleProbe.leaks === 0`), symlink/junction containment (`status: 'unavailable'`), and same-size byte modification detection.
4. **Forgotten & Superseded Memory Exclusion**: `forgottenLeaks === 0` across `tests/memorybench.test.ts` (`recall >= 0.80`), `scripts/retrieval-baseline.mjs` (`staleLeaks === 0`), `repository-task-eval.mjs`, and independent-process MCP queries (`0` leaked records/text).
5. **Explicit Cross-File Relationships & Implementation Evidence**: Verified `explicit_decision_source` links + `collectImplementationEvidence` AST/TypeChecker links (`execution: 'unverified'` explicitly preserved) with mid-check file mutation rejection (`0` false test links on shadowed/type-only imports).
6. **Cross-Session Task Restoration & Lease Safety**: `hypersabmemory_task_claim` / `checkpoint` fencing, stale-owner rejection, and single-call compact restoration (`hypersabmemory_task_context({ compact: true })`) keeping ledger shell reads at `0`, MCP calls at `1`, and compact handoff `p95 <= 50 ms` (currently `15.91–16.37 ms`).
7. **MCP Compatibility & Packaging**: Clean `npx tsc --noEmit`, `npm test` (`294/294`), `npm run package:smoke`, and 9/9 independent-process packed-tarball MCP verification checks over stdio.
8. **Grounded Search Latency SLA**: `latencyMs.p95 < 100 ms` on the `repository-task-eval.mjs` 82-file / 30-query workload (achieved: **`31.55–34.59 ms`** vs `169.35–241.50 ms` baseline) and `p95 < 25 ms` on single/multi-source `sprint29-latency-probe.mjs` (achieved: **`6.03 ms` / `11.15 ms`**).
*(Broad open-ended architectural reasoning and patch quality remain explicitly out-of-scope for deterministic grounding assertions and are measured separately through end-to-end coding-agent evaluations.)*

---

## 10. Product-Owner Recommendation and Explicit Release Status

- **Recommendation**: **Recommend Option B** to the product owner as the accurate, defensible release contract matching HyperSABMemory's deterministic context-harness architecture and demonstrated user value, paired with adding the Option B verification script (`sprint37-grounding-bench.mjs` / MCP regression) to CI alongside `package:smoke` once ratified. Note also that under Option A, NO-GO remains indefinitely blocked unless a major semantic synthesis architecture is introduced.
- **Current Decision**: **Product release remains NO-GO.** Neither `src/eval/repositoryTaskEvaluation.ts` nor `src/eval/repositoryTaskFixture.ts` was altered in Sprint 3.7, and no Option B gate changes should be enacted until the product owner explicitly approves Option B over Option A.
