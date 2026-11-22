# HyperSABMemory — Developer Preview Gate 1: Remote CI Verification Report

**Product Release Status**: `NO-GO` (`npm run release:preflight` exits `1`, `5/12` frozen criteria failing)

**Option B Product Direction**: `APPROVED` (product positioning only; thresholds and replacement release contract remain `NOT APPROVED`)

---

## 1. Push Audit & Remote Identity

- **Verified Remote (`origin`)**: `https://github.com/framesxsab/HyperSABMemory.git` (fetch and push)
- **Target Branch**: `feature/sprint2.5-20261106` (new branch on remote, fast-forward linear descendant of `origin/main` at `592f054acb5409d3ee93bc4eb2e7fdeb581fa9fa`)
- **Pushed Commit SHA**: `e6d6d22357a5753891ba1650249ee524221286de` (`ci: run development CI matrix on feature branch pushes`, parent `2f220d7`: `docs: approve evidence-harness product direction`)
- **Push Command & Result**: `git push -u origin HEAD:refs/heads/feature/sprint2.5-20261106` -> exited `0` (`* [new branch] HEAD -> feature/sprint2.5-20261106`)
- **Pre-Push Security & Hygiene Checks**: `0` secret/token pattern matches across `HEAD`; `0` of the `10` pre-existing untracked files tracked; pre-existing 1-byte UTF-8 BOM diff in [src/hooks/autoCommit.ts](../src/hooks/autoCommit.ts) excluded from staging and left untouched.
- **Release Workflow Isolation**: `gh run list --workflow release.yml --limit 5` confirmed [.github/workflows/release.yml](../.github/workflows/release.yml) did **not** trigger (latest historical run remains `32642293702` from `2026-08-23T13:25:19Z`).
- **Note on Documentation Timing**: Pushed commit `e6d6d22` did **not** include the post-push CI findings below or local test fix `7b3d8cc`; those remain local-only until another push is authorized.

---

## 2. GitHub Actions CI Run & 3 x 3 OS / Node Matrix

- **Workflow**: `CI` ([.github/workflows/ci.yml](../.github/workflows/ci.yml))
- **Run ID**: `45043165195` (`event: push`, `headSha: e6d6d22357a5753891ba1650249ee524221286de`)
- **Run URL**: https://github.com/framesxsab/HyperSABMemory/actions/runs/45043165195
- **Overall Conclusion**: `completed` / `failure` (`3/9` matrix jobs passed, `6/9` failed)

| Runner OS | Node `20` (`v20.20.2`) | Node `22` (`v22.23.5`) | Node `24` (`v24.22.3`) |
| --- | --- | --- | --- |
| **`ubuntu-latest`** | **PASS** (job `137271885815`) | **PASS** (job `137271885672`) | **PASS** (job `137271885874`) |
| **`windows-latest`** | **FAIL** (`npm test`: `5` files / `6` tests failed; job `137271885877`) | **FAIL** (`npm test`: `5` files / `6` tests failed; job `137271885872`) | **FAIL** (`npm test`: `5` files / `6` tests failed; job `137271885960`) |
| **`macos-latest`** | **FAIL** (`npm test`: `6` files / `7` tests failed; job `137271885855`) | **FAIL** (`npm test`: `6` files / `7` tests failed; job `137271885865`) | **FAIL** (`npm test`: `6` files / `7` tests failed; job `137271885915`) |

### Per-Job Step & Compatibility Breakdown

