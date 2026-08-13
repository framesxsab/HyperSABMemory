/**
 * HyperMemory — Oh-My-Pi State Harness Engine
 * Formats terminal/IDE context state headers into rich, compressed prompts for AI agents.
 */

import { HashAnchorEngine } from './hashAnchor.js';
import { PonytailEngine, type PonytailIntensity } from './ponytail.js';
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
  contextBlock?: string;
  graphifySummary?: string;
  tokenCeiling?: number;
  activeFileContent?: string;
  ponytailIntensity?: PonytailIntensity;
}

export class OhMyPiHarness {
  private tokenCeiling: number;
  private ponytail: PonytailEngine;

  constructor(tokenCeiling: number = 1500, ponytailIntensity: PonytailIntensity = 'full') {
    this.tokenCeiling = tokenCeiling;
    this.ponytail = new PonytailEngine({ intensity: ponytailIntensity });
  }

  /**
   * Generates the structured Oh-My-Pi context header for AI agent prompt injection.
   */
  public generateHeader(state: HarnessState): string {
    const intensity = state.ponytailIntensity;
    const ponytail = intensity
      ? new PonytailEngine({ intensity })
      : this.ponytail;

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

    const rawHeader = `⚡ [HYPERMEMORY :: OH-MY-PI + PONYTAIL HARNESS]
┌─ Workspace: ${state.workspaceName} | Branch: ${branchStr} | Checkpoint: ${commitStr}
├─ Active Focus: ${activeFileStr}
├─ Hashline: ${hashline || 'n/a'}
├─ Modified Files: [${modifiedStr}]
├─ Structural Knowledge: ${state.graphifySummary || 'Graphify Ready'}
├─ Temporal Memory: ${memorySection}
└─ Diff Snapshot:
${compactDiff}
${summarizedFocus ? `\n[SUMMARIZED READ]\n${summarizedFocus}\n` : ''}
${ponytail.generatePonytailHeader()}

<STATE_FOCUS>
Ensure all edits maintain non-blocking execution, adhere to project Rules.md, and preserve persistent Memory.md state.
</STATE_FOCUS>`;

    return TokenCompressor.compressText(rawHeader, this.tokenCeiling);
  }
}
