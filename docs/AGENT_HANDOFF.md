# Opt-in project handoff for coding agents

Install and connect the existing HyperSABMemory MCP server. Run `hypersabmemory doctor` from the project and enable the server in your client. For an opt-in project policy, copy the block below into your project agent instructions. Keep the policy scoped to the project. Setup does not install this handoff policy.

<!-- handoff-start -->
## Project handoff

When a request resumes unfinished work or depends on a previous project decision, check available project handoff context before making changes. If the HyperSABMemory MCP server is available, call `hypersabmemory_task_context` with `{"compact": true}` (or `{}`) first: it automatically restores the sole active task's checkpoint, next action, source-verified decisions and linked constraints, task-linked memories, and source hashes in one call without reading `.hypersabmemory/tasks.json`. If multiple tasks are active, inspect the Active Tasks resource (`hypersabmemory://tasks`) or pass a `taskId`. Use `hypersabmemory_query_evidence` only when an extra project-wide search is needed.

Use the current source and tests to verify any recovered context. Treat stale or unverified entries as leads. If the server or a matching task is unavailable, continue with the repository and its history.
<!-- handoff-end -->

In clients that surface tools but lack MCP resource browsing, provide the task ID when handing off. Use the same workspace directory for the server and the agent. A handoff can be used with only the task-context and evidence-query tools enabled.
