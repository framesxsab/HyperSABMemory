#!/usr/bin/env node

/**
 * HyperSABMemory — CLI Entry Point
 * Command Line Interface for initialization, real-time watcher, auto-commits, and MCP server.
 */

import { Command } from 'commander';
import picocolors from 'picocolors';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { FileWatcherHook } from '../hooks/fileWatcher.js';
import { AutoCommitEngine } from '../hooks/autoCommit.js';
import { HyperSABMemoryMcpServer } from '../mcp/server.js';
import { TemporalMemoryEngine } from '../memory/temporalMemory.js';
import { OneShotSetupEngine, printSetupOutcome } from './oneShotSetup.js';
import { DashboardServer } from '../server/dashboardServer.js';
import { UniversalAdaptersEngine } from '../harness/universalAdapters.js';
import { McpAccessEngine, MCP_TOOL_FLOW } from '../harness/mcpAccess.js';
import { getPackageVersion } from '../version.js';
import { parseIntervalMinutes } from './cliUtils.js';
import { registerMemoryCommands } from './memoryCommands.js';
import { runDoctor } from './doctor.js';
import { runEvalCommand } from './evalCommand.js';
import { buildHandoffBrief } from './handoffCommand.js';
import { removeInjection } from './removeCommand.js';
import { setupNextStepsFlow } from './setupOutput.js';

const execFileAsync = promisify(execFile);

// Official semver grammar (semver.org appendix), anchored both ends.
const STRICT_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

function newestMtimeMs(dir: string): number {
  let newest = 0;
  const visit = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        visit(full);
      } else if (entry.isFile()) {
        const mtimeMs = fs.statSync(full).mtimeMs;
        if (mtimeMs > newest) newest = mtimeMs;
      }
    }
  };
  visit(dir);
  return newest;
}

const program = new Command();

program
  .name('hypersabmemory')
  .description('Open-source IDE context harness & persistent memory engine')
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

// Command: setup (One-shot installer)
program
  .command('setup')
  .description('One-shot setup: Installs IDE adapters, local memory, MCP access, and project context')
  .option('--checkpoint', 'Create an initial local Git checkpoint during setup')
  .option('--inject-tracked', 'Allow injecting HyperSABMemory sections into Git-tracked instruction files', false)
  .action(async (options) => {
    console.log(picocolors.cyan('\n[HyperSABMemory :: One-Shot Setup] Deploying complete ecosystem...'));
    const setupEngine = new OneShotSetupEngine(process.cwd());
    const result = await setupEngine.executeSetup({
      checkpoint: options.checkpoint === true,
      injectTracked: options.injectTracked === true
    });
    printSetupOutcome(result);
    if (result.success) {
      console.log(picocolors.cyan(`\n${setupNextStepsFlow(process.cwd())}`));
    }
  });

// Command: init
program
  .command('init')
  .description('Initialize HyperSABMemory environment and core blueprint docs in current directory')
  .action(() => {
    console.log(picocolors.cyan('[HyperSABMemory] Initializing IDE context harness & temporal memory store...'));
    const engine = new TemporalMemoryEngine(process.cwd());
    engine.remember('architecture', 'Initialized HyperSABMemory workspace environment.');
    console.log(picocolors.green('✔ Initialized .hypersabmemory/ store and Memory.md state log.'));
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
    console.log(picocolors.cyan(`[HyperSABMemory] Starting watcher & hyperfrequent auto-commit engine (${minutes}m interval)...`));
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
    console.log(picocolors.cyan('\nHyperSABMemory checkpoints\n'));
    for (const entry of entries) {
      console.log(`  ${picocolors.green(entry.hash)}  ${entry.date}  ${entry.message}`);
    }
    console.log(picocolors.gray(`\nPreview a rollback with: hypersabmemory diff <hash>`));
  });

