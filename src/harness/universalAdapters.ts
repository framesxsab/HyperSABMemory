/**
 * HyperMemory — Universal IDE Rule Adapter Generator
 * Auto-generates and synchronizes rules across Cursor, Claude Code, Windsurf, Copilot, and Antigravity.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface AdapterSyncResult {
  cursor: boolean;
  claude: boolean;
  windsurf: boolean;
  copilot: boolean;
  antigravity: boolean;
  createdFiles: string[];
}

export class UniversalAdaptersEngine {
  private workspaceDir: string;

  constructor(workspaceDir: string = process.cwd()) {
    this.workspaceDir = workspaceDir;
  }

  /**
   * Auto-generates rules files for all target IDE platforms in the workspace.
   */
  public syncAllAdapters(): AdapterSyncResult {
    const createdFiles: string[] = [];

    const basePrompt = `# HyperMemory AI Agent Harness Protocol
- **State Harness**: Keep context headers under 1500 tokens. Read Memory.md on session start.
- **Structural Knowledge**: Query Graphify (graph.json) before writing new modules. Re-use existing components.
- **Ponytail YAGNI**: Default to NO for unnecessary features. Use standard libraries. Write minimal code.
- **Auto-Commit Safety**: Work is auto-checkpointed every 3-5m under configured git author.
`;

    // 1. Cursor IDE (.cursor/rules/hypermemory.mdc)
    const cursorDir = path.join(this.workspaceDir, '.cursor', 'rules');
    fs.mkdirSync(cursorDir, { recursive: true });
    const cursorPath = path.join(cursorDir, 'hypermemory.mdc');
    fs.writeFileSync(cursorPath, `description: HyperMemory & Ponytail YAGNI agent rules\nglobs: "*"\n---\n${basePrompt}`, 'utf-8');
    createdFiles.push(cursorPath);

    // 2. Claude Code (.claude.json)
    const claudePath = path.join(this.workspaceDir, '.claude.json');
    if (!fs.existsSync(claudePath)) {
      fs.writeFileSync(claudePath, JSON.stringify({ instructions: basePrompt }, null, 2), 'utf-8');
      createdFiles.push(claudePath);
    }

    // 3. Windsurf (.windsurfrules)
    const windsurfPath = path.join(this.workspaceDir, '.windsurfrules');
    fs.writeFileSync(windsurfPath, basePrompt, 'utf-8');
    createdFiles.push(windsurfPath);

    // 4. GitHub Copilot (.github/copilot-instructions.md)
    const copilotDir = path.join(this.workspaceDir, '.github');
    fs.mkdirSync(copilotDir, { recursive: true });
    const copilotPath = path.join(copilotDir, 'copilot-instructions.md');
    fs.writeFileSync(copilotPath, basePrompt, 'utf-8');
    createdFiles.push(copilotPath);

    // 5. Antigravity / GSD (.agents/skills/hypermemory/SKILL.md)
    const antigravityDir = path.join(this.workspaceDir, '.agents', 'skills', 'hypermemory');
    fs.mkdirSync(antigravityDir, { recursive: true });
    const antigravityPath = path.join(antigravityDir, 'SKILL.md');
    fs.writeFileSync(antigravityPath, `---\nname: hypermemory\ndescription: Universal IDE Context Harness & Memory Engine\n---\n${basePrompt}`, 'utf-8');
    createdFiles.push(antigravityPath);

    return {
      cursor: true,
      claude: true,
      windsurf: true,
      copilot: true,
      antigravity: true,
      createdFiles
    };
  }
}
