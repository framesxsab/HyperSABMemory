# HyperSABMemory Sprint 4.2 — Git Worktree and Cross-Platform Portability

## 1. Starting Git State

- **Repository / worktree**: `C:\Users\singa\Desktop\hypermemory-sprint2.5`
- **Branch**: `feature/sprint2.5-20261106`
- **Starting HEAD**: `26a317bef7c2eb6ce56b6695b0ee9ef2c431ea3c` (`test(validation): verify offline setup, root docs, JSON paths, and latency profile`)
- **Pre-existing untracked artifacts preserved** (`10` files untouched): `CLEANUP-RESULTS.md`, `cleanup-inventory.md`, `code-cleanup-audit.md`, `docs/V2_BASELINE.md`, `docs/V2_RESEARCH_AND_SPRINT.md`, `scheduled-tasks-audit.md`, `scheduled-tasks-inventory.csv`, `scheduled-tasks-triage.csv`, `scripts/cleanup-dry-run.ps1`, `scripts/cleanup-safe.ps1`.
- **Sibling maintenance worktrees preserved at `592f054`**:
  - `C:/Users/singa/Desktop/hypermemory` (`[audit/cleanup-20261105]`)
  - `C:/Users/singa/Desktop/hypermemory-cleanup-isolated` (`[maintenance/cleanup-isolated-20261106]`)
  - `C:/Users/singa/Desktop/hypermemory-dependency-review` (`[maintenance/dependency-review-20261106]`)

---

## 2. Worktree Integration Findings & Reproduced Defects

Auditing Git worktree handling across `src/cli/oneShotSetup.ts`, `src/hooks/autoCommit.ts`, `src/mcp/server.ts`, and `src/cli/doctor.ts` and executing real `git worktree add` tests in [tests/worktreePortability.test.ts](../tests/worktreePortability.test.ts) reproduced three concrete defects prior to fixes:

1. **Linked worktree store containment and genesis skip (`src/cli/oneShotSetup.ts`)**:
   - `containStoreInGit` and `executeSetup` checked `fs.statSync(path.join(targetDir, '.git')).isDirectory()`, which is `false` inside linked Git worktrees where `.git` is a regular pointer file (`gitdir: ...`).
   - Consequences reproduced on baseline `26a317b`:
     - `git check-ignore .hypersabmemory` failed (non-zero exit) in linked worktrees because `.hypersabmemory/` was never appended to the shared `<commonDir>/info/exclude`.
     - `executeSetup({ checkpoint: true })` skipped `runGenesisRitual` in linked worktrees (`outcome.genesisHash === undefined`), emitting a generic setup checkpoint instead of `feat: genesis: workspace memory baseline`.
     - Non-existent workspace paths passed to `OneShotSetupEngine` were not rejected upfront before store/directory writes.
2. **Forged / escaping `.git` pointer acceptance (`src/hooks/autoCommit.ts`, `src/cli/doctor.ts`)**:
   - When an untrusted directory contained a crafted `.git` file (`gitdir: ../main repo/.git` or `gitdir: ../main repo/.git/worktrees/linked-wt-alpha`), `git rev-parse --show-toplevel` reported the forged directory as its own toplevel while `--git-dir` resolved to the unrelated target repository.
   - Reproduced on baseline `26a317b`: `AutoCommitEngine.createCheckpoint()` accepted the forged pointer and created a commit directly inside the unrelated repository (`cp.committed === true`), `rollback` attempted resets against it, and `runDoctor` reported `worktree: ok`.
3. **MCP invalid-workspace side effect & lexical-only `activeFile` check (`src/mcp/server.ts`)**:
   - `HyperSABMemoryMcpServer` instantiated `TemporalMemoryEngine` and `SwarmMeshEngine` before `TaskLedger`, creating `.hypersabmemory` inside non-existent paths before `TaskLedger` threw `INVALID_WORKSPACE`.
   - `resolveActiveFilePath` performed only lexical `path.resolve`/`path.relative`, did not reject files reached via symlinks escaping into sibling worktrees or outside directories, and rejected legitimate filenames beginning with `..` (e.g., `..notes.txt`) due to `rel.startsWith('..')`.

