# HyperSABMemory — Option B Developer-Preview Acceptance Contract Proposal

**Product Direction (Option B)**: **APPROVED** (positioning scope only)

**Proposed Numeric Thresholds**: **PENDING PRODUCT-OWNER APPROVAL**

**Replacement Release Contract**: **UNAPPROVED** (frozen gates in `src/eval/repositoryTaskEvaluation.ts` and `scripts/release-preflight.mjs` remain active and fail-closed)

**Official Product Release Status**: **`NO-GO`**

---

## 1. Product Scope & Architectural Boundary

Under the product owner's approved Option B direction:

> HyperSABMemory is a local-first, source-verifiable memory and task-continuation harness for coding agents. It preserves development context, restores unfinished work, verifies source provenance, and exposes bounded evidence through MCP.

This proposal replaces implicit expectations of open-ended autonomous question answering with a strict, auditable contract organized into four categories:

- **A. Safety and Correctness Guarantees**: Non-negotiable fail-closed protections against false verified assertions, stale evidence reuse, forgotten/superseded data leakage, workspace escape, worktree contamination, lock/write corruption, and false static test attribution.
- **B. Retrieval Usefulness Requirements**: Quantitative top-5 retrieval and candidate-noise expectations, separated cleanly from `answerableCandidateCoverage`, plus positive deterministic claim coverage so an always-abstaining system cannot pass.
- **C. Performance and Operational Reliability Requirements**: Workload-specific latency, response-size, recovery, packaging, and multi-OS/runtime budgets (distinguishing observed sample metrics from universal hard upper bounds).
- **D. Explicit Non-Guarantees**: Capabilities intentionally excluded from HyperSABMemory's direct guarantees.

---

## 2. Category A — Mandatory Safety Guarantees

Safety gates are mandatory in both **Profile 1 (Limited Developer Preview)** and **Profile 2 (Stable Public Release)** and must never be weakened to obtain a green release. Passing zero-failure checks on finite test suites demonstrates observed conformance on tested inputs; it does not constitute formal proof that edge-case failures are impossible.

| ID | Safety Gate | Mandatory Requirement (`PENDING PRODUCT-OWNER APPROVAL`) | Enforcement Mechanism & Primary Verification |
|---|---|---|---|
| `A.1` | Unsupported verified assertions | `0` unsupported assertions (`canAssert === true` / `answerVerified === true` only when every cited check passes exact deterministic verification) | `searchGrounded`, `tests/groundedSearch.test.ts` (`36/36`), `repositoryTaskEvaluation` (`0/30` held-out; `0/20` independent ans+unans on Sprint 4.3 `ni`/`commander`) |
| `A.2` | Forgotten-memory leakage | `0` forgotten or superseded records surfaced across raw search, grounded verification, and `task_context` restoration | `SqliteStore` status filtering, `tests/memorybench.test.ts` (`8/8`), `repositoryTaskEvaluation` (`0` leaks), `sprint42-worktree-eval` |
| `A.3` | Stale-source leakage | `100%` detection of missing/modified cited files including same-byte-size content rewrites (`STALE_EVIDENCE`), with `0` stale excerpts/assertions emitted | Current SHA-256 verification in `taskSources.ts` & `groundedSearch.ts`, `repositoryTaskEvaluation` (`staleProbe: 20/20`, `0` leaks), `sprint42-worktree-eval` |
| `A.4` | Conflicting evidence and abstention | Contradictory claims, caller-declared conflicts, duplicate hash mismatches, or ambiguous keys abstain (`canAssert: false`, `CONFLICTING_EVIDENCE`) | `tests/groundedSearch.test.ts`, `tests/sprint28FactReconciliation.test.ts`, `package:smoke` |
| `A.5` | Source-hash verification | Every verified evidence item and compact handoff source reference carries current 64-hex disk SHA-256 and exact verified line/excerpt when unique; mid-check mutations rejected | `captureTaskSources`, `verifyTaskSourceContent`, `tests/taskSources.test.ts`, `tests/efficientDecisionEvidence.test.ts` |
| `A.6` | Workspace containment | Relative `../` traversal and escaping symlinks outside the workspace root rejected (`isError: true`); symlinked workspace roots still contained safely | `canonicalExistingPath` / `verifyGitWorktree` / `resolveContainedPath`, `tests/storeContainment.test.ts`, `tests/taskLedger.test.ts`, `sprint42-worktree-eval` (Linux POSIX + Win junctions) |
| `A.7` | Git worktree isolation | Linked worktrees share `<commonDir>/info/exclude` containment without mutating tracked files, while keeping `.git` checkpoint locks, task ledgers, and memory stores isolated per worktree | `src/harness/gitWorktree.ts`, `src/hooks/autoCommit.ts`, `tests/worktreePortability.test.ts` (`6/6`), `tests/autoCommitGuards.test.ts` (`2/2`), `sprint42-worktree-eval` |
| `A.8` | Atomic-write integrity | Store writes serialize under `withFileLock` and replace atomically via `fs.renameSync(tmp, dest)` once written; retry only `EPERM`/`EBUSY` (`5` attempts max, `[20, 40, 80, 160]` ms backoff, `300 ms` max cumulative sleep `< 2000 ms` lock budget); never delete destination first or retry full read-modify-write | `src/memory/fileLock.ts`, `tests/atomicStoreWrites.test.ts` (`8/8`), `tests/concurrency.test.ts` (`8/8`) |
| `A.9` | Failed-write recovery | Persistent rename failure or non-retryable I/O error (`EIO`) throws cleanly, preserves prior committed store on disk and in memory, preserves `.tmp` with recovery guard (`failedTemporaryContents`), and releases `.lock` | `src/memory/sqliteStore.ts`, `tests/atomicStoreWrites.test.ts` (`5`-`EPERM` exhaustion & `EIO` cases) |
| `A.10` | Task lease fencing | Concurrent agents claiming or updating a task require valid ownership/generation; stale lease holders fail (`OWNERSHIP_CONFLICT` / `CLAIM_CONFLICT`) rather than overwriting | `TaskLedger.claim`, `tests/taskLedger.test.ts`, `tests/taskProcesses.test.ts`, `package:smoke` |
| `A.11` | Task-restoration correctness | Interrupted-task restoration (`task_context({ compact: true })`) returns active goal, verified provenance, stale eviction, and filters completed tasks cleanly | `tests/taskAnswerBundle.test.ts`, `scripts/sprint36-handoff-bench.mjs` (`7/7`), `sprint42-worktree-eval` |
| `A.12` | Static test-attribution false positives | TypeScript AST + TypeChecker linking accepts direct, curried/tagged Vitest `.each`, and `node:test`/`node:assert` bindings only via resolved value imports (`execution: "unverified"`), rejecting `import type`, local shadowing, and ambiguous bindings (`0` false links) | `src/memory/implementationEvidence.ts`, `tests/implementationEvidence.test.ts` (`21/21`), `tests/groundedSearch.test.ts` (`36/36`), `sprint40-independent-eval` (`0` false links on `ni`/`commander`) |

