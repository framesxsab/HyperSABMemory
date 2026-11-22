# HyperSABMemory Sprint 4.0 — Independent Product Validation and Developer-Preview Readiness

## 1. Executive Verdict

**Release status remains NO-GO.** `npm run release:preflight` continues to fail closed (`Verdict: RELEASE BLOCKED — NO-GO`, exit `1`) against the frozen release contract (`src/eval/repositoryTaskEvaluation.ts` and `src/eval/repositoryTaskFixture.ts`, both untouched), and `npm run eval:option-b:shadow` remains non-authoritative (`authorizesRelease: false`, `candidateContractPassing: false`).

Across two genuinely independent open-source repositories installed with `hypersabmemory@1.4.1` via its locally packed npm tarball (`178.3 kB`, `167` files), HyperSABMemory delivered reliable cold-start setup (`0` unexpected Git commits, idempotent bootstrap seeding), sub-100 ms median query latency (`34.65–44.87 ms` p50 across MCP `hypersabmemory_query_evidence` calls), exact source-hash/line attribution, same-size stale-rewrite rejection, forgotten-memory exclusion, workspace containment, and a successful two-session Codex continuation task on `tj/commander.js`.

At the same time, testing independent codebases uncovered a **real, generalizable product defect** before our fix: projects using Node's built-in `node:test` + `node:assert/strict` received **0/2** test attributions (`testLinked: false`) even though `src/memory/implementationEvidence.ts` explicitly supports `'node:test'`. Commit `3bdb8a4` resolves `node:assert` / `node:assert/strict` default, namespace, and named assertions cleanly while preserving local-shadowing guards and `execution: "unverified"`. Remaining cross-platform remote Linux/macOS CI runs, nested JSON key disambiguation, dynamic curried test builders (`it.each`), offline MCP launch config, and bounded top-5 precision/unanswerable filtering remain open before any developer preview or release approval.

---

## 2. Independent Repositories Tested

Both repositories were selected and shallow-cloned at pinned commits, and pre-labeled reference questions (7 answerable + 3 genuinely unanswerable per repository) were finalized from direct source reading **before** running HyperSABMemory against either codebase:

| Repository | URL | Pinned Commit | License | Language / Runner / Why Chosen |
| --- | --- | --- | --- | --- |
| `antfu-collective/ni` | `https://github.com/antfu-collective/ni.git` | `71e261fd497c9e5f7bc925267ff249f5b9f9bc14` | MIT | Pure TypeScript ESM CLI (`src/`, `src/catalog/`, `src/commands/`), `test/` singular, Vitest (`expect`, `it.each`), extensionless relative TS imports (`../../src/catalog/spec`, `../src/fs`), `README.md`. Tests TS module resolution, catalog/config queries, and Vitest test linking. |
| `tj/commander.js` | `https://github.com/tj/commander.js.git` | `a5a7dc084d4d2b7932e85ca049c5204e50a2c721` | MIT | Pure ESM JavaScript (`lib/`, `index.js`, `typings/index.d.ts`, `docs/`), mixed-case `Readme.md`, `tests/`, built-in `node:test` + `node:assert/strict`. Exercises non-`src/` JS projects, large module files (`lib/command.js`, `88.3 kB`), native `node --test` execution without `npm install`, and Node assert test linking. |

Validation harness: [scripts/sprint40-independent-eval.mjs](../scripts/sprint40-independent-eval.mjs). Both clones were copied into fresh disposable Git workspaces and paired with an npm-packed/installed `hypersabmemory@1.4.1` CLI and MCP stdio server (`node <install>/dist/cli/index.js mcp`).

---

## 3. Installed-Package Consumer Workflow Results

Measured end-to-end against `hypersabmemory-1.4.1.tgz` (`178,282` bytes packed, `pack: 2039.88 ms`, `install: 13714.45 ms`, `--version: 1.4.1`):

