# HyperSABMemory — Product Requirements (Option B)

> **Scope Statement**: HyperSABMemory is a local-first, source-verifiable MCP context harness and task-continuation memory engine for AI coding agents. It preserves development context, restores unfinished work via compact handoffs, verifies source provenance against current disk bytes, and separates verified deterministic evidence from lexical retrieval candidates.

## Category A — Mandatory Safety Guarantees (Permanent Across All Releases)

1. **`A.1` Zero Unsupported Verified Assertions**: `canAssert: true` / `answerVerified: true` emitted only when every cited check passes exact deterministic verification.
2. **`A.2` Logical Forgetting & Zero Projection Leaks**: Forgotten and superseded records never surface in `Memory.md`, `hypersabmemory://memory-log`, `context_block`, `query`, `query_evidence`, `task_grounded_query`, or `task_context` (audit records retained in `.hypersabmemory/memory_store.json`, `.bak`, and Git history).
3. **`A.3` Stale & Same-Size Rewrite Detection (`100%` Flagged / `0` Leaks)**: Current disk SHA-256 checked on every cited source, including same-byte-size content rewrites (`STALE_EVIDENCE`).
4. **`A.4` Conflicting Evidence Abstention**: Contradictory claims, caller-declared conflicts, and duplicate hash mismatches abstain cleanly (`CONFLICTING_EVIDENCE`).
5. **`A.5` Mid-Verification Mutation Rejection**: Fresh on-disk inspection catches mutations occurring between candidate capture and verification.
6. **`A.6` Canonical Containment**: Relative traversal (`../`) and escaping symlinks/junctions blocked across Windows, macOS, and Linux.
7. **`A.7` Git Worktree & Setup Non-Destructiveness**: Shared `<commonDir>/info/exclude` without mutating tracked files (`preserveTrackedFiles: true` default) or repo git identity; isolated task/memory/lock state per linked worktree.
8. **`A.8`–`A.9` Atomic Store Integrity & Recovery**: File-locked atomic rename writes with bounded `5`-attempt `EPERM`/`EBUSY` backoff (`<= 300 ms`), preserving `.tmp`/`.bak` and releasing `.lock` on failure.
9. **`A.10`–`A.11` Lease Fencing & Active-Only Task Restoration**: Owner/generation checks (`CLAIM_CONFLICT`, `NOT_TASK_OWNER`, `OWNERSHIP_CONFLICT`) and active-only compact task projection (`compact: false` unchanged).
10. **`A.12` Static Test-Attribution Safety**: TypeScript `TypeChecker` value-import linking (`0` false links across `import type`, local shadowing, and uncalled bindings), always reporting `execution: "unverified"`.

## Category B — Retrieval & Continuation Usefulness Thresholds

| Metric | Profile 1 (Developer Preview `v1.5.0-preview.1`) | Profile 2 (Stable `v1.5.0`) |
|---|---|---|
| Raw / Grounded Macro Recall@5 (unseen `n=30`) | `>= 0.80` | `>= 0.85` |
| Normalized Precision@5 (`P@5 / maxP@5`) | `>= 0.45` | `>= 0.50` absolute (where `maxP@5 >= 0.50`) |
| Grounded MRR@5 / Top-1 Success | `MRR >= 0.80`, `Top-1 >= 0.70` | `MRR >= 0.85`, `Top-1 >= 0.75` |
| Unanswerable Candidate Emission | `<= 0.50` (`0` unsupported assertions) | `<= 0.25` (`0` unsupported assertions) |
| Positive Deterministic Claim Coverage | `>= 0.90` on supported deterministic classes | `>= 0.95` on supported deterministic classes |
| Real Cross-Session Continuation | **`3/3`** fresh Session A->B tasks passing unmodified + targeted + behavioral + `reported_complete` checkpoint | `>= 6/6` across `>= 3` repos + comparative baseline |

## Category C — Operational & Performance Budgets

- **Warm MCP `query_evidence` (`n=90`)**: nearest-rank `p95 <= 100 ms`
- **Cold TypeScript `query_evidence` (`n=30`, excl. process startup)**: nearest-rank `p95 <= 500 ms`
- **Compact `task_context({ compact: true })`**: `p95 <= 50 ms`, `>= 50%` UTF-8 byte reduction, `16/16` semantic completeness equivalence vs `compact: false`
- **Cross-Platform CI**: `9/9` passing (`ubuntu-latest`, `windows-latest`, `macos-latest` × Node `20`, `22`, `24`)

## Category D — Explicit Non-Guarantees

1. No open-ended natural-language prose synthesis (`supportedAnswerCoverage = 0` on open-ended conceptual prompts).
2. No runtime test execution proof from static TypeChecker test links (`execution: "unverified"`).
3. No autonomous LLM patch correctness guarantee outside HyperSABMemory's MCP context/freshness guarantees.
4. No elimination of unverified lexical candidates below configured thresholds when unanswerable queries reuse repo tokens (always marked `answerVerified: false`).