// Command: handoff
program
  .command('handoff')
  .description('Print a paste-ready forward handoff brief (--story for a ledger-only retrospective)')
  .option('--story', 'Deterministic captain\'s-log retrospective built purely from local ledgers', false)
  .action(async (options) => {
    const brief = await buildHandoffBrief(process.cwd(), { story: options.story === true });
    console.log(brief);
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
  .description('Ingest native IDE rules (MDC, AGENTS.md, CLAUDE.md) and safely sync HyperSABMemory')
  .option('--inject-tracked', 'Allow injecting HyperSABMemory sections into Git-tracked instruction files', false)
  .action((options) => {
    const engine = new TemporalMemoryEngine(process.cwd());
    const adapters = new UniversalAdaptersEngine(process.cwd());
    const result = adapters.syncAllAdapters({
      contextBlock: engine.getContextBlock(),
      preserveTrackedFiles: options.injectTracked !== true
    });
    console.log(picocolors.green(`✔ Injected ${result.createdFiles.length} adapter files (ingested ${result.ingested.length} native rules).`));
    for (const file of result.createdFiles) {
      console.log(picocolors.gray(`  ${file}`));
    }
    if (result.skippedTrackedFiles.length > 0) {
      console.log(picocolors.yellow(`ℹ Preserved tracked files: ${result.skippedTrackedFiles.join(', ')} (pass --inject-tracked to opt in).`));
    }
  });

// Command: connect
program
  .command('connect')
  .description('Write Cursor / Claude Code / VS Code MCP config so agents get HyperSABMemory tools directly')
  .action(() => {
    const access = new McpAccessEngine(process.cwd());
    const result = access.connect();
    console.log(picocolors.green('✔ HyperSABMemory MCP access installed.'));
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
    console.log(picocolors.cyan('\nHyperSABMemory access status\n'));
    for (const file of checks) {
      const ok = fs.existsSync(file);
      const mark = ok ? picocolors.green('✔') : picocolors.yellow('○');
      console.log(`  ${mark} ${path.relative(root, file) || file}`);
    }
    console.log(picocolors.cyan('\nAgent tools:'));
    for (const tool of MCP_TOOL_FLOW) {
      console.log(picocolors.gray(`  ${tool}`));
    }
    console.log(picocolors.cyan('\nIf a file is missing, run `npx hypersabmemory connect` then reload the IDE.\n'));
  });

// Command: eval
program
  .command('eval')
  .description('Run local MemoryBench recall eval (no AWS). Exit 1 if recall < 0.8 or forgotten facts leak.')
  .option('--json', 'Print machine-readable benchmark report + token-efficiency JSON', false)
  .action((options: { json?: boolean }) => {
    runEvalCommand({ json: options.json });
  });

// Command: mcp
program
  .command('mcp')
  .description('Launch Model Context Protocol (MCP) stdio server for AI agents')
  .action(async () => {
    const server = new HyperSABMemoryMcpServer(process.cwd());
    await server.start();
  });

// Command: publish
program
  .command('publish')
  .description('Check open source publication readiness for https://github.com/framesxsab/HyperSABMemory')
  .action(async () => {
    console.log(picocolors.cyan('\nHyperSABMemory — Publication Readiness Checklist'));
    console.log(picocolors.gray('Target Repo: https://github.com/framesxsab/HyperSABMemory\n'));

    let hardFailures = 0;
    const reportCheck = (ok: boolean, label: string, detail: string): void => {
      const mark = ok ? picocolors.green('✔') : picocolors.red('✘');
      console.log(`  ${mark} ${label}: ${detail}`);
      if (!ok) hardFailures += 1;
    };

    // Check 1: git working tree clean
    let treeClean = false;
    let treeDetail: string;
    try {
      const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd: process.cwd() });
      treeClean = stdout.trim().length === 0;
      treeDetail = treeClean ? 'clean' : `${stdout.trim().split('\n').length} uncommitted file(s)`;
    } catch {
      treeDetail = 'not a git repository or git unavailable';
    }
    reportCheck(treeClean, 'Git working tree', treeDetail);

    // Check 2: dist/ exists and is at least as new as src/
    const distDir = path.join(process.cwd(), 'dist');
    const srcDir = path.join(process.cwd(), 'src');
    let distFresh = false;
    let distDetail: string;
    if (!fs.existsSync(distDir)) {
      distDetail = 'dist/ missing — run `npm run build`';
    } else {
      const distNewest = newestMtimeMs(distDir);
      const srcNewest = fs.existsSync(srcDir) ? newestMtimeMs(srcDir) : 0;
      distFresh = distNewest >= srcNewest;
      distDetail = distFresh ? 'dist/ is up to date with src/' : 'dist/ is stale — run `npm run build`';
    }
    reportCheck(distFresh, 'Build output', distDetail);

    // Check 3: package.json version parses as strict semver
    let versionOk = false;
    let versionDetail: string;
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8')) as { version?: unknown };
      const version = typeof pkg.version === 'string' ? pkg.version : '';
      versionOk = STRICT_SEMVER.test(version);
      versionDetail = versionOk ? version : `"${version || 'missing'}" is not strict semver (MAJOR.MINOR.PATCH)`;
    } catch {
      versionDetail = 'package.json unreadable or invalid JSON';
    }
    reportCheck(versionOk, 'package.json version', versionDetail);

    // Check 4: npm registry identity (best-effort, non-fatal)
    try {
      const { stdout } = await execFileAsync('npm', ['whoami'], { cwd: process.cwd() });
      console.log(`  ${picocolors.green('✔')} npm identity: logged in as ${stdout.trim()}`);
    } catch {
      console.log(`  ${picocolors.yellow('○')} npm identity: not authenticated (or offline) — run \`npm login\` before publishing`);
    }

    if (hardFailures > 0) {
      console.log(picocolors.red(`\n✖ ${hardFailures} hard check(s) failed. Fix the items above before publishing.`));
      process.exitCode = 1;
      return;
    }
    console.log(picocolors.green('\n✔ All hard checks passed. Ready to publish.'));
  });

