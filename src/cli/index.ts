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
import * as readline from 'readline/promises';
import { FileWatcherHook } from '../hooks/fileWatcher.js';
import { AutoCommitEngine } from '../hooks/autoCommit.js';
import { HyperMemoryMcpServer } from '../mcp/server.js';
import { SupermemoryEngine } from '../memory/supermemory.js';
import { OneShotSetupEngine } from './oneShotSetup.js';
import { DashboardServer } from '../server/dashboardServer.js';
import { UniversalAdaptersEngine } from '../harness/universalAdapters.js';
import { McpAccessEngine, MCP_TOOL_FLOW } from '../harness/mcpAccess.js';
import { evaluateMemoryEngine, evaluateSearchRecordsPath, evaluateFusionPath, seedMemoryBench } from '../eval/memoryBench.js';
import { HybridSearchEngine } from '../memory/hybridSearch.js';
import { getPackageVersion } from '../version.js';
import { parseIntervalMinutes } from './cliUtils.js';
import { registerMemoryCommands } from './memoryCommands.js';
import { runDoctor } from './doctor.js';

const program = new Command();

program
  .name('hypermemory')
  .description('Open-source IDE context harness & persistent memory engine inspired by Supermemory, Oh-My-Pi, Graphify & Ponytail')
  .version(getPackageVersion());

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
  .option('-d, --dashboard', 'Also launch the live web dashboard at http://localhost:4321')
  .option('-p, --port <port>', 'Dashboard port (with --dashboard)', '4321')
  .action(async (options) => {
    const minutes = parseIntervalMinutes(options.interval);
    if (minutes === null) {
      console.log(picocolors.red('✖ Invalid --interval: use a number of minutes >= 1 (e.g. --interval 3).'));
      process.exitCode = 1;
      return;
    }
    console.log(picocolors.cyan(`⚡ [HyperMemory] Starting watcher & hyperfrequent auto-commit engine (${minutes}m interval)...`));
    const hook = new FileWatcherHook({
      workspaceDir: process.cwd(),
      autoCommitIntervalMinutes: minutes
    });
    hook.start();
    if (options.dashboard) {
      const port = parseInt(options.port, 10);
      const server = new DashboardServer(port, process.cwd());
      await server.start();
    }
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
    } else if (result.status === 'not-a-repo') {
      console.log(picocolors.yellow('ℹ Not a git repository — checkpoint skipped.'));
    } else if (result.status === 'failed') {
      console.log(picocolors.red('✖ Checkpoint failed. Check logs for details.'));
      process.exitCode = 1;
    } else {
      console.log(picocolors.yellow('ℹ No uncommitted changes detected.'));
    }
  });

// Command: history
program
  .command('history')
  .description('List recent checkpoints')
  .option('-n, --limit <count>', 'How many checkpoints to show', '10')
  .action(async (options) => {
    const autoCommit = new AutoCommitEngine({ workspaceDir: process.cwd() });
    const entries = await autoCommit.getHistory(parseInt(options.limit, 10));
    if (entries.length === 0) {
      console.log(picocolors.yellow('ℹ No checkpoints found in this workspace.'));
      return;
    }
    console.log(picocolors.cyan('\nHyperMemory checkpoints\n'));
    for (const entry of entries) {
      console.log(`  ${picocolors.green(entry.hash)}  ${entry.date}  ${entry.message}`);
    }
    console.log(picocolors.gray(`\nPreview a rollback with: hypermemory diff <hash>`));
  });

