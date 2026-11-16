# Sprint 2.8 Development Evidence Review v1

Scope: the 22 below-five file labels from the prior development diagnostic. Ranks are historical on the captured source snapshot; the 84 TypeScript source/test files matched the current worktree by SHA-256 on this continuation. Classification addresses the stated subclaim, not the entire multi-part question. The prior top-five and grounding numbers remain unchanged. The review is automated source inspection by separate coding agents and the primary worker, not independent human review. Test-source lines prove test statements exist, not that tests passed.

Questions: Q1 task creation/hash/capsule/MCP; Q2 setup seeding/rules/MCP; Q3 contained paths/same-size rewrites; Q4 MCP context/graph; Q5 persisted memory and hybrid search; Q6 forgotten/superseded filtering; Q7 rollback/ghost paths; Q8 MCP claims and locking; Q9 revision fencing and write recovery; Q10 watcher/checkpoint/noise; Q11 task coordination, memory persistence and context boundaries.

| Question | Original labeled source | Rank | Subclaim reviewed | Source lines | Classification | Limitation |
|---|---|---:|---|---|---|---|
| Q1 | src/harness/taskContext.ts | 6 | Restore bounded task capsule | 30-46,74-80 | PARTIAL SUPPORT | Renders and bounds capsule; does not establish creation, hashing and MCP routing. |
| Q1 | tests/taskProcesses.test.ts | 7 | Restore task after MCP restart | 236-245,254-255,263-274 | PARTIAL SUPPORT | Tests restored state; not captured hash values or capsule bound. |
| Q2 | src/memory/seeding.ts | 9 | Derive and persist seed facts | 109-145 | PARTIAL SUPPORT | Implements seeding, not proof setup invokes it or configures MCP. |
| Q2 | src/harness/universalAdapters.ts | 6 | Merge native agent rules | 130-143 | PARTIAL SUPPORT | Rules component only; seeding and MCP need other sources. |
| Q2 | tests/harness.test.ts | 16 | Exercise adapter merge and MCP configuration | 57-80,141-158 | PARTIAL SUPPORT | Tests configuration, not a successful end-to-end server connection. |
| Q3 | src/harness/taskSources.ts | 7 | Contain paths and hash source bytes | 36-55,68-76,128-135 | DIRECT SUPPORT | Containment and byte hashing directly support these subclaims; restoration call requires taskContext.ts. |
| Q4 | src/memory/contextBlock.ts | 26 | Rank and compress active memory | 69-96 | PARTIAL SUPPORT | Context block only; MCP route and active-file/graph composition need other sources. |
| Q4 | tests/mcpResources.test.ts | 14 | Compare context-block resource and tool | 42-54 | PARTIAL SUPPORT | Tests resource equivalence, not active-file and graph composition. |
| Q5 | src/memory/sqliteStore.ts | 8 | Persist memory as JSON | 39-42,86-108,132-146 | PARTIAL SUPPORT | Shows JSON store and writes; temporal and MCP retrieval require other sources. |
| Q6 | src/memory/hybridSearch.ts | 24 | Search active memory | 174,304 | PARTIAL SUPPORT | Delegates to getActive; does not itself establish both forgotten and superseded filtering. |
| Q6 | tests/sqliteStore.test.ts | 15 | Exclude forgotten record after recovery | 114-127 | PARTIAL SUPPORT | Tests forgotten exclusion; cited lines do not establish superseded filtering. |
| Q6 | tests/hybridSearch.test.ts | 37 | Exclude forgotten records from search | 63-66,101-115 | PARTIAL SUPPORT | Tests forgotten records; cited lines do not establish superseded filtering. |
| Q7 | src/hooks/autoCommit.ts | 6 | Attempt pre-rollback safety checkpoint | 275-294 | PARTIAL SUPPORT | Attempts checkpoint; checkpoint failure can be tolerated, and ghost context is elsewhere. |
| Q8 | src/memory/fileLock.ts | 15 | Exclusive generic lock acquisition | 61-65,90-102 | CONTEXTUAL ONLY | Generic file lock; task ledger uses SQLite immediate coordinator, so this label does not establish task claim fencing. |
| Q9 | src/memory/fileLock.ts | 8 | Generic lock or write recovery | 28-38,71-102 | CONTEXTUAL ONLY | Generic primitives do not establish task revision fencing or task-ledger recovery. |
| Q10 | src/hooks/autoCommit.ts | 7 | Schedule periodic checkpoints | 60-67,88-112 | PARTIAL SUPPORT | Shows periodic checkpoints and lock; watcher trigger and noise suppression require separate evidence. |
| Q10 | src/memory/fileLock.ts | 40 | Acquire generic asynchronous lock | 106-120 | CONTEXTUAL ONLY | Generic lock connected by autoCommit.ts; does not establish watcher or noise behavior. |
| Q10 | tests/autoCommitGuards.test.ts | 39 | Check checkpoint identity and staging | 39-80 | CONTEXTUAL ONLY | Checks commit identity and excluded store; not watcher debounce or noise. |
| Q11 | src/memory/sqliteStore.ts | 25 | Persist memory records | 39-42,86-108,139-148 | PARTIAL SUPPORT | Supports persistence only, not full documented architectural boundaries. |
| Q11 | src/harness/contextHarness.ts | 12 | Build compact context header | 40-42,61-62,80-96 | PARTIAL SUPPORT | Supports context delivery only, not complete task/persistence relationship. |
| Q11 | src/mcp/server.ts | 10 | Expose task and context interfaces | 16-21,291-292,311-321,452-462 | PARTIAL SUPPORT | Shows interface-level linkage, not full persistence or boundary proof. |
| Q11 | tests/mcpResources.test.ts | 15 | Check MCP resource interfaces | 31-39,42-53,57-66 | PARTIAL SUPPORT | Tests resource expectations, not entire architecture or actual test execution. |

## Review findings

Only Q3 taskSources is classified direct for its stated containment and byte-hash subclaims; the compound question also needs evidence of the restoration call. Seventeen labels support a defined part of the compound question, while four generic or indirect labels are contextual only. In particular, taskLedger.ts uses the SQLite coordinator for task mutations; generic file-lock code cannot independently establish task-claim or revision fencing. The watcher starts the auto-checkpoint timer; the inspected file-event handler does not itself invoke a checkpoint. These classifications are not frozen benchmark labels and do not change original scores.

The next required work is to freeze a separate source-line validation set and run a controlled candidate against it. No ranking hypothesis or candidate has been accepted; factual entailment must not be inferred from lexical similarity.
