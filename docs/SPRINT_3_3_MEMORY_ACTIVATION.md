# Sprint 3.3 memory activation and handoff

Started at `49ddd3ebd804fbc2c17f65081ca4f3313d9c1dd7` on `feature/sprint2.5-20261106`. Ten pre-existing untracked files were preserved. The three maintenance worktrees were left at `592f054`.

## Diagnosis and opt-in integration

Sprint 3.2 recorded zero MCP calls in its treatment traces. The wire task trace shows the agent reading the repository skill, tests, and source directly. The original configuration allowed the general query and evidence query, and did not expose task restoration. Those traces contain no successful discovery or invocation and do not establish whether the tool was unseen, understood and skipped, or unnecessary. The named files made repository inspection a plausible direct route. There is no evidence that a tool description caused the result.

The [opt-in handoff guide](AGENT_HANDOFF.md) gives a short project instruction for unfinished work and historical decisions. Users copy it into their own agent instructions by choice. It points to the existing active task resource, context tool and evidence tool. Setup behavior, server schemas and retrieval are untouched.

## Registration and real client check

The runner installed the pinned local tarball in a fresh prefix. A separate protocol client listed the tools, read the Active Tasks resource, and verified that all four checkpoint sources had current SHA-256 citations. The authenticated Codex diagnostic successfully invoked both task context and the evidence query with the experiment's read-tool allowlist. It reported a ready, unclaimed checkpoint at revision 4, recovered its next action, and cited the current architecture statement about rereading and hashing source evidence. The query returned no verified assertion for the actual rewrite case. This read-only, directed check is separate from the adoption counts.

## Frozen task design

The [manifest](../scripts/sprint33-tasks.json) records prompts, model, and order. The runner checks the same Git tree for each agent copy, installs dependencies once and copies them privately, gives the same opt-in guide to both natural arms, then scopes MCP to the memory arm. The guide contains no task answers. Both natural arms get identical prompts. Only the prompted diagnostic adds a neutral instruction to consult handoff evidence. The baseline keeps all repository documentation and development tools.

- **Resume.** The unfinished freshness issue is genuine work identified in the Sprint 3.2 pilot. Its experimental patches were never applied. The checkpoint is a reconstruction from that prior report and patch judgment, not a claim that a ledger existed during Sprint 3.2. It records the next action and the constraint to retain current standalone evidence after the other endpoint goes stale. The report and code exist in both arms. The reconstructed checkpoint, its next action and exact constraint wording are available only through the treatment's ledger. The independent probe demonstrates the bug on the starting snapshot and checks the valid-link control and stale-link failure.
- **Attribution.** Current TypeScript import syntax can look like a valid link even when the import is erased before execution. Sprint 3.0 documented the requirement for a named import and an identifiable test assertion. The treatment indexes that exact historical rationale with citations. The same report exists in the baseline repository. The independent probe requires an ordinary value import to remain linked, and verifies rejection of declaration-level and specifier-level type-only imports, including the test and assertion helpers.

All task and probe definitions were written before agent execution. The runner replays patches only on independent checkouts, with task probes outside the agent's files during execution.

## Reproduction and evidence

Use the Sprint 3.2 runner and environment setup described in [the prior evaluation](SPRINT_3_2_AGENT_VALUE.md). Run `node scripts/sprint32-agent-eval.mjs --activation` to opt in explicitly. Offline summaries use `--summary <artifact-directory>`.

The local run directory is `%TEMP%/hm32-agent-eval-cCPSWs`. It retains the plan, probe hashes, opt-in note, saved protocol visibility check, event traces, patches, and independent scorer logs. The repository report includes summarized outcomes rather than raw session traces.

## Natural resume pair

| Arm | Seconds | Shell / inspection / tests | Successful HyperSABMemory calls | Independent result |
|---|---:|---:|---|---|
| Repository only | 220.06 | 16 / 10 / 7 | 0 | Freshness probe and regressions passed |
| Repository + memory | 191.10 | 11 / 5 / 4 | 3 | Freshness probe and regressions passed |

The baseline tried generic MCP resource discovery and then used the checked-in Sprint 3.2 report. The treatment read Active Tasks, asked a general evidence question and restored the checkpoint, all before its first edit. The general query returned five current citations and no verified answer. Some of those citations concerned neighboring MCP implementation and tests. The checkpoint itself narrowed the work to the recorded source references, next action, and the constraint to preserve independently supported current evidence.

The agent said it would recover the pilot handoff and verify against the checkout. Its patch validates the relationship after final source verification and adds a same-size rewrite regression that preserves the current constraint. The trace shows that the recovered constraint preceded a matching change. Both agents made that change, so the evidence does not establish that memory was necessary or caused the elapsed-time difference. Neither patch was applied to production. Resume baseline reported 1,118,100 input and 4,096 output tokens, including 1,056,640 cached input. Treatment reported 450,250 input and 3,245 output tokens, including 381,568 cached input. These totals do not establish a reduction in uncached token use.

