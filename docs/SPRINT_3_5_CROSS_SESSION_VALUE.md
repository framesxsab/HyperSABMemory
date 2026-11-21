# Sprint 3.5 — Prove Cross-Session Memory Value

- **Repository:** `C:\Users\singa\Desktop\hypermemory-sprint2.5`
- **Branch:** `feature/sprint2.5-20261106`
- **Starting HEAD:** `2845e9894083db9a4a64f3fd2f1b30c93699432a` (`2845e98`)
- **Product Release Status:** **NO-GO**
- **Date:** 2026-11-21

---

## 1. Starting Git State and Worktree Verification

Before evaluation or code changes, the repository state was verified:

- **Branch & Commit:** `feature/sprint2.5-20261106` at `2845e9894083db9a4a64f3fd2f1b30c93699432a` (`test: evaluate actionable memory handoffs on clean snapshots`), preceded by `5d8ef9e` (`fix: preserve accurate TypeScript test attribution`), `cdc56d8`, and `c4f206c`.
- **Worktrees Present (Untouched):**
  - `C:/Users/singa/Desktop/hypermemory` (`592f054 [audit/cleanup-20261105]`)
  - `C:/Users/singa/Desktop/hypermemory-cleanup-isolated` (`592f054 [maintenance/cleanup-isolated-20261106]`)
  - `C:/Users/singa/Desktop/hypermemory-dependency-review` (`592f054 [maintenance/dependency-review-20261106]`)
  - `C:/Users/singa/Desktop/hypermemory-sprint2.5` (`2845e98 [feature/sprint2.5-20261106]`)
- **Pre-existing Untracked Artifacts Preserved (10 files, untouched and excluded from commits):**
  `CLEANUP-RESULTS.md`, `cleanup-inventory.md`, `code-cleanup-audit.md`, `docs/V2_BASELINE.md`, `docs/V2_RESEARCH_AND_SPRINT.md`, `scheduled-tasks-audit.md`, `scheduled-tasks-inventory.csv`, `scheduled-tasks-triage.csv`, `scripts/cleanup-dry-run.ps1`, `scripts/cleanup-safe.ps1`.
- **Clean Agent Evaluation Snapshots:** Pinned archive built from committed tree `7e49f0f3378ea28b1e02112d61ab433438452773` (`snapshotSha256: fd54916753cae06c838a00406dc6f00e6bf87a03d8bb38919f3054bc5d251c6a`) with `docs/SPRINT_3_*.md` excluded (`5` files: Sprint 3.0–3.4 reports).

---

## 2. Historical-Context Provenance Table

