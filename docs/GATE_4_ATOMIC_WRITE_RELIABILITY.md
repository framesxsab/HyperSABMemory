# Gate 4 Production Reliability Report: Bounded Atomic-Rename Retry

## 1. Confirmed Production Failure Evidence

- **GitHub Actions CI**: `https://github.com/framesxsab/HyperSABMemory/actions/runs/45344342678/job/138275186632`
- **Platform**: `windows-latest`, Node `v20.20.2` (8 of 9 matrix jobs passed in Run `45344342678`, including `windows-latest` Node `22`, `windows-latest` Node `24`, all 3 `ubuntu-latest`, and all 3 `macos-latest` jobs)
- **Failing test**: `tests/concurrency.test.ts` — `(b) two real child processes writing to one dir keep all 10 facts` (`[procA] exit=1`, `[procB] exit=0`)
- **Observed production error and stack**:
  - `Error: EPERM: operation not permitted, rename 'C:\Users\RUNNER~1\AppData\Local\Temp\hm-conc-JEb3fD\memory_store.json.tmp' -> 'C:\Users\RUNNER~1\AppData\Local\Temp\hm-conc-JEb3fD\memory_store.json'` (`errno: -4048`, `code: 'EPERM'`, `syscall: 'rename'`)
  - Stack: `writeAtomicText` (`src/memory/fileLock.ts`) -> `SqliteStore.writeRecords` (`src/memory/sqliteStore.ts`) -> `SqliteStore.applySetUnderLock` -> `withFileLock` -> `SqliteStore.set`
- **Root cause**: `writeAtomicText` performed only a single immediate `fs.renameSync` retry on `EPERM` or `EBUSY` with zero backoff delay, causing transient multi-millisecond Windows file-handle contention on `memory_store.json` to fail immediately on attempt 2.

## 2. Selected Retry Policy (`src/memory/fileLock.ts`)

- **Constants exported from `src/memory/fileLock.ts`**:
  - `ATOMIC_RENAME_RETRY_DELAYS_MS = [20, 40, 80, 160]`
  - `ATOMIC_RENAME_MAX_ATTEMPTS = 5`
- **Retry scope**: Retries ONLY `fs.renameSync(tmpPath, filePath)` when `err.code === 'EPERM' || err.code === 'EBUSY'`, sleeping `[20, 40, 80, 160]` ms via `options?.sleep ?? sleepSync` between failed attempts `0..3`, and rethrowing on attempt `4` (5th total attempt) or immediately on any non-retryable error (such as `EIO`).
- **Lock timing compatibility**: Maximum cumulative backoff is `300 ms`, which stays well below `BUDGET_MS = 2000 ms` in `acquireFileLock` and `UNPARSEABLE_GRACE_MS = 5000 ms` in `isHolderDead` while the lock holder PID remains live (`process.kill(sentinel.pid, 0)` succeeds).

## 3. Locking and Data-Integrity Invariants

All callers of `writeAtomicText` (`src/memory/sqliteStore.ts:115` and `src/memory/swarmMesh.ts:105`) execute inside `withFileLock`:

- Temporary file `${filePath}.tmp` is written once before entering the rename retry loop and remains untouched across retries.
- Destination file is never deleted prior to rename and never replaced via non-atomic copy-and-delete.
- The read-modify-write transaction is never retried, preventing duplicate records or partial mutations.
- If all 5 rename attempts fail or a non-retryable error occurs, `writeAtomicText` propagates the original error, `memory_store.json` retains its prior committed contents, `.tmp` retains the un-renamed candidate payload for existing `SqliteStore` recovery semantics (`failedTemporaryContents` prevents same-instance phantom reads), and `withFileLock` removes `.lock` in `finally`.

## 4. RED -> GREEN Deterministic Regression (`tests/atomicStoreWrites.test.ts`)

- **RED baseline (prior to editing `src/memory/fileLock.ts`)**: `npx.cmd vitest run tests/atomicStoreWrites.test.ts` -> **3 failed | 4 passed (7)** (`1.79s`). The new multi-transient `EPERM` (`4` failures), multi-transient `EBUSY` (`3` failures), and `5`-attempt retry exhaustion cases failed as expected against the 1-retry implementation (`expected "vi.fn()" to be called 5 times, but got 2 times`).
- **GREEN result (after editing `src/memory/fileLock.ts` and adding explicit `[20, 40, 80, 160]` delay/temp-content integrity assertions)**: `npx.cmd vitest run tests/atomicStoreWrites.test.ts` -> **1/1 file, 8/8 tests passed** (`2.38s`), covering:
  1. Immediate single-attempt commit with zero leftover `.tmp` / `.lock`.
  2. One transient `EPERM` / `EBUSY` followed by success on both `SqliteStore` and `SwarmMeshEngine`.
  3. Multiple transient `EPERM` (`4`) and `EBUSY` (`3`) failures followed by atomic commit on attempt `5` / `4` (`setAndSupersede`, zero duplicates).
  4. Retry exhaustion after `5` attempts propagating `EPERM`, preserving prior `memory_store.json`, preserving `.tmp`, and releasing `.lock`.
  5. Immediate failure on non-retryable `EIO` (`1` call) preserving error and store state.
  6. Exact `[20, 40, 80, 160]` delay sequence (`ATOMIC_RENAME_RETRY_DELAYS_MS`, `ATOMIC_RENAME_MAX_ATTEMPTS = 5`) and unchanged `.tmp` / target bytes during waits.

## 5. Real Concurrent-Process Verification