---

## 3. Category B — Retrieval Usefulness & Resolving the `supportedAnswerCoverage > 0` Mismatch

### Why Retrieval Relevance Cannot Be Replaced by Candidate Availability

In `src/eval/repositoryTaskEvaluation.ts`, `grounded.answerableCandidateCoverage` (`1.0000`) measures only whether *at least one* evidence record appeared on answerable queries. It does not ensure that top-5 results contain the files an agent needs or that unanswerable queries remain free of misleading matches. Low precision forces coding agents to read noisy files or misread lexical overlaps; low recall omits ~30% of required files across top-5 slots. Option B must therefore gate explicit retrieval relevance metrics alongside safety.

### Why `supportedAnswerCoverage > 0` Mismatches Option B (and How to Replace It Safely)

In `src/eval/repositoryTaskEvaluation.ts`, `supportedAnswerCoverage` equals `(count of answerable queries with grounded.canAssert === true) / answerable.length`. The 20 held-out queries are open-ended natural-language architecture prompts (e.g., *"Trace how task leases are claimed..."*), whereas `searchGrounded` verifies only deterministic structured claims (`symbol`, `json_scalar`, `quoted_text`, explicit `Decision:`/`Decision-Source:` links, and TypeChecker test links). Because HyperSABMemory intentionally refuses to fabricate free-form prose assertions on open-ended prompts, `supportedAnswerCoverage` is deterministically `0` even when top-5 sources are retrieved accurately.

**However**, deleting `supportedAnswerCoverage > 0` without a replacement creates an **"always abstain" loophole**: an implementation that returns `canAssert: false` on every input would achieve `0` unsupported assertions automatically. Therefore, under Option B, broad prose `supportedAnswerCoverage > 0` should be replaced only by **Dual Positive Coverage & Abstention Requirements**:

1. **Positive deterministic coverage (`>= 0.90` Developer Preview / `>= 0.95` Stable Release, `PENDING PRODUCT-OWNER APPROVAL`)**: On pre-registered queries targeting supported deterministic forms (exact symbols, scoped JSON scalars, quoted text, explicit `Decision-Source:` links, direct/parameterized test links), HyperSABMemory **must** emit verified `canAssert: true` assertions (`>= 1` accurate deterministic assertion) rather than abstaining.
2. **Accurate abstention on unsupported/unanswerable inputs (`100%` abstention: `noAnswerUnsupportedAssertionRate === 0`, `PENDING PRODUCT-OWNER APPROVAL`)**: When evidence is absent, ambiguous, stale, or open-ended prose beyond deterministic forms, `canAssert` / `answerVerified` must be `false`.

Until explicit product-owner sign-off replaces the frozen release contract, `supportedAnswerCoverage > 0` in `src/eval/repositoryTaskEvaluation.ts` and `scripts/release-preflight.mjs` remains active and untouched.

---

## 4. Category C — Performance & Operational Reliability Budgets

Latency metrics in Option B use workload-specific budgets rather than a single blended number. **Observed sample p50/p95 latencies measure historical test workloads on benchmark hardware (`win32 Node v22.14.0`, GitHub CI runners); they are empirical compliance targets, not real-time OS guarantees.**

- **Normal memory search (`eval:baseline`)**: Warm lookup over 500 records (`p50: 1.74 ms`, `p95: 2.81 ms` local Gate 4 `v22.14.0`).
- **Held-out grounded search (`repositoryTaskEvaluation`, `n=150`)**: `p95 < 100 ms` (`30.88 / 63.92 ms` standalone, `55.67 ms` via `release:preflight` on `2ebb975`).
- **Warm MCP `query_evidence` (ordinary source vs. implementation+test)**: Warm ordinary `p95 <= 50 ms` (`13.51–16.79 ms` observed in Sprint 4.3 `ni`/`commander`); warm TypeChecker test linking `p95 <= 50 ms` (`9.32–18.62 ms` observed).
- **Cold first MCP `query_evidence` (`TypeScript TypeChecker`)**: Cold `ts.createProgram` budget `p95 <= 500 ms` on medium repos (`140.39–294.54 ms` cold observed on `ni`/`commander`; larger monorepos >1k TS files not benchmarked).
- **Compact task restoration (`task_context({ compact: true })`)**: Warm `p95 <= 50 ms` and `>= 50%` byte reduction vs. verbose restoration (`15.08–18.58 ms` p95 and `-65.9%` to `-66.1%` observed in `sprint36-handoff-bench`).
- **Package startup & offline setup**: Offline `setup` `< 5 s` (`1.75–1.95 s` standalone observed), MCP startup & discovery `< 3 s` (`1.42–1.43 s` observed), response payloads bounded (`limit: 5` `<= 16 kB`; `4.5–6.4 kB` observed).
- **Atomic-write overhead & fault recovery**: `0 ms` retry sleep on uncontended writes (`p50: 4.29 ms`, `p95: 5.75 ms`), bounded `300 ms` maximum backoff across `5` attempts (`354–371 ms` under injected multi-`EPERM`).
- **Cross-platform installation & execution**: Clean `9/9` CI pass across `ubuntu-latest`, `windows-latest`, and `macos-latest` on Node `20`, `22`, and `24` (achieved in Gate 4 Run `45372059755`).