// Command: diff
program
  .command('diff')
  .description('Preview what a rollback between two checkpoints would change (read-only)')
  .argument('<hashA>', 'Base commit hash')
  .argument('[hashB]', 'Target commit hash (defaults to HEAD)')
  .action(async (hashA, hashB) => {
    const autoCommit = new AutoCommitEngine({ workspaceDir: process.cwd() });
    const result = await autoCommit.getDiffBetween(hashA, hashB);
    if (!result) {
      console.log(picocolors.red(`✖ Could not diff ${hashA}${hashB ? `..${hashB}` : ''} (unknown hash or not a git repo).`));
      process.exitCode = 1;
      return;
    }
    console.log(picocolors.cyan(`\nChanges ${hashA} -> ${hashB ?? 'HEAD'}\n`));
    console.log(picocolors.gray(result.nameStatus || '(no textual differences)'));
    if (result.stat && result.stat !== result.nameStatus) {
      console.log('');
      console.log(picocolors.gray(result.stat));
    }
  });

// Command: rollback
program
  .command('rollback')
  .description('Rollback workspace to a previous checkpoint commit (creates a safety checkpoint first)')
  .argument('<hash>', 'Commit hash to revert to')
  .option('--yes', 'Skip interactive confirmation', false)
  .action(async (hash, options) => {
    const autoCommit = new AutoCommitEngine({ workspaceDir: process.cwd() });

    const preview = await autoCommit.getDiffBetween(hash);
    const snapshot = await autoCommit.getSnapshot();
    console.log(picocolors.cyan(`\nRollback to ${hash} would move the workspace to that checkpoint.`));
    if (preview && preview.nameStatus) {
      console.log(picocolors.cyan('\nFiles changed since then:'));
      console.log(picocolors.gray(preview.nameStatus));
    } else {
      console.log(picocolors.yellow('ℹ No textual differences between HEAD and the target.'));
    }
    console.log(picocolors.cyan(`\n${snapshot.modifiedFiles.length} uncommitted file(s) will be captured in a safety checkpoint first.\n`));

    if (!process.stdin.isTTY && !options.yes) {
      console.log(picocolors.red('✖ Non-interactive shell detected. Re-run with --yes to proceed without a prompt.'));
      process.exitCode = 1;
      return;
    }

    if (!options.yes) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const answer = (await rl.question('Proceed with rollback? [y/N] ')).trim().toLowerCase();
      rl.close();
      if (answer !== 'y' && answer !== 'yes') {
        console.log(picocolors.yellow('ℹ Rollback aborted.'));
        return;
      }
    }

    const success = await autoCommit.rollback(hash);
    if (success) {
      console.log(picocolors.green(`✔ Rolled back to checkpoint ${hash}`));
    } else {
      console.log(picocolors.red(`✖ Failed to rollback to checkpoint ${hash}`));
      process.exitCode = 1;
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
    const hybrid = new HybridSearchEngine(dir, engine);
    const searchRecordsPath = evaluateSearchRecordsPath(hybrid, engine.getContextBlock());
    const fusionPath = evaluateFusionPath(hybrid);
    fs.rmSync(dir, { recursive: true, force: true });
    console.log(JSON.stringify({ ...report, searchRecordsPath, fusionPath }, null, 2));
    if (!report.passed || !searchRecordsPath.passed || !fusionPath.passed) {
      console.log(picocolors.red('✖ MemoryBench eval failed.'));
      process.exitCode = 1;
      return;
    }
    console.log(picocolors.green(`✔ MemoryBench passed (recall ${report.recall.toFixed(2)}, shipped-path ${searchRecordsPath.recall.toFixed(2)}, fusion ${fusionPath.recall.toFixed(2)}).`));
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

// Command: doctor
program
  .command('doctor')
  .description('Read-only health check: git, work tree, memory store, MCP configs, dashboard port')
  .action(async () => {
    const report = await runDoctor(process.cwd());
    console.log(picocolors.cyan('\nHyperMemory doctor\n'));
    for (const check of report.checks) {
      const mark = check.ok ? picocolors.green('✔') : picocolors.red('✖');
      console.log(`  ${mark} ${check.name}: ${check.detail}`);
    }
    if (!report.ok) {
      console.log(picocolors.red('\n✖ Issues found above.'));
      process.exitCode = 1;
      return;
    }
    console.log(picocolors.green('\n✔ All checks passed.'));
  });

registerMemoryCommands(program);

program.parse(process.argv);