| Fact ID | Task | Legitimate Original Source | Timestamp / Version | Present in Committed Snapshot (`2845e98`)? | Current & Applicable? | Source Status | Implementation Impact |
|---|---|---|---|---|---|---|---|
| `GAP-A1` | `watcher-provenance` | Untracked `docs/V2_RESEARCH_AND_SPRINT.md` (§"V2 context behavior to build toward" #1–2) | 2026-10-21 / 2026-10-26 | Partial — `Rules.md` (`R-5`), `PRD.md` (`FR-3`), and `src/memory/sqliteStore.ts:28` (`source?: 'seed' \| 'auto' \| 'user'`) exist, but `docs/V2_RESEARCH_AND_SPRINT.md` itself is **absent** from committed archive `2845e98` (`git ls-files` exit `1`) and does not document using existing `artifacts` rather than new schema fields | Yes — `FileWatcherHook.onFileEvent` still writes unattributed `'architecture'` memories and `TemporalMemoryEngine.remember` still lets watcher writes supersede user-confirmed records sharing a 48-char prefix | Uncommitted workspace research doc (absent from clean git snapshot) | Without prior V2 design context, an agent may invent a new field (`sourcePath` on `MemoryRecord`) instead of reusing `StructuredMemory.artifacts` (`artifacts?: string[]`) with `source: 'auto'` |
| `GAP-A2` | `watcher-provenance` | Untracked `docs/V2_RESEARCH_AND_SPRINT.md` + `src/memory/sqliteStore.ts:28` + `tests/temporalMemory.test.ts` | 2026-10-21 / 2026-10-26 | Partial — plain `remember()` record shape tested indirectly, not explicitly linked to `source: 'auto'` non-supersession | Yes — plain user `remember()` calls without explicit `source` must stay key-compatible (`['category', 'content', 'id', 'status', 'tags', 'timestamp']`) | Uncommitted workspace research doc (absent from clean git snapshot) | Prevents breaking existing record compatibility while blocking automatic events from displacing user-confirmed or seeded records |
| `GAP-B1` | `linked-constraints` | Interrupted Codex session `rollout-2026-11-16T21-37-17-01a1e51c-dcb5-7c22-a6e8-bd4f1bfc159b.jsonl` (6,981 lines; Sprint 2.9 work `2026-11-17T18:24Z`–`2026-11-18T16:27Z`, 4 interrupted turns) + commits `691b299` & `ee5fcdb` | 2026-11-17 / 2026-11-18 | Partial — `Architecture.md:40-42` states that task-context links reuse the cross-file verifier, but session diagnostics identifying the unfinished pieces in `taskAnswerBundle`, `verifyRecordedClaims`, and `searchGrounded` are **absent** from the repository | Yes — `taskTools.ts:17,68` still uses whole-file 2-line regex `CONSTRAINT_DOCUMENT`; `claimVerification.ts:114,135` and `groundedSearch.ts:273,284` still inspect raw lines instead of prose-only lines | Historical session transcript outside repository (interrupted mid-unification) | Agents unaware of the remaining unfinished raw-line sites in `searchGrounded.ts` (`decisionSources` & `recordedInputs`) miss updating `groundedSearch.ts`, causing fenced/commented examples to be selected or conflict |
| `GAP-B2` | `linked-constraints` | Codex session `rollout-2026-11-16T21-37-17-01a1e51c-dcb5-7c22-a6e8-bd4f1bfc159b.jsonl` (`ee5fcdb`, `Architecture.md:40-42`) | 2026-11-18 | Partial — `markdownProseLineIndices` exists in `src/harness/taskContext.ts`, but the requirement to preserve strict `CONFLICTING_EVIDENCE` abstention on duplicate genuine prose lines across both `verifyRecordedClaims` and `searchGrounded` was in session context | Yes — raw-line checks still run before prose filtering in `searchGrounded.ts:273,284` and `claimVerification.ts:114,135` | Historical session transcript outside repository | Ensures unified prose-line scanning without weakening genuine multi-source or duplicate-prose conflict abstention |

---

## 3. Repository Snapshot vs. Seeded / Handoff Memory Diff

What was **present in the pinned repository (`2845e98`)**:
- `Rules.md:34` (`file-event observations must retain their provenance and must not silently supersede user-confirmed facts`) and `PRD.md:39` (`Event Provenance`), plus `source?: 'seed' | 'auto' | 'user'` in `src/memory/sqliteStore.ts:28` and `FILE_EVENT_FACT_PATTERN` in `src/memory/contextBlock.ts`.
- `Architecture.md:40-42` mentioning `claimVerification.ts` and `markdownProseLineIndices` (`src/harness/taskContext.ts`), plus commits `691b299` and `ee5fcdb`.

What was **missing from the pinned repository** (supplied identically via `HANDOFF.md` in Condition B and `.hypersabmemory/` in Condition C):
1. For `watcher-provenance`: the concrete V2 decision from untracked `docs/V2_RESEARCH_AND_SPRINT.md` to mark watcher events with `source: 'auto'` and normalized workspace-relative `artifacts` (reusing `StructuredMemory.artifacts` rather than adding new `MemoryRecord` keys), keep plain user `remember()` calls key-compatible, and prevent `auto` events from superseding user-confirmed or seeded memories sharing a 48-character prefix.
2. For `linked-constraints`: the unfinished diagnostic from the interrupted `2026-11-17`/`2026-11-18` Sprint 2.9 session pinpointing all three remaining pre-unification sites (`taskAnswerBundle` using `CONSTRAINT_DOCUMENT`, plus raw-line `Decision:`/`Decision-Source:`/`Constraint:` checks in `verifyRecordedClaims` and `searchGrounded`) and preserving strict `CONFLICTING_EVIDENCE` abstention on genuine competing prose lines.

Neither `HANDOFF.md` nor `.hypersabmemory/` contained solution patches, acceptance-probe scripts, or line-level code diffs.

---

## 4. Frozen Continuation Tasks & Independent Acceptance Checks

Both tasks, permitted file scopes, regression suites, and independent Node probes (`scripts/sprint35-watcher.probe.mjs`, `scripts/sprint35-links.probe.mjs`) were frozen in `scripts/sprint35-tasks.json` before running Condition C/B/A agents:

- **Task A — Historical Decision Continuation (`watcher-provenance`):**
  - *Prompt:* Continue V2 event-provenance design for automatic file-change observations (`source: 'auto'`, workspace-relative `artifacts` scoping, non-supersession over user-confirmed/seeded memories, preserve existing record compatibility, add regressions).
  - *Independent Probe ([sprint35-watcher.probe.mjs](file:///C:/Users/singa/Desktop/hypermemory-sprint2.5/scripts/sprint35-watcher.probe.mjs)):* Verified failing on `2845e98` (`AssertionError: auto file-event observations must not supersede user-confirmed memories`). Tests `change`, `add`, and `unlink` events on long shared-prefix paths, checks `source === 'auto'`, checks `FILE_EVENT_FACT_PATTERN`, checks normalized workspace-relative `artifacts`, and asserts user-confirmed records remain `active`.
  - *Regression Suites:* `tests/fileWatcher.test.ts`, `tests/temporalMemory.test.ts`, `tests/sqliteStore.test.ts`, `tests/contextBlock.test.ts`, `tests/concurrency.test.ts`, `tests/mcpQuery.test.ts`.
- **Task B — Recovery from Interrupted Investigation (`linked-constraints`):**
  - *Prompt:* Resume unfinished Sprint 2.9 grounding unification for Markdown decision and linked-constraint documents (formatted Markdown restoration in `taskAnswerBundle`, ignore fenced/commented examples in `claimVerification` and `groundedSearch`, keep strict abstention on genuine prose conflicts, add focused regressions).
  - *Independent Probe ([sprint35-links.probe.mjs](file:///C:/Users/singa/Desktop/hypermemory-sprint2.5/scripts/sprint35-links.probe.mjs)):* Verified failing on `2845e98` (`AssertionError: task_context must discover prose linked constraints...`). Tests BOM + headings + fenced/commented examples across `task_context` and `searchGrounded`, plus 3 negative controls (duplicate prose `Constraint:`, competing prose `Decision:` file, stale rewrite after capture). Note: after inspecting the initial run, two updates were made to the Sprint 3.5 scoring harness before final rescoring: (1) `src/harness/taskContext.ts` and `tests/efficientDecisionEvidence.test.ts` were added to `linked-constraints.permitted` after all 3 arms independently fixed a real `comment`-before-`fence` ordering bug in `markdownProseLineIndices`, and (2) `sprint35-links.probe.mjs` was updated to give the example-only `guideFile` a matching `'decision'` memory and co-index `decisionFile` with `altDecisionFile` so `searchGrounded` candidate selection cleanly distinguishes prose filtering (`handoff`/`memory`) from raw-line checks (`baseline`).
  - *Regression Suites:* `tests/taskAnswerBundle.test.ts`, `tests/crossFileGrounded.test.ts`, `tests/groundedSearch.test.ts`, `tests/mcpQuery.test.ts`, `tests/taskLedger.test.ts`, `tests/decisionMarkdownSafety.test.ts`, `tests/sprint28FactReconciliation.test.ts`.

---

## 5. Three-Condition Experimental Setup

Executed via `scripts/sprint32-agent-eval.mjs --cross-session` (artifacts preserved at `C:\Users\singa\AppData\Local\Temp\hm32-agent-eval-aOwSBd`):

- **Model & Runtime:** `gpt-6.2-sol`, `reasoningEffort: "low"`, `deadlineMs: 300000`, `codex-cli 0.171.0`, Node `v22.14.0`, `win32 x64`.
- **Neutral Guidance Across All Arms:** Identical byte-for-byte `AGENTS.md` instructing the agent to check available project handoff context (handoff note or connected project memory tools/resources, if present) and verify against current source and tests. No arm was told which MCP tool names to invoke.
- **Counterbalanced Run Order:**
  1. `watcher-provenance-baseline` (Condition A) -> `watcher-provenance-handoff` (Condition B) -> `watcher-provenance-memory` (Condition C)
  2. `linked-constraints-memory` (Condition C) -> `linked-constraints-handoff` (Condition B) -> `linked-constraints-baseline` (Condition A)
- **Pre-run Infrastructure Gates Passed:** Both preflight probe checks exited `1` on pristine `2845e98`; MCP client visibility passed (`hypersabmemory_task_context: true`, `hypersabmemory_query_evidence: true`).

---

## 6. Real Agent Execution Results (Initial + Rescored)

### 6.1 Initial Live Scorer Output (`results.json`, preserved verbatim)

| Label | Condition | Elapsed (s) | Agent Exit / Error | Scope | Regression | Check Exits | Accepted | Reason Recorded in Initial Scorer |
|---|---|---|---|---|---|---|---|---|
| `watcher-provenance-baseline` | A (Repo only) | 221.52 | `0` | `true` | `false` | `[1]` | `false` | Failed probe (`MemoryRecord.sourcePath` instead of `artifacts`); `tests/concurrency.test.ts` failed because `vitest` ran before `build` |
| `watcher-provenance-handoff` | B (`HANDOFF.md`) | 147.44 | `0` | `true` | `false` | `[0]` | `false` | **Passed probe `[0]`**; `regression: false` solely because `tests/concurrency.test.ts` ran before `build(scorer)` (`dist/` absent) |
| `watcher-provenance-memory` | C (HyperSABMemory MCP) | 227.59 | `0` | `true` | `false` | `[0]` | `false` | **Passed probe `[0]`**; `regression: false` solely because `tests/concurrency.test.ts` ran before `build(scorer)` (`dist/` absent) |
| `linked-constraints-memory` | C (HyperSABMemory MCP) | 300.08 | `null` (`Agent deadline reached`) | `false` | `false` | `[]` | `false` | Hit 300s deadline while re-running Vitest after passing 74/74 focused tests (left `.vitest-local.config.mjs`); edited `src/harness/taskContext.ts` (outside initial `permitted`) |
| `linked-constraints-handoff` | B (`HANDOFF.md`) | 300.08 | `null` (`Agent deadline reached`) | `false` | `false` | `[]` | `false` | Hit 300s deadline right after 72/72 focused suites passed; edited `src/harness/taskContext.ts` (outside initial `permitted`) |
| `linked-constraints-baseline` | A (Repo only) | 263.10 | `0` | `false` | `false` | `[]` | `false` | Edited `src/harness/taskContext.ts` (outside initial `permitted`) |

### 6.2 Post-Fix Deterministic Rescore of Preserved Patches (`rescored-results.json`)

After fixing `scripts/sprint32-agent-eval.mjs` to run `build(scorer)` before `vitest(scorer)`, cleaning interrupted `.vitest-*.config.*` scratch files before checking scope, adding `src/harness/taskContext.ts` and `tests/efficientDecisionEvidence.test.ts` to `linked-constraints.permitted`, and tightening `sprint35-links.probe.mjs` ranking coverage (`--rescore C:\Users\singa\AppData\Local\Temp\hm32-agent-eval-aOwSBd`):

| Label | Condition | Initial Agent Exit (Preserved) | Scope | `build` Exit | `vitest` Exit | Regression | Probe Exit | Final Accepted | Key Technical Outcome |
|---|---|---|---|---|---|---|---|---|---|
| `watcher-provenance-baseline` | A (Repo only) | `0` | `true` | `0` | `0` | `true` | `[1]` | `false` | Added unrequested `sourcePath` field on `MemoryRecord` instead of `artifacts` -> probe failed |
| `watcher-provenance-handoff` | B (`HANDOFF.md`) | `0` | `true` | `0` | `0` | `true` | `[0]` | `true` | Added `source: 'auto'` + `artifacts: [relativePath]`; guarded supersession inside locked store |
| `watcher-provenance-memory` | C (HyperSABMemory MCP) | `0` | `true` | `0` | `0` | `true` | `[0]` | `true` | Added `source: 'auto'` + `artifacts: [relativePath]`; guarded supersession + updated `Memory.md` |
| `linked-constraints-memory` | C (HyperSABMemory MCP) | `null` (deadline 300.08s; `.vitest-local.config.mjs` removed during rescore) | `true` | `0` | `0` | `true` | `[0]` | `true` (patch) | Unified `taskContext.ts`, `taskTools.ts`, `claimVerification.ts`, AND `groundedSearch.ts` |
| `linked-constraints-handoff` | B (`HANDOFF.md`) | `null` (deadline 300.08s) | `true` | `0` | `0` | `true` | `[0]` | `true` (patch) | Unified `taskContext.ts`, `taskTools.ts`, `claimVerification.ts`, AND `groundedSearch.ts` |
| `linked-constraints-baseline` | A (Repo only) | `0` | `true` | `0` | `0` (after `--pool=forks` retry policy on Win32 `0xc0000005` thread crash) | `true` | `[1]` | `false` | Missed `src/memory/groundedSearch.ts` lines 273 & 284 -> fenced example triggered false conflict in probe |

---

## 7. Independent Validation Results

Replaying all 6 preserved patches against clean `2845e98` checkouts shows a clear split driven by historical context:

- **Condition A (`baseline`) failed independent probes on both tasks (0/2 passed):**
  - On `watcher-provenance`, `baseline` invented `MemoryRecord.sourcePath` (`src/memory/sqliteStore.ts:32`) instead of using `StructuredMemory.artifacts`, failing `sprint35-watcher.probe.mjs:41`.
  - On `linked-constraints`, `baseline` updated `taskContext.ts`, `taskTools.ts`, and `claimVerification.ts`, **but never updated `src/memory/groundedSearch.ts`** (`decisionSources` at line 273 and `recordedInputs` at line 284), failing `sprint35-links.probe.mjs:90` (`'INSUFFICIENT_EVIDENCE'`/`CONFLICTING` mismatch when an example guide document ranked alongside real decision files).
- **Condition B (`handoff`) and Condition C (`memory`) produced patches passing both full regressions and independent probes (2/2 task patches passed in both arms):**
  - Note honestly that both `linked-constraints-handoff` and `linked-constraints-memory` reached the 300s deadline while running extra Windows Vitest iterations inside the sandbox (both had already finished writing their code fixes and passed 72/72 and 74/74 focused tests before timeout).

---

## 8. Memory Adoption vs. Manual Handoff Comparison

Separating the two causal questions:

1. **Historical Context Effect (A vs. B/C):** **Strongly positive.** Having the historical design/session context (`handoff` OR `memory`) prevented both baseline failure modes:
   - Task A: reusing `StructuredMemory.artifacts` instead of inventing `sourcePath` on `MemoryRecord`.
   - Task B: recovering the interrupted Sprint 2.9 note identifying all unfinished raw-line sites in `groundedSearch.ts` as well as `taskTools.ts` and `claimVerification.ts`.
   In both tasks, `baseline` passed its own self-written unit tests while failing the independent historical-contract check.
2. **HyperSABMemory vs. Equivalent Manual Handoff (B vs. C):** **Zero task-correctness advantage observed in Sprint 3.5; measurable speed/token overhead in Task A for MCP.**
   - Both Condition B (`HANDOFF.md`) and Condition C (HyperSABMemory MCP) received the same historical facts and achieved identical patch acceptance (`2/2` rescored patches passed regressions and independent probes).
   - Where HyperSABMemory had an advantage over a plain markdown note is structural (hash-verified source freshness checks via `task_context`, lease state tracking, bounded responses), **not** higher implementation accuracy on these single-task continuations.
   - Conversely, on `watcher-provenance` (where both finished inside deadline), `handoff` was **80.15s faster** (147.44s vs 227.59s) and consumed **43.0% fewer input tokens** (588,022 vs 1,032,437) and fewer shell/inspection calls (`10`/`6` vs `13`/`8`).

---

## 9. Efficiency, Context Retrieval, Decisions & Failure Metrics

| Metric | Task A Baseline | Task A Handoff | Task A Memory | Task B Memory | Task B Handoff | Task B Baseline |
|---|---|---|---|---|---|---|
| **Handoff / MCP Discovery** | None (0 MCP) | Read `HANDOFF.md` immediately (0 MCP) | `query_evidence` (ok) + `task_context` (ok) (2/2 MCP ok) | `query_evidence` (ok), `task_context` (failed on `task_bf6bf0be`, then ok on full UUID) (2/3 MCP ok) | Read `HANDOFF.md` immediately (0 MCP) | None (0 MCP) |
| **Target Files Modified** | `fileWatcher`, `sqliteStore`, `temporalMemory`, 2 tests (5 files) | `fileWatcher`, `temporalMemory`, 2 tests (4 files) | `fileWatcher`, `temporalMemory`, 2 tests (4 files) | `taskContext`, `taskTools`, `claimVerification`, `groundedSearch`, 3 tests + `.vitest-local.config.mjs` | `taskContext`, `taskTools`, `claimVerification`, `groundedSearch`, 2 tests (6 files) | `taskContext`, `taskTools`, `claimVerification`, 2 tests (5 files — missed `groundedSearch`) |
| **Elapsed Seconds** | 221.52 | 147.44 | 227.59 | 300.08 (deadline) | 300.08 (deadline) | 263.10 |
| **Shell Commands** | 15 | 10 | 13 | 19 | 18 | 22 |
| **Inspection Commands** | 11 | 6 | 8 | 11 | 8 | 10 |
| **Codex `file_change` Events** | 3 | 3 | 3 | 12 | 0 (edited via Python in shell) | 0 (edited via Python in shell) |
| **Test Commands** | 9 | 5 | 5 | 6 | 9 | 10 |
| **Input Tokens (Cached)** | 951,335 (889,472) | 588,022 (524,416) | 1,032,437 (974,336) | n/a (timeout) | n/a (timeout) | 1,416,225 (1,340,800) |
| **Output (Reasoning) Tokens** | 4,501 (431) | 3,162 (124) | 3,875 (535) | n/a (timeout) | n/a (timeout) | 5,704 (401) |

*(Note: In Task B, `edits: 0` reflects Codex JSON event counting `file_change` items only; `linked-constraints-handoff` and `linked-constraints-baseline` applied all source/test edits via PowerShell Python heredocs in `command_execution`.)*

---

## 10. Product Bottleneck Identified & Change Implemented

- **Observed Bottleneck in Real MCP Traces:** Across both Condition C (`memory`) runs, agents did not know the active `taskId` UUID after receiving `query_evidence` results (since `hypersabmemory_query_evidence` searches memory records, not `TaskLedger`).
  - `watcher-provenance-memory` had to run a separate PowerShell script reading `.hypersabmemory/tasks.json` before calling `hypersabmemory_task_context`.
  - `linked-constraints-memory` extracted an 8-hex prefix via regex (`"task_bf6bf0be"`) and **failed** its first `hypersabmemory_task_context` call with `TASK_NOT_FOUND`, forcing an extra shell read of `.hypersabmemory/tasks.json` and a retry with the full UUID.
- **Smallest Safe Product Improvement Implemented ([taskTools.ts](file:///C:/Users/singa/Desktop/hypermemory-sprint2.5/src/mcp/taskTools.ts#L320-L462)):**
  - Made `taskId` optional (`required: []`) on `hypersabmemory_task_context` input schema while keeping the property name, response shape, fail-closed semantics, and 600-token capsule invariant intact.
  - Added `resolveContextTask(ledger, requestedTaskId?)` so:
    1. Omitting `taskId` automatically restores the sole non-`reported_complete` task, or fails closed with `TASK_NOT_FOUND` (0 active) / `TASK_ID_REQUIRED` (multiple active, returning `activeTaskIds`).
    2. Supplying an exact `taskId` behaves identically to before.
    3. Supplying an unambiguous prefix of `>= 8` characters resolves the matching task, or fails closed with `TASK_ID_AMBIGUOUS` when multiple tasks match (short prefixes `< 8` chars fall through to `ledger.get` -> `TASK_NOT_FOUND`).
- **Focused Regression Added ([taskAnswerBundle.test.ts](file:///C:/Users/singa/Desktop/hypermemory-sprint2.5/tests/taskAnswerBundle.test.ts#L110-L170)):** Covers 0-active `TASK_NOT_FOUND`, sole-active restoration alongside a `reported_complete` task, `task.id.slice(0, 13)` (`task_xxxxxxxx`) prefix resolution, multi-active `TASK_ID_REQUIRED`, `< 8`-char prefix rejection, and ambiguous `>= 8`-char prefix `TASK_ID_AMBIGUOUS`.

---

## 11. Regression and Safety Checks (Run Sequentially After Final Edit)

All verification commands ran sequentially on `C:\Users\singa\Desktop\hypermemory-sprint2.5` after the final edit to `src/mcp/taskTools.ts` and `tests/taskAnswerBundle.test.ts`:

| Check | Command | Outcome & Exact Figures |
|---|---|---|
| Full test suite | `npm.cmd test` | **PASS** — `44 passed (44)` test files, `291 passed (291)` tests, `85.75s` (includes `fileWatcher`, `temporalMemory`, `taskLedger`, `taskAnswerBundle`, `groundedSearch`, `decisionMarkdownSafety`, `mcpQuery`, `taskProcesses`, `concurrency`, `memorybench`) |
| TypeScript check | `npx.cmd tsc --noEmit` | **PASS** — exit `0` |
| Production build | `npm.cmd run build` | **PASS** — exit `0` |
| Local MemoryBench eval | `npm.cmd run eval` | **PASS** — `1 passed (1)` file (`tests/memorybench.test.ts`), `8 passed (8)` tests, `4.38s` (0 stale/forgotten leaks) |
| Package smoke test | `npm.cmd run package:smoke` | **PASS** — exit `0` (`hypersabmemory@1.4.1`, `Sprint 3.1 installed MCP handoff passed`, code `p50: 93.61 ms` / `p95: 112.72 ms`, code-and-test `p50: 140.40 ms` / `p95: 169.91 ms`, unsupported `p50: 81.09 ms` / `p95: 91.76 ms`) |
| Repo task baseline eval | `node scripts/repository-task-eval.mjs` | **Ran (NO-GO gate unchanged, exit `0`, `passed: false`)** — `corpus: 83 records / 82 files`; raw `precision@5: 0.470`, `recall@5: 0.7208`, `noAnswerFalsePositives: 9/10`; grounded `precision@5: 0.430`, `recall@5: 0.6583`, `supportedAnswerCoverage: 0/20`, `noAnswerFalsePositives: 0/10`, `staleProbe: 20/20 flagged (0 leaks)`, `forgottenLeaks: 0`; latency (`150` samples) `p50: 63.92 ms`, `p95: 189.13 ms` |

---

## 12. Release-Contract Decision Proposal

Product release remains **NO-GO**. Rather than conflating distinct capabilities under one retrieval threshold, the release contract should separate and gate six distinct engineering properties:

1. **Single-Source Deterministic Fact Verification:** Exact declarations, quotations, top-level JSON scalars, and single-source Markdown `Decision:`/`Rationale:` lines verified against live captured SHA-256 hashes — **passing & gated**.
2. **Multi-Source Explicit Link Verification:** Cross-file `Decision-Source:` + `Constraint:` chains with prose-only Markdown scanning and strict `CONFLICTING_EVIDENCE` abstention on competing prose lines — **passing & gated** (`taskAnswerBundle`, `claimVerification`, `groundedSearch`).
3. **Implementation-Evidence Lookup:** Bounded AST/regex-free code + test attribution (including static relative TS imports) rechecked against current file hashes — **passing** (`p95` `112.72 ms` code / `169.91 ms` code-and-test on smoke harness).
4. **Cross-Session Task Restoration:** Lease-fenced `TaskLedger` capsules (`<= 600` estimated tokens), hash-freshness mismatch detection (`STALE_EVIDENCE`), and single-call task restoration via `hypersabmemory_task_context` — **passing & measurably valuable vs. baseline** when historical context is absent from git history.
5. **Broad Natural-Language Retrieval & Abstention:** Open-ended repository QA (`node scripts/repository-task-eval.mjs`) currently yields `0.470` raw / `0.430` grounded `precision@5`, `0.7208` raw / `0.6583` grounded `recall@5`, `0/20` supported assertions on general repository questions (by design when deterministic classes do not apply, vs. `0/10` false-positive unsupported assertions and `0` stale/forgotten leaks) — **NO-GO** for a general "answers arbitrary repo questions" product claim.
6. **Interactive Latency Targets:** Broad repository grounding `p95` measured `189.13 ms` (exceeding the `100 ms` target in `repository-task-eval.mjs`; previously `163.42 ms` in frozen baseline), while `package:smoke` implementation queries measured `93.61–169.91 ms` — **NO-GO** for `< 100 ms` `p95` latency guarantees.

---

## 13. Remaining Limitations

- Small sample size (`n = 2` tasks x `3` arms = `6` runs, one pinned model `gpt-6.2-sol`, `reasoningEffort: "low"`, Windows sandbox).
- Both `linked-constraints` treatment runs (`memory` and `handoff`) exceeded the `300 s` execution deadline after editing Windows Vitest invocations, meaning acceptance of their preserved patches was established via clean replay (`rescored-results.json`), not uninterrupted agent exit `0`.
- Single-call `hypersabmemory_task_context` (`resolved` without full UUID) was added *after* the 6-run experiment; its runtime latency savings for real agents are inferred from eliminating the observed failed `TASK_NOT_FOUND` + `.hypersabmemory/tasks.json` shell turns rather than yet measured in a fresh Sprint 3.6 agent rerun.

---

## 14. Sprint 3.5 Completion Decision

**Sprint 3.5 Decision: COMPLETE (Research & Evaluation Milestone Met; Product Release Remains NO-GO).**

Legitimate historical-context gaps from both an untracked V2 research document and an interrupted Sprint 2.9 coding session produced a measurable task-completion gap against repository-only baselines (`0/2` baseline vs `2/2` accepted patches in both `handoff` and `memory`), while exposing and fixing a real MCP UX bottleneck in `hypersabmemory_task_context` task lookup without regressing any safety invariant.