---

## 5. Category D — Explicit Non-Guarantees

Even after Option B approval, HyperSABMemory explicitly does **not** guarantee:

1. **Broad semantic synthesis** over arbitrary natural-language architecture prose (`supportedAnswerCoverage` remains `0` on open-ended conceptual queries).
2. **Autonomous implementation or patch correctness** generated by an external coding agent consuming MCP context.
3. **Runtime test execution or pass/fail proof** inferred from static implementation-to-test links (static AST attribution always sets `execution: "unverified"`).
4. **Universal coding-agent productivity or pass-rate superiority** across unseen software engineering benchmarks.
5. **Zero irrelevant candidate records or zero lexical overlap** in unverified `candidate_excerpt` / `weak_lexical_candidates` slots when unanswerable queries share repository tokens (e.g., `"Commander"` in `cmd_unans_sqlite`).
6. **Universal compatibility** on untested OSes, Node versions (`< 20`), case-sensitive/network-mounted filesystems beyond tested runners, or offline npm installs when `prebuild-install` native `better-sqlite3` binaries cannot be built locally.

---

## 6. Exact Metric Definitions (`src/eval/repositoryTaskEvaluation.ts`)

Every retrieval metric below uses exact corpus snapshots. **Do not combine or compare metrics across different corpus versions without noting corpus counts.** Note that the frozen 30-query internal corpus (`89` records / `88` real `.ts`+`Architecture.md` files on `2ebb975`) has been repeatedly inspected during Sprints 2.5–4.3 and is **development-observed baseline evidence**, not untouched independent proof.

- **Raw Precision@5 (macro)**: Mean over answerable queries (`Q_ans = 20`) of `(relevant docs in hybrid.searchRecords(q, 5)) / 5`. Bounded above by `maximumPrecisionAt5 = mean(|relevant_q| <= 5 ? |relevant_q|/5 : 1)` (`0.6600` on Gate 4 corpus; `66` total relevant pairs across `20` answerable queries -> average `3.3` relevant files/query).
- **Raw Recall@5 (macro)** vs. **Micro Recall@5**: Macro averages `|hits_q@5| / |relevant_q|` across answerable queries (`48/66` micro `0.7273`, macro `0.7375` on `2ebb975`).
- **Grounded Precision@5 & Recall@5 (macro)**: Same denominators (`5` and `|relevant_q|`), evaluated over `searchGrounded(hybrid, root, q, sources).evidence` (`limit: 5`, retaining verified current-source evidence; micro `46/66 = 0.6970`, macro `R@5 = 0.7042`, `P@5 = 0.4600` on `2ebb975`).
- **Mean Reciprocal Rank (MRR)**: Mean over `Q_ans` of `1 / rank(first relevant hit)`, `0` if none (`0.8750` for both raw and grounded on `2ebb975`).
- **Top-1 Success Rate**: Fraction of `Q_ans` where rank `1` is in `relevant_q` (`1 - incorrectFirstResultRate` when measured over answerable set; `5/7 = 0.7143` on `ni`, `7/7 = 1.0000` on `commander`; `raw incorrectFirstResultRate = 0.4333` over all `30` queries on `2ebb975` includes `9/10` unanswerable lexical hits).
- **Unsupported-Query Candidate Noise**: Fraction of unanswerable queries (`Q_unans = 10` on internal eval; `6` combined on `ni`+`commander`) emitting `grounded.evidence.length > 0` (`grounded.noAnswerCandidateRate = 0.4000` [`4/10`] internal; `5/6` candidate/excerpt overlap independent with `0/6` `answerVerified: true`).
- **Verified Answerability Classification**: Correct assignment of `evidenceClassification` (`verified_answer`, `unverified_source_evidence`, `weak_lexical_candidates`, `memory_only_no_source_evidence`, `stale_evidence`, `conflicting_evidence`, `insufficient_evidence`) with `answerVerified === true` exclusively when deterministic claims verify (`100%` on `Sprint 4.3` `6/6` independent unanswerable + `tests/mcpQuery.test.ts` `12/12`).

---

## 7. Proposed Acceptance Threshold Profiles (`PENDING PRODUCT-OWNER APPROVAL`)

All numeric requirements in **Profile 1 (Limited Developer Preview)** and **Profile 2 (Stable Public Release)** are **`PENDING PRODUCT-OWNER APPROVAL`**. Thresholds below reflect actual coding-agent utility and independent evaluation requirements rather than lowering bars to fit current scores.