| Job | Exact Job ID & URL | `npm ci` + `better-sqlite3` | `tsc --noEmit` | `npm test` (Incl. `worktreePortability` `6/6` & `sqliteStore` `11/11`) | `eval:baseline` | `package:smoke` (Offline MCP + Tarball) |
| --- | --- | --- | --- | --- | --- | --- |
| `ubuntu-latest`, Node 20 (`v20.20.2`) | `137271885815` — https://github.com/framesxsab/HyperSABMemory/actions/runs/45043165195/job/137271885815 | `success` (`181` pkgs in `3s`, SQLite `26ms`) | `success` | `success` (`48/48` files, `worktreePortability` `4677ms`) | `success` (`passed: true`, `P@5: 0.2`, `R@5: 1`, `p50/p95: 0.407/0.991 ms`) | `success` (`hypersabmemory@1.4.1`, `code` `3.13/4.15 ms`, `code-and-test` `2.32/3.95 ms`, `unsupported` `2.44/3.32 ms`) |
| `ubuntu-latest`, Node 22 (`v22.23.5`) | `137271885672` — https://github.com/framesxsab/HyperSABMemory/actions/runs/45043165195/job/137271885672 | `success` (`181` pkgs in `5s`, SQLite `33ms`) | `success` | `success` (`48/48` files, `worktreePortability` `6330ms`) | `success` (`passed: true`, `P@5: 0.2`, `R@5: 1`, `p50/p95: 0.478/0.810 ms`) | `success` (`hypersabmemory@1.4.1`, `code` `3.56/5.90 ms`, `code-and-test` `3.18/5.05 ms`, `unsupported` `3.36/3.92 ms`) |
| `ubuntu-latest`, Node 24 (`v24.22.3`) | `137271885874` — https://github.com/framesxsab/HyperSABMemory/actions/runs/45043165195/job/137271885874 | `success` (`181` pkgs in `4s`, SQLite `29ms`) | `success` | `success` (`48/48` files, `worktreePortability` `4310ms`) | `success` (`passed: true`, `P@5: 0.2`, `R@5: 1`, `p50/p95: 0.487/0.939 ms`) | `success` (`hypersabmemory@1.4.1`, `code` `3.36/5.39 ms`, `code-and-test` `2.87/5.00 ms`, `unsupported` `3.03/3.34 ms`) |
| `windows-latest`, Node 20 (`v20.20.2`) | `137271885877` — https://github.com/framesxsab/HyperSABMemory/actions/runs/45043165195/job/137271885877 | `success` (`179` pkgs in `6s`, SQLite `105ms`) | `success` | `failure` (`43 passed \| 5 failed` files, `6` tests failed, `worktreePortability` `21167ms`) | `skipped` | `skipped` |
| `windows-latest`, Node 22 (`v22.23.5`) | `137271885872` — https://github.com/framesxsab/HyperSABMemory/actions/runs/45043165195/job/137271885872 | `success` (`179` pkgs in `8s`, SQLite `116ms`) | `success` | `failure` (`43 passed \| 5 failed` files, `6` tests failed, `worktreePortability` `19514ms`) | `skipped` | `skipped` |
| `windows-latest`, Node 24 (`v24.22.3`) | `137271885960` — https://github.com/framesxsab/HyperSABMemory/actions/runs/45043165195/job/137271885960 | `success` (`179` pkgs in `7s`, SQLite `87ms`) | `success` | `failure` (`43 passed \| 5 failed` files, `6` tests failed, `worktreePortability` `17213ms`) | `skipped` | `skipped` |
| `macos-latest`, Node 20 (`v20.20.2`) | `137271885855` — https://github.com/framesxsab/HyperSABMemory/actions/runs/45043165195/job/137271885855 | `success` (`180` pkgs in `4s`, SQLite `41ms`) | `success` | `failure` (`42 passed \| 6 failed` files, `7` failed / `334` passed, `worktreePortability` `7109ms`) | `skipped` | `skipped` |
| `macos-latest`, Node 22 (`v22.23.5`) | `137271885865` — https://github.com/framesxsab/HyperSABMemory/actions/runs/45043165195/job/137271885865 | `success` (`180` pkgs in `6s`, SQLite `73ms`) | `success` | `failure` (`42 passed \| 6 failed` files, `7` failed, `worktreePortability` `8417ms`) | `skipped` | `skipped` |
| `macos-latest`, Node 24 (`v24.22.3`) | `137271885915` — https://github.com/framesxsab/HyperSABMemory/actions/runs/45043165195/job/137271885915 | `success` (`180` pkgs in `5s`, SQLite `129ms`) | `success` | `failure` (`42 passed \| 6 failed` files, `7` failed, `worktreePortability` `7735ms`) | `skipped` | `skipped` |

### Native Dependencies & Executed CI Validations

- **Native `better-sqlite3@12.9.0`**: Installed cleanly (`npm ci`) and passed all `11/11` tests in `tests/sqliteStore.test.ts` on **all `9/9` matrix combinations** (`ubuntu-latest`, `windows-latest`, `macos-latest` x Node `20`, `22`, `24`).
- **Linked-worktree unit tests & Offline MCP smoke**: `tests/worktreePortability.test.ts` (`6/6` tests) executed and passed on **all `9/9` jobs**. Offline installed-package MCP checks inside `scripts/package-smoke.mjs` executed and passed on all `3` `ubuntu-latest` jobs (`npm_config_offline=true`, `Sprint 3.1 installed MCP handoff passed`, `Packed install smoke passed`), and were skipped on `windows-latest` and `macos-latest` because `npm test` failed prior to Step 8. Notice [scripts/sprint42-worktree-eval.mjs](../scripts/sprint42-worktree-eval.mjs) is a standalone local validation script and is **not** wired into `.github/workflows/ci.yml`.
- **GitHub Actions Runner Notice**: Jobs on `ubuntu-latest` and `macos-latest` emitted the GitHub warning that `actions/checkout@v4` and `actions/setup-node@v4` target Node.js 20 and will be transitioned to Node.js 24 by GitHub runners.

