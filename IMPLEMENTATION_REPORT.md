
# Preview.2 engineering verification

Verification ran in the isolated Windows checkout under Node 22.14.0 and npm 10.9.2. The packed engineering candidate retained its baseline version label and was installed from local bytes. The preview.2 version was reserved for the integration and acceptance cycle.

| Check | Actual result |
|---|---|
| `npm.cmd ci` | Exit 0. Installed lockfile dependencies. npm reported two moderate advisories on the initial audit. Dependency updates were outside this delta. |
| `npx.cmd tsc --noEmit` | Exit 0. |
| `node node_modules/vitest/vitest.mjs run tests/releaseCandidate.test.ts tests/releasePreflight.test.ts tests/mcpAccess.test.ts tests/reliabilityIndex.test.ts --maxWorkers=2` | 35/35 tests passed across four files. |
| `npm.cmd test` | 387/387 tests in 52/52 files. Build and test in 85.28 seconds. Includes MemoryBench. |
| `npm.cmd run eval:baseline` | Exit 0. Seven local retrieval cases, six answerable and one false positive on an unanswerable case. Measured p95 was 2.11 ms over 175 samples. The runner reported that the precision gate was invalid for this fixture. |
| `npm.cmd run package:smoke` | Exit 0. Packed install, repeated setup, CLI recall, independent stdio MCP clients and task continuation passed. The external tarball argument also passed against the clean release fixture. |
| `npm.cmd --silent run test:upgrade` | Exit 0. 1.4.0, 1.4.1 and published 1.5.0-preview.1 upgraded successfully. Preview.1 used its published JSON and SQLite task ledger. Stable releases used the released JSON memory implementation plus a synthetic task-ledger fixture. |
| `node scripts/reliability-stress.mjs 2 48` | Exit 0. Two iterations at 79/79 tests each, 48 indexed files per iteration, 21.608 and 20.556 seconds. No failures. |
| `node scripts/release-preflight.mjs --json` | Expected exit 1 for changed source. `SRC_TREE_HASH_MISMATCH` confirms that historical preview acceptance cannot authorize the changed runtime. |
| Workflow inspection | Parsed the actual YAML and syntax-checked every Bash step. Executed the smoke-report step with success, failure and skipped outcomes. Verified the step ID, artifact paths, publish-job permission and publish-last ordering. |
| Candidate and registry tests | A live registry read rejected the already-published preview version. The final strict prototype rejected the original ledger's different package hash. In a clean disposable checkout with test-only registry and acceptance inputs, two builds matched SHA-256 `49060de51b686cbe40e9b87d5507ca189dbec820db4c10127454ded06660f082`. The guard rejected tampered commit, ledger and tarball inputs and missing OIDC variables. Fixture read-only post-publication checks and exact-file package smoke passed. |

The upgrade runner initially demonstrated a Windows-only cleanup failure after the three upgrade assertions succeeded. The published package's native SQLite addon remained mapped until the process exited. Moving the fixture creation to a child process fixed cleanup. The final three-version run exited 0. The packed candidate in that run had integrity `sha512-yp4bb0d06nvLsckoHbMJaQKl8AP0NFyEGyCsbL35D77/vLBALZPedpdxYj3jBDtrSsN5tyZNv1yCaUk9T6L+lg==`.

The MCP regression reproduced malformed-state loss before the fix. The final upgrade test compares the full workspace path listing, MCP files, Memory.md, AGENTS.md and task JSON after failed setup. The injected late rename test verifies original byte restoration, deletion of newly created config files and directories, and successful retry.

Raw local evidence is under `scratch/next-version/` in the isolated checkout. Inspect `regression.log`, `package-smoke.log`, `upgrade.json`, `reliability.json`, `historical-preflight-rejection.json`, `live-duplicate-rejection.json` and the `synthetic-release-*.json` files. The synthetic reports are engineering test inputs and results. An approved preview.2 acceptance run and hosted OIDC execution remain pending.

For a larger follow-up run after release engineering, build once and run `npm.cmd run test:reliability -- 10 2000`. The runner records each test failure and subprocess error in its JSON report.