---

## 3. Production Fixes Implemented (`f765688`)

1. **[src/harness/gitWorktree.ts](../src/harness/gitWorktree.ts)** (new):
   - Exports `canonicalPath`, `sameCanonicalPath`, `isPathContained`, `verifyGitWorktree`, and `resolveVerifiedGitWorktree`.
   - Verifies both normal `.git` directories (`HEAD` present, matches `--git-dir`) and linked worktree `.git` regular pointer files (`^gitdir:\s*...$`, size `<= 8192` bytes, no NUL bytes, non-symlink `.git`, mutual `<gitdir>/gitdir` back-pointer matching the workspace `.git`, and valid `<gitdir>/commondir` directory with `HEAD`).
   - Preserves mocked unit tests (`allowMockedMissingDotGit`) only when the workspace directory itself does not exist on disk and `--git-dir` matches `<ws>/.git`.
2. **[src/cli/oneShotSetup.ts](../src/cli/oneShotSetup.ts)**:
   - Rejects non-existent or non-directory `targetDir` before creating stores or adapters.
   - Updates `containStoreInGit` to resolve `<commonDir>` via `resolveVerifiedGitWorktree`, reject symlinks on `info/` or `exclude`, serialize updates with `withFileLock(<commonDir>/info/hypersabmemory-exclude.lock)`, append `.hypersabmemory/` idempotently, and untrack legacy `.hypersabmemory/` per worktree index.
3. **[src/hooks/autoCommit.ts](../src/hooks/autoCommit.ts)**:
   - Verifies worktree ownership via `verifyGitWorktree` before acquiring `<gitDir>/hypersabmemory-checkpoint.lock`, keeping `MERGE_HEAD`/`rebase-merge`/`rebase-apply` isolation per worktree and returning `{ committed: false, status: 'not-a-repo' }` for forged/malformed `.git` entries.
   - Guards `rollback()` with `resolveVerifiedGitWorktree`.
4. **[src/mcp/server.ts](../src/mcp/server.ts)**:
   - Initializes `TaskLedger` first in `HyperSABMemoryMcpServer` constructor so non-existent workspace paths throw `INVALID_WORKSPACE` without directory creation side effects.
   - Hardens `resolveActiveFilePath` using `isPathContained` + `canonicalPath` symlink containment (allowing valid dotfiles like `..notes.txt` while blocking cross-worktree symlink escapes).
5. **[src/cli/doctor.ts](../src/cli/doctor.ts)**:
   - Verifies local `.git` pointer integrity inside `checkInsideWorkTree` so forged `.git` pointers report `worktree` check `ok: false` while subdirectories of valid repositories remain read-only and supported.

---

## 4. Installed-Package MCP Scenario, Memory/Task Isolation, & Freshness

Executed [scripts/sprint42-worktree-eval.mjs](../scripts/sprint42-worktree-eval.mjs) from freshly packed `hypersabmemory-1.4.1.tgz` installed into disposable `"install dir"` (with spaces) under strict offline env (`npm_config_offline=true`, `npm_config_registry=http://127.0.0.1:1`, empty cache/prefix):

- **Main checkout** (`"main checkout"`) + **linked worktree** (`"linked worktree"` via `git worktree add -b wt-sprint42`) + `"missing-workspace"` invalid path:
  - `setup` in `"linked worktree"` exited `0`, added `.hypersabmemory/` to shared `<commonDir>/info/exclude` (`git check-ignore .hypersabmemory` exited `0`), wrote direct offline Node launch entries to `.mcp.json`, `.cursor/mcp.json`, `.vscode/mcp.json`, created `0` commits, and was idempotent across repeat `setup`.
  - Non-existent `"missing-workspace"` failed cleanly (`outcome.success === false`, directory not created on disk).
  - Offline MCP Session 1 (`17` tools, `3` resources): verified `hypersabmemory_scope_sources` (`README.md`), remembered active decision & `package.json` artifact + forgot canary `wt42opaque5599`, created/claimed/checkpointed unfinished task referencing `src/service.ts` and `package.json`, and exited.
  - Offline MCP Session 2 (independent stdio restart): `hypersabmemory_task_context({ compact: true })` (with omitted `taskId`) restored goal, decision memory, current SHA-256 (`8b4ee684...` on win32 CRLF / `949a94cc...` on Linux LF) while excluding `wt42opaque5599`; `hypersabmemory_query_evidence` verified `computeLeaseWindow` (`src/service.ts:1`) and nested `repository.type` (`"git"` in `package.json`), returned `0` records for `wt42opaque5599`; rejected `../main checkout/src/service.ts` (and cross-worktree symlink `src/escape-main.ts` on Linux ext4); detected same-byte-size rewrite (`status: "modified"`); and after `hypersabmemory_checkpoint`, `"main checkout"` `HEAD` stayed at baseline with `TASK_NOT_FOUND` and `0` leaked memories.