| Metric | `antfu-collective/ni` | `tj/commander.js` | Notes |
| --- | --- | --- | --- |
| Indexed repo records (`remember`) | 32 | 25 | Real source, doc, manifest, and test files |
| First `setup` latency | 1765.30 ms | 1751.93 ms | Creates adapters, `.mcp.json`/IDE configs, `Memory.md`, `graph.json` |
| Repeat `setup` latency | 1599.21 ms | 1555.54 ms | Idempotent (`0` duplicate seeds, `0` Git commits created) |
| Seeded bootstrap facts | 6 | 7 | Detected `src/` vs `lib/`, `test/` vs `tests/`, `docs/`, `README.md`/`Readme.md` |
| MCP startup + discovery (`listTools` + `listResources`) | 1416.08 ms | 1430.78 ms | Exposed 17 tools, 3 resources |
| `hypersabmemory_query_evidence` p50 / p95 / max (10 queries) | 34.65 / 339.57 / 339.57 ms | 44.87 / 568.50 / 568.50 ms | Cold first-query indexing causes p95 spike; steady-state median < 45 ms |
| Implementation evidence query p50 / p95 (3 queries) | 69.31 / 185.03 ms | 63.36 / 336.80 ms | Cold AST parse + TypeChecker on first query |
| Response payload mean / max bytes (`limit: 5`) | 4519.1 / 6144 B | 5753.4 / 6400 B | Bounded top-5 packets |
| Error clarity (`empty query`, `../outside.txt`, `unknown taskId`) | Pass (`isError: true`, `TASK_NOT_FOUND`) | Pass (`isError: true`, `TASK_NOT_FOUND`) | Structured error codes returned |

**Consumer friction note**: `src/harness/mcpAccess.ts` writes `{ command: 'cmd', args: ['/c', 'npx', '-y', 'hypersabmemory', 'mcp'] }` on Windows (`npx` on POSIX) when `.hypersabmemory`/local `dist/cli/index.js` is not in the workspace itself. Until published on npm or invoked via a local installed path (as done in `package:smoke` and `sprint40-independent-eval.mjs`), offline/unlinked consumer repos require pointing MCP config at the installed CLI path.

---

## 4. Retrieval Quality on Independent Repositories

Evaluated via live MCP `hypersabmemory_query_evidence` (`limit: 5`) over 10 pre-labeled queries per project (7 answerable + 3 unanswerable), counting **all 38 (`ni`) and 50 (`commander`)** returned evidence citations verified against disk SHA-256 hashes:

| Metric | `antfu-collective/ni` (7 ans / 3 unans) | `tj/commander.js` (7 ans / 3 unans) |
| --- | --- | --- |
| Precision@5 | `0.2857` | `0.3143` |
| Macro Recall@5 | `1.0000` (7/7 all relevant files retrieved) | `0.9286` (6/7 full, 1/7 half: missed `tests/argument.choices.test.js` in top-5) |
| Mean Reciprocal Rank (MRR) | `0.8333` | `1.0000` |
| Top-1 success rate | `0.7143` (5/7) | `1.0000` (7/7) |
| Unrelated evidence in top-5 (strict / acceptable) | `25` / `15` (across 35 slots) | `24` / `16` (across 35 slots) |
| Unanswerable unsupported assertions (`answerVerified: true`) | `0 / 3` | `0 / 3` |
| Unanswerable queries returning candidate evidence (`status: evidence_found`) | `1 / 3` (`ni_unans_pg`: PostgreSQL question matched generic terms like `version`) | `3 / 3` (`cmd_unans_*`: Commander generic tokens matched `lib/command.js`, error tests, docs) |
| Source attribution validity (`sha256` match + `freshness: current`) | `38 / 38` (100%) | `50 / 50` (100%) |

**Honest interpretation**: For answerable developer questions, HyperSABMemory surfaced the primary implementation/doc file at rank 1 on 12/14 queries (`MRR = 0.8333` on `ni`, `1.0000` on `commander`, macro recall `0.9286–1.0000`). However, because `hypersabmemory_query_evidence` fills up to `limit: 5` slots whenever any BM25 keyword matches (`limit=5` precision bounded by small `|relevant|=1..2`), unrelated files fill remaining slots (24–25 strict non-relevant slots out of 35) and unanswerable queries still surface lexically overlapping `candidate_excerpt` records on 4/6 unanswerable queries across the two repos—though with `answerVerified: false` and `0` unsupported assertions.

---

## 5. Implementation & Test Evidence Accuracy (Before vs. After `3bdb8a4`)

Evaluated via MCP `hypersabmemory_query_evidence` on real exported symbols and test files, including negative probes with locally shadowed functions (`shadowed-spec.spec.ts` in `ni`, `shadowed-useColor.test.js` in `commander`):

