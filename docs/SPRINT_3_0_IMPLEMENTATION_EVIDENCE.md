# Sprint 3.0 implementation evidence

Started on `feature/sprint2.5-20261106` at `ee5fcdb40ca7e79448b26c638d30198a11c0b3de`. The worktree had only the ten pre-existing untracked audit and planning artifacts. Sprint 2.8 and 2.9 reports are preserved.

## What is supported

Location and evidence questions can receive an optional `implementationEvidence` packet through `searchGrounded` and `hypersabmemory_query_evidence`. The verifier inspects current files reached through ranked memory records. It parses up to 20 JavaScript or TypeScript files of at most 256 KiB each with the TypeScript compiler already in the lockfile, now a runtime dependency. It returns up to three named function or class-method locations, up to five call sites and five throws per location, and up to four test assertions. Excerpts are capped at 320 characters. Code observations and test definitions remain separate from the existing recorded claims and answer verification flags.

Test links require a supported Vitest assertion around a direct call to a named import or a method on a local const initialized with an imported class. Local binding checks exclude shadowed names. Relative import matching is scoped to the inspected files. Re-exports, indirect calls, runtime module identity and arbitrary assertion styles are outside this slice. The packet labels executions unverified. The final source check revalidates hashes for the code and test before returning their link. A later filesystem change can invalidate that result.

## Independent consumer

The package smoke installed the local tarball and copied real source and test files into a disposable project. It registered them through the public remember tool, then queried a fresh MCP process with “Where is exclusive task claiming implemented, and what evidence supports its behavior?” The question supplied no filename.

- `TaskLedger.claim` spans lines 354–386 of `src/memory/taskLedger.ts`, SHA-256 `80348ce4035b15bb7c78667d8d3278ebc9c82120cba810590f2fb257a61514d8`. The source contains `this.mutate(...)` at lines 361–385 and a `CLAIM_CONFLICT` throw at line 370. These observations describe statements in the method.
- Line 20 of `tests/taskLedger.test.ts` asserts that a second claimant throws “Task is already claimed.” Its SHA-256 was `8afcea9adcf663b49dfb47ef8ba5e439a1566378f59d72a89d07a1cd380d892c`. The packet cited the relative import and assertion and marked execution unverified.
- The separate `npm.cmd test` run on Windows x64, Node 22.14.0, passed that test in the Sprint 3.0 working snapshot. The test checks rejection while the first agent holds the lease. The smoke query about race freedom under all circumstances returned `answerVerified: false`.

This was scripted public MCP validation. Codex and Claude Code reported logged out. No authenticated agent task or independent human review was performed.

## Local checks

- `npm.cmd test` passed 281 tests across 43 files, including the distinct `tallyCrates` fixture, unrelated and shadowed names, same-size code and test rewrites, forgotten-memory exclusion, and task and lease regressions.
- `npx.cmd tsc --noEmit`, `npm.cmd run build`, `npm.cmd run eval` (8 MemoryBench tests), and `npm.cmd run package:smoke` passed. The first full build caught two TypeScript type errors in the new integration. The sequential run passed after the types were corrected.
- The fresh package run also exercised scalar, decision, and multi-source claims and task recovery.

## Performance and release

Repeated local tarball smoke measured 30 warm end-to-end requests in each category. Code location and call sites measured 67.23/95.44 ms p50/p95. Code with a linked test measured 125.22/167.13 ms. Unsupported behavior measured 63.41/78.21 ms. These are observations from a small disposable project.

The unchanged frozen evaluator exited 1 against the current indexed corpus. Raw P@5 and macro recall were 0.470 and 0.7208. Grounded P@5 and macro recall were 0.430 and 0.6583. Supported broad assertions were 0/20, unsupported no-answer assertions were 0/10, forgotten leaks were 0, and stale leaks were 0/20. Frozen p50/p95 were 65.03/303.84 ms. Retrieval scores were lower and p95 higher than the historical Sprint 2.9 run. The corpus and host measurements differ, so the comparison does not isolate the source of the regression. The evaluator scores verified assertions and gives no credit for a code or test location alone.

Sprint 3.0 engineering acceptance is complete for the source-backed slice. Release remains **NO-GO**. Broad answer quality is the main blocker, with retrieval and latency also below release readiness. Remote CI, public registry installation and production latency remain unverified.