| Metric | Exact Definition & Scope | Profile 1: Limited Developer Preview (`PENDING PRODUCT-OWNER APPROVAL`) | Profile 2: Stable Public Release (`PENDING PRODUCT-OWNER APPROVAL`) | Current Observed Result & Corpus Snapshot | Why It Matters to Users | Supporting Evidence & Sample Size (`n`) | Known Limitations & Current Status | Required Improvement if Failing |
|---|---|---|---|---|---|---|---|---|
| **Unsupported verified assertions** | `grounded.noAnswerUnsupportedAssertionRate` & `grounded.unsupportedAssertions` | `0` (`=== 0`, `PENDING PRODUCT-OWNER APPROVAL`) | `0` (`=== 0`, `PENDING PRODUCT-OWNER APPROVAL`) | `0` held-out (`2ebb975`, `n=30`); `0` independent (`ni`+`commander`, `n=20`); `36/36` unit | Agents must never cite false verified facts | `repositoryTaskEvaluation`, `tests/groundedSearch.test.ts`, `sprint40-independent-eval` (`n=50` total queries) | Verified within deterministic scope; semantic prose excluded -> **Passes locally / pending PO sign-off** | None for deterministic core |
| **Positive deterministic claim coverage** | Share of pre-registered deterministic probes (`symbol`, `json_scalar`, `Decision-Source`, direct/param tests) returning `canAssert: true` / valid link with `0` false positives | `>= 0.90` on supported forms, `0` false test links (`PENDING PRODUCT-OWNER APPROVAL`) | `>= 0.95` on supported forms, `0` false test links (`PENDING PRODUCT-OWNER APPROVAL`) | `38/38` & `2/2` param (`ni`); `50/50` & `2/2` `node:assert` (`commander`); `21/21` `implementationEvidence`; `9/9` MCP `sprint37` | Prevents trivial "always abstain" pass while ensuring real coding utility | `sprint40`, `sprint43`, `tests/implementationEvidence.test.ts`, `tests/groundedSearch.test.ts` | Measured on pre-specified probes; untouched multi-repo baseline still needed -> **Partially verified locally; pending independent eval** | Broaden test DSLs only if unseen repos require |
| **Forgotten & stale leaks** | Forgotten leaks + stale (incl. same-size rewrite) leaks across retrieval, grounded, handoff | `0` forgotten leaks, `100%` stale detection, `0` stale leaks (`PENDING PRODUCT-OWNER APPROVAL`) | `0` leaks + concurrent mid-read TOCTOU probe coverage (`PENDING PRODUCT-OWNER APPROVAL`) | `0` forgotten leaks, `20/20` stale flagged (`0` leaks) on `2ebb975`; `sprint42` & `sprint40` `0` leaks | Prevents deleted secrets or outdated code snippets from misleading patches | `tests/memorybench.test.ts` (`8/8`), `repositoryTaskEvaluation`, `sprint42-worktree-eval` | Post-response file edits remain caller responsibility -> **Passes locally; pending PO sign-off** | None |
| **Raw Recall@5 (macro)** | Macro average fraction of `relevant_q` in `hybrid.searchRecords(q, 5)` over answerable queries | Independent eval `>= 0.80`; frozen dev `>= 0.72` *(floor, no regression)* (`PENDING PRODUCT-OWNER APPROVAL`) | Independent eval `>= 0.85`; held-out `>= 0.85` (`PENDING PRODUCT-OWNER APPROVAL`) | Internal frozen `0.7375` (`48/66` micro `0.7273`, `n=20`, `2ebb975`); `ni` `1.0000` (`n=7`), `commander` `0.9286` (`n=7`) | Controls whether BM25+graph surfaces needed files before grounding | `repositoryTaskEvaluation` (`n=20`), `sprint40-independent-eval` (`n=14`) | Internal corpus uses complex multi-file prompts; unseen `n=30` answerable set required -> **Pending independent eval & PO approval (Fails frozen 0.85)** | Add retrieval improvements for Stable Profile 2 |
| **Grounded Recall@5 (macro)** | Macro average fraction of `relevant_q` in `searchGrounded(...).evidence` (`limit: 5`) over answerable queries | Independent eval `>= 0.80`; frozen dev `>= 0.70` *(no regression)* (`PENDING PRODUCT-OWNER APPROVAL`) | Independent eval `>= 0.85`; held-out `>= 0.85` (`PENDING PRODUCT-OWNER APPROVAL`) | Internal frozen `0.7042` (`46/66` micro `0.6970`, `n=20`, `2ebb975`); `combinedDev42` `0.7303` (`Sprint 4.3`) | Primary evidence-finder metric for coding agents | `repositoryTaskEvaluation` (`n=20`), `sprint39-dev-retrieval-eval` (`n=42`) | Currently omits ~30% of labeled internal held-out files in top-5 -> **Fails frozen 0.85; candidate 0.70/0.80 pending PO approval** | Multi-hop symbol/path boosting if `>= 0.85` demanded |
| **Raw & Grounded Precision@5** | Macro average `|relevant in top-5| / 5` over answerable queries *(note capacity ceiling `maxP@5 = mean(min(5, |rel|)/5)`)* | Independent normalized ratio `P@5 / maxP@5 >= 0.45` (`raw/grounded` reported); frozen dev `>= 0.45` (`PENDING PRODUCT-OWNER APPROVAL`) | `>= 0.50` raw & grounded when `maxP@5 >= 0.50` (`PENDING PRODUCT-OWNER APPROVAL`) | Internal frozen (`maxP@5 = 0.6600`): Raw `0.4800`, Grounded `0.4600` (`2ebb975`); `ni` `0.2857`, `commander` `0.3143` (small `|rel|=1..2`) | Limits wasted agent context tokens on filler files | `repositoryTaskEvaluation` (`n=20`), `sprint40` (`n=14`) | Small target counts (`|rel|=1..2`) mathematically cap `P@5` at `0.20–0.40` if `5` slots backfill -> **Fails frozen 0.50; pending PO approval** | Stop backfilling weak candidates once strong hits end |
| **Grounded MRR & Top-1 success** | Rank of first relevant verified file (`MRR`); fraction where rank 1 is relevant (`Top-1`) | Grounded `MRR >= 0.80`, `Top-1 >= 0.70` (`PENDING PRODUCT-OWNER APPROVAL`) | Grounded `MRR >= 0.85`, `Top-1 >= 0.75` (`PENDING PRODUCT-OWNER APPROVAL`) | Internal frozen Grounded `MRR = 0.8750` (`n=20`); `ni` `MRR = 0.8333` / `Top-1 = 0.7143`; `commander` `MRR = 1.0` / `Top-1 = 1.0` | Agents read rank-1 file first; high MRR cuts exploration turns | `repositoryTaskEvaluation` (`n=20`), `sprint40` (`n=14`), `sprint39` (`Top-1: 0.8182`) | Requires unseen acceptance set to remove small-`n` variance -> **Pending independent eval & PO approval** | Maintain ranking quality |
| **Unsupported-query candidate noise & classification** | Rate of unanswerable queries returning `grounded.evidence.length > 0` (`noAnswerCandidateRate`) + `evidenceClassification` correctness | `noAnswerUnsupportedAssertionRate === 0`, `100%` honest non-verified classification (`answerVerified: false`), `noAnswerCandidateRate <= 0.50` (`PENDING PRODUCT-OWNER APPROVAL`) | `noAnswerUnsupportedAssertionRate === 0`, `noAnswerCandidateRate <= 0.25` (`PENDING PRODUCT-OWNER APPROVAL`) | Internal frozen `noAnswerCandidateRate = 0.4000` (`4/10`, `0` unsupported); independent `5/6` candidate/excerpt noise (`cmd_unans_sqlite` unverified_source_evidence), `100%` `answerVerified: false` | Prevents misleading `evidence_found` noise when topic is absent from repo | `repositoryTaskEvaluation` (`n=10`), `sprint43` (`n=6` unans), `tests/mcpQuery.test.ts` (`12/12`) | Lexical token match on repo name (`Commander`) triggers weak/unverified excerpts -> **Independent `5/6` fails `<0.50` strict noise rate unless scored via classification + tighter threshold** | Tighten minimum BM25/term-coverage cutoff for unanswerable noise |
| **Worktree, containment & storage concurrency** | Linked worktree isolation tests (`6/6`), `sprint42-worktree-eval` (`win32` + POSIX `ext4`), `atomicStoreWrites` (`8/8`), `concurrency` (`8/8`) | `100%` CI matrix + Win/Linux worktree eval pass; bounded `5`-attempt atomic retry (`[20,40,80,160]` ms) (`PENDING PRODUCT-OWNER APPROVAL`) | Zero failures across 50-iteration Windows/macOS/Linux concurrency soak (`PENDING PRODUCT-OWNER APPROVAL`) | CI `45372059755`: `9/9` pass (`atomicStoreWrites 8/8`, `concurrency 8/8`, `worktreePortability 6/6`); `10/10` local Win Node `22` concurrency runs; `sprint42` pass Win+Linux | Prevents cross-worktree corruption and Windows `EPERM` store rename crashes | CI Run `45372059755`, Gate 4 `a024e1e`, `sprint42-worktree-eval` | One green CI run (`45372059755`) does not prove permanent elimination of rare Windows filesystem locks -> **Passes preview CI criteria; soak pending for Stable** | Run soak check prior to Stable Release |
| **Workload-specific latency & response size** | Warm/cold MCP latency, compact handoff bytes/latency, atomic-write p95, grounded search p95 | Warm search/MCP `p95 < 100 ms`; cold `ts.createProgram` `p95 < 500 ms`; compact handoff `<= 50 ms` & `>= 50%` byte reduction (`PENDING PRODUCT-OWNER APPROVAL`) | Same + benchmarked on medium/large repo (`>= 500` files) (`PENDING PRODUCT-OWNER APPROVAL`) | Grounded eval `p95 = 63.92 ms` (`release:preflight` `55.67 ms`); warm MCP `9.32–18.62 ms`; cold `140.39–294.54 ms`; handoff `15.08–18.58 ms` (`-66%` B); normal atomic write `p95 = 5.75 ms` | Keeps IDE/MCP interactive inside coding-agent turn budgets | `repositoryTaskEvaluation`, `sprint43`, `sprint36`, `Gate 4` (`50`-write bench) | Cold TypeChecker scales with project size; historical metrics not real-time SLA -> **Meets observed bounds; large-repo scaling pending Stable** | Large-repo cache profiling for Stable |
| **Independent agent continuation** | Unfamiliar repo two-session continuation via installed `setup` + `task_context({ compact: true })`, verified by repo tests | `>= 3` independent tasks across `>= 2` unseen repos passing target + regression tests without hint leakage (`PENDING PRODUCT-OWNER APPROVAL`) | `>= 6` tasks across `>= 3` repos with comparative baseline (`PENDING PRODUCT-OWNER APPROVAL`) | Historical `n=2` Sprint 3.5 + `n=1` `sprint36` + `n=1` `commander` Codex (`48/48` target pass) (`total n=4`, not pre-registered single benchmark) | Validates real session restoration end-to-end | `docs/SPRINT_3_5_CROSS_SESSION_VALUE.md`, `docs/SPRINT_4_0_INDEPENDENT_VALIDATION.md` (`n=1` external) | **Sample too small**; historical Sprint 3.5 had post-hoc edits; Codex sandbox needed `--experimental-test-isolation=none` -> **`UNVERIFIED` / `PENDING` (requires 3 pre-registered tasks)** | Execute bounded 3-task unseen agent check |
| **Cross-platform CI & packaging** | Full `3x3` CI matrix (`ubuntu`, `windows`, `macos` × Node `20`, `22`, `24`), `package:smoke`, no dev fixture bloat if release-packaged | `9/9` `.github/workflows/ci.yml` passing; clean tarball (`171` files) (`PENDING PRODUCT-OWNER APPROVAL`) | `9/9` CI + `3/3` `.github/workflows/release.yml` + tag protection + OIDC + non-eval tarball hygiene (`PENDING PRODUCT-OWNER APPROVAL`) | Run `45372059755`: **`9/9` pass** (`49/49` files, `356/356` tests per job, `0` skipped, `package:smoke` offline MCP pass on all 9 jobs) | Ensures install and native SQLite work cleanly across developer machines | CI Run `45372059755`, [ci.yml](file:///C:/Users/singa/Desktop/hypermemory-sprint2.5/.github/workflows/ci.yml), `package.json` | Standalone `sprint42-worktree-eval.mjs` runs locally (`Win`+`Linux`), not inside `ci.yml`; prerelease publish safeguards need registry hardening for Stable -> **Passes CI; Stable controls pending** | Configure tag/environment protection for Stable |

---

## 8. Acceptance Readiness Assessment Matrix

Statuses allowed: `PASS`, `FAIL`, `UNVERIFIED`, `PENDING OWNER APPROVAL`. Note: CI Run `45372059755` (`9/9` passing) satisfies cross-platform CI compatibility for Gate 4, **but does not make the product ready for release** and does not prove intermittent filesystem races cannot recur.

| # | Area | Profile 1 (Limited Developer Preview) Status | Profile 2 (Stable Public Release) Status | Concise Basis |
|---|---|---|---|---|
| 1 | **Safety** | `PASS` *(finite tests; PO ratification required)* | `PENDING OWNER APPROVAL` | `0` unsupported assertions, `0` forgotten leaks, `20/20` stale caught, containment & worktree isolation verified (`49/49` files); Stable adds concurrency soak |
| 2 | **Retrieval** | `PENDING OWNER APPROVAL` *(Fails frozen contract)* | `FAIL` | Internal frozen `R@5 = 0.7042`, `P@5 = 0.4600`, `supportedAnswerCoverage = 0` (`NO-GO`); independent unseen 3-repo acceptance set not yet run |
| 3 | **Source verification** | `PASS` | `PASS` *(within deterministic scope)* | Exact symbols, scoped JSON scalars, explicit `Decision-Source:`, static `vitest` (direct+`.each`), and `node:assert` verified (`0` false links; current SHA-256) |
| 4 | **Task restoration** | `PASS` *(deterministic harness)* / `UNVERIFIED` *(multi-task agents)* | `UNVERIFIED` | Deterministic ledger, lease fencing, and `-66%` compact restoration verified locally & in CI; multi-task unseen agent eval (`n>=3`) still needed |
| 5 | **Agent-facing evidence classification** | `PASS` *(classification)* / `PENDING OWNER APPROVAL` *(noise threshold)* | `FAIL` *(strict `<=0.25` unans candidate noise)* | Additive `evidenceClassification` separates verified vs weak candidates cleanly; unanswerable lexical backfill stays at `40%` internal / `5/6` independent |
| 6 | **Storage reliability** | `PASS` *(observed on CI Run `45372059755` + `10/10` local concurrency + `8/8` atomic fault tests)* | `UNVERIFIED` *(needs multi-OS 50-run soak)* | Bounded `5`-attempt `[20,40,80,160]` ms rename retries resolved the Windows Node 20 CI failure in `45372059755`; one CI run != impossibility proof |
| 7 | **Performance** | `PASS` | `UNVERIFIED` *(needs >=500-file repo benchmark)* | Held-out `p95 = 55.67–63.92 ms` (`<100 ms`), warm MCP `<20 ms`, compact handoff `<19 ms`, atomic write `p95 = 5.75 ms` |
| 8 | **Package installation** | `PASS` | `PENDING OWNER APPROVAL` | Offline packed `.tgz` (`188.8–189.0 kB`, `171` files) installs and passes `package:smoke` MCP handoff across all 9 CI lanes |
| 9 | **Cross-platform compatibility** | `PASS` *(CI 9/9 + local Win22/Linux24 worktree eval)* | `PASS` *(runtime)* / `UNVERIFIED` *(CI worktree eval step)* | CI Run `45372059755` passed `9/9` (`ubuntu`/`windows`/`macos` × Node `20`/`22`/`24`); standalone `sprint42-worktree-eval` ran locally, not in `ci.yml` |
| 10 | **Documentation** | `PENDING OWNER APPROVAL` | `FAIL` | Gate 5 draft copy authored in this proposal; public [README.md](file:///C:/Users/singa/Desktop/hypermemory-sprint2.5/README.md) & `package.json` remain unedited until owner approval |
| 11 | **Independent evaluation** | `UNVERIFIED` *(post-Gate-4 pre-registered 3-repo run not yet executed)* | `UNVERIFIED` | Prior Sprint 4.0/4.3 validation ran on 2 repos (`ni`, `commander`, `7+3` queries each, `1` Codex task); bounded pre-registered Gate 5 acceptance suite specified below |
| 12 | **Release governance** | `FAIL` *(official gates fail-closed `NO-GO`; replacement contract unapproved)* | `FAIL` | `release:preflight` exits `1` (`5/12` failing); `eval:option-b:shadow` is informational only (`authorizesRelease: false`); npm/tag OIDC hardening unconfigured |

---

## 9. Finite Independent Acceptance Evaluation Plan (Pre-Registered & Bounded)

To certify Option B without overfitting or an open-ended benchmarking campaign, execute **one bounded, pre-registered evaluation** after owner approval of the target thresholds:

### Structure & Isolation Rules
- **Corpus separation**: Select **3 genuinely unseen public MIT/Apache repositories** not referenced during development (`ni`, `commander.js`, and HyperSABMemory itself excluded — e.g., 1 TypeScript Vitest CLI/library, 1 TypeScript/JS `node:test` or mixed library, and 1 multi-module workspace/utility repo with nested configs and README/docs).
- **Pre-registration**: Pin exact commit SHAs, file inventories, ground-truth relevant file sets, expected deterministic assertions, and unanswerable query definitions in a frozen fixture file **before running HyperSABMemory against any of the 3 repos**.
- **Strict no-tuning rule**: Do not modify ranking weights, tokenizers, or heuristics using results from the 3 acceptance repos and re-report the same set as independent. Any implementation change invalidates the untouched label and requires a fresh repository cohort.
- **Installed-package execution**: Run strictly against a packed offline `.tgz` install (`hypersabmemory setup`, `hypersabmemory doctor`, and stdio `hypersabmemory mcp` tool calls). Existing frozen `src/eval/repositoryTaskEvaluation.ts` / `repositoryTaskFixture.ts` remain unmodified.

### Bounded Query & Probe Design (`n = 45` Retrieval + Deterministic Probes + `3` Continuation Tasks)
Per repository (`x 3` repos):
1. **10 Answerable retrieval queries (`30` total across 3 repos)**: Covering multi-file implementation+caller relationships (`>= 2` relevant files), historical architectural decisions (`remember`), configuration lookups, and test-file queries. Record **macro R@5**, **micro R@5**, **MRR**, **Top-1 rate**, and **capacity-capped normalized Precision@5 (`P@5 / maxP@5`)** separately for queries with `|rel| <= 5` vs. `|rel| > 5` (reporting exact `min(5, |rel|) / 5` capacity ceiling so `|rel| > 5` does not penalize recall artifacts silently).
2. **5 Genuinely unanswerable queries (`15` total across 3 repos)**: Out-of-domain technologies plus at least 2 **"near-miss" queries reusing the repo's own project/library name** alongside unsupported subsystems. Require `0` unsupported assertions, `answerVerified === false`, and track `noAnswerCandidateRate` + `evidenceClassification` distribution.
3. **Deterministic verification & safety probes (`3` repos)**: Exact symbol definition (`>= 2`/repo), scoped nested/root JSON scalar (`>= 2`/repo), explicit `Decision:` + `Decision-Source:` multi-source link (`>= 1`/repo) + declared conflict (`>= 1`/repo), static test attribution (`>= 1` direct/parameterized + `>= 1` shadowed/`import type` negative probe/repo), source edit + **same-byte-size rewrite** after indexing (`100%` stale detection, `0` leaks), and **opaque canary forgotten memory** (`0` leaks).
4. **Cross-session task continuation (`1` task per repo = `3` tasks total)**: Seed an unstated requirement via `hypersabmemory_remember` + `task_checkpoint` pointing to target files, launch a fresh agent session prompted only to restore active work via `hypersabmemory_task_context({ compact: true })`, and grade patches deterministically by unmodified repo unit tests + behavior script + zero regressions.

### Statistical Uncertainty & Stopping Conditions
- Report **95% Wilson score confidence intervals** alongside point estimates for Top-1 rate (`n = 30`), no-answer candidate rate (`n = 15`), and positive deterministic assertion coverage (e.g., at `n = 30` queries, `24/30 = 80.0%` has a 95% Wilson CI of `[62.7%, 90.5%]`; exact counts `k/n` must always accompany ratios).
- **Stopping conditions**: Stop evaluation immediately after the single pre-registered pass across the 3 repos (`1` run, `<= 45` queries, `<= 3` agent tasks). If **Profile 1** safety gates (`0` unsupported/stale/forgotten/false-test leaks) AND agreed retrieval/classification thresholds pass, prepare developer-preview tag review. If any mandatory safety gate fails or retrieval falls short of owner-approved floors, halt release/preview progression cleanly and fix the specific defect before drawing a new unseen cohort.

---

## 10. Draft Developer-Preview Positioning Copy (Proposal Only — Do Not Apply Yet)

The copy below is drafted for owner review; **public [README.md](file:///C:/Users/singa/Desktop/hypermemory-sprint2.5/README.md) and [package.json](file:///C:/Users/singa/Desktop/hypermemory-sprint2.5/package.json) have not been modified.**

### Draft `package.json` `description` & README Introduction
> **Draft npm description**: Local-first, source-verifiable MCP context harness and task-continuation memory store for AI coding agents (Developer Preview).
>
> **Draft README introduction**: HyperSABMemory is a **local-first, source-verifiable context harness and task-continuation engine** exposed over MCP for coding agents. It checkpoints active work across interrupted sessions, stores project decisions locally under `.hypersabmemory/`, verifies source provenance (SHA-256 checksums, freshness, exact symbol/JSON scalar lines, and static import-to-test links), and separates **verified deterministic evidence** from **unverified lexical retrieval candidates**. HyperSABMemory does **not** perform broad semantic QA synthesis, guarantee runtime test execution, or guarantee patch correctness.

### Draft MCP Integration & Local Offline Installation (Pre-Publish Developer Preview)
```bash
# 1. Pack or install from local build / verified preview tarball (offline-safe once installed):
npm install -g ./hypersabmemory-1.4.1.tgz   # or: npx / node <installed-path>/dist/cli/index.js setup

# 2. Initialize inside a workspace or linked Git worktree (writes direct Node CLI MCP entries, zero commits):
hypersabmemory setup
hypersabmemory doctor --verify
```
- Generated MCP configs (`.mcp.json`, `.cursor/mcp.json`, `.vscode/mcp.json`, etc.) invoke the installed local `node <path>/dist/cli/index.js mcp` entry directly when resolved offline, falling back explicitly to `npx` only when local installation paths are absent (`doctor --verify` tests stdio handshake directly).
- Linked Git worktrees are isolated per worktree checkout (`.git` pointer safety, separate checkpoint locks and stores, shared `<commonDir>/info/exclude` gitignore containment).

### Draft First-Use Task-Restoration Example
1. Session A records an unstated constraint via `hypersabmemory_remember` and checkpoints active task state via `hypersabmemory_task_checkpoint` referencing target source files.
2. Session B starts fresh, calls `hypersabmemory_task_context({ compact: true })`, receives the active task goal, lease state, and current SHA-256 verified source snapshots (`stale` references automatically flagged/evicted), and resumes implementation immediately without scanning raw ledgers.

### Draft Evidence Classification, Privacy & Known Limitations
- **Verified evidence vs. retrieved candidates**: Inspect `evidenceClassification` and `answerVerified`:
  - `verified_answer` (`answerVerified: true`): deterministic symbol, scoped JSON scalar, explicit `Decision-Source:`, or AST test-link check verified against current disk bytes.
  - `unverified_source_evidence`, `weak_lexical_candidates`, `memory_only_no_source_evidence`: unverified candidates surfaced for human/agent inspection only (`answerVerified: false`); never treat lexical candidates as verified truth.
  - `stale_evidence` / `conflicting_evidence` / `insufficient_evidence`: abstention required (`canAssert: false`).
- **Static test attribution vs. executed tests**: Links from TypeScript/JS modules to `vitest` (`it`/`test`/`it.each`/`test.each`) or `node:test`/`node:assert` tests reflect static TypeChecker value-import bindings and **always** set `execution: "unverified"`—they do not confirm tests were executed or passed.
- **Privacy & storage**: Stored locally under `.hypersabmemory/` (`memory_store.json` + transactional `.tmp`/`.lock`/`.bak`, `task_ledger.json`, `swarm_state.json`, optional local `Memory.md` / `graph.json`); gitignored via repository/common `info/exclude`, with localhost-only optional dashboard bindings. No external LLM/cloud API calls.
- **Supported platforms & known limitations**: Remote Gate 4 CI passed `9/9` across `ubuntu-latest`, `windows-latest`, and `macos-latest` on Node `20`, `22`, and `24` (pre-built/rebuilt native `better-sqlite3@12.9.0` required per target OS/ABI). Standalone multi-worktree script verified locally on Windows and WSL2 Ubuntu `ext4`, not as a CI step. No broad prose synthesis (`supportedAnswerCoverage = 0` on open-ended architecture prompts), limited multi-task agent sample (`n=1` external task so far), and `5/12` original frozen release criteria remain intentionally unmet under [`NO-GO`](../scripts/release-preflight.mjs).

---

## 11. Remaining Release Blockers

- **Blocking Profile 1 (Limited Developer Preview)**:
  1. Explicit product-owner approval of Option B numeric thresholds and replacement positive-coverage definition.
  2. Execution of the bounded 3-repo pre-registered independent acceptance evaluation (including `>= 3` cross-session continuation tasks).
  3. Final approval of scoped README / `package.json` preview wording and non-runtime `dist/eval/*` fixture packaging trim if distributing tarballs/preview tags.
- **Blocking Profile 2 (Stable Public Release)**:
  - All Profile 1 blockers, **plus** stronger retrieval quality (`>= 0.85` macro recall@5, `<= 0.25` no-answer candidate noise), `50`-iteration multi-OS concurrency soak, `>= 500`-file cold TypeChecker scaling evaluation, integrating `sprint42-worktree-eval` into CI, and GitHub Tag/Environment protection + npm OIDC Trusted Publishing setup.

---

## 12. Explicit Product-Owner Decisions Required

Product-owner sign-off is explicitly requested on the following five decisions before any Gate 6 implementation, evaluation activation, or preview distribution:

1. **Decision 1 — Option B Contract Replacement**: Approve replacing the frozen open-ended `supportedAnswerCoverage > 0` criterion in the future Option B release gate with **Dual Positive Deterministic Coverage (`>= 0.90` on supported claim/link classes) + Strict Abstention (`0` unsupported assertions, `100%` abstention on insufficient evidence)** while preserving existing frozen `release:preflight` until ratification?
2. **Decision 2 — Profile 1 Developer-Preview Thresholds**: Approve (or adjust) the exact numeric Profile 1 bars (`>= 0.80` independent / `>= 0.70` frozen-floor grounded `R@5`, normalized `P@5 / maxP@5 >= 0.45`, `MRR >= 0.80`, `Top-1 >= 0.70`, `noAnswerCandidateRate <= 0.50` vs. stricter noise suppression, `< 100 ms` warm / `< 500 ms` cold p95)?
3. **Decision 3 — Unanswerable Lexical Candidate Handling**: For Developer Preview, accept explicit `evidenceClassification` (`weak_lexical_candidates` / `unverified_source_evidence` with `answerVerified: false`) alongside `<= 0.50` candidate noise, or require a stricter pre-preview BM25 cutoff tightening pass to drive unanswerable candidate noise below `0.25`?
4. **Decision 4 — Authorize Gate 5/6 Pre-Registered Independent Acceptance Run**: Authorize running the bounded 3-repo independent acceptance suite (`45` retrieval queries + deterministic probes + `3` continuation tasks) before preview tagging?
5. **Decision 5 — Developer-Preview Distribution Scope**: Confirm that public npm publication remains **`NO-GO`** pending Decision 1–4 completion and preview-channel rules (`0.x`/prerelease tag vs. local/tarball preview only), and authorize drafting public [README.md](file:///C:/Users/singa/Desktop/hypermemory-sprint2.5/README.md) / packaging cleanup only after sign-off.
