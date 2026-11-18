# HyperSABMemory Design Guidelines

## Grounded multi-source answer shape

Render each atomic claim with its exact source path, line, and current SHA-256. Render cross-file relationships separately with the source-reference line that establishes the link. Keep direct source recording distinct from semantic truth, and state that implementation compliance was not checked.

The same claim and citation representation is returned by general grounded search and the evidence MCP tool. A recorded statement supports only that the source records it; a task role or runtime behavior needs its own verifier.

## Context header

Keep the always-on header compact and scannable. Its current sections are workspace/branch/checkpoint, active focus, hashline, modified files, structural knowledge, temporal memory, and diff snapshot.

```text
[HYPERSABMEMORY :: CONTEXT HARNESS]
Workspace: hypersabmemory | Branch: main | Checkpoint: <hash or Initial>
Active Focus: src/memory/temporalMemory.ts
Hashline: n/a
Modified Files: [src/memory/sqliteStore.ts]
Structural Knowledge: graph.json source status
Temporal Memory: [CONTEXT BLOCK]
Diff Snapshot: <compact diff or No uncommitted changes>

<STATE_FOCUS>
Preserve workspace state and follow the repository rules.
</STATE_FOCUS>
```

The default budget is 1,500 estimated tokens using a four-characters-per-token heuristic. Keep the cap until a measured, model-tokenizer-aware change demonstrates value.

## Dashboard palette

- **Deep Space Background**: `#0B0F19`
- **Surface Elevation**: `#161C2E`
- **Electric Cyan (Focus/Active)**: `#00F0FF`
- **Quantum Purple (Temporal Memory)**: `#8A2BE2`
- **Neon Green (Auto-Commit/Sync Status)**: `#00FF66`
- **Warning Amber**: `#FFB800`
- **Muted Slate Text**: `#94A3B8`

## Typography and status labels

- **Code / Monospace**: Fira Code, JetBrains Mono, or system monospace.
- **UI Font**: Inter, system-ui, sans-serif.
- `[SYNCED]` uses the sync green; `[COMMIT]` uses the active cyan; `[MEMORY INDEXED]` uses the memory purple.