| Check | Repo | Pre-Fix (`fa49bec`) | Post-Fix (`3bdb8a4`) | Ground-Truth Details |
| --- | --- | --- | --- | --- |
| `parsePackageSpec` impl + Vitest test | `ni` | Code + **4 tests linked** | Code + **4 tests linked** | `src/catalog/spec.ts:11-21` + `test/programmatic/catalog-spec.spec.ts:6,10,18,25` (`execution: unverified`, `shaMatch: true`) |
| `isVerbatimSpec` impl + `it.each` test | `ni` | Code found, `0` tests | Code found, `0` tests | `it.each(verbatim)(...)` curried Vitest helper remains unsupported |
| `detect` impl + `detectPM` call site | `ni` | **Code + 5 call sites** | **Code + 5 call sites** | `src/detect.ts:29-85` includes call site `detectPM(...)` |
| Shadowed import probe (`parsePackageSpec`) | `ni` | **Rejected** | **Rejected** | `shadowedImportRejected: true` |
| `useColor` impl + `node:assert` test | `commander` | Code found, **0 tests linked** | Code + **4 tests linked** | `lib/command.js:2781-2803` + `tests/useColor.test.js:28,38,43,50` (`execution: unverified`, `shaMatch: true`) |
| `DualOptions.valueFromOption` impl + `node:assert` test | `commander` | Code found, **0 tests linked** | Code + **4 tests linked** | `lib/option.js:297-305` + `tests/options.dual-options.test.js:55,60,65,70` (`execution: unverified`, `shaMatch: true`) |
| `suggestSimilar` impl + `editDistance` call site | `commander` | **Code + 1 call site** | **Code + 1 call site** | `lib/suggestSimilar.js:56-99`, `editDistance(...)` call site |
| Shadowed import probe (`useColor`) | `commander` | **Rejected** | **Rejected** | `shadowedImportRejected: true` |

Every attributed test link explicitly preserves `execution: "unverified"` and is re-hashed on return.

---

## 6. Grounding Safety, Freshness, and Abstention Checks

Both independent workspaces ran the complete deterministic safety probe battery via installed MCP tools:

| Safety / Exactness Check | `antfu-collective/ni` | `tj/commander.js` | Observation |
| --- | --- | --- | --- |
| Exact JSON scalar (`name` in `package.json`) | Pass (`line 2`, `sha256` match) | Pass (`line 2`, `sha256` match) | `@antfu/ni` and `commander` verified |
| Exact JSON scalar (`version` in `package.json`) | Pass (`line 4`, `sha256` match) | Pass (`line 3`, `sha256` match) | `30.6.0` and `15.1.0` verified |
| Nested duplicate JSON key (`type` in `package.json`) | Safely abstained (`answerVerified: false`) | Safely abstained (`answerVerified: false`) | `package.json` contains `"type": "module"` and `"repository": { "type": "git" }`; `verifyJsonScalarClaim` treats duplicate key text conservatively rather than guessing top-level key |
| Exact symbol declaration (`parsePackageSpec` / `suggestSimilar`) | Pass (`src/catalog/spec.ts:11`) | Pass (`lib/suggestSimilar.js:56`) | Exact 1-based line + `sha256` verified |
| Same-size content rewrite (`deterministic` -> `DETERMINISTIC`) | Detected (`status: modified`, zero stale excerpts) | Detected (`status: modified`, zero stale excerpts) | Byte length unchanged, SHA-256 mismatch caught |
| Deleted source file detection | Detected (`status: missing`) | Detected (`status: missing`) | Stale source reported cleanly |
| Forgotten-memory exclusion (`hypersabmemory_forget`) | Excluded (`0` records, `0` evidence) | Excluded (`0` records, `0` evidence) | Note: using repo name `commander` inside a sentinel initially hit unrelated records matching the tokenized word `commander`; opaque tokens (`sprint40canarytoken918273*`) confirm zero leak of forgotten records |
| Conflicting evidence & caller-declared conflicts | Abstained (`canAssert: false`, `CONFLICTING_EVIDENCE`) | Abstained (`canAssert: false`, `CONFLICTING_EVIDENCE`) | Safe abstention on both contradiction and declared conflict |
| Workspace path containment (`../outside.txt`) | Rejected (`isError: true`) | Rejected (`isError: true`) | Escaping relative paths blocked |

---

## 7. Real Cross-Session Continuation Scenario (`tj/commander.js`)

Script: [scripts/sprint40-cross-session-commander.mjs](../scripts/sprint40-cross-session-commander.mjs).

