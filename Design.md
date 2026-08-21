# HyperSABMemory — Visual & Prompt Design Guidelines

## 1. context-harness Prompt Harness Aesthetics

HyperSABMemory formats dynamic context headers for AI IDE agents inspired by terminal statusbars (like Oh-My-Posh).

### Context Header Output Structure

```
⚡ [HYPERSABMEMORY :: CONTEXT HARNESS] v1.0.0
┌─ Workspace: hypersabmemory | Branch: main | Checkpoint: 3m ago (a7f2d9)
├─ Active Focus: src/harness/ohMyPi.ts (L42-C15)
├─ Modified Files: [src/hooks/fileWatcher.ts (+12/-3), Memory.md (+5/-1)]
├─ Temporal Memory Store: 14 indexed symbols | 3 active architectural goals
└─ Token Usage: 340 / 1500 tokens (Compact Mode)

<CONTEXT_SUMMARY>
Active Task: Building context-harness state harness formatter.
Last Action: Updated file watcher hook to trigger auto-commits every 3-5 minutes.
Key Requirement: Maintain non-blocking local state persistence.
</CONTEXT_SUMMARY>
```

---

## 2. Color Palette & UI Tokens (Web Dashboard & Extension)

For web components, dashboard views, and IDE extension panels, HyperSABMemory uses a high-contrast dark aesthetic:

- **Deep Space Background**: `#0B0F19`
- **Surface Elevation**: `#161C2E`
- **Electric Cyan (Focus/Active)**: `#00F0FF`
- **Quantum Purple (Temporal Memory Store)**: `#8A2BE2`
- **Neon Green (Auto-Commit/Sync Status)**: `#00FF66`
- **Warning Amber**: `#FFB800`
- **Muted Slate Text**: `#94A3B8`

---

## 3. Typography & Badges

- **Code / Monospace**: Fira Code, JetBrains Mono, or system monospace.
- **UI Font**: Inter, system-ui, sans-serif.
- **Badges**:
  - `[SYNCED]` — Neon Green pill `#00FF66`
  - `[COMMIT :: 3m]` — Cyan outline `#00F0FF`
  - `[MEMORY INDEXED]` — Quantum Purple background `#8A2BE2`
