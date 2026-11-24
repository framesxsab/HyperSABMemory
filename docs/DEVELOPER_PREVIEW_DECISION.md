# HyperSABMemory — Developer Preview Decision Record & Option B Acceptance Proposals

**Option B product direction: APPROVED**

**Option B acceptance thresholds: NOT APPROVED**

**Replacement release contract: NOT APPROVED**

**Product release: NO-GO**

---

## 1. Product-Owner Decision & Scope Distinction

The product owner approved Option B strictly as **HyperSABMemory's intended product direction**:

> HyperSABMemory is a local-first, source-verifiable memory and task-continuation harness for coding agents. It preserves development context, restores unfinished work, verifies source provenance, and exposes bounded evidence through MCP.

### Product Positioning vs. Release Authorization

This decision establishes **product positioning only**. It does **not** authorize or approve:

- Replacement release thresholds or modified evaluation gates.
- Removal or loosening of existing frozen release criteria.
- Public distribution or public-registry (`npm`) publication.
- Release-candidate (`RC`) publication or release tag creation (`v*`).
- Production deployment.
- Broad claims of general coding-agent productivity or benchmark superiority.

Even if remote GitHub Actions development CI succeeds across supported runners, **official product release status remains `NO-GO`** until: (a) explicit acceptance criteria are approved or existing frozen criteria are satisfied, and (b) release readiness is separately authorized.

---

## 2. In-Scope Developer-Preview Capabilities vs. Explicit Non-Guarantees

### In-Scope Preview Capabilities (Demonstrated Functionality Only)

1. Local-first project memory (JSON/SQLite-backed workspace store under `.hypersabmemory/`).
2. Historical development decisions and rationale captured with source references.
3. Unfinished-task restoration across interrupted sessions (`TaskLedger` with lease fencing).
4. One-call compact MCP handoff (`hypersabmemory_task_context` with `compact: true`).
5. Source-backed deterministic evidence retrieval and assertion checking (`searchGrounded`, `hypersabmemory_query_evidence`).
6. Exact symbol definition verification and explicitly scoped JSON scalar verification (`repository.type`, `$.type`, `root type`).
7. Explicit multi-source relationships (`Decision-Source:` markdown linking and conflict detection).
8. TypeScript and JavaScript implementation-to-test attribution (`collectImplementationEvidence` with AST + TypeScript TypeChecker import resolution).
9. Parameterized Vitest (`it.each` / `test.each` curried and tagged-template) and `node:test` / `node:assert` structural attribution (labeled `execution: "unverified"`).
10. SHA-256 current-file provenance on cited evidence items.
11. Freshness verification and same-byte-size rewrite protection (`STALE_EVIDENCE` detection).
12. Forgotten-memory exclusion across raw, grounded, and task-context paths.
13. Explicit verified versus unverified/weak candidate classification (`evidenceClassification` & `evidenceSummary`).
14. Git worktree memory and checkpoint isolation (`verifyGitWorktree`, shared `<commonDir>/info/exclude`, isolated `.git` worktree state and locks).
15. Offline installed-package MCP setup (`hypersabmemory setup` writing direct Node launcher entries without `npx` network fetches and creating `0` setup commits).
16. Local validation executed on Windows 11 (`win32 x64`, Node `v22.14.0`) and WSL2 Ubuntu Linux (`linux x64`, Node `v24.14.1`, native `ext4`).

### Explicit Non-Guarantees (Current Limitations)

These items are explicit product limitations and are **not** guarantees in scope for implementation during this gate:

1. No broad autonomous semantic question answering over unstructured repository prose.
2. No guarantee of generated or modified code correctness.
3. No guaranteed coding-agent productivity gains across general tasks.
4. No verification of runtime test execution or pass/fail status from static test-link attribution (`execution` remains `"unverified"`).
5. No guarantee of zero irrelevant retrieval candidates in top-`k` results.
6. No guarantee of universal cross-platform compatibility prior to verified multi-OS CI results across supported Node versions.
7. No public-registry (`npm`) installation readiness or release sign-off.

---

## 3. Official Frozen Release Contract (`NO-GO`)