- **Windows 11 (`win32 x64`, local active `Node v22.14.0`; `Node 20` is unavailable locally)**:
  - Focused `npx.cmd vitest run tests/atomicStoreWrites.test.ts tests/concurrency.test.ts`: **2/2 files, 16/16 tests passed** (`4.31s`).
  - Repeated `npx.cmd vitest run tests/concurrency.test.ts`: **10/10 consecutive runs passed** (`concurrency-run-1=PASS` .. `concurrency-run-10=PASS`, `8/8` tests per run, all `10` facts persisted cleanly with zero leftover `.lock` / `.tmp` artifacts).
  - Checkpoint regression `npx.cmd vitest run tests/autoCommit.test.ts`: **1/1 file, 14/14 tests passed** (`28.32s`).
- **Linux (WSL2 Ubuntu, `Node v24.14.1`)**:
  - Direct Vitest startup in WSL2 on the Windows worktree's `node_modules` hit missing Linux `@rolldown/binding-wasm32-wasi` native bindings (Windows `node_modules` left untouched).
  - Direct two-process writer check importing compiled `dist/memory/sqliteStore.js` and `dist/memory/fileLock.js` under WSL2 Ubuntu Node `v24.14.1` passed cleanly (`records: 10`, `leftovers: []`, `maxAttempts: 5`, `delaysPolicy: [20, 40, 80, 160]`, `exit 0`).

## 6. Performance Impact

Measured against compiled `dist/memory/fileLock.js` on Windows `Node v22.14.0`:

- **Normal write path (`50` uncontended `writeAtomicText` writes)**: `p50 = 4.29 ms`, `p95 = 5.751 ms`, `max = 6.158 ms` (`0 ms` retry sleep overhead).
- **Simulated single-retry backoff (`[20]` ms)**: `42.057 ms` total for write + sleep + rewrite.
- **Simulated 4-retry backoff (`[20, 40, 80, 160]` ms)**: `354.148 ms` total; deterministic `4`-`EPERM` `SqliteStore.setAndSupersede` recovery in Vitest took `365 ms`–`367 ms` and `5`-`EPERM` exhaustion took `370 ms`–`371 ms`.

## 7. Sequential Regression Validation (`win32`, `Node v22.14.0`)

- `npx.cmd tsc --noEmit`: exit `0`
- `npm.cmd run build`: exit `0`
- `npm.cmd test`: exit `0` (**`49/49` files, `356/356` tests passed**, `104.71s`, including `tests/atomicStoreWrites.test.ts`, `tests/concurrency.test.ts`, `tests/taskLedger.test.ts`, `tests/autoCommit.test.ts`, `tests/worktreePortability.test.ts`, `tests/packageSmokePaths.test.ts`, `tests/testUtils.test.ts`)
- `npm.cmd run eval`: exit `0` (`1/1` file `tests/memorybench.test.ts`, `8/8` tests passed, `4.66s`)
- `npm.cmd run eval:baseline`: exit `0` (`passed: true`, `precisionAt5: 0.19999999999999998`, `recallAt5: 1`, `meanReciprocalRank: 1`, `staleLeaks: 0`, `latencyMs.p50: 1.7412 ms`, `p95: 2.8142 ms`, `estimatedTokens: 243`)
- `npm.cmd run package:smoke`: exit `0` (`189.0 kB`, `851.4 kB` unpacked, `171` files, `code` `26.84/34.35 ms`, `code-and-test` `38.43/46.79 ms`, `unsupported` `37.07/43.75 ms`, `Sprint 3.1 installed MCP handoff passed.`, `Packed install smoke passed: hypersabmemory@1.4.1`)
- `node scripts/sprint42-worktree-eval.mjs`: exit `0` (`passed: true`; `crossWorktreeSymlinkTested: false`, `caseSensitiveDistinctDocsTested: false` on NTFS)
- `node scripts/repository-task-eval.mjs`: exit `1` *(expected frozen)* (`passed: false`, raw `P@5: 0.48`, `R@5: 0.7375`, grounded `P@5: 0.46`, `R@5: 0.7042`, `supportedAnswerCoverage: 0`, `latencyMs.p95: 63.9207 ms`)
- `npm.cmd run release:preflight`: exit `1` *(expected fail-closed)* (`Verdict: RELEASE BLOCKED — NO-GO`, `Eligible for publication: NO`, `5/12` failing, `7/12` passing, `latencyMs.p95: 55.6669 ms`)
- `npm.cmd run eval:option-b:shadow`: exit `0` (`mode: "SHADOW_CANDIDATE_INFORMATIONAL_ONLY"`, `authorizesRelease: false`, `officialReleaseStatus: "NO-GO"`, `candidateContractPassing: false`)

## 8. Local Commits and Remote Verification Status

- Code commit: `a024e1e89d2aab2a6c4ff2bf404ac3f8371329d4` (`fix(storage): retry transient atomic rename failures with bounded backoff`, files: `src/memory/fileLock.ts`, `tests/atomicStoreWrites.test.ts`).
- Documentation commit: local commit adding `docs/GATE_4_ATOMIC_WRITE_RELIABILITY.md` immediately after authoring this document.
- Remote `origin/feature/sprint2.5-20261106` remains at `c027618ad1691461e3de5439c0ef774704c6b04f` (**no push executed**).
- **Remaining remote verification**: Product-owner authorization for one non-force push to `origin/feature/sprint2.5-20261106` and full `9/9` CI verification—specifically confirming `windows-latest` Node `20` passes `tests/concurrency.test.ts`, `npm test`, `eval:baseline`, and `package:smoke` alongside the remaining 8 matrix jobs.
- **Release status**: Remains **`NO-GO`**.