---

## 5. Cross-Platform Execution Results & Unverified Platforms

| Environment / Runtime | Commands Executed | Exact Observed Outcome |
| --- | --- | --- |
| **Windows 11 (`win32 x64`, Node `v22.14.0`, Git `2.47.1.windows.1`, NTFS)** | Full 15-command verification matrix (see §6) | `48/48` Vitest files (`328/328` tests) passed (`82.98s`), `tsc --noEmit` exit `0`, `build` exit `0`, `eval` `8/8`, `eval:baseline` `passed: true` (`p50/p95: 1.08/1.78 ms`), `package:smoke` exit `0` (`171` files, `186.5 kB` tarball), `sprint42-worktree-eval.mjs` exit `0` (`passed: true`; unprivileged NTFS file symlink & case-sensitive distinct docs flags reported `false` honestly). |
| **Linux (`WSL2 Ubuntu`, `Linux 6.6.87.2-microsoft-standard-WSL2 x86_64`, Node `v24.14.1`, npm `11.11.0`, Git `2.43.0`, native `ext4`)** | `npm ci`, `tsc --noEmit`, `npm run build`, `npm test`, `npm run eval`, `npm run eval:baseline`, `npm run package:smoke`, `node scripts/sprint42-worktree-eval.mjs` in isolated `/tmp/hm-sprint42-linux-*` | **All `8` commands exited `0`**: `npm ci` (`181` packages in `22s`, native `better-sqlite3` operational on Linux x64 Node `24`), `npm test` (`48/48` test files, `328/328` tests in `50.31s` including real POSIX symlinks, directory `fsyncSync`, atomic writes, and case-sensitive worktree tests), `eval` (`8/8` in `1.00s`), `eval:baseline` (`passed: true`, `p50/p95: 0.91/2.00 ms`), `package:smoke` (`171` files, `186.4 kB`, `code` p50/p95 `6.29/11.17 ms`, `code-and-test` `6.43/10.01 ms`), `sprint42-worktree-eval.mjs` (`passed: true`, `crossWorktreeSymlinkTested: true`, `caseSensitiveDistinctDocsTested: true`). |
| **Unverified Platforms (Explicitly Reported)** | Not executed locally or remotely | **macOS (`macos-latest`)**, **Node `20`**, **Linux Node `20`/`22`**, **Windows Node `20`/`24`**, and **remote GitHub Actions CI workflows** ([.github/workflows/ci.yml](../.github/workflows/ci.yml) / [.github/workflows/release.yml](../.github/workflows/release.yml)) remain **unverified** (remote push prohibited). |

---

## 6. Full Sequential Verification Results (Windows `win32 x64`, Node `v22.14.0`, After Fixes)

