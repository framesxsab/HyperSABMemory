# Sprint 3.2 coding-agent comparison

The evaluation starts at `d44ac8883ce4b43a240b2830420b5d07365b405e`, tree `d480d1f5ce38119662040a5d8ad70126fc347ac5`, on `feature/sprint2.5-20261106`. The ten untracked audit and planning files stayed outside the experiment. The three maintenance worktrees were left alone.

## Frozen design

The [task manifest](../scripts/sprint32-tasks.json) records the exact task-specific prompts, order, model, and common time limit. The runner appends identical instructions about workspace scope, Vitest workers, evidence reporting, and avoiding commits to both arms.

1. **Freshness correctness.** A same-size decision rewrite after the first read invalidates a recorded relationship. The unmodified grounder still emits an explicit-link assertion from the constraint file. The independent probe first verifies the normal link, then requires the stale relationship and compound answer to disappear while the current standalone constraint remains.
2. **MCP regression protection.** The installed-package smoke already covers implementation evidence, but the faster public-handler integration suite lacked it. The test-only task adds code and linked test citations and checks the execution and verification flags. Preflight demonstrated that the old suite passes both wire mutations. A passing patch must fail both mutations while passing the unmodified suite.

The order was freshness baseline, freshness memory, wire regression memory, wire regression baseline. Each CLI invocation uses a fresh workspace-write session and a separately extracted archive with the same Git tree. The runner installs locked dependencies once with `npm ci` and copies them privately into each checkout and scorer. The memory arm additionally has a read-only MCP allowlist and indexed excerpts copied from existing architecture documentation, with links to the documented source files. The seed has no expected patch or scoring fixtures. Scoring replays only the captured patch on an independent source and dependency copy.

## Running the comparison

Authenticate with Codex CLI in advance. On the Windows Node installation used here:

```powershell
$env:HM32_CODEX = (Get-Command codex).Source
$env:HM32_NPM_CLI = Join-Path (Split-Path (Get-Command npm.cmd).Source) 'node_modules/npm/bin/npm-cli.js'
node scripts/sprint32-agent-eval.mjs
```

Pass a task name to run both of its conditions in the frozen order. Pass a task and arm, for example `freshness baseline`, to run one condition. Use `node scripts/sprint32-agent-eval.mjs --summary <artifact-directory>` for offline analysis. Agent and scorer logs, patches, hashes, and the result JSON remain in the printed disposable artifact directory. The run does not commit its traces or experimental patches.

## Infrastructure interruptions

- An initial npm launcher stalled before the runner started. Direct Node invocation with the explicit npm CLI entry reached the preflight.
- The first preflight passed the task checks, then the run stopped before launching an agent because Git for Windows applied CRLF conversion during archive creation. The resulting Git tree failed the byte-for-byte snapshot guard. The runner now disables conversion for archive creation, and the next preflight passed with the pinned tree.
- The next runner stopped during the first agent run. It left a 48-line test-only partial edit, with no agent transcript or completed score. That checkout, the preflight logs, and `freshness-baseline-interrupted.patch` remain under `%TEMP%/hm32-agent-eval-xgMWn3`. The infrastructure retry reused the same plan and added direct-to-disk event logging.
- The first detached launch waited on stdin before opening a model session. Its empty event stream and diagnostic output are retained under `%TEMP%/hm32-agent-eval-BUaiOO`. The launcher now provides a pipe and closes it explicitly.

## Primary run environment

Windows x64, Node 22.14.0, Codex CLI 0.171.0, model requested as `gpt-6.2-sol` with low reasoning effort. The model service did not report a backend build ID. Both conditions had the same 300-second wall-clock cap. The tar snapshot SHA-256 was `81ab9d98bc67aede289df163be7a39225d6226fceec624870cb40ca426f76bca`. The plan SHA-256 was `1534c08efdfd4b1ff2d7dbb1a37afdf91b226b78393642b2413b7e4bcb679cb2`. The independently applied freshness probe SHA-256 was `4ebb5ffac41796871b939d4e0735a5254a70b19d496ace1b27edd51b9422777c`.

Primary traces and patches are under `%TEMP%/hm32-agent-eval-Y3xO2L`. Both freshness patches touched only the two required files and passed the independent freshness probe. Both original broader scorer runs ended with Windows status `0xc0000005` and no assertions reported. The wire task's first two launches ended during workspace routing discovery before any shell or MCP calls and produced empty patches. The retry paired only those two launches in the same order. The freshness memory run stopped at its frozen deadline and was not retried.