1. **Session 1 (installed HyperSABMemory setup + decision recording)**:
   - On a fresh baseline copy of `tj/commander.js` (`a5a7dc084d4d2b7932e85ca049c5204e50a2c721`), ran installed `hypersabmemory setup`, recorded an architectural decision via `hypersabmemory_remember` (`"Cap suggestSimilar() output to at most 3 alphabetically sorted candidates when more than 3 candidates tie at the same best edit distance, keeping exact formatting without ellipsis"`), and created + checkpointed task `task_ab52b2a8-243e-4197-992b-f2e2f80b83c9` referencing `lib/suggestSimilar.js` and `tests/help.suggestion.test.js`, then closed Session 1's MCP client completely.
2. **Session 2 (fresh `codex.exe exec` agent run with neutral prompt)**:
   - Prompted `codex.exe` (`-a never exec --json --ephemeral --ignore-user-config --sandbox workspace-write -c windows.sandbox="unelevated"`) ONLY to continue the active task via `hypersabmemory_task_context({ compact: true })`, **without disclosing the max-3 tie cap in the prompt**.
   - Elapsed wall-clock time: `71.97 s` (`exitCode: 0`, `7` shell commands, `5` MCP calls: `hypersabmemory_task_context`, `hypersabmemory_task_claim`, `hypersabmemory_task_checkpoint` to `reported_complete`, one redundant release `task_claim` after completion which safely errored/failed without corrupting state, and a final confirmation `task_context` read).
   - Tokens used: `533,761` input (`473,856` cached), `1,259` output.
   - Note on sandbox test execution: inside Codex's Windows `workspace-write` sandbox, default `node --test` child-process isolation hit `spawn EPERM`, so Codex verified with `node --test --experimental-test-isolation=none tests/help.suggestion.test.js` (`48/48` pass) + `git diff --check`.
3. **Independent verification (outside Codex)**:
   - Minimal 2-file patch accepted: `lib/suggestSimilar.js` (`+1`: `similar = similar.slice(0, 3);`) and `tests/help.suggestion.test.js` (`+6`: regression case `'bat, cat, hat'` for 4 tied candidates `['rat', 'cat', 'hat', 'bat']`).
   - Direct runtime behavior verified (`behaviorVerified: true`): `suggestSimilar('cat', ['bat', 'fat', 'hat', 'mat', 'pat', 'rat'])` -> `"\n(Did you mean one of bat, fat, hat?)"` while 3 ties remain `"\n(Did you mean one of bat, mat, rat?)"`.
   - `node --test tests/help.suggestion.test.js` (default isolation, external Node): **48/48 passed (`0` failures)** vs `47/47` baseline.
   - Full `node --test` suite (external Node): **1414/1419 passed** (`1` pre-existing Windows baseline failure, `4` skipped; baseline was `1413/1418` with the same `1` failure and `4` skipped — **zero regressions**).
   - Fresh MCP verification confirmed task `revision: 6`, `state: "reported_complete"`.

**Single-task caveat**: This end-to-end continuation demonstrates that a real Codex session can recover an unstated historical design rule through compact one-call MCP handoff on an unfamiliar OSS codebase and complete the patch cleanly. As a single task (`n = 1`), it does not statistically prove general cross-session superiority across arbitrary tasks, nor does it evaluate noisy multi-session drift.

---

## 8. Largest Remaining Product Weakness and Production Fix

### Primary Defect Fixed: `node:assert` Test Attribution Gap (`3bdb8a4`)