// Command: doctor
program
  .command('doctor')
  .description('Read-only health check: git, work tree, memory store, MCP configs, dashboard port')
  .action(async () => {
    const report = await runDoctor(process.cwd());
    console.log(picocolors.cyan('\nHyperSABMemory doctor\n'));
    for (const check of report.checks) {
      const mark = check.ok ? picocolors.green('✔') : picocolors.red('✘');
      console.log(`  ${mark} ${check.name}: ${check.detail}`);
    }
    if (!report.ok) {
      console.log(picocolors.red('\n✖ Issues found above.'));
      process.exitCode = 1;
      return;
    }
    if (report.counters) {
      const counters = report.counters;
      console.log(picocolors.cyan('\nMeasured counters:'));
      console.log(`  memory records: ${counters.activeRecords} active / ${counters.forgottenRecords} forgotten`);
      console.log(`  checkpoint commits: ${counters.checkpointCommits ?? 'unknown (not a git repo)'}`);
      if (counters.lastRollbackHash) {
        console.log(`  last rollback: ${counters.lastRollbackHash} (safety checkpoint)`);
      }
      if (typeof counters.estTokensSavedPct === 'number') {
        console.log(`  est. tokens saved ~${counters.estTokensSavedPct}% (measured on this store)`);
      }
    }
    console.log(picocolors.green('\n✔ All checks passed.'));
  });

// Command: remove
program
  .command('remove')
  .description('Clean uninstall: strips injected HyperSABMemory sections, MCP entries, and the local store')
  .action(() => {
    const result = removeInjection(process.cwd());
    if (result.cleanedFiles.length > 0) {
      console.log(picocolors.green(`✔ Cleaned injected sections from ${result.cleanedFiles.length} file(s):`));
      for (const file of result.cleanedFiles) {
        console.log(picocolors.gray(`  ${path.relative(process.cwd(), file) || file}`));
      }
    }
    for (const file of result.removedFiles) {
      console.log(picocolors.green(`✔ Removed generated file: ${path.relative(process.cwd(), file) || file}`));
    }
    if (result.storeRemoved) {
      console.log(picocolors.green('✔ Removed .hypersabmemory/ store directory.'));
    }
    if (result.cleanedFiles.length === 0 && result.removedFiles.length === 0 && !result.storeRemoved) {
      console.log(picocolors.yellow('ℹ Nothing to remove — no HyperSABMemory artifacts found.'));
    }
  });

registerMemoryCommands(program);

program.parse(process.argv);
