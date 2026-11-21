# Opt-in project handoff for coding agents

Install and connect the existing HyperSABMemory MCP server. Run `hypersabmemory doctor` from the project and enable the server in your client. For an opt-in project policy, copy the block below into your project agent instructions. Keep the policy scoped to the project. Setup does not install this handoff policy.

<!-- handoff-start -->
## Project handoff

When a request resumes unfinished work or depends on a previous project decision, check available project handoff context before making changes. If the HyperSABMemory MCP server is available, its Active Tasks resource (hypersabmemory://tasks) lists task IDs. The task-context tool restores a known task's checkpoint and next action. The evidence-query tool finds recorded decisions, rationale, and source citations for a project question.

Use the current source and tests to verify any recovered context. Treat stale or unverified entries as leads. If the server or a matching task is unavailable, continue with the repository and its history.
<!-- handoff-end -->

In clients that surface tools but lack MCP resource browsing, provide the task ID when handing off. Use the same workspace directory for the server and the agent. A handoff can be used with only the task-context and evidence-query tools enabled.
