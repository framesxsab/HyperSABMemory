# HyperMemory — Visual & Prompt Design Guidelines

## 1. Oh-My-Pi Prompt Harness Aesthetics

HyperMemory formats dynamic context headers for AI IDE agents inspired by terminal statusbars (like Oh-My-Posh / Oh-My-Pi).

### Context Header Output Structure

```
⚡ [HYPERMEMORY :: OH-MY-PI HARNESS] v1.0.0
┌─ Workspace: hypermemory | Branch: main | Checkpoint: 3m ago (a7f2d9)
├─ Active Focus: src/harness/ohMyPi.ts (L42-C15)
├─ Modified Files: [src/hooks/fileWatcher.ts (+12/-3), Memory.md (+5/-1)]
├─ Supermemory Base: 14 indexed symbols | 3 active architectural goals
└─ Token Usage: 340 / 1500 tokens (Compact Mode)

<CONTEXT_SUMMARY>
Active Task: Building Oh-My-Pi state harness formatter.
Last Action: Updated file watcher hook to trigger auto-commits every 3-5 minutes.
Key Requirement: Maintain non-blocking local state persistence.
</CONTEXT_SUMMARY>
```

---

## 2. Color Palette & UI Tokens (Web Dashboard & Extension)

For web components, dashboard views, and IDE extension panels, HyperMemory uses a high-contrast dark aesthetic:

- **Deep Space Background**: `#0B0F19`
- **Surface Elevation**: `#161C2E`
- **Electric Cyan (Focus/Active)**: `#00F0FF`
- **Quantum Purple (Supermemory Base)**: `#8A2BE2`
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