| # | Command | Process Exit | Structured `passed` / Key Observed Result |
| --- | --- | --- | --- |
| 1 | `npm.cmd test` | `0` | `48` test files / `328` tests passed (`82.98s`), including `tests/worktreePortability.test.ts` (`6/6`), `tests/storeContainment.test.ts` (`3/3`), `tests/autoCommit.test.ts` (`14/14`), `tests/autoCommitGuards.test.ts` (`2/2`), `tests/privacy.test.ts` (`4/4`) |
| 2 | `npx.cmd tsc --noEmit` | `0` | Clean TypeScript typecheck |
| 3 | `npm.cmd run build` | `0` | Clean TypeScript build (`dist/`) |
| 4 | `npm.cmd run eval` | `0` | `tests/memorybench.test.ts`: `8/8` passed |
| 5 | `npm.cmd run eval:baseline` | `0` | `passed: true` (`500` records / `493` distractors, `recallAt5: 1`, `MRR: 1`, `staleLeaks: 0`, `p50: 1.08 ms`, `p95: 1.78 ms`, `estimatedTokens: 243`) |
| 6 | `npm.cmd run package:smoke` | `0` | `171` files, `186.5 kB` tarball (`839.7 kB` unpacked), offline setup verification passed, `code` p50/p95 `24.47/29.51 ms`, `code-and-test` `26.35/30.38 ms`, `unsupported` `25.84/29.28 ms` |
| 7 | `node scripts/sprint36-handoff-bench.mjs` | `0` | `matrixPassed: true`; compact one-call p50/p95 `9.53/11.37 ms` (`-65.4%` bytes) & `9.45/11.43 ms` (`-65.2%` bytes) |
| 8 | `node scripts/sprint37-grounding-bench.mjs` | `0` | `9/9` MCP regression checks passed; alternating `after` (`450` samples) p50 `17.11 ms` / p95 `32.09 ms`; `repositoryTaskEvalComparison.after` p50 `15.78 ms` / p95 `27.10 ms` |
| 9 | `node scripts/sprint39-dev-retrieval-eval.mjs` | `0` | `combinedDev42` grounded `P@5: 0.4545`, `R@5: 0.7303`, `MRR: 0.8977`, `top1HitRate: 0.8182`, `staleProbe.leaks: 0` (`22/22` flagged), `forgottenLeaks: 0`, p50/p95 `15.47/27.64 ms` |
| 10 | `node scripts/sprint40-independent-eval.mjs` | `0` | `ni` (`R@5 1.0000`, `MRR 0.8333`, `38/38` valid, offline config/restart OK) & `commander` (`R@5 0.9286`, `MRR 1.0000`, `50/50` valid, `"Readme.md"` exact casing, offline config/restart OK) |
| 11 | `node scripts/sprint41-mcp-latency-profile.mjs` | `0` | Cold `n=3` vs warm `n=50` profiled: warm MCP p50/p95 `17.85/23.25` (`ni` ord), `15.89/19.35` (`ni` JSON), `20.23/24.68` (`ni` impl); `18.70/24.60` (`cmd` ord), `6.97/9.52` (`cmd` JSON), `10.95/15.39 ms` (`cmd` impl) |
| 12 | `node scripts/sprint42-worktree-eval.mjs` | `0` | `passed: true` (linked-worktree setup, offline restart, compact restore, provenance, nested JSON, same-size rewrite, forgetting, main isolation) |
| 13 | `node scripts/repository-task-eval.mjs` | `1` *(expected)* | `passed: false` (frozen contract; `88` records / `87` real files): raw `P@5: 0.4800`, `R@5: 0.7375`, `MRR: 0.8750`; grounded `P@5: 0.4600`, `R@5: 0.7042`, `MRR: 0.8750`, `supportedAnswerCoverage: 0`, `unsupportedAssertions: 0`, `noAnswerFalsePositives: 0`, `forgottenLeaks: 0`, `staleProbe.leaks: 0` (`20/20`), `p50/p95: 15.96/27.94 ms` |
| 14 | `npm.cmd run release:preflight` | `1` *(expected)* | `Verdict: RELEASE BLOCKED — NO-GO`, `Eligible for publication: NO` (`5` failing / `7` passing frozen criteria; `latencyMs.p95: 25.6323 ms`) |
| 15 | `npm.cmd run eval:option-b:shadow` | `0` | `mode: SHADOW_CANDIDATE_INFORMATIONAL_ONLY`, `authorizesRelease: false`, `officialReleaseStatus: NO-GO`, `candidateContractPassing: false` (`repositoryTaskEval p50/p95: 15.66/24.12 ms`) |

---

## 7. Frozen Release Status & Developer-Preview Readiness Decision Record

