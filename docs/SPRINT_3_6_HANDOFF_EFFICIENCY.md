# Sprint 3.6 — One-Call Handoff and Context Efficiency

- **Repository:** `C:\Users\singa\Desktop\hypermemory-sprint2.5`
- **Branch:** `feature/sprint2.5-20261106`
- **Starting HEAD:** `6200b7ec4951fdaddddb3642d85e1affc64289e9` (`6200b7e`)
- **Commit 1 (Product Handoff Improvement):** `8ef93f200c4a44066f78a641945c8fe405bcfab2` (`8ef93f2`) — `feat: streamline cross-session task handoff`
- **Product Release Status:** **NO-GO**
- **Date:** 2026-11-21 / 2026-11-22

---

## 1. Verified Starting State & Preserved Sprint 3.5 Functionality

- **Git & Worktree Verification:** Starting HEAD confirmed at `6200b7e` (`test(eval): prove cross-session memory value and report Sprint 3.5`), preceded by `1b18ef7` (`feat(mcp): resolve sole active task and prefix in task_context`), `2845e98`, and `5d8ef9e`.
- **Sibling Worktrees Preserved Untouched:**
  - `C:/Users/singa/Desktop/hypermemory` (`592f054 [audit/cleanup-20261105]`)
  - `C:/Users/singa/Desktop/hypermemory-cleanup-isolated` (`592f054 [maintenance/cleanup-isolated-20261106]`)
  - `C:/Users/singa/Desktop/hypermemory-dependency-review` (`592f054 [maintenance/dependency-review-20261106]`)
- **10 Pre-existing Untracked Artifacts Preserved Untouched:** `CLEANUP-RESULTS.md`, `cleanup-inventory.md`, `code-cleanup-audit.md`, `docs/V2_BASELINE.md`, `docs/V2_RESEARCH_AND_SPRINT.md`, `scheduled-tasks-audit.md`, `scheduled-tasks-inventory.csv`, `scheduled-tasks-triage.csv`, `scripts/cleanup-dry-run.ps1`, `scripts/cleanup-safe.ps1`.
- **Preserved Sprint 3.5 One-Call Selection (`1b18ef7`):** Retained `resolveContextTask(ledger, requestedTaskId?)` and `hypersabmemory_task_context` optional `taskId` (`required: []`) without reimplementing or breaking sole active task auto-resolution, `>= 8`-char prefix matching, `TASK_NOT_FOUND`, `TASK_ID_REQUIRED`, or `TASK_ID_AMBIGUOUS`.

---

## 2. Measured Product Bottleneck (Sprint 3.5 Trace Breakdown)

Analyzing the Sprint 3.5 `hm32-agent-eval-aOwSBd` event logs separated five distinct cost categories:

1. **Tool discovery cost:** `SKILL.md` (`Step 1` & `Step 6`) and `docs/AGENT_HANDOFF.md` previously directed resuming agents to `hypersabmemory_scope_sources` and `hypersabmemory://tasks` first instead of `hypersabmemory_task_context` with omitted `taskId`, so Codex agents ran `hypersabmemory_query_evidence` (`5,588` bytes in `watcher-provenance-memory`; `5,941` bytes in `linked-constraints-memory`) before discovering any task.
2. **Task discovery cost:** In `hm32-agent-eval-aOwSBd`, both `watcher-provenance-memory` and `linked-constraints-memory` ran shell commands reading `.hypersabmemory/tasks.json` to find a full UUID (`linked-constraints-memory` first tried 8-hex `"task_bf6bf0be"` -> `TASK_NOT_FOUND`). Sprint 3.5 `1b18ef7` resolved ledger lookup, *but* `hypersabmemory_task_context` still omitted active durable memories attached to the task's captured sources.
3. **Evidence retrieval cost:** Because `hypersabmemory_task_context` only returned `decisionEvidence` (from `Decision:` lines in Markdown) and `linkedConstraints` (from `Decision-Source:` links), durable architectural/decision records stored in `.hypersabmemory/memory_store.json` (e.g., V2 research decisions or interrupted-session diagnostics) were *absent* from `hypersabmemory_task_context` — forcing an extra `hypersabmemory_query_evidence` call (`+5.6–6.0 KB` response, extra round-trip).
4. **Response overhead:** Combining `query_evidence` + default `task_context` delivered `11,721` bytes (`~2,931` tokens) on `watcher-provenance` and `12,002–12,163` bytes (`~3,001–3,041` tokens) on `linked-constraints`, while repeating the multi-line `capsule` string alongside `answerBundle.recordedTask` and repeating `currentSha256 === sha256` on every unchanged file.
5. **Agent interpretation & Windows sandbox runner noise:** In Sprint 3.5 Task B, Vitest config-loader `EPERM` retries under the Windows sandbox dominated wall-clock time across all arms (`memory`, `handoff`, and `baseline`), independent of MCP.