- **Observed failure**: `src/memory/implementationEvidence.ts:223` explicitly accepted `'node:test'` test functions, yet `assertion()` (lines 227–238) exclusively recognized Vitest's `expect(target).to*()` chain. On `tj/commander.js`, **0/2** real `node:test` + `node:assert/strict` test files (`tests/useColor.test.js`, `tests/options.dual-options.test.js`) linked to their imported targets.
- **Root cause**: `resolveImportBinding` / `imported` in `implementationEvidence.ts` only accepted `ts.isImportSpecifier`, whereas Node's `import assert from 'node:assert/strict'` and `import * as assert from 'node:assert/strict'` use default `ImportClause` / `NamespaceImport` nodes, and `assertion()` had no extractor for `assert.<method>(call)` / `assert.throws(() => call)` / named `strictEqual(call, ...)`.
- **Fix ([src/memory/implementationEvidence.ts](../src/memory/implementationEvidence.ts))**:
  - Added unified import binding resolution (`ImportSpecifier`, default `ImportClause`, `NamespaceImport`, skipping type-only imports and requiring `importedNames.get(name) === 1` + single non-shadowed TypeScript declaration).
  - Extracted `unwrapAssertedCall` and `extractAssertedCall` covering both Vitest `expect(...)` and `node:assert` / `node:assert/strict` / `assert` / `assert/strict` value methods (`ok`, `equal`, `strictEqual`, `deepEqual`, `deepStrictEqual`, `notEqual`, `notStrictEqual`, `notDeepEqual`, `notDeepStrictEqual`, `match`, `doesNotMatch`) and wrapper methods (`throws`, `doesNotThrow`, `rejects`, `doesNotReject`), preserving `execution: "unverified"` and source re-hashing.
- **TDD verification**: Added regression test in [tests/groundedSearch.test.ts](../tests/groundedSearch.test.ts) covering default/named `node:assert/strict`, `assert.equal`, `assert.throws`, class instance `PortRange.contains`, shadowed `assert`, and shadowed target; confirmed clean RED failure (`Received: []`) before editing `src/memory/implementationEvidence.ts`, GREEN `34/34` pass after editing, and `2/2` `commander` test attribution (`8` linked test cases across both files) on the reinstalled tarball.

### Other Observed Real-World Weaknesses (Logged, Not Touched to Preserve Single-Fix Discipline)

1. **Dynamic test parameterization (`it.each`)**: `ni`'s `test/programmatic/catalog-spec.spec.ts` uses `it.each(verbatim)(...)` for `isVerbatimSpec`, which curries a call expression rather than calling named `it(...)` directly; `0` tests linked for `isVerbatimSpec`.
2. **Flat JSON key collision check**: `verifyJsonScalarClaim` scans the entire JSON text for `"key":`, so querying `What is the value of "type" in package.json?` sees both top-level `"type": "module"` and `"repository": { "type": "git" }` and abstains (`answerVerified: false`).
3. **Unanswerable candidate noise**: `hypersabmemory_query_evidence` returned lexically overlapping `candidate_excerpt` records on 4/6 unanswerable independent queries (`answerVerified: false`), and strict P@5 stays `~0.29–0.31` when relevant sets have `1–2` files and `limit: 5` pads out top-5.
4. **Offline / pre-publish `npx` fallback**: `resolveMcpLaunch` in `src/harness/mcpAccess.ts` defaults to `npx -y hypersabmemory mcp` when `dist/cli/index.js` is absent from the consumer workspace.
5. **Case-sensitive Linux `Readme.md` discovery**: `discoverProjectSources` (`src/harness/taskSources.ts:28`) checks uppercase `README.md` (unlike `seeding.ts:46` which checks `['README.md', 'readme.md', 'Readme.md']`).

---

## 9. Cross-Platform Readiness Audit

Inspected workflows and platform-sensitive paths directly in source:

- **CI & Release Workflows**:
  - `.github/workflows/ci.yml` defines a 3x3 matrix (`ubuntu-latest`, `windows-latest`, `macos-latest` x Node `20, 22, 24`) running `npm ci`, `npx tsc --noEmit`, `npm test`, `npm run eval:baseline`, and `npm run package:smoke`.
  - `.github/workflows/release.yml` gates `v*` tag pushes / `workflow_dispatch` on all 3 OSes at Node `24`, enforcing `npm run release:preflight` before `publish` (`needs: gates`).
- **Native Dependency Risk**: `package.json` declares `"better-sqlite3": "12.9.0"`, which relies on `prebuild-install` binaries or a native C++ build toolchain if prebuilds are unavailable for a platform/Node ABI.
- **Windows vs. POSIX Path Behavior**:
  - `sourceKey()` (`groundedSearch.ts`), `captureTaskSources()` (`taskSources.ts`), and `normalizePath()` (`hybridSearch.ts`) normalize backslashes and lowercase on `win32` while staying case-sensitive on POSIX.
  - As noted above, `ROOT_DOCUMENTS` in `src/harness/taskSources.ts:28` only lists `'README.md'`, so a lowercase/mixed-case `Readme.md` (like `tj/commander.js`) is discovered on case-insensitive Windows/macOS filesystems but would be skipped by `discoverProjectSources` on case-sensitive Linux.
  - `containStoreInGit` (`src/cli/oneShotSetup.ts:32`) checks `fs.statSync(gitDir).isDirectory()`, so linked Git worktrees (where `.git` is a pointer file) skip `.git/info/exclude` setup.