The frozen evaluator ([src/eval/repositoryTaskEvaluation.ts](../src/eval/repositoryTaskEvaluation.ts), [src/eval/repositoryTaskFixture.ts](../src/eval/repositoryTaskFixture.ts)), `npm run release:preflight`, and `package.json` `prepublishOnly` remain authoritative, unmodified, and fail-closed. [scripts/option-b-shadow-eval.mjs](../scripts/option-b-shadow-eval.mjs) remains diagnostic only (`authorizesRelease: false`, `officialReleaseStatus: NO-GO`).

| Criterion (Frozen 30-Query Held-Out Evaluator) | Latest Observed Result (`adba40b` / `8f44a10`) | Frozen Contract Status |
| --- | ---: | --- |
| Raw precision@5 | `0.4800` | Fails (`required >= 0.5`) |
| Raw recall@5 | `0.7375` | Fails (`required >= 0.85`) |
| Grounded precision@5 | `0.4500` | Fails (`required >= 0.5`) |
| Grounded recall@5 | `0.6917` | Fails (`required >= 0.85`) |
| Broad supported assertions | `0/20` (`supportedAnswerCoverage: 0`) | Fails (`required > 0`) |
| Unsupported grounded assertions | `0` | Passes (`0`) |
| Forgotten leaks | `0` | Passes (`=== 0`) |
| Stale leaks | `0` (`staleProbe: 20/20` flagged) | Passes (`=== 0`) |
| Search p95 latency (`n=150`) | `23.31 ms` (`release:preflight` `22.32 ms`) | Passes (`< 100 ms`) |

Summary: `5/12` frozen release criteria fail (`retrieval.precisionAt5`, `retrieval.recallAt5`, `grounded.recallAt5`, `grounded.precisionAt5`, `grounded.supportedAnswerCoverage`); `7/12` pass (`maximumPrecisionAt5: 0.6600`, `noAnswerFalsePositives: 0`, `forgottenLeaks: 0`, `staleSourceTested: true`, `staleProbe.leaks: 0`, `latencyMs.samples: 150`, `latencyMs.p95 < 100 ms`).

---

## 4. Proposed Option B Acceptance Criteria (`PENDING PRODUCT-OWNER APPROVAL`)

All proposed numeric thresholds and pass bars below are **PENDING PRODUCT-OWNER APPROVAL**. They do not replace the frozen release contract and must not be adopted automatically or equated with candidate coverage.

