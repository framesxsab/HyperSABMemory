# Sprint 3.4 context to action

Started at `cdc56d8ff812e2e675aed7b12c3d79d04285a7bb` on `feature/sprint2.5-20261106`. Ten pre-existing untracked files and all three maintenance worktrees were preserved.

## Production correctness

The original Sprint 3.3 attribution probe reproduced a false test link. The new focused test reproduced six failures under varied aliases with whole-clause and specifier-level type imports, test-helper imports, and an ambiguous duplicate local import. The previous experimental patch filtered type-only import declarations, but its probe still failed. The old probe includes duplicate helper imports, where the TypeScript binder can recover a usable symbol from invalid source.

The existing implementation-evidence verifier now excludes erased imports from target eligibility and tests the bound runtime alias for the implementation, test runner, and assertion helper. It declines duplicate import names and ambiguous declaration sets instead of choosing a recovered binding. Ordinary aliases still produce a current source/test citation with execution marked unverified. Shadowed and unrelated imports remain excluded. This change uses TypeScript's AST and checker and does not alter freshness checks, ranking, task storage, or MCP schemas.

## Handoff trace review

In Sprint 3.3, the unsuccessful attribution agent retrieved the relevant Sprint 3.0 rationale, named the implementation issue at the target, test-runner, and assertion bindings, and wrote a regression. Active Tasks was empty, and it made no task-context call. It reached the deadline with no production edit. The trace does not establish that a missing field, retrieval latency, or the task-context presentation caused that outcome.

The existing answer bundle already distinguishes agent-reported next action, constraints, and checks from source-linked constraints. The restore packet contains source paths, hashes, and warnings. No task-context schema or output change is justified by the observed failure. This sprint exercises actual checkpoints through the existing surface rather than adding another view.

## Clean agent comparison

`node scripts/sprint32-agent-eval.mjs --context-action` reuses the paired runner. Both arms use the committed starting snapshot and locked dependencies, with four Sprint 3.x reports excluded from the archive identically. The runner checks every tracked blob and mode against the pinned tree minus those explicit exclusions. Historical files remain unchanged in the repository. Neither experimental copy contains the external scoring probes or prior experimental patches. Each natural arm receives the same opt-in guide and task prompt. The prompted comparison is a separate pair, with a neutral instruction to consult available handoff evidence or repository history.

- **Decision prose.** A real task restoration bug drops a valid decision after a commented example containing a fence marker. The treatment gets a ready checkpoint recording the preflight symptom and the existing source-attribution contract. The same architecture, rules, tests, and code are available in both arms. The checkpoint's precise next action exists only in the treatment ledger. Its content summarizes the investigation and does not encode a patch.
- **Module link.** Runtime test attribution currently strips extensions before matching sources, so incompatible emitted extensions can produce a false link. The treatment indexes the existing architecture convention on static relative imports and cites its implementation paths. The same architecture text is available on disk in both arms. The frozen probe requires compatible CommonJS and ESM links and rejects cross-family substitutions.

Both task failures and their positive controls were checked before executing agents. The task plan freezes `gpt-6.2-sol` at low effort and a 300-second wall-clock cap per condition. Fresh sessions use Codex CLI 0.171.0 on Windows x64 with Node 22.14.0. The read-only visibility check uses real authenticated Codex and the locally installed pinned package. It is excluded from both adoption counts and task results.

The runner archives the filtered snapshot, verifies current SHA-256 provenance, stores protocol and agent events and patches outside the repository, and replays scoped patches on private scorer copies. The shared guide is explicitly applied by the experiment in each disposable copy. Production setup continues to leave project instructions under user control.

Primary experiment artifacts are under `%TEMP%/hm32-agent-eval-lvhORR`. The five initial launches outside the completed natural decision-prose baseline failed at workspace routing before any tool call or edit. The runner preserved those outcomes. Only those five infrastructure failures were eligible for the retry, with the same task order, prompts, snapshot, model, and limits.

The first retry is under `%TEMP%/hm32-agent-eval-dmeL0F`. Natural decision-prose memory finished. The module-link memory session read Active Tasks and ran two evidence queries before the client rejected further model requests at its usage limit. It produced no patch. The module-link baseline and both prompted sessions were rejected before they acted. The next retry was started after the reset time stated by the client. Completed decision-prose patches were not rerun.

## Natural decision-prose pair

| Arm | Seconds | Shell / inspection / tests | Successful HyperSABMemory calls | Independent result |
|---|---:|---:|---:|---|
| Repository only | 140.31 | 12 / 6 / 7 | 0 | Probe passed, 63 regressions passed |
| Repository + memory | 199.07 | 13 / 6 / 8 | 3 | Probe passed, 61 regressions passed |

The repository-only agent attempted generic MCP resource discovery and then used the checkout. It added its regression in `tests/decisionMarkdownSafety.test.ts`. The treatment read Active Tasks, queried evidence, and restored a ready checkpoint. It recovered the exact constraint on source attribution and captured hashes, a next action, and five current source references before editing. The general query returned current citations with `answerVerified: false`. The agent then fixed the shared scanner and added a test in `tests/taskLedger.test.ts` asserting excerpt, rationale, source path, line numbers, and captured hash.

Both patches moved open-comment handling ahead of recognizing a new fence. The treatment used the handoff to identify the implementation and citation contract, and its patch reflected both. The repository-only agent reached the same approach independently. The treatment was slower in this pair and neither arm made unrelated tracked changes. The treatment's first independent regression process crashed in the Windows thread pool; the unchanged scorer suite passed with fork workers. The suites included each patch's changed test file, which accounts for the count difference.