- **Unverified Remote Execution**: **Linux and macOS GitHub Actions CI runs have NOT been executed** because pushing to remote is prohibited in Sprint 4.0. All Sprint 4.0 validation ran locally on Windows (`win32 x64`, Node `v22.14.0`).

---

## 10. Updated Option B Release-Contract Assessment (UNAPPROVED)

Consistent with Sprints 3.7–3.9, any shift from the frozen evaluator to an evidence-harness contract (**Option B**) remains **UNAPPROVED** and requires explicit product-owner sign-off. Grounded in independent validation results across `ni` and `commander.js`, candidate readiness should be cleanly separated across three distinct layers:

| Layer | Candidate Criterion (UNAPPROVED Draft) | Observed Sprint 4.0 Evidence | Current Readiness |
| --- | --- | --- | --- |
| **1. Harness-Level Guarantees** | - `0` unsupported assertions (`answerVerified: true` errors)<br>- `100%` SHA-256 + freshness + unique line checks<br>- `0` stale leaks (including same-size rewrites & mid-read mutations)<br>- `0` forgotten-memory leaks & `100%` conflict abstention<br>- Workspace path containment + clean packaged CLI/MCP install (`p95 <= 100 ms` steady-state, compact handoff) | Frozen `30`-query (`0` unsupported, `20/20` stale caught, `0` leaks, `25.92 ms` p95), `sprint36` (`15.85 ms` p95 compact), `sprint37` (`9/9` MCP regression), `ni` + `commander` (`88/88` attributions, `0` leaks, `2/2` Vitest + `2/2` `node:assert` tests linked with `execution: unverified`; `p95` cold+warm `340–569 ms` on small MCP run) | **Strong locally on Windows**; remote Linux/macOS CI + `Readme.md` POSIX discovery + offline MCP launch need resolution |
| **2. Integrated-Agent Outcomes** | - Fresh session restores unstated decision/task in `<= 2` MCP context/query calls<br>- Patch passes independent external tests & behavior checks<br>- Multi-repo multi-task sample (`>= 5` independent tasks) without brittle test hacks | Sprint 4.0 `commander` Codex run succeeded (`1/1`, `48/48` targeted tests, `1414/1419` full suite vs `1413` baseline); combined with Sprints 3.5–3.6 (`2/2` historical acceptance), total empirical Codex tasks across codebase = small (`n = 3` historical tasks total) | **Promising proof-of-concept (`n = 1` external repo)**; sample still below statistical developer-preview bar and sandboxed test spawning needed fallback flag inside Codex |
| **3. Broad Semantic Synthesis & Retrieval** | - Bounded top-5 macro recall `>= 0.85` across repos<br>- Bounded unanswerable candidate leakage clearly scoped / reduced<br>- Do **not** conflate lexical `candidate_excerpt` retrieval with semantic proof (`answerVerified` stays strict) | Frozen `30` queries (`grounded R@5 = 0.6708`, `P@5 = 0.4400`, `40%` unanswerable candidates); `ni` + `commander` (`macro R@5 = 1.0000 / 0.9286`, `MRR = 0.8333 / 1.0000`, `4/6` unanswerable queries surfaced candidate records with `0` false assertions) | **Not ready for broad claim synthesis**; retrieval quality works well as human/agent *evidence lookup*, not autonomous QA over arbitrary prose |

**Threshold posture**: Proposed Option B thresholds are **UNAPPROVED** (`eval:option-b:shadow` stays `authorizesRelease: false`, `candidateContractPassing: false`, `NO-GO`). Do not alter frozen thresholds in `src/eval/repositoryTaskEvaluation.ts`.

---

## 11. Full Sequential Verification Matrix (After `3bdb8a4`)

All 13 commands executed sequentially in `C:\Users\singa\Desktop\hypermemory-sprint2.5` (Windows `win32 x64`, Node `v22.14.0`):

