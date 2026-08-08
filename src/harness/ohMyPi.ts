/**
 * HyperMemory — Oh-My-Pi State Harness Engine
 * Formats terminal/IDE context state headers into rich, compressed prompts for AI agents.
 */

import { TokenCompressor } from './tokenCompressor.js';

export interface HarnessState {
  workspaceName: string;
  activeFile?: string;
  cursorLine?: number;
  cursorColumn?: number;
  gitBranch?: string;
  lastCommitHash?: string;
  lastCommitTime?: string;
  modifiedFiles: string[];
  recentDiff?: string;
  memorySummary?: string;
  graphifySummary?: string;
  tokenCeiling?: number;
}

export class OhMyPiHarness {
  private tokenCeiling: number;

  constructor(tokenCeiling: number = 1500) {
    this.tokenCeiling = tokenCeiling;
  }

  /**
   * Generates the structured Oh-My-Pi context header for AI agent prompt injection.
   */
  public generateHeader(state: HarnessState): string {
    const activeFileStr = state.activeFile
      ? `${state.activeFile}${state.cursorLine ? ` (L${state.cursorLine}:C${state.cursorColumn || 1})` : ''}`
      : 'None';
    
    const branchStr = state.gitBranch || 'main';
    const commitStr = state.lastCommitHash
      ? `${state.lastCommitHash.slice(0, 7)} (${state.lastCommitTime || 'recent'})`
      : 'Initial';

    const modifiedStr = state.modifiedFiles.length > 0
      ? state.modifiedFiles.slice(0, 5).join(', ') + (state.modifiedFiles.length > 5 ? ` +${state.modifiedFiles.length - 5} more` : '')
      : 'Clean';

    const compactDiff = TokenCompressor.formatCompactDiff(state.recentDiff || '', 10);

    const rawHeader = `⚡ [HYPERMEMORY :: OH-MY-PI + PONYTAIL HARNESS]
┌─ Workspace: ${state.workspaceName} | Branch: ${branchStr} | Checkpoint: ${commitStr}
├─ Active Focus: ${activeFileStr}
├─ Modified Files: [${modifiedStr}]
├─ Structural Knowledge: ${state.graphifySummary || 'Graphify Ready'}
├─ Temporal Memory: ${state.memorySummary || 'Initialized'}
└─ Diff Snapshot:
${compactDiff}

🎯 [PONYTAIL YAGNI DECISION LADDER]
1. Does this feature need to exist at all? (Default NO unless requested)
2. Re-use existing Graphify codebase components first.
3. Use standard libraries — zero unnecessary dependencies.
4. Write minimum working code. Zero fluff, zero over-engineering.

<STATE_FOCUS>
Ensure all edits maintain non-blocking execution, adhere to project Rules.md, and preserve persistent Memory.md state.
</STATE_FOCUS>`;

    // Compress to guarantee budget compliance
    return TokenCompressor.compressText(rawHeader, this.tokenCeiling);
  }
}