The post-limit retry artifacts are under `%TEMP%/hm32-agent-eval-SpcxkM`. The module-link treatment finished in 187.36 seconds with 16 shell commands, seven inspection commands, nine test commands, and four successful MCP operations. Its evidence query returned current references to `implementationEvidence.ts` and `Architecture.md`, including the indexed prior static-import convention. The query marked the answer unverified. The agent checked the architecture and source, restricted test links to compatible runtime extensions, and retained code evidence and unverified execution status. Its nonempty patch was limited to the verifier and regression test. It passed the frozen probe and 63 independent regressions after a fork-worker retry of the native thread crash. The trace shows relevant evidence being consulted and cited, while the exact extension behavior was verified against code and the external probe.

## Natural module-link pair

| Arm | Seconds | Shell / inspection / tests | Successful HyperSABMemory operations | Independent result |
|---|---:|---:|---:|---|
| Repository only | 146.36 | 15 / 11 / 5 | 0 | Probe passed, 69 regressions passed |
| Repository + memory | 187.36 | 16 / 7 / 9 | 4 | Probe passed, 63 regressions passed |

The repository-only agent implemented the compatible-extension rule independently, kept incompatible files available as code evidence, and covered ambiguity along with positive aliases. It added only the verifier patch and focused tests. The original thread scorer crashed, and a fork-worker rerun passed on the same files. Both module-link probes passed. The memory arm used fewer inspection commands but took more time and ran more test commands. Across the two natural pairs, both arms earned two independently accepted patches. Only the memory arm used HyperSABMemory. No experimental patch entered production.

## Prompted decision-prose diagnostic

The memory arm completed in 222.17 seconds with 18 shell commands, seven inspection commands, 12 test commands and three successful HyperSABMemory operations. It read Active Tasks, queried evidence, and restored the checkpoint. Its final message explicitly connected the recovered constraint to the architecture and evidence rules. The patch used the shared prose scanner to respect those rules and tested exact source attribution. The frozen probe passed, and the unchanged fork-worker scorer passed 61 regressions after the thread process crashed. These calls are directed use and excluded from the natural-adoption count.

The equivalent repository-history arm finished in 159.25 seconds with 21 shell commands, eight inspection commands, 13 test commands, and zero HyperSABMemory operations. It looked through Sprint 2.8 project history and the checkout, reached the same scanner correction, and added a scoped provenance regression. It passed the frozen probe and 61 independent regressions after a native thread-worker crash. Both prompted sessions had the same 300-second cap and independently accepted patches. Agent-reported test results included Windows sandbox and native process failures. Only the independent scorer exits determine the experimental result.

## Status and commit

The verified product change is `5d8ef9ece93eec917c98216e3ab2ee291e061d69` (`fix: preserve accurate TypeScript test attribution`). The experiment tooling and this report are in the accompanying local evaluation commit. Sprint 3.4 engineering is complete. Source-backed task recovery and corresponding implementation changes were observed. The natural pairs tied on correctly completed tasks and the prompted pair also tied. The memory arm took longer in all three pairs. Those observations do not isolate a causal time penalty or establish a general benefit.

The next product blocker is finding handoffs where the retrieved checkpoint supplies decisive context and measurably removes work. These test cases were recoverable from the repository, and the added checkpoint was useful without being necessary. The comment/fence and module-extension patches remain experimental and require separate production review. Remote CI, public registry installation, and independent human review remain unverified.

## Product verification and frozen gate

The focused implementation-evidence, grounding, and task-answer suites passed 45 tests. After rebuilding, the original Sprint 3.3 attribution probe passed unchanged. Sequential full verification passed 290 tests across 44 files, no-emit typecheck, standalone build, eight MemoryBench tests, and local-tarball package smoke with a fresh MCP process.

The unchanged frozen evaluator exited 1 after the production correction. Raw P@5 and macro recall were 0.470 and 0.7208. Grounded scores were 0.430 and 0.6583. It recorded 0/20 supported broad assertions, 0/10 unsupported no-answer assertions, zero forgotten leaks, and 0/20 stale leaks. With 150 samples, p50/p95 were 53.14/163.42 ms against the 100 ms p95 release gate. The release remains **NO-GO**.

## Matched request timing

`node scripts/sprint29-latency-probe.mjs --compare <baseline-dist>` exercises both in-memory MCP builds over the same workspace and captured task. Each build has three warmups and 40 alternating measured requests per path. The first benchmark setup failed because the create schema disallows inline decisions. The rerun recorded them through the existing claim and checkpoint operations.

| Path | p50 before → after | p95 before → after | Source reads/request | Response bytes |
|---|---:|---:|---:|---:|
| Task context with linked constraint | 48.87 → 50.24 ms | 55.03 → 59.70 ms | 13 → 13 | 8,181 → 8,181 |
| Evidence query with a linked test | 83.71 → 84.76 ms | 93.17 → 94.87 ms | 13 → 13 | 4,960 → 4,960 |

Reads count source-file reads in the probe, including repeated validation. Both versions shared the process, which ended at 134.89 MiB RSS, so there is no per-version memory comparison. The benchmark retains the fixture path in its logs. This shows no change in request reads or size, and does not establish a latency improvement. Independent process behavior was checked separately by the tarball smoke.