| # | Command | Exit Code | Verdict / Key Observed Output |
| --- | --- | --- | --- |
| 1 | `npm.cmd test` | `0` | `45` test files passed, `308` tests passed (`+1` `node:assert` test over `fa49bec`) |
| 2 | `npx.cmd tsc --noEmit` | `0` | Clean typecheck |
| 3 | `npm.cmd run build` | `0` | Clean TypeScript build to `dist/` |
| 4 | `npm.cmd run eval` | `0` | `tests/memorybench.test.ts`: `8/8` passed |
| 5 | `npm.cmd run eval:baseline` | `0` | `passed: true` (`500` records, `493` distractors, `recall@5: 1.0`, `MRR: 1.0`, `staleLeaks: 0`, `p95: 1.98 ms`) |
| 6 | `npm.cmd run package:smoke` | `0` | `167` files, `178.3 kB` tarball (`802.8 kB` unpacked), `Packed install smoke passed: hypersabmemory@1.4.1` |
| 7 | `node scripts/sprint36-handoff-bench.mjs` | `0` | `matrixPassed: true`; compact one-call p95 `14.75–15.85 ms`, `-65.2%` to `-65.4%` response bytes |
| 8 | `node scripts/sprint37-grounding-bench.mjs` | `0` | `9/9` MCP regression passed; benchmark p50 `16.93 ms` / p95 `25.52 ms` (vs baseline p95 `194.78 ms`) |
| 9 | `node scripts/sprint39-dev-retrieval-eval.mjs` | `0` | `combinedDev42` grounded `MRR = 0.8977` (`+0.1098`), `top1HitRate = 0.8182`, `staleProbe.leaks = 0`, p95 `30.22 ms` |
| 10 | `node scripts/sprint40-independent-eval.mjs` | `0` | `ni` (`MRR 0.8333`, `R@5 1.0000`, Vitest `testLinked: true`) + `commander` (`MRR 1.0000`, `R@5 0.9286`, `node:assert` `2/2` `testLinked: true`); `0` unsupported/stale/forgotten leaks |
| 11 | `node scripts/repository-task-eval.mjs` | `1` *(expected)* | `passed: false` (frozen contract): raw `P@5 = 0.4700`, `R@5 = 0.7208`, `MRR = 0.8750`; grounded `P@5 = 0.4400`, `R@5 = 0.6708`, `MRR = 0.8750`, `supportedAnswerCoverage = 0`, `forgottenLeaks = 0`, `staleProbe.leaks = 0`, `p95 = 25.92 ms` |
| 12 | `npm.cmd run release:preflight` | `1` *(expected)* | `Verdict: RELEASE BLOCKED — NO-GO`, `Eligible for publication: NO` (`5` failing frozen criteria / `7` passing) |
| 13 | `npm.cmd run eval:option-b:shadow` | `0` | `mode: SHADOW_CANDIDATE_INFORMATIONAL_ONLY`, `authorizesRelease: false`, `officialReleaseStatus: NO-GO`, `candidateContractPassing: false` |

Additionally verified after final cleanup edit: `node scripts/sprint40-cross-session-commander.mjs` exited `0` (`Codex exitCode: 0`, `71.97 s`, `behaviorVerified: true`, Commander `tests/help.suggestion.test.js` `48/48` pass, full `node --test` `1414/1419` pass vs `1413/1418` baseline).

---

## 12. Concrete Next-Milestone Recommendation

Before seeking **developer-preview** approval (Sprint 4.1 / Option B review):

1. **Fix the remaining high-leverage consumer portability issues surfaced by independent validation**:
   - Add lowercase/mixed-case `Readme.md` / `readme.md` to `ROOT_DOCUMENTS` in `src/harness/taskSources.ts` so Linux matches `seeding.ts` (`tj/commander.js` `Readme.md`).
   - Resolve installed CLI / local binary fallback cleanly in `src/harness/mcpAccess.ts` (`process.argv[1]` / resolved package entry) when `hypersabmemory setup` configures IDE MCP JSON so unpublished/air-gapped or locally installed workspaces don't point at `npx -y hypersabmemory mcp`.
   - Fix nested key scoping in `verifyJsonScalarClaim` (`type` at root vs `repository.type` in `package.json`).
2. **Submit an explicit Option B Developer-Preview Proposal** to the product owner separating **Harness-level guarantees** (where HyperSABMemory now demonstrates strong independent evidence) from **Broad semantic synthesis** (explicitly excluded from claims), and authorize a CI push on a test branch so `ubuntu-latest` and `macos-latest` verify native `better-sqlite3` installation and POSIX case-sensitivity remotely.