## Infrastructure interruptions

The original attribution memory arm reached the deadline during transport failure before any shell or MCP call or edit. Its trace reports a WebSocket certificate error followed by HTTPS connection failures. Attribution baseline and prompted resume both failed in workspace routing before any task activity. Only these three infrastructure outcomes were eligible for retry. Their original results remain unchanged. The retry used the same model, snapshot, time limit, task prompts, opt-in policy, and scoring probes.

Retry artifacts are under `%TEMP%/hm32-agent-eval-LpZrYJ`. The authenticated visibility check again passed. In the resumed attribution memory arm, Active Tasks was empty as expected. The two evidence queries returned the historical Sprint 3.0 test-link record and candidate excerpts from implementation and test sources, with no verified answer. The agent identified the erased-binding issue in the target, test runner, and assertion imports. It produced a test-only patch and reached the deadline without a production edit. This fails the frozen scope gate. The runner performs no regression replay on a patch missing the required production file. This was a task attempt and was not retried.

## Natural attribution pair

| Arm | Seconds | Shell / inspection / tests | Successful HyperSABMemory calls | Independent result |
|---|---:|---:|---|---|
| Repository only | 300.10 | 20 / 10 / 8 | 0 | 74 regressions passed, frozen attribution probe failed |
| Repository + memory | 300.10 | 12 / 9 / 3 | 4 | Incomplete test-only patch, scope gate failed |

Both sessions reached the same deadline. The baseline's worktree contained a runtime import filter and additional tests, but a false type-only link survived the independent probe. The treatment's calls were resource listing, reading Active Tasks, and two evidence queries. Retrieval of the prior rationale did not yield an accepted patch. Neither deadline produced complete token usage. No evidence demonstrates that MCP latency caused the failures.

## Prompted memory-use diagnostic

The fresh prompted resume session completed in 153.38 seconds, with 11 shell commands, six inspection commands, and four test commands. It made four successful HyperSABMemory calls: list resources, read Active Tasks, query evidence, and restore the checkpoint. The agent explicitly cited its recovered handoff, cross-checked the pilot report and architecture, and implemented the stale-link correction with the same-size rewrite regression. Independent replay passed the frozen probe and all 61 regression tests. The reported input/output tokens were 623,921/4,030, including 583,168 cached input tokens. This run validates a directed handoff. It is excluded from natural-adoption counts and causal timing comparisons.

Inspection found no unrelated tracked changes in the scored patches. The natural resume and prompted traces retrieved current task provenance and treated candidate excerpts as unverified. The scorer used the unchanged frozen probe for each respective task and the same regression suite. No human review, agent patch integration, or additional production change was performed.

## Verification and release

The full checkout suite passed all 281 tests across 43 files. No-emit typecheck, standalone build, eight MemoryBench tests, and fresh-process package smoke passed sequentially. The smoke checks that the installed tarball includes the bounded handoff block and setup leaves it out of project agent instructions. The protocol test and authenticated client runs separately verified registration, permissions, restored context, and current citations. The four checkpoint SHA-256 values also matched independently hashed archived source files. Existing grounding and task tests cover stale and forgotten evidence. This sprint did not change those paths.

Sprint 3.3 engineering is complete for opt-in activation and the pilot. Natural memory use occurred on both treatment tasks, and the completed resume patch shows how a checkpoint can direct the next action. Task completion was tied across the natural arms, at one accepted patch each. No general correctness, speed, or resource advantage is established by two tasks. Remote CI, public registry installation, and independent human review remain unverified.

Local integration and evaluation commit `c4f206c7cd0e1bec635c0e8fbf6294dc6b700281`. The primary and retry runner hashes are recorded in their result JSON files. After the primary launch, runner edits moved protocol imports into the activation block and added subset selection for infrastructure retries. The prompts, scoring probes, policy text, and snapshot stayed fixed.

Release remains **NO-GO**. The unchanged thresholds were not freshly evaluated because this sprint changed onboarding and evaluation tooling only. Historical Sprint 3.1 results remain raw P@5/macro recall 0.470/0.7208, grounded 0.430/0.6583, supported broad assertions 0/20, unsupported no-answer assertions 0/10, forgotten leaks 0 and stale leaks 0/20. Frozen p95 was 147.40 ms against the 100 ms gate.

The next product blocker is showing repeatable completion value across real handoffs with differing amounts of history in the repository and ledger. Future pilots should measure actual checkpoint use and independently accepted patches separately.
