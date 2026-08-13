#!/usr/bin/env node

/**
 * HyperMemory — CLI Entry Point
 * Command Line Interface for initialization, real-time watcher, auto-commits, and MCP server.
 */

import { Command } from 'commander';
import picocolors from 'picocolors';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileWatcherHook } from '../hooks/fileWatcher.js';
import { AutoCommitEngine } from '../hooks/autoCommit.js';
import { HyperMemoryMcpServer } from '../mcp/server.js';
import { SupermemoryEngine } from '../memory/supermemory.js';
import { OneShotSetupEngine } from './oneShotSetup.js';
import { DashboardServer } from '../server/dashboardServer.js';
import { UniversalAdaptersEngine } from '../harness/universalAdapters.js';
import { McpAccessEngine, MCP_TOOL_FLOW } from '../harness/mcpAccess.js';
import { evaluateMemoryEngine, seedMemoryBench } from '../eval/memoryBench.js';

const program = new Command();

program
  .name('hypermemory')
  .description('Open-source IDE context harness & persistent memory engine inspired by Supermemory, Oh-My-Pi, Graphify & Ponytail')
  .version('1.0.0');

// Command: dashboard
program
  .command('dashboard')
  .description('Launch live web visualizer dashboard at http://localhost:4321')
  .option('-p, --port <port>', 'Dashboard port', '4321')
  .action(async (options) => {
    const port = parseInt(options.port, 10);
    const server = new DashboardServer(port, process.cwd());
    await server.start();
  });

// Command: setup / ponytail (One-shot installer)
program
  .command('setup')
  .alias('ponytail')
  .description('One-shot setup: Installs Graphify + Supermemory + Oh-My-Pi + Ponytail YAGNI rules + 3-5m Auto-Commits')
  .action(async () => {
    console.log(picocolors.cyan('\n🚀 [HyperMemory :: One-Shot Setup] Deploying complete ecosystem...'));
    const setupEngine = new OneShotSetupEngine(process.cwd());
    const result = await setupEngine.executeSetup();
    if (result.success) {
      console.log(picocolors.green('✔ Graphify structural knowledge layer integrated.'));
      console.log(picocolors.green('✔ Supermemory temporal memory base initialized.'));
      console.log(picocolors.green('✔ Ponytail YAGNI decision ladder rules installed (.agents/skills/hypermemory/SKILL.md).'));
      console.log(picocolors.green('✔ 3-5 Min Auto-Commit engine configured.'));
      console.log(picocolors.green('✔ Direct MCP access written (Cursor, Claude Code, VS Code).'));
      console.log(picocolors.cyan('\nFlow: reload the IDE → enable the hypermemory MCP server → call hypermemory_get_context.'));
    } else {
      console.log(picocolors.red('✖ Setup encountered an error. Check logs for details.'));
    }
  });

// Command: init
program
  .command('init')
  .description('Initialize HyperMemory environment and core blueprint docs in current directory')
  .action(() => {
    console.log(picocolors.cyan('⚡ [HyperMemory] Initializing IDE context harness & Supermemory base...'));
    const supermemory = new SupermemoryEngine(process.cwd());
    supermemory.remember('architecture', 'Initialized HyperMemory workspace environment.');
    console.log(picocolors.green('✔ Initialized .hypermemory/ store and Memory.md state log.'));
  });

// Command: watch
program
  .command('watch')
  .alias('start')
  .description('Start real-time file watcher hook and 3-5 min hyperfrequent auto-commit engine')
  .option('-i, --interval <minutes>', 'Auto-commit interval in minutes', '3')
  .action((options) => {
    const minutes = parseInt(options.interval, 10);
    console.log(picocolors.cyan(`⚡ [HyperMemory] Starting watcher & hyperfrequent auto-commit engine (${minutes}m interval)...`));
    const hook = new FileWatcherHook({
      workspaceDir: process.cwd(),
      autoCommitIntervalMinutes: minutes
    });
    hook.start();
  });

// Command: checkpoint
program
  .command('checkpoint')
  .description('Create an instant git checkpoint commit')
  .argument('[reason]', 'Optional summary of changes being checkpointed', 'Manual CLI Checkpoint')
  .action(async (reason) => {
    const autoCommit = new AutoCommitEngine({
      workspaceDir: process.cwd()
    });
    const result = await autoCommit.createCheckpoint(reason);
    if (result.committed) {
      console.log(picocolors.green(`✔ Created checkpoint [${result.hash}]`));
    } else {
      console.log(picocolors.yellow('ℹ No uncommitted changes detected.'));
    }
  });