## Agent executions and patch review

| Task | Arm | Session | Seconds | Shell / inspection / test commands | MCP calls | Independent task checks |
|---|---|---|---:|---:|---:|---|
| Freshness | Repository only | Finished | 137.85 | 13 / 8 / 6 | 0 | Freshness probe passed |
| Freshness | Repository + memory | Deadline after editing | 300.08 | 7 / 5 / 3 | 0 | Freshness probe passed |
| Wire regression | Repository + memory | Finished on infrastructure retry | 101.83 | 10 / 6 / 6 | 0 | Both mutations caught |
| Wire regression | Repository only | Finished on infrastructure retry | 95.33 | 13 / 10 / 4 | 0 | Both mutations caught |

The two empty wire launches took 56.50 seconds for memory and 48.93 seconds for repository only. They remain in the primary result file. Wire retry traces and patches are under `%TEMP%/hm32-agent-eval-fWSwu6`. Shell counts are completed command events. Inspection and test counts are command-text classifications and can overlap. File-change events were 3, 2, 1, and 1. The completed turns reported input/output token totals of 450,936/3,638, 437,579/1,889, and 440,690/1,878 for freshness baseline, wire memory, and wire baseline respectively. Most input tokens were reported as cached. The interrupted memory freshness turn supplied no final usage.

- Freshness baseline rebuilt the relationship assertions and cited excerpts after the final hash check, kept the standalone constraint, and added a regression. Freshness memory independently reached the same broad strategy and passed the frozen probe despite the deadline. Its session events include recurrent transport errors. Both diffs are confined to the planned production and test files.
- Wire memory used the public handler and verified code/test hashes, line spans, an aliased import, the execution marker, and abstention. Wire baseline independently exercised the same handler and also covered exclusion of a shadowed import. Both diffs are test-only. Each new test was the failing test under both mutations.
- No arm edited production files outside the authorized freshness file or made a tracked unrelated change. Review here means inspection of the patches and logs by the evaluation author and independent automated replay. No human review was conducted.

The measured effect is access to memory under these prompts. Both treatment agents used repository inspection and made zero MCP calls. Their patches therefore provide no evidence that retrieved memory changed an action. The targeted prompts already named the test or production file, which limits what these tasks can establish about discovery or handoff value. One session per arm, transport interruptions, and model variability also limit the comparison. No experimental patch was applied to the Sprint branch and no production change was justified by observed memory use.

## Scorer recovery

The independent broader suite uses the same grounding, public MCP, and task-ledger tests for each patch. The Windows thread process exited with an access violation on all four patches. Both wire runs had already printed 61 passing tests when the process failed. All four fork-worker reruns passed 61 tests each without editing the patches or assertions. Original thread exits remain in `results.json`. Rerun logs have the suffix `-regression-forks.log` alongside the originals. The runner now retries only that native crash with fork workers and saves the original crash log. The two on-task wire sessions also reported sandbox command-launch impediments and used the native config loader to run their own tests. The independent scorer ran the regular config.

## Engineering and release

Both arms produced two patches that passed independent task and regression checks after infrastructure recovery. Repository only finished both sessions. Memory access finished one session and reached its deadline on the other after writing an accepted patch. No advantage from memory was demonstrated and the deadline is not attributable to MCP overhead from these traces.

Sprint 3.2 engineering is complete as an evaluation deliverable. Runner commit `6faabd2b35473624e5bcad914aa6daf290998005`. The checkout verification ran sequentially and passed the full suite (281 tests across 43 files), no-emit typecheck, standalone build, eight MemoryBench tests, and locally installed package smoke with a fresh MCP process. Runner script syntax checks, the frozen preflight, and offline result display also passed.

Release remains **NO-GO**. Sprint 3.1 frozen results are historical because this sprint changed evaluation tooling only. Raw precision@5 and macro recall were 0.470 and 0.7208. Grounded precision@5 and macro recall were 0.430 and 0.6583. Supported broad assertions were 0/20 and unsupported no-answer assertions were 0/10. Forgotten leakage was zero and stale leakage was 0/20. Frozen p95 was 147.40 ms against the 100 ms threshold. No release gate changed. Remote CI and public registry installation remain unverified.

The next product blocker is showing that agents discover and use the memory evidence on genuine tasks where the starting file and prior decision are not already given. A follow-up should measure actual evidence use and independently scored outcomes separately.