### Frozen Release Status (`NO-GO`)

[src/eval/repositoryTaskEvaluation.ts](../src/eval/repositoryTaskEvaluation.ts), [src/eval/repositoryTaskFixture.ts](../src/eval/repositoryTaskFixture.ts), `release:preflight`, and `prepublishOnly` remain **untouched and blocking**:

- `release:preflight` fails closed (exit `1`, `Verdict: RELEASE BLOCKED — NO-GO`) on `5/12` frozen criteria:
  - `retrieval.precisionAt5`: `0.4800` (required `>= 0.5`)
  - `retrieval.recallAt5`: `0.7375` (required `>= 0.85`)
  - `grounded.recallAt5`: `0.7042` (required `>= 0.85`)
  - `grounded.precisionAt5`: `0.4600` (required `>= 0.5`)
  - `grounded.supportedAnswerCoverage`: `0` (required `> 0`)
- Passing frozen safety/latency criteria (`7/12`): `maximumPrecisionAt5: 0.6600`, `grounded.noAnswerFalsePositives: 0`, `forgottenLeaks: 0`, `staleSourceTested: true`, `staleProbe.leaks: 0`, `latencyMs.samples: 150`, `latencyMs.p95: 25.6323 ms`.

### Developer-Preview Decision Record (Option B Remains Unapproved)

1. **Independently verified**: Offline installed-package MCP setup/restart (`hypersabmemory@1.4.1`), exact root-doc casing & nested/root JSON scalar verification on `antfu-collective/ni` and `tj/commander.js`, Sprint 4.0 Commander cross-session Codex completion (`n=1`), warm MCP query p95 (`9.52–24.68 ms`), and full Git worktree isolation + POSIX `ext4` verification across Windows (`v22.14.0`) and WSL2 Ubuntu Linux (`v24.14.1`).
2. **Still needing cross-platform verification**: `macos-latest`, Node `20` across all three OSes, Linux Node `22`, Windows Node `24`, and remote GitHub Actions CI (`ubuntu-latest`, `windows-latest`, `macos-latest`) via an authorized push.
3. **Remaining retrieval-quality gaps**: Frozen top-5 precision/recall still below original thresholds (`P@5 0.46–0.48`, `R@5 0.7042–0.7375`), `40%` unanswerable candidate noise on internal eval (`4/10`) and `4/6` on independent repos (with `0` unsupported assertions), and curried `it.each` test linking unsupported.
4. **Candidate Option B thresholds awaiting product-owner approval**: Explicit replacement/scoping of frozen `retrieval.precisionAt5 >= 0.5`, `retrieval/grounded recallAt5 >= 0.85`, and `supportedAnswerCoverage > 0`, plus governance acceptance criteria across `eval:option-b:shadow`'s unapproved dimensions (`mcp_packaging_and_cross_platform`, `retrieval_quality_bounded_top5`, `end_to_end_agent_use`).
5. **Agent claims supported vs. unsupported by evidence**: Evidence supports reliable deterministic code/JSON/decision provenance, freshness/forgetting/conflict abstention, offline MCP handoff (`compact: true`), and linked-worktree isolation. Evidence does **not** support broad autonomous claim synthesis or statistical cross-session superiority (`n = 2..3` agent pilots total).
6. **Prerequisites before controlled developer preview**: (a) Product-owner sign-off on release contract (Option B or meeting frozen thresholds), (b) authorized CI push confirming `.github/workflows/ci.yml` across `ubuntu-latest`, `macos-latest`, `windows-latest` x Node `20`/`22`/`24`, and (c) explicit scope communication limiting claims to evidence lookup and deterministic verification.

---

## 8. Commits Created & Engineering Completion Decision

- **Commit 1**: `f765688` — `fix(git): isolate memory and checkpoints across linked worktrees`
- **Commit 2**: `test(worktree): add installed-package worktree validation and Sprint 4.2 report` (`scripts/sprint42-worktree-eval.mjs`, `docs/SPRINT_4_2_WORKTREE_PORTABILITY.md`)
- **Engineering Completion Decision**: **Sprint 4.2 complete; product release remains NO-GO.**