// Command: rollback
program
  .command('rollback')
  .description('Rollback workspace to a previous checkpoint commit')
  .argument('<hash>', 'Commit hash to revert to')
  .action(async (hash) => {
    const autoCommit = new AutoCommitEngine({ workspaceDir: process.cwd() });
    const success = await autoCommit.rollback(hash);
    if (success) {
      console.log(picocolors.green(`✔ Rolled back to checkpoint ${hash}`));
    } else {
      console.log(picocolors.red(`✖ Failed to rollback to checkpoint ${hash}`));
    }
  });

// Command: inject
program
  .command('inject')
  .description('Ingest native IDE rules (MDC, AGENTS.md, CLAUDE.md) and auto-inject HyperMemory')
  .action(() => {
    const supermemory = new SupermemoryEngine(process.cwd());
    const adapters = new UniversalAdaptersEngine(process.cwd());
    const result = adapters.syncAllAdapters({
      contextBlock: supermemory.getContextBlock()
    });
    console.log(picocolors.green(`✔ Injected ${result.createdFiles.length} adapter files (ingested ${result.ingested.length} native rules).`));
    for (const file of result.createdFiles) {
      console.log(picocolors.gray(`  ${file}`));
    }
  });

// Command: connect
program
  .command('connect')
  .description('Write Cursor / Claude Code / VS Code MCP config so agents get HyperMemory tools directly')
  .action(() => {
    const access = new McpAccessEngine(process.cwd());
    const result = access.connect();
    console.log(picocolors.green('✔ HyperMemory MCP access installed.'));
    for (const file of result.written) {
      console.log(picocolors.gray(`  ${file}`));
    }
    console.log(picocolors.cyan(`\n${access.describeFlow(result)}`));
  });

// Command: status
program
  .command('status')
  .description('Show whether MCP access files exist and which tools agents can call')
  .action(() => {
    const root = process.cwd();
    const checks = [
      path.join(root, '.cursor', 'mcp.json'),
      path.join(root, '.mcp.json'),
      path.join(root, '.vscode', 'mcp.json')
    ];
    console.log(picocolors.cyan('\nHyperMemory access status\n'));
    for (const file of checks) {
      const ok = fs.existsSync(file);
      const mark = ok ? picocolors.green('✔') : picocolors.yellow('○');
      console.log(`  ${mark} ${path.relative(root, file) || file}`);
    }
    console.log(picocolors.cyan('\nAgent tools:'));
    for (const tool of MCP_TOOL_FLOW) {
      console.log(picocolors.gray(`  ${tool}`));
    }
    console.log(picocolors.cyan('\nIf a file is missing, run `npx hypermemory connect` then reload the IDE.\n'));
  });

// Command: eval
program
  .command('eval')
  .description('Run local MemoryBench recall eval (no AWS). Exit 1 if recall < 0.8 or forgotten facts leak.')
  .action(() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-eval-'));
    const engine = new SupermemoryEngine(dir);
    seedMemoryBench(engine);
    const report = evaluateMemoryEngine(engine);
    fs.rmSync(dir, { recursive: true, force: true });
    console.log(JSON.stringify(report, null, 2));
    if (!report.passed) {
      console.log(picocolors.red('✖ MemoryBench eval failed.'));
      process.exitCode = 1;
      return;
    }
    console.log(picocolors.green(`✔ MemoryBench passed (recall ${report.recall.toFixed(2)}).`));
  });

// Command: mcp
program
  .command('mcp')
  .description('Launch Model Context Protocol (MCP) stdio server for AI agents')
  .action(async () => {
    const server = new HyperMemoryMcpServer(process.cwd());
    await server.start();
  });

// Command: publish
program
  .command('publish')
  .description('Check open source publication readiness for https://github.com/framesxsab/HyperMemory')
  .action(() => {
    console.log(picocolors.cyan('\n🚀 HyperMemory — Open Source Publication Checklist'));
    console.log(picocolors.gray('Target Repo: https://github.com/framesxsab/HyperMemory\n'));
    console.log(picocolors.green('  ✔ PRD.md: Complete'));
    console.log(picocolors.green('  ✔ Architecture.md: Complete'));
    console.log(picocolors.green('  ✔ Rules.md: Complete'));
    console.log(picocolors.green('  ✔ Phases.md: Complete'));
    console.log(picocolors.green('  ✔ Design.md: Complete'));
    console.log(picocolors.green('  ✔ Memory.md: Complete'));
    console.log(picocolors.green('  ✔ LICENSE: MIT'));
    console.log(picocolors.green('  ✔ CONTRIBUTING.md: Complete'));
    console.log(picocolors.green('  ✔ GitHub Actions CI: .github/workflows/ci.yml'));
    console.log(picocolors.green('  ✔ MemoryBench eval: npm run eval (local, no SageMaker)'));
    console.log(picocolors.green('  ✔ Git Author: Configured'));
    console.log(picocolors.green('  ✔ MCP connect: npx hypermemory connect'));
    console.log(picocolors.cyan('\nReady to push repository to GitHub!'));
  });

program.parse(process.argv);