| # | Criterion Area | Proposed Requirement (`PENDING PRODUCT-OWNER APPROVAL`) | Current Measurement (Sprint 3.5–4.3) | Test / Benchmark Source | Status | Remaining Risk | Additional Engineering Needed? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Deterministic source-verification accuracy | `0` unsupported assertions (`PENDING PRODUCT-OWNER APPROVAL`) and `100%` pass (`PENDING PRODUCT-OWNER APPROVAL`) on verified symbol, scoped JSON scalar, and explicit `Decision-Source:` multi-source suites | `0` unsupported assertions on held-out 30 queries (`0` on `6` unanswerable independent queries); `9/9` MCP checks pass; `38/38` valid on `ni` & `50/50` valid on `commander` | `tests/groundedSearch.test.ts` (`36/36`), `scripts/sprint37-grounding-bench.mjs`, `scripts/sprint40-independent-eval.mjs` | Passes locally (Win Node 22, Linux Node 24) | Scope restricted to deterministic AST/JSON/explicit markdown forms; bare ambiguous JSON keys (`type`) rightly abstain (`expectVerified: false`) | No for deterministic core; semantic prose claims excluded from guarantee |
| 2 | Provenance and freshness | Cited evidence carries current 64-hex SHA-256 and `100%` (`PENDING PRODUCT-OWNER APPROVAL`) stale detection including same-byte-size rewrites (`0` stale leaks, `PENDING PRODUCT-OWNER APPROVAL`) | `20/20` stale probes flagged (`0` leaks) on held-out eval; `22/22` flagged (`0` leaks) on `combinedDev42`; same-size rewrites flagged (`STALE_EVIDENCE` / `modified`) on Win & Linux `ext4` | `scripts/repository-task-eval.mjs`, `scripts/sprint39-dev-retrieval-eval.mjs`, `scripts/sprint42-worktree-eval.mjs` | Passes locally | TOCTOU mutations occurring strictly after MCP serialization returns to client remain outside harness visibility | No within single-call snapshot verification |
| 3 | Forgotten-memory protection | `0` forgotten or superseded leaks (`PENDING PRODUCT-OWNER APPROVAL`) across raw retrieval, grounded verification, and MCP `task_context` restoration | `0` forgotten leaks across `memorybench` (`8/8`), `repository-task-eval`, `sprint39-dev-retrieval-eval`, `sprint40-independent-eval`, `sprint42-worktree-eval`, and `sprint36-handoff-bench` | `tests/memorybench.test.ts`, `scripts/repository-task-eval.mjs`, `scripts/sprint40-independent-eval.mjs`, `scripts/sprint42-worktree-eval.mjs` | Passes locally | External memory files deleted or edited manually outside MCP remain subject to file checksum/availability rules | No |
| 4 | Git worktree and workspace containment | Strict canonical/symlink workspace containment (`0` escaping paths accepted, `PENDING PRODUCT-OWNER APPROVAL`), forged `.git` rejection, `.git/info/exclude` shared containment, and isolated task/checkpoint state per linked worktree | `6/6` worktree unit tests pass; `sprint42-worktree-eval` `passed: true` on Win Node 22 and Linux `ext4` Node 24 (`crossWorktreeSymlinkTested: true`, `caseSensitiveDistinctDocsTested: true`); `../` and escaping symlinks rejected | `tests/worktreePortability.test.ts` (`6/6`), `tests/storeContainment.test.ts` (`3/3`), `tests/autoCommitGuards.test.ts` (`2/2`), `scripts/sprint42-worktree-eval.mjs` | Passes locally | Unprivileged Windows NTFS file symlinks not exercisable without Developer Mode (`crossWorktreeSymlinkTested: false` on win32) | No (CI on `macos-latest` & `ubuntu-latest` Node 20/22/24 needed for verification) |
| 5 | Task-restoration correctness | Lease-fenced task claims (`TASK_ID_REQUIRED` / `TASK_ID_AMBIGUOUS` / `TASK_NOT_FOUND`), `100%` (`PENDING PRODUCT-OWNER APPROVAL`) active vs. completed filtering, and one-call compact handoff restoring goal, verified provenance, and stale eviction | `matrixPassed: true` (`7/7` handoff cases); `-65.9%` to `-66.1%` compact payload bytes (`4059–4163 B` vs. `11991–12224 B`); `sprint42-worktree-eval` offline MCP restart verified; Sprint 3.5–3.6 historical tasks completed (`n=2` & `n=1`) | `scripts/sprint36-handoff-bench.mjs`, `tests/taskLedger.test.ts`, `tests/taskProcesses.test.ts`, `tests/taskAnswerBundle.test.ts`, `scripts/sprint42-worktree-eval.mjs` | Passes locally (small agent sample `n=1..2` unapproved for general superiority) | General multi-task coding-agent effectiveness remains statistically unproven (`n=2` Sprint 3.5 tasks with post-hoc scorer corrections) | No for deterministic task mechanics; larger multi-agent eval needed if productivity claims are desired |
| 6 | MCP installation and startup | Fresh packed `.tgz` install runs offline `setup` (`0` network calls, `0` commits, direct Node config), discovers exact-cased root docs, and connects `stdio` MCP (`17` tools, `3` resources) | Verified in `package:smoke` (`188.5 kB` tarball, `171` files), `sprint40-independent-eval`, `sprint41-mcp-latency-profile`, `sprint42-worktree-eval` on Win Node 22 & Linux Node 24. *Observed risk*: concurrent WSL2 VM + Windows `setup` triggered one `NewSpace` heap OOM (`exit 134`); standalone ran cleanly in `1.90–1.95s` | `scripts/package-smoke.mjs`, `scripts/sprint40-independent-eval.mjs`, `scripts/sprint42-worktree-eval.mjs` | Locally verified (Win Node 22, Linux Node 24); remote CI pending | Prebuilt/rebuilt `better-sqlite3` ABI on macOS, Node 20, and host memory sensitivity during `setup` | Monitor CI native installs; investigate `setup` memory headroom if CI shows pressure |
| 7 | Implementation-to-test attribution | AST + TypeChecker value-import linking across direct (`vitest`/`node:test`), curried/tagged `.each` (`vitest`), and `node:assert` with `0` false links (`PENDING PRODUCT-OWNER APPROVAL`) and `execution === "unverified"` | `21/21` `implementationEvidence` tests pass; `ni` `isVerbatimSpec` (`2` parameterized tests), `parsePackageSpec` (`4` direct), `commander` `useColor` (`4`) & `DualOptions.valueFromOption` (`4`) linked; `9` negative cases + shadowed/`import type` probes rejected (`0` false links) | `tests/implementationEvidence.test.ts`, `scripts/sprint40-independent-eval.mjs`, `scripts/sprint43-evidence-bench.mjs` | Passes locally (Win Node 22, Linux Node 24) | Helper wrappers beyond direct/`it.each`/`test.each`, transitive call-chain mocks, and dynamic test pass/fail remain outside static attribution | Only if additional test DSLs become priority |
| 8 | Bounded evidence retrieval quality | Explicit PO-approved bounded top-5 recall & precision floors (`PENDING PRODUCT-OWNER APPROVAL`; e.g., separate raw/grounded `R@5`, `P@5`, `MRR` bar distinct from `answerableCandidateCoverage`) plus multi-repo held-out baseline | Frozen internal 30-query eval: raw `P@5 0.4800`, `R@5 0.7375`, `MRR 0.8750`; grounded `P@5 0.4500`, `R@5 0.6917`, `MRR 0.8750`. Dev 42 (`combinedDev42`): grounded `P@5 0.4545`, `R@5 0.7303`, `MRR 0.8977`. Independent repos: `ni` `R@5 1.0000` / `P@5 0.2857`, `commander` `R@5 0.9286` / `P@5 0.3143` | `scripts/repository-task-eval.mjs`, `scripts/sprint39-dev-retrieval-eval.mjs`, `scripts/sprint40-independent-eval.mjs` | **Fails frozen contract** (`R@5 < 0.85`, `P@5 < 0.50`); PO thresholds **UNAPPROVED** | Top-5 misses ~31% of relevant held-out files; lexical matching drops precision when few target files exist or query terms are broad | Yes **if** PO requires higher top-5 recall/precision rather than approving realistic Option B thresholds |
| 9 | Unsupported-query behavior | `0` unsupported assertions (`noAnswerUnsupportedAssertionRate = 0`, `PENDING PRODUCT-OWNER APPROVAL`), `answerVerified === false`, explicit `evidenceClassification`, and clear separation between `insufficient_evidence`, `memory_only_no_source_evidence`, `weak_lexical_candidates`, and `unverified_source_evidence` | `0` unsupported assertions across `10` held-out no-answer queries (`noAnswerCandidateRate: 0.4000`, `4/10` surfaced candidates) and `6` independent unanswerable queries (`ni_unans_redis`: `insufficient_evidence`, `ni_unans_k8s`: `memory_only_no_source_evidence`, `ni_unans_pg`/`cmd_unans_graphql`/`cmd_unans_oauth`: `weak_lexical_candidates`, `cmd_unans_sqlite`: `unverified_source_evidence` due to `"Commander"` token overlap) | `tests/mcpQuery.test.ts` (`12/12`), `scripts/repository-task-eval.mjs`, `scripts/sprint40-independent-eval.mjs` | Locally verified for explicit classification; candidate noise rate fails strict suppression expectations (`40%` internal, `5/6` candidate/excerpt hits independent) | Unanswerable questions naming repo tokens (e.g. `"Commander"`) still match lexical `source_excerpt` candidates (`unverified_source_evidence`) | Optional tightening of lexical gate only if PO rejects candidate backfill on no-answer queries |
| 10 | Warm and cold latency | Defined warm MCP & in-process latency budgets (`PENDING PRODUCT-OWNER APPROVAL`: e.g., held-out p95 `< 100 ms`, warm MCP p95 `< 50 ms`, cold first TypeChecker/MCP p95 `< 500 ms` across supported OSes) | Held-out `searchGrounded` p50/p95 `14.22 / 23.31 ms`; `sprint41` warm MCP p95 `9.03–25.00 ms`; `sprint43` `ni` parameterized warm cached in-process `0.014/0.128 ms`, MCP parameterized cold p95 `140.39 ms` / warm `9.32 ms`; `commander` cold p95 `294.54 ms` / warm `18.62 ms`; `sprint36` compact handoff p95 `15.08–18.58 ms` | `scripts/repository-task-eval.mjs`, `scripts/sprint36-handoff-bench.mjs`, `scripts/sprint41-mcp-latency-profile.mjs`, `scripts/sprint43-evidence-bench.mjs` | Passes locally (Win Node 22, Linux Node 24) | Larger repositories (>1k TS files) could raise cold `ts.createProgram` latency; macOS and Node 20 timings unverified | No for current benchmarked scope; monitor remote CI `package:smoke` latencies |
| 11 | Supported operating systems and Node versions | Green `.github/workflows/ci.yml` matrix across `ubuntu-latest`, `windows-latest`, and `macos-latest` on Node `20`, `22`, `24` (`PENDING PRODUCT-OWNER APPROVAL`) | Win 11 `x64` Node `v22.14.0` (`14/16` scripts pass; `s14`/`s15` frozen fail) and WSL2 Ubuntu `x64` Node `v24.14.1` (`9/9` commands pass). **macOS (`macos-latest`), Node `20` (all OSes), Linux Node `22`, Windows Node `24`, and remote GitHub Actions CI are UNVERIFIED as of this pre-push commit** | `.github/workflows/ci.yml`, Sprint 4.3 Win/WSL2 local runs | **PENDING** remote CI verification | Native `better-sqlite3@12.9.0` prebuild/compilation or OS-specific path/fsync/symlink quirks on unrun combos (especially `macos-latest` and Node `20`) | Contingent on remote GitHub Actions CI results |

