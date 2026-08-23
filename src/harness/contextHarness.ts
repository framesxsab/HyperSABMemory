/**
 * HyperSABMemory — Context State Harness Engine
 * Formats terminal/IDE context state headers into rich, compressed prompts for AI agents.
 */

import { HashAnchorEngine } from './hashAnchor.js';
import { MinimalChangeEngine, type MinimalChangeIntensity } from './minimalChange.js';
import { TokenCompressor } from './tokenCompressor.js';
import { resolveGhostLine } from './ghostPaths.js';

export interface HarnessState {
  workspaceName: string;
  workspaceDir?: string;
  activeFile?: string;
  cursorLine?: number;
  cursorColumn?: number;
  gitBranch?: string;
  lastCommitHash?: string;
  lastCommitTime?: string;
  modifiedFiles: string[];
  recentDiff?: string;
  memorySummary?: string;
  contextBlock?: string;
  structuralGraphSummary?: string;
  tokenCeiling?: number;
  activeFileContent?: string;
  minimalChangeIntensity?: MinimalChangeIntensity;
}

export class ContextHarness {
  private tokenCeiling: number;
  private minimalChange: MinimalChangeEngine;

  constructor(tokenCeiling: number = 1500, minimalChangeIntensity: MinimalChangeIntensity = 'full') {
    this.tokenCeiling = tokenCeiling;
    this.minimalChange = new MinimalChangeEngine({ intensity: minimalChangeIntensity });
  }

  /**
   * Generates the structured context harness header for AI agent prompt injection.
   */
  public generateHeader(state: HarnessState): string {
    const intensity = state.minimalChangeIntensity;
    const rules = intensity
      ? new MinimalChangeEngine({ intensity })
      : this.minimalChange;

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
    const memorySection = state.contextBlock || state.memorySummary || 'Initialized';

    let hashline = '';
    if (state.activeFile && state.activeFileContent) {
      const lineCount = state.activeFileContent.split('\n').length;
      hashline = HashAnchorEngine.formatHashline(state.activeFile, state.activeFileContent, 1, lineCount);
    }

    const summarizedFocus = state.activeFileContent
      ? TokenCompressor.summarizeRead(state.activeFileContent, 16)
      : '';

    const ghostLine = resolveGhostLine({
      workspaceDir: state.workspaceDir,
      activeFile: state.activeFile,
      modifiedFiles: state.modifiedFiles
    });

    const rawHeader = `[HYPERSABMEMORY :: CONTEXT HARNESS]
┌─ Workspace: ${state.workspaceName} | Branch: ${branchStr} | Checkpoint: ${commitStr}
├─ Active Focus: ${activeFileStr}
├─ Hashline: ${hashline || 'n/a'}
├─ Modified Files: [${modifiedStr}]
├─ Structural Knowledge: ${state.structuralGraphSummary || 'Structural knowledge graph ready'}
├─ Temporal Memory: ${memorySection}
└─ Diff Snapshot:
${compactDiff}
${summarizedFocus ? `\n[SUMMARIZED READ]\n${summarizedFocus}\n` : ''}
${rules.generateMinimalChangeHeader()}

<STATE_FOCUS>
Ensure all edits maintain non-blocking execution, adhere to project Rules.md, and preserve persistent Memory.md state.
</STATE_FOCUS>${ghostLine ? `\n${ghostLine}` : ''}`;

    return TokenCompressor.compressText(rawHeader, this.tokenCeiling);
  }
}