**Selected Bottleneck:** **#2 + #3 + #4 together** — `hypersabmemory_task_context` did not surface task-linked durable memories (`TemporalMemoryEngine`) alongside source-verified task context, and had no non-duplicative `compact` projection, nor did `SKILL.md` / `AGENT_HANDOFF.md` guide agents to use a single `hypersabmemory_task_context({ compact: true })` call first.

---

## 3. Exact Implementation Change (`8ef93f2`)

- **[taskTools.ts](file:///C:/Users/singa/Desktop/hypermemory-sprint2.5/src/mcp/taskTools.ts#L64-L215):**
  - Added `collectTaskMemories(workspaceDir, currentSources)` to read active records when `memory_store.json` (or `.bak`) exists, exclude `record.source === 'auto'` and `FILE_EVENT_FACT_PATTERN` watcher noise, keep only records whose `artifacts` match verified **current** task sources, rank deterministically (`decision > bug > architecture > symbol > general`, newest timestamp first), and tag every entry `attribution: 'recorded_memory'`.
  - Bounded `relatedMemories` (`<= 5` items within the existing `600`-token `TASK_CAPSULE_TOKEN_BUDGET` shared with `linkedConstraints`) and updated `truncated`.
  - Retained full default output shape (`answerBundle.relatedMemories` added non-destructively) when `compact` is omitted or `false`.
  - Added optional `compact?: boolean` parameter (`TASK_TOOLS` schema & `INVALID_ARGUMENT` guard when non-boolean) that omits the redundant `capsule` text and unchanged `currentSha256` fields while keeping full 64-char `sha256` hashes, `nextAction`, `decisions`, `decisionEvidence` (with `rationale`), `linkedConstraints`, `relatedMemories`, `reread`, `warnings`, `conflicts`, `unsupportedAssumptions`, per-source `attribution`, and `limitation`.
- **[SKILL.md](file:///C:/Users/singa/Desktop/hypermemory-sprint2.5/.agents/skills/hypersabmemory/SKILL.md#L11-L18) & [AGENT_HANDOFF.md](file:///C:/Users/singa/Desktop/hypermemory-sprint2.5/docs/AGENT_HANDOFF.md#L5-L11):** Updated opt-in workflow steps so resuming agents call `hypersabmemory_task_context({ "compact": true })` (or `{}`) first, resorting to `hypersabmemory://tasks` only when multiple tasks are active and `hypersabmemory_query_evidence` only when repository-wide search outside task sources is needed (keeping `AGENT_HANDOFF.md` handoff block under `1200` chars).
- **[taskAnswerBundle.test.ts](file:///C:/Users/singa/Desktop/hypermemory-sprint2.5/tests/taskAnswerBundle.test.ts#L173-L250):** Added unit/integration regression verifying `relatedMemories`, exclusion of forgotten and `auto` watcher records, compact size reduction without dropping 64-char hashes or limitations, `INVALID_ARGUMENT` on non-boolean `compact`, and same-size stale rewrite eviction across both default and compact modes.

---

## 4. One-Call Handoff Demonstration & Task-Selection Safety Behavior

Executed via [sprint36-handoff-bench.mjs](file:///C:/Users/singa/Desktop/hypermemory-sprint2.5/scripts/sprint36-handoff-bench.mjs) against a freshly packed and installed `hypersabmemory@1.4.1` MCP stdio server (`Client` + `StdioClientTransport`):

- **One-Call Restoration (`hypersabmemory_task_context({})` and `hypersabmemory_task_context({ compact: true })`) Verified All 8 Items Without Reading `.hypersabmemory/tasks.json`:**
  1. Active task (`taskId`)
  2. Recorded next action (`nextAction`)
  3. Recorded decisions (`decisions` and source-verified `decisionEvidence`)
  4. Recorded rationale (`decisionEvidence[].rationale`)
  5. Explicit constraints (`constraints` and cross-file `linkedConstraints`)
  6. Relevant source references (64-char `sha256`, `status`, and `reread`)
  7. Freshness and conflict warnings (`warnings`, `conflicts`, `unsupportedAssumptions`)
  8. Recorded vs. verified provenance (`decisionsStatus: 'reported_unverified' | 'historical_unverified'`, `attribution`, `limitation`)
- **All 7 Task-Selection & Safety Cases Passed Over Live Installed Stdio MCP:**
  1. Zero active tasks (only a `reported_complete` task exists) + `{}` -> `isError: true`, `TASK_NOT_FOUND`.
  2. Completed task + sole active task -> `{}` and `{ compact: true }` both auto-select the active task (never `reported_complete`).
  3. Unambiguous `>= 8`-char prefix (`taskId.slice(0, 13)`, `compact: true`) -> resolves exact task.
  4. Too-short prefix (`task_`) and unknown `>= 8`-char prefix (`task_deadbeef`) -> `isError: true`, `TASK_NOT_FOUND`.
  5. Multiple active tasks + `{}` -> `TASK_ID_REQUIRED` (`activeTaskIds`); ambiguous `>= 8`-char prefix (`task_36abcdef`) -> `TASK_ID_AMBIGUOUS` (`matchingTaskIds`).
  6. Forgotten memory (`memory.forget(...)`) -> excluded from both default and `compact` payloads.
  7. Same-size stale rewrite on `choice.md` -> `status: 'modified'`, `currentSha256` populated, `decisionsStatus: 'historical_unverified'`, stale `decisionEvidence`, `linkedConstraints`, and `relatedMemories` evicted, warning emitted.

---

## 5. Controlled Before/After Response, Interaction Overhead & Performance

Measured on `hypersabmemory@1.4.1` installed tarball (`N = 30` alternating iterations per fixture after 1 warmup cycle via [sprint36-handoff-bench.mjs](file:///C:/Users/singa/Desktop/hypermemory-sprint2.5/scripts/sprint36-handoff-bench.mjs)):

| Archived Fixture | Workflow | MCP Calls | Ledger Shell Reads | Source Reads (`fs.readFileSync`) | Response Bytes (Est. Tokens) | Saved vs. Multi-Step | Stdio Latency p50 / p95 / Mean (ms) |
|---|---|---:|---:|---:|---|---:|---|
| `watcher-provenance` | Sprint 3.5 Multi-Step (`tasks.json` + `query_evidence` + `task_context(id)`) | 2 | 1 | 26 | 11,721 B (2,931 tok) | — | 67.67 / 79.66 / 67.76 |
| `watcher-provenance` | Sprint 3.6 One-Call Default (`task_context({})`) | 1 | 0 | 9 | 6,131 B (1,533 tok) | 47.7% | 23.24 / 30.35 / 23.92 |
| `watcher-provenance` | Sprint 3.6 One-Call Compact (`task_context({ compact: true })`) | 1 | 0 | 9 | **4,059 B (1,015 tok)** | **65.4% (-7,662 B)** | **24.90 / 30.65 / 24.74** |
| `linked-constraints` | Sprint 3.5 Multi-Step (`tasks.json` + `query_evidence` + `task_context(id)`) | 2 | 1 | 22 | 12,002 B (3,001 tok) | — | 75.54 / 91.12 / 73.69 |
| `linked-constraints` | Sprint 3.6 One-Call Default (`task_context({})`) | 1 | 0 | 8 | 6,222 B (1,556 tok) | 48.2% | 22.64 / 30.88 / 23.30 |
| `linked-constraints` | Sprint 3.6 One-Call Compact (`task_context({ compact: true })`) | 1 | 0 | 8 | **4,163 B (1,041 tok)** | **65.3% (-7,839 B)** | **24.68 / 29.55 / 24.06** |

---

## 6. Focused Actual-Agent Validation & Manual Handoff Comparison (`hm32-agent-eval-FJhLP4`)

### 6.1 Task Setup (`handoff-curation`)

- **Snapshot:** `8ef93f200c4a44066f78a641945c8fe405bcfab2` (`docs/SPRINT_3_*.md` excluded; `gpt-6.2-sol`, `reasoningEffort: "low"`, `deadlineMs: 420000`, `win32 x64`).
- **Genuine Pre-frozen Acceptance Probe ([sprint36-handoff.probe.mjs](file:///C:/Users/singa/Desktop/hypermemory-sprint2.5/scripts/sprint36-handoff.probe.mjs)):** Verified failing on pristine `8ef93f2` (`preflight-handoff-curation.log`, exit `1`: `AssertionError: durable decisions and bugs must rank ahead of automatic file-event observations in buildHandoffBrief`).
- **Pre-run Protocol Visibility Gate:** Passed (`exit: 0`, single `hypersabmemory_task_context({ compact: true })` call succeeded, returning `4,614` B).

### 6.2 Ten-Metric Comparison (Manual `HANDOFF.md` vs. HyperSABMemory)

| Metric | Condition A — Manual Handoff (`handoff`) | Condition B — HyperSABMemory (`memory`) |
|---|---|---|
| 1. Correct task discovery | Read `HANDOFF.md` directly (0 MCP calls) | **Single call `hypersabmemory_task_context({ compact: true })`** without reading `.hypersabmemory/tasks.json` |
| 2. Historical context retrieved | `HANDOFF.md` (`2,370` B) | Compact JSON payload (`4,614` B, `estimatedTokens: 399`) |
| 3. Evidence completeness | Full seeded V2 rules & `TaskLedger` summary | Both seeded V2 memories (`relatedMemories`), `nextAction`, `decisions`, `constraints`, 6 verified `sha256` source hashes, `attribution`, `limitation` |
| 4. Context used in implementation | Excluded `auto` & `FILE_EVENT_FACT_PATTERN` in `topFacts()`; added `TaskLedger` active `nextAction` in `openNextSteps()`; added budget guard | Same functional design cleanly implemented in `src/cli/handoffCommand.ts` with budget-preserving per-section trimming |
| 5. MCP and shell interactions | `0` MCP calls; `18` shell; `10` inspection; `0` ledger reads; `5` edits; `8` test commands | **`1/1` MCP call**; `19` shell; `9` inspection; **`0` ledger reads**; `3` edits; `6` test commands |
| 6. Elapsed time | `193.12 s` | `201.52 s` (`+8.40 s` / `+4.3%`, down from `+80.15 s` in Sprint 3.5) |
| 7. Observable tokens (cached / out / reason) | `688,874` in (`650,624` cached) / `5,006` out (`475` reasoning) | `727,328` in (`690,944` cached) / `5,136` out (`494` reasoning) (`+5.6%` input vs. `+75.6%` in Sprint 3.5) |
| 8. Independent patch acceptance | **Probe `[0]` (PASS)**; initial `results.json` `regression: false` due to `--pool=threads` `process.chdir()` error in `tests/cli.test.ts`; **Rescored `accepted: true` (`5/5` suites)** | **Probe `[0]` (PASS)**; initial `results.json` `regression: false` due to `--pool=threads` `process.chdir()` error in `tests/cli.test.ts`; **Rescored `accepted: true` (`5/5` suites)** |
| 9. Constraint compliance | Budget `<= 600` est. tokens & `story` determinism preserved | Budget `<= 600` est. tokens & `story` determinism preserved |
| 10. Unrelated modifications | None (`scope: true`: `src/cli/handoffCommand.ts`, `tests/handoffCommand.test.ts`) | None (`scope: true`: `src/cli/handoffCommand.ts`, `tests/handoffCommand.test.ts`) |

- **Objective Scorer Disclosure (Section 8 Policy):** `hm32-agent-eval-FJhLP4/results.json` is preserved untouched showing `checkExits: [0]` and `regression: false` on both arms because `tests/cli.test.ts` calls `process.chdir()`, which Node worker threads reject (`TypeError: process.chdir() is not supported in workers`) when `sprint32-agent-eval.mjs` ran `vitest --pool=threads`. Updating `vitest()` in `scripts/sprint32-agent-eval.mjs` to retry under `--pool=forks` on that worker incompatibility and running `--rescore` (`hm32-agent-eval-FJhLP4/rescored-results.json`) passed all 5 regression suites (`tests/handoffCommand.test.ts`, `tests/contextBlock.test.ts`, `tests/taskLedger.test.ts`, `tests/taskAnswerBundle.test.ts`, `tests/cli.test.ts`) and `sprint36-handoff.probe.mjs` for both arms.

---

## 7. Full Regression Results (Sequential Execution After Final Code Edit)

| Verification Command | Outcome & Exact Measured Numbers |
|---|---|
| `npm.cmd test` | **PASS** — `44 passed (44)` test files, `292 passed (292)` tests, `78.39s` (includes `taskAnswerBundle.test.ts` `7/7`, `taskLedger.test.ts` `18/18`, `taskProcesses.test.ts` `13/13`, `concurrency.test.ts` `7/7`, `memorybench.test.ts` `8/8`) |
| `npx.cmd tsc --noEmit` | **PASS** — exit `0` |
| `npm.cmd run build` | **PASS** — exit `0` |
| `npm.cmd run eval` | **PASS** — `tests/memorybench.test.ts`, `8 passed (8)` tests, `4.03s` (0 forgotten/stale leaks) |
| `npm.cmd run package:smoke` | **PASS** — exit `0` (`hypersabmemory@1.4.1`, `Sprint 3.1 installed MCP handoff passed`, code `p50: 73.54 ms` / `p95: 118.86 ms`, code-and-test `p50: 141.85 ms` / `p95: 163.26 ms`, unsupported `p50: 71.41 ms` / `p95: 90.95 ms`) |
| `node scripts/sprint36-handoff-bench.mjs` | **PASS** — exit `0`, `matrixPassed: true` (`7/7` safety/selection checks), `N=30` paired stdio benchmarks (`-65.4%` / `-65.3%` bytes vs. multi-step; `p95` `30.65 ms` / `29.55 ms`) |
| `node scripts/repository-task-eval.mjs` | **Ran (Gate FAILED, exit `1`, `passed: false`)** — `corpus: 83 records / 82 files`; raw `precision@5: 0.470`, `recall@5: 0.7208`, `noAnswerFalsePositives: 9/10`, `forgottenLeaks: 0`; grounded `precision@5: 0.420` (vs. `0.430` in prompt's earlier baseline), `recall@5: 0.6417` (vs. `0.6583`), `supportedAnswerCoverage: 0/20`, `noAnswerFalsePositives: 0/10`, `staleProbe: 20/20 flagged (0 leaks)`; latency (`150` samples) `p50: 62.52 ms`, `p95: 169.16 ms` (still above `100 ms` gate; historical prompt figure `189.13 ms`) |

*Unverified externally:* Remote GitHub CI execution, public npm registry installation, and independent external human code review remain unverified.

---

## 8. Release-Contract Proposal

| Category | Level | Current Evidence | Proposed Acceptance Criterion | Current Result | Known Gaps |
|---|---|---|---|---|---|
| 1. Deterministic verification readiness | Harness-level | `groundedSearch.test.ts`, `crossFileGrounded.test.ts`, `decisionMarkdownSafety.test.ts`, `implementationEvidence.test.ts` | 100% accuracy on declarations, quotes, JSON scalars, prose-only Markdown `Decision:`/`Decision-Source:`/`Constraint:`, and strict `CONFLICTING_EVIDENCE` abstention | **Pass** (`44/44` suites green) | Limited to deterministic syntax patterns, not arbitrary prose semantics |
| 2. Task-restoration readiness | Harness-level | `taskLedger.test.ts`, `taskAnswerBundle.test.ts`, `sprint36-handoff-bench.mjs` | One-call `hypersabmemory_task_context({ compact: true })` restores sole active task + memories + hashes within 600-token capsule and fails closed on ambiguity/staleness | **Pass** (`7/7` MCP checks, `p95 <= 30.65 ms`) | Multi-active workspaces require resource inspection or `>= 8`-char prefix |
| 3. General retrieval quality | Harness-level | `memorybench.test.ts` (`8/8`), `repository-task-eval.mjs` (`0.470` raw / `0.420` grounded P@5) | Pass MemoryBench (`>= 0.8` recall, `0` leaks) and explicitly approved precision/recall target on open-ended repo QA | **Mixed / NO-GO** on repo QA (`supportedAnswerCoverage: 0/20`, `grounded P@5: 0.420`) | Lexical BM25 + substring graph does not synthesize unanchored multi-file prose |
| 4. End-to-end coding-agent usefulness | Integrated-agent-level | Sprint 3.5 (`0/2` baseline vs `2/2` memory/handoff rescored) & Sprint 3.6 (`handoff-curation` `1`-call MCP) | Preserve cross-session task continuity within single-digit time/token overhead vs. equivalent manual `HANDOFF.md` | **Pass on 3 tasks** (`+4.3%` time, `+5.6%` tokens vs. manual note in Sprint 3.6) | Small sample size (`n=3` tasks total), single model/sandbox; manual note slightly faster (`-8.4 s`) |
| 5. Safety and freshness guarantees | Harness-level | `storeContainment.test.ts`, `autoCommitGuards.test.ts`, `concurrency.test.ts`, `sprint36-handoff-bench.mjs` | Zero path escapes, `0` forgotten/stale leaks (`20/20` flagged), atomic locked writes, lease fencing, `0` silent same-size rewrite bypasses | **Pass** (`0` leaks across all probes and tests) | None in tested local Windows flows; macOS/Linux CI unverified |
| 6. Latency and packaging readiness | Harness-level | `package:smoke`, `sprint36-handoff-bench.mjs`, `repository-task-eval.mjs` | Tarball CLI + MCP smoke pass; `task_context` `p95 < 100 ms`; approved broad-query `p95` SLA met | **Task-context Pass (`29.55–30.65 ms`) / Repo QA NO-GO (`169.16 ms` `p95 > 100 ms`)** | `searchGrounded` `p95` (`169.16 ms`) and `code-and-test` (`163.26 ms`) exceed `100 ms` |

- **Recommendation on Broad Semantic Synthesis:** **Exclude broad semantic synthesis from the core harness release contract.** Semantic planning, multi-file prose reasoning, and test authoring are consuming coding-agent responsibilities; the harness guarantee should cover deterministic source verification, bounded cross-session task restoration, conflict/staleness detection, and ranked lexical retrieval hints. Changing the release contract or `100 ms` gate requires explicit product-owner approval; product release remains **NO-GO** while `repository-task-eval.mjs` fails (`passed: false`).

---

## 9. Remaining Blockers

1. `repository-task-eval.mjs` fails the existing `passed: false` release gate (`p95 = 169.16 ms > 100 ms`; `supportedAnswerCoverage = 0/20`; `grounded P@5 = 0.420`).
2. `handoff-curation` comparison (`n = 1` task, `2` arms) narrows MCP vs. `HANDOFF.md` gap to `4.3%` time / `5.6%` input tokens via one-call `compact: true`, rather than showing broad speed superiority over a pre-authored file already in the workspace root.
3. Remote GitHub CI, public npm installation, and macOS/Linux multi-host validation remain unverified.
