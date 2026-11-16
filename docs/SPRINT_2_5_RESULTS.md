# Sprint 2.5 — Multi-source retrieval and evidence safety

**Status: NO-GO.** All measurements are local Windows x64 / Node 22.14.0. Frozen labels were not edited. One final frozen evaluation was run after implementation changes were finalized; its exit code 1 correctly indicates failed gates.

Implementation is isolated on `feature/sprint2.5-20261106` at the original base commit with uncommitted changes. The three maintenance worktrees remain present and untouched by Sprint 2.5.

## Implemented

- Added a separate, source-path-labeled development fixture with 11 answerable multi-source tasks, ten unanswerable tasks, and one task requiring Architecture documentation. No query text overlaps the existing development or frozen fixture. The maximum answerable precision@5 ceiling is 0.982 (54 relevant slots over 55).
- Fixed path token coverage: artifact paths are now tokenized before lowercasing, allowing `leaseCoordinator.ts` to contribute both `lease` and `coordinator`. In a same-fixture replay of the previous lowercased-before-tokenizing formula, development P@5 stayed 0.5636, macro recall@5 rose 0.5576 to 0.5621 (+0.8%), and MRR rose 0.750 to 0.803 (+7.1%). Grounded precision/recall did not change in this replay. This is a small measured improvement, far short of the 20% target.
- Bounded repository evaluation now indexes the existing `Architecture.md` through `discoverProjectSources`, while leaving `Memory.md` and unrelated user documents out of the corpus.
- One-shot `setup` now makes no Git commit by default. `setup --checkpoint` opts into a local initial checkpoint. The package smoke test verifies default/repeated setup leaves `HEAD` unchanged, preserves user instructions and another MCP server, installs from a local tarball, remembers/recalls a fact, lists tools, coordinates two independent MCP clients, rejects a competing lease, checkpoints progress, restores it after restart, and removes HyperSABMemory files without removing user files. The generated `npx` MCP entry is checked, then replaced with the installed tarball's local CLI path for the offline handshake; registry resolution of `npx hypersabmemory mcp` is unverified.
- Grounded regression tests cover same-size source rewrites, deletion, rename/stale indexed references, evidence changing after retrieval but before assertion, superseded/forgotten filtering, and a current-evidence refresh. Across four explicit invalidated-source cases, tests assert zero stale-backed assertions; the frozen held-out leakage gate remains unmeasured. Duplicate assertions for the same identifier and source path are emitted once.

## Measurements

The current development run on 11 answerable and ten no-answer cases reports raw P@5 **0.564**, macro recall@5 **0.562**, micro recall@5 **0.554**, MRR **0.803**, no-answer raw candidate results **8/10**, grounded P@5 **0.491**, grounded macro recall@5 **0.480**, supported assertions **0**, forgotten leaks **0**, and latency p95 **149.88 ms**. Relative to the historical minimum targets, development raw P@5 and grounded P@5 exceed their minimums, while raw and grounded recall do not. This separate, manually authored fixture has not received independent human review.

The final frozen run reports raw P@5 **0.470**, macro recall@5 **0.725**, micro recall@5 **0.712**, MRR **0.788**, grounded P@5 **0.340**, grounded macro recall@5 **0.529**, supported assertions **0/20**, unsupported no-answer assertions **0/10**, forgotten leaks **0**, and p95 **124.00 ms** over 150 samples. It reports `staleSourceTested: false`; stale leakage is not covered by that frozen evaluation.

For the separate grounded 10,000-record benchmark (71 real TypeScript source files, 9,929 synthetic distractors, six development queries), three post-optimization runs produced median warm p50/p95 **71.28/94.36 ms** and median fresh-engine first-query p50/p95 **110.64/169.07 ms**. Warm p95 was below 100 ms in all three runs; fresh-engine p95 remains above target. Median candidate retrieval p95 was **62.47 ms**. Stage percentiles are independent and should not be summed. The benchmark uses prior development queries and synthetic distractors, not live-agent traffic.

Compared with historical Sprint 2.4 frozen metrics, raw P@5 improved **6.8%** and raw macro recall@5 **6.8%**; grounded P@5 decreased **2.9%** and grounded recall@5 decreased **3.1%**. All four changes miss the 20% target; two grounded metrics regressed. Historical latency runs use different corpus counts and are not a controlled comparison. The development-only path-coverage replay uses the same fixture and corpus.

## Verification

- `npm test`: **211 tests passed in 36 files**; this command builds first.
- `npm run eval`: **8 tests passed**.
- `npx tsc --noEmit`: passed.
- `npm run package:smoke`: passed after local tarball installation, consumer setup, two-client MCP/task recovery, and removal checks.
- `npm audit --omit=dev --audit-level=high`: **0 vulnerabilities**.
- The package install emitted a `prebuild-install` deprecation warning for a transitive package; the production audit found no high-severity vulnerability.
- `node scripts/grounded-benchmark.mjs 10000`: completed with the profile above.
- `node scripts/repository-task-eval.mjs`: completed once on the final code; exit code **1** because frozen release gates fail.
- The final path change raises P@5 on the old development-only fixture from 0.620 to 0.640; after adding the architecture-document case, P@5 is 0.564. The current report does not claim a 20% quality improvement.
- Cross-platform CI is configured for Windows/macOS/Linux × Node 20/22/24, but remote results were not run or verified. No publishing or push was attempted.

## Remaining gates and next step

The 20% development-quality target is not met, raw macro recall remains below 0.815 and the release gate 0.85, the frozen release gates fail, no held-out assertions are supported, grounded p95 is above 100 ms, and frozen stale-source leakage is untested. The best-supported next action is to optimize candidate retrieval, currently the largest measured latency stage, while building a genuinely blind multi-source evaluation and retaining the source-hash checks.