---

## 5. Pre-Push CI Verification Status

At the time this record is committed prior to pushing `feature/sprint2.5-20261106`:

- Remote GitHub Actions runs across `ubuntu-latest`, `windows-latest`, and `macos-latest` on Node `20`, `22`, and `24` have **not yet executed**.
- Post-push CI workflow IDs, logs, matrix results, and any failure classifications will be recorded locally in [DEVELOPER_PREVIEW_CI_VERIFICATION.md](./DEVELOPER_PREVIEW_CI_VERIFICATION.md) and appended in a clearly separated local update to this document after inspection.

---

## 6. Post-Push Remote CI Verification Results (Local Update After Push `e6d6d22`)

*Note: Pushed commit `e6d6d22` did NOT contain this section or local test fix `7b3d8cc`; these results and fixes are local-only until another push is authorized.*

- **Remote Run**: CI Run `45043165195` (https://github.com/framesxsab/HyperSABMemory/actions/runs/45043165195) on `feature/sprint2.5-20261106` (`e6d6d22`); [.github/workflows/release.yml](../.github/workflows/release.yml) did **not** trigger.
- **Matrix Summary (`3/9` pass, `6/9` fail)**:
  - `ubuntu-latest` Node `20` (`v20.20.2`, job `137271885815`), Node `22` (`v22.23.5`, job `137271885672`), Node `24` (`v24.22.3`, job `137271885874`): **PASSED** all steps (`npm ci`, native `better-sqlite3`, `tsc`, `npm test` `48/48` files including `worktreePortability` `6/6`, `eval:baseline`, and `package:smoke` offline MCP handshake).
  - `windows-latest` Node `20` (`137271885877`), Node `22` (`137271885872`), Node `24` (`137271885960`): `npm ci`, `better-sqlite3` (`sqliteStore` `11/11`), `tsc`, and `worktreePortability` (`6/6`) **PASSED**; `npm test` **FAILED** on all 3 (`43 passed | 5 failed` files, `6` failed tests); `eval:baseline` and `package:smoke` skipped.
  - `macos-latest` Node `20` (`137271885855`), Node `22` (`137271885865`), Node `24` (`137271885915`): `npm ci`, `better-sqlite3` (`sqliteStore` `11/11`), `tsc`, and `worktreePortability` (`6/6`) **PASSED**; `npm test` **FAILED** on all 3 (`42 passed | 6 failed` files, `7` failed tests = the same `6` spy tests + `tests/doctorVerify.test.ts:64`); `eval:baseline` and `package:smoke` skipped.
- **Root Cause & Unpushed Local Fix (`7b3d8cc`)**:
  - Category 4 (`POSIX /var -> /private/var` symlink on macOS & Windows 8.3 `RUNNER~1` short temp paths on GitHub `windows-latest`) + Category 5 (`process.cwd()` check in `tests/doctorVerify.test.ts:59`). Zero production defects.
  - Fixed locally in unpushed commit `7b3d8cc` (`tests/testUtils.ts`, `tests/testUtils.test.ts`, `tests/doctorVerify.test.ts`, and the 5 spy test files). Verified locally under Windows 8.3 short `TEMP`/`TMP` (`LONGRU~1`: `7/7` files / `74/74` tests + `package:smoke` exited `0`) and full standard `npm test` (`48/48` files, `342/342` tests, `94.28s`). **Not yet remotely verified pending another authorized push.**
- **Release Gate**: Re-verified locally after CI: `npm run release:preflight` exited `1` (`Verdict: RELEASE BLOCKED — NO-GO`, `5/12` failing); `npm run eval:option-b:shadow` exited `0` (`authorizesRelease: false`, `officialReleaseStatus: NO-GO`). **Option B thresholds remain `NOT APPROVED`; product release remains `NO-GO`.**

---

## 7. Gate 4 Remote CI Completion & Gate 5 Acceptance Contract Proposal

*Status unchanged: **Option B product direction: APPROVED**; **Option B acceptance thresholds: NOT APPROVED**; **Replacement release contract: NOT APPROVED**; **Product release: NO-GO**.*

- **Gate 4 Final Remote CI Verification (`2ebb9757290b5fe1d31e4f6010af8d44782fa7db`)**:
  - **Run ID / URL**: CI Run `45372059755` (`https://github.com/framesxsab/HyperSABMemory/actions/runs/45372059755`) passed **`9/9` matrix jobs** (`ubuntu-latest`, `windows-latest`, `macos-latest` × Node `20.20.2`, `22.23.5`, `24.22.3`), `49/49` test files and `356/356` tests per job, zero skipped steps.
  - All `9/9` jobs passed `npm ci` (`better-sqlite3@12.9.0`), `npx tsc --noEmit`, `npm test` (including [atomicStoreWrites.test.ts](../tests/atomicStoreWrites.test.ts) `8/8`, [concurrency.test.ts](../tests/concurrency.test.ts) `8/8`, [worktreePortability.test.ts](../tests/worktreePortability.test.ts) `6/6`, [autoCommit.test.ts](../tests/autoCommit.test.ts) `14/14`, [testUtils.test.ts](../tests/testUtils.test.ts) `6/6`, [packageSmokePaths.test.ts](../tests/packageSmokePaths.test.ts) `4/4`), `npm run eval:baseline` (`passed: true`), and `npm run package:smoke` (`Sprint 3.1 installed MCP handoff passed.`, `Packed install smoke passed: hypersabmemory@1.4.1`, `188.8–189.0 kB`, `171` files).
  - Standalone `scripts/sprint42-worktree-eval.mjs` ran locally on Windows (`Node v22.14.0`) and WSL2 Ubuntu `ext4` (`Node v24.14.1`), not as a step inside `.github/workflows/ci.yml`.
  - `.github/workflows/release.yml` did **not** trigger; npm publication safeguards remain intact (`NO-GO`).
- **CI progression summary**: Gate 1 Run `45043165195` (`3/9`) -> Gate 2 Run `45048987296` (`5/9`) -> Gate 4 Runs `45331032640` (`8/9`) & `45344342678` (`8/9`, exposing `EPERM` on `writeAtomicText` retry via bounded child diagnostics) -> Gate 4 Run `45372059755` (**`9/9`** after bounded `[20, 40, 80, 160]` ms `writeAtomicText` backoff in `a024e1e`).
- **Gate 5 Decision Package**: Complete Option B developer-preview vs. stable-release contract, mandatory safety gates, proposed numeric thresholds (`PENDING PRODUCT-OWNER APPROVAL`), `supportedAnswerCoverage` resolution, readiness matrix, bounded 3-repo independent acceptance evaluation plan, and draft preview positioning are documented in [OPTION_B_ACCEPTANCE_CONTRACT_PROPOSAL.md](./OPTION_B_ACCEPTANCE_CONTRACT_PROPOSAL.md).
