---
name: hypersabmemory
description: Discover existing project scope, coordinate local agent tasks through MCP, and checkpoint evidence-backed state before handoff or context compaction.
---
# HyperSABMemory AI Agent Harness Protocol
- **State Harness**: Keep context headers under 1500 tokens. Read Memory.md on session start.
- **Structural Knowledge**: Query the structural knowledge graph (graph.json) before writing new modules. Re-use existing components.
- **Minimal-Change Rules**: Default to NO for unnecessary features. Use standard libraries. Write minimal code.
- **Auto-Commit Safety**: Work is auto-checkpointed every 3-5m under configured git author.

## Scope and task workflow

1. When resuming unfinished work or checking prior session decisions, call `hypersabmemory_task_context({ "compact": true })` (or `hypersabmemory_task_context({})`) first. Omitting `taskId` automatically restores the sole active task, its next action, verified source decisions/rationales, linked constraints, task-linked active memories, and source SHA-256 freshness in one call without reading `.hypersabmemory/tasks.json`. Only call `hypersabmemory_query_evidence` if you need an additional repository-wide search outside the restored task sources. When starting a brand-new project scope with no active task, discover scope with `hypersabmemory_scope_sources`; read relevant current instructions, PRD, architecture, rules, README, and source files. Keep those documents authoritative. Do not create a duplicate scope document. Record conflicts, missing information, and assumptions explicitly rather than resolving them by guesswork.
2. Create a task with `hypersabmemory_task_create`: capture the user goal, explicit constraints, acceptance criteria, and relevant workspace-relative `sourceRefs` paths. Source hashes are captured locally. A missing source is unverified evidence, never a known fact.
3. Choose one stable `agentId` for this worker and reuse it across claims, checkpoints, and handoffs. Claim with `hypersabmemory_task_claim` before working. Renew the ten-minute lease while active. Use the existing `hypersabmemory_claim_task` separately for file locks; its file-lock meaning is unchanged.
4. Checkpoint meaningful milestones with `hypersabmemory_task_checkpoint`, supplying the expected task revision and lease generation from the claim, concise decisions, completed work, evidence paths, reported checks, blockers, and the next action. Supply the same generation when renewing or releasing. A conflict requires reading the current task and reconciling; never silently overwrite another worker's checkpoint.
5. Before handing off or expected context compaction, checkpoint the latest task state and keep its task ID available. Store compact task state and references only; do not save conversations or full tool transcripts.
6. Restore with `hypersabmemory_task_context({ "compact": true })` (or pass `taskId` / an >= 8-character prefix when multiple tasks are active). Inspect source/evidence freshness metadata. Re-read changed or implementation-target sources, locate missing files, and treat recorded decisions as historical/unverified until supported by current evidence. Refresh recorded source paths only in an explicit checkpoint after re-reading them.
7. Validate the acceptance criteria using real commands. Supply workspace-relative `evidencePaths` and concise `checks` when reporting completion. `reported_complete` means the agent reported completion; HyperSABMemory does not independently verify those claims. Resolve recorded contradictions and unsupported assumptions before relying on them.
8. Release a claim for controlled handoff, or let an abandoned lease expire. Another worker claims and restores the same durable task instead of recreating its scope from memory.

## Context budgets and evidence

- The task capsule is capped at 600 estimated tokens, independently of the existing 1,500-token context-header default. If essential state does not fit, shorten the supplied wording or use compact evidence references; do not discard acceptance criteria or critical constraints.
- Context recovery returns source paths, hashes, freshness, and unresolved issues. Read the referenced files on demand instead of dumping the codebase into every prompt.
- Explicit conflicts/assumptions are recorded by agents. Hash checks detect byte changes, including same-size rewrites; they do not prove that prose is semantically correct or that a test result is truthful.
- Coordination is local to this shared workspace. Existing IDEs run their own agents; HyperSABMemory supplies scope, ownership, and recovery state.
- Task ledger locks fail closed after a writer crash; confirm that no writer is active before manually recovering an abandoned lock.
