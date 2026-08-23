import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { setupNextStepsFlow } from '../src/cli/setupOutput.js';

describe('HyperSABMemory — setup success next-steps flow (H4)', () => {
  it('renders the per-host enable steps including the Cursor host mention', () => {
    const flow = setupNextStepsFlow(process.cwd());

    expect(flow).toContain('Direct access is wired');
    expect(flow).toContain('Cursor (.cursor/mcp.json)');
    expect(flow).toContain('Claude Code (.mcp.json)');
    expect(flow).toContain('VS Code (.vscode/mcp.json)');
  });

  it('is wired into the setup command success output', () => {
    const cliSource = fs.readFileSync(
      path.resolve(process.cwd(), 'src', 'cli', 'index.ts'),
      'utf-8'
    );
    const setupSection = cliSource.split('// Command: setup')[1]?.split('// Command:')[0] ?? '';
    expect(setupSection).toContain('setupNextStepsFlow');
  });
});