---

## 3. Failure Diagnosis, Root-Cause Classification, & Local Unpushed Fix

### Observed Remote Failures

Every Windows job (`20`, `22`, `24`) failed identically on the same `6` tests (`5` files); every macOS job (`20`, `22`, `24`) failed identically on those exact `6` tests plus `tests/doctorVerify.test.ts:64` (`6` files / `7` tests):

1. `tests/crossFileGrounded.test.ts:80` — `vi.spyOn(fsDefault, 'readFileSync')` checked `String(file) === constraint` (`reads` stayed `0`, returned `SUPPORTED` instead of `STALE_EVIDENCE`).
2. `tests/efficientDecisionEvidence.test.ts:27` — spy checked `String(name) === file` (`expected 0 to be greater than or equal to 5`).
3. `tests/groundedSearch.test.ts:48` — spy checked `file === testPath` (`expected false to be true`).
4. `tests/taskAnswerBundle.test.ts:83` — spy checked `String(name) === file` (`expected 0 to be greater than or equal to 3`).
5. `tests/taskAnswerBundle.test.ts:107` — spy checked `String(name) === other` (`expected +0 to be 2`).
6. `tests/taskLedger.test.ts:105` — spy checked `String(file) === filename` (`expected 0 to be greater than or equal to 3`).
7. `tests/doctorVerify.test.ts:64` (**macOS only**, Nodes `20/22/24`) — fake MCP server line 59 ran `if (process.cwd() !== dir) process.exit(1)`.

### Root-Cause Classification

- **Category 4 (`POSIX or Windows path handling`) — Primary**:
  - Production code (`canonicalPath` via `fs.realpathSync.native` on `win32`, `fs.realpathSync` on POSIX) canonicalizes workspace and source paths before invoking `fs.readFileSync`.
  - On GitHub `windows-latest`, user `runneradmin` exceeds 8 characters, so `os.tmpdir()` returns Windows 8.3 short paths (`C:\Users\RUNNER~1\AppData\Local\Temp`), while canonicalized `fs.readFileSync` paths use `C:\Users\runneradmin\AppData\Local\Temp\...`. On `macos-latest`, `os.tmpdir()` returns `/var/folders/...` (where `/var -> /private/var` is a symlink), while canonicalized reads use `/private/var/folders/...`. Strict string equality in the 6 test spies therefore failed to match on both CI runner OSes while passing on `ubuntu-latest` (`/tmp` canonical) and on local Windows (`singa` <= 8 chars, no `~1` short path).
- **Category 5 (`Test isolation or process-spawn failure`) — Secondary (macOS `doctorVerify.test.ts`)**:
  - On `macos-latest`, spawning `node` with `cwd: '/var/folders/...'` caused the child process's `process.cwd()` to resolve `/private/var/folders/...`, triggering `process.exit(1)` inside the fake server check before handling MCP JSON-RPC.
- **No production defects**: Zero `src/` production incompatibilities caused any CI failure.

### Local Reproduction & Non-Weakening Local Fix (`7b3d8cc`, **NOT REMOTELY VERIFIED**)

1. **Reproduced all `6` Windows CI failures locally**: Running the 6 failing test files with `TEMP`/`TMP` set to an 8.3 short path (`C:\Users\singa\AppData\Local\Temp\LONGRU~1` -> realpath `longrunnerdir_check`) reproduced the exact `6` failures identically.
2. **Implemented minimal test fix cleanly in local commit `7b3d8cc58662776a400ded5ae2228c47bab68744`** (`test(portability): compare canonical paths in fs spies and doctor cwd test`):
   - Added `matchesTargetFile(file, targetPath)` in [tests/testUtils.ts](../tests/testUtils.ts) using `sameCanonicalPath` from [src/harness/gitWorktree.ts](../src/harness/gitWorktree.ts).
   - Updated the 6 spy predicates (`tests/crossFileGrounded.test.ts`, `tests/efficientDecisionEvidence.test.ts`, `tests/groundedSearch.test.ts`, `tests/taskAnswerBundle.test.ts` x 2, `tests/taskLedger.test.ts`) to use `matchesTargetFile` without changing assertions, timeouts, or production files.
   - Updated `tests/doctorVerify.test.ts:59` fake server cwd check to compare canonicalized `process.cwd()` against canonicalized `dir`.
   - Added canonical/symlink regression coverage for `matchesTargetFile` in [tests/testUtils.test.ts](../tests/testUtils.test.ts).
