# Sprint 3.1 agent reliability

Started at `f28861de6ef8f6f7f20e82eefff7eab03b35cf17` on `feature/sprint2.5-20261106`. The ten pre-existing untracked artifacts were preserved. The three maintenance worktrees stayed at `592f054`.

Local implementation commit `8aad4c4736d2807cb7b911574bd4c2487f52b8dc` contains the optimization, regression, benchmark, and consumer scenario.

## Installed consumer

`npm.cmd run package:smoke` installs a local tarball into a new prefix, uses the public MCP API over stdio, and creates a disposable TypeScript parcel project. One process creates, claims, checkpoints, and releases the unfinished task. A fresh process restores the next action, reads the decision and rationale, verifies the linked constraint, and locates the implementation and its test assertion from filename-free questions. The test citation reports execution as unverified. The old decision is rejected against the task's captured hash, and the forgotten marker stays out of general recall. The unsupported question produces no verified answer.

The stale check uses a task snapshot. General MCP evidence queries intentionally capture current source bytes for each request. These entry points use different freshness baselines.

## Authenticated Codex run

On Windows, set `$env:HM31_CODEX = (Get-Command codex).Source` before running package smoke to opt in. The run uses a disposable workspace, configures the installed stdio server for that invocation, and allows only task context and evidence queries. The agent receives the task ID and a continuation request. The required change and source paths are recovered from the workspace and MCP.

The final Codex run completed one task-context call and two evidence queries, then changed `countParcels` to return `Math.max(0, value)`. The existing test file matched its original bytes. The baseline fixture had the expected failure for negative input. The agent ran the project tests successfully, and the smoke script independently reran both tests successfully after inspecting the implementation.

Two initial attempts reached the scripted handoff but failed to install the fixture's Vitest dependency. npm 10.9.2's Arborist threw an `edgesOut` exception resolving peers. The fixture used `--legacy-peer-deps` on retry. The local HyperSABMemory tarball installed normally in a new prefix. The first Codex launch encountered Windows workspace command policy. The unelevated workspace sandbox resolved that issue, but the next run still needed MCP read-tool approval and Vitest's fork worker hit `EPERM`. The final run used a per-invocation read-tool allowlist and a thread worker for the fixture. The repository suite retained its original worker configuration.

## Measured optimization

In two baseline CPU profiles of the 12-record code-and-test fixture, TypeScript `createProgram` accounted for 2,332 of 2,853 and 2,443 of 2,983 CPU samples. AST creation accounted for 34 samples in each. The profiler captured each sample's ancestor stack, so categories can overlap. Source path, read, and hash timings came from the grounder. The MCP path separately ranks once to select memory references and again to ground the query. It hashes captured sources, inspects them during grounding, and rechecks returned citations. Fallback excerpts can add two more reads for their paths.

The production change filters test imports using the same relative path, ambiguity, and symbol checks already required for a link. It binds only eligible tests and reuses the resolved import mapping when checking actual lexical bindings. Shadowing, aliasing, assertions, and final hashes still get checked. The same-size rewrite regression mutates the test immediately after its first read and requires the final result to omit its link.

`node scripts/sprint31-benchmark.mjs <baseline-dist> dist` ran on Windows x64 with Node 22.14.0. Each pair shared the exact source directory, captured hashes, memory records, queries, and three warmups. Four rounds alternated process order. Each side has 80 warm requests and four independent first requests per workload. Fresh timing starts before loading the grounder and ends after the first grounded response is serialized. The fresh p95 is the maximum of four observations.

| Records and workload | Warm p50/p95 before → after (ms) | Fresh p50/p95 before → after (ms) |
|---|---:|---:|
| 2, ordinary | 7.49/11.84 → 7.68/9.21 | 653.89/809.17 → 636.59/660.88 |
| 2, code and test | 25.65/32.31 → 25.35/31.76 | 712.72/735.34 → 707.99/748.17 |
| 12, ordinary | 21.77/25.50 → 22.81/27.32 | 677.02/726.46 → 662.30/677.65 |
| 12, code and test | 208.37/247.92 → 40.21/57.05 | 926.32/929.45 → 733.43/759.90 |
| 500, ordinary | 22.78/27.94 → 21.63/27.05 | 664.92/690.22 → 663.33/703.92 |
| 500, code and test | 205.48/250.99 → 39.67/55.88 | 935.26/975.10 → 625.02/772.85 |

All six workloads returned matching serialized evidence across builds. The 500-record fixture has the same 12 sources plus 488 unrelated notes. End-of-worker median RSS on its code-and-test query went from 150.18 to 96.50 MiB. This is an observed process snapshot. On the 12-record code-and-test query, p50 candidate retrieval and ranking were 0.62 and 0.27 ms before, and 0.49 and 0.22 ms after. Containment/path, read, and hash p50 were 17.86, 4.84, and 0.51 ms before, and 14.63, 4.00, and 0.41 ms after. The residual grounder decision stage fell from 184.09 to 20.40 ms. It includes parsing, test association, claim verification, and packet construction. Serialization p50 was 0.05 and 0.04 ms. Query normalization is included in retrieval and grounding timings. Stage percentiles describe their own samples and should not be added. These are synthetic measurements of the grounder and serialization rather than a production latency guarantee.

The paired profiling check counted 2,127 `createProgram` samples before and 209 after over the same 20 requests per side. AST creation counted 31 on each side. This corroborates the targeted reduction in binding work.

## Verification and release

The focused grounding, task ledger, and task process run passed 62 tests. The full suite passed 281 tests across 43 files. The no-emit typecheck, standalone build, eight MemoryBench tests, and local tarball package smoke passed. Existing scalar, decision, compound evidence, code and test evidence, task recovery, and lease checks ran as part of this sequence.

The unchanged frozen evaluator exited 1. Raw P@5 and macro recall were 0.470 and 0.7208. Grounded P@5 and macro recall were 0.430 and 0.6583. Supported broad assertions were 0/20. Unsupported no-answer assertions were 0/10. Forgotten leaks were 0 and stale leaks were 0/20. Frozen p50/p95 were 49.91/147.40 ms across 150 samples. The frozen p95 is below the historical 303.84 ms observation, though corpus and host conditions differ. Only the alternating fixture comparison isolates the production change.

Release remains **NO-GO**. Broad assertion coverage, retrieval quality and the frozen p95 gate remain open. Remote CI and public registry installation were outside the local verification.

Sprint 3.1 engineering acceptance is complete. The next engineering objective is to measure whether agents using the evidence complete repository maintenance tasks more reliably than the same agents working from the repository alone.

## Broad assertion recommendation

Keep broad synthesis in the consuming coding agent. HyperSABMemory can verify the source and scope of exact facts, structural observations, and explicit relationships under local, reproducible rules. A consuming agent can combine these with its own code inspection and test runs and cite the evidence it used. This keeps provider choice, network use, and model cost with the client and gives the harness a clear abstention boundary.

The current evaluator grades retrieval against relevant paths and checks whether the grounder emitted a verified assertion. Assertion attribution is checked against those paths. It does not grade a synthesized answer for semantic entailment, and code or test evidence alone earns no verified assertion. The broad questions still make coverage a meaningful release gap under the existing contract. A separate agent answer evaluation and any change to the release contract need an explicit product decision and approval.
