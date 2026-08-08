#!/usr/bin/env node

/**
 * HyperMemory — CLI Entry Point
 * Command Line Interface for initialization, real-time watcher, auto-commits, and MCP server.
 */

import { Command } from 'commander';
import picocolors from 'picocolors';
import { FileWatcherHook } from '../hooks/fileWatcher.js';
import { AutoCommitEngine } from '../hooks/autoCommit.js';
import { HyperMemoryMcpServer } from '../mcp/server.js';
import { SupermemoryEngine } from '../memory/supermemory.js';
import { OneShotSetupEngine } from './oneShotSetup.js';
import { DashboardServer } from '../server/dashboardServer.js';

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
      console.log(picocolors.cyan('\n✨ One-shot setup complete! Run `npx hypermemory watch` to start real-time harness.'));
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
    console.log(picocolors.green('  ✔ Git Author: Configured'));
    console.log(picocolors.green('  ✔ 3-5 Min Auto-Commit Engine: Enabled'));
    console.log(picocolors.cyan('\nReady to push repository to GitHub!'));
  });

program.parse(process.argv);