3. **Local post-fix verification (Windows `win32 x64`, Node `v22.14.0`)**:
   - Under Windows 8.3 short `TEMP`/`TMP` (`LONGRU~1`): all `7` affected test files (`74/74` tests) passed (`11.85s`) and `npm.cmd run package:smoke` exited `0` (`code` `27.36/32.89 ms`, `code-and-test` `29.44/35.14 ms`, `unsupported` `26.11/34.20 ms`).
   - Standard local run: `npx.cmd tsc --noEmit` exited `0`; full `npm.cmd test` passed `48/48` test files, `342/342` tests (`94.28s`).
4. **Verification boundary**: Because only one branch push was authorized, commit `7b3d8cc` is **local only and has NOT yet been remotely verified** on `windows-latest` (`package:smoke` / `npm test`) or `macos-latest` (`npm test` / `eval:baseline` / `package:smoke`) GitHub Actions runners.

---

## 4. Release Gate Verification & Static Audit of `release.yml`

- **Local frozen gate re-verification**:
  - `npm.cmd run release:preflight` -> exited `1` (`Verdict: RELEASE BLOCKED — NO-GO`, `Eligible for publication: NO`), failing `5/12` frozen criteria (`retrieval.precisionAt5: 0.4800 < 0.5`, `retrieval.recallAt5: 0.7375 < 0.85`, `grounded.recallAt5: 0.6917 < 0.85`, `grounded.precisionAt5: 0.4500 < 0.5`, `grounded.supportedAnswerCoverage: 0 <= 0`; `latencyMs.p95: 27.6624 ms`).
  - `npm.cmd run eval:option-b:shadow` -> exited `0`, reporting `mode: SHADOW_CANDIDATE_INFORMATIONAL_ONLY`, `authorizesRelease: false`, `officialReleaseStatus: NO-GO`, `candidateContractPassing: false`.
- **Static audit of [.github/workflows/release.yml](../.github/workflows/release.yml)**:
  - `on`: `push` tags matching `'v*'` and `workflow_dispatch`.
  - `publish` job: `needs: gates` and `if: github.event_name == 'push' && github.ref_type == 'tag'`, enforcing `npx tsc --noEmit`, `npm test`, `npm run eval`, `npm run eval:baseline`, `npm run package:smoke`, and `npm run release:preflight` across `[ubuntu-latest, windows-latest, macos-latest]` (Node `24`) before `npm publish`. Package-level `prepublishOnly` provides a redundant local safety block.
  - *Observed CI/release governance note*: `release.yml` gates execute on Node `24` only (whereas `ci.yml` covers Node `20`, `22`, `24`).

---

## 5. Remaining Risks & Next Product-Owner Authorizations Required

1. **Cross-platform CI gaps remaining until another authorized push**:
   - `windows-latest` (Node `20`, `22`, `24`): `package:smoke` and `eval:baseline` were skipped remotely due to the 6 uncanonicalized test-spy failures (though local Win11 `8.3` short-temp reproduction passed `74/74` + `package:smoke`).
   - `macos-latest` (Node `20`, `22`, `24`): `npm test` (with `7b3d8cc`), `eval:baseline`, and `package:smoke` remain **unverified remotely**.
2. **Product-owner decisions still required**:
   - Whether to approve concrete Option B acceptance thresholds (`PENDING PRODUCT-OWNER APPROVAL` in [DEVELOPER_PREVIEW_DECISION.md](./DEVELOPER_PREVIEW_DECISION.md)) or require additional retrieval-quality engineering (`R@5: 0.6917` grounded / `0.7375` raw; `P@5: 0.4500` grounded / `0.4800` raw; `40%` internal unanswerable candidate noise).
   - Whether to authorize a second feature-branch push (`7b3d8cc` + CI report commit) to confirm `9/9` green GitHub Actions CI across `ubuntu-latest`, `windows-latest`, and `macos-latest` (`Node 20/22/24`).
