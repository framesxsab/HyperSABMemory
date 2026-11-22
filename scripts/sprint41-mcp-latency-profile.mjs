import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const defaultWinNpm = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
const npmCli = process.env.HM40_NPM_CLI ?? process.env.npm_execpath ?? (fs.existsSync(defaultWinNpm) ? defaultWinNpm : undefined);
assert.ok(npmCli, 'Set HM40_NPM_CLI or run via npm so npm-cli.js can be resolved');

const REPOS = [
  {
    key: 'ni',
    name: 'antfu-collective/ni',
    url: 'https://github.com/antfu-collective/ni.git',
    commit: '71e261fd497c9e5f7bc925267ff249f5b9f9bc14',
    records: [
      ['architecture', 'src/detect.ts', 'Detects package manager using deno.json check and package-manager-detector lockfiles.'],
      ['architecture', 'src/config.ts', 'Loads configuration from .nirc ini file and NI_* environment variables.'],
      ['architecture', 'src/catalog/spec.ts', 'Parses npm package specifiers via parsePackageSpec and isVerbatimSpec.'],
      ['architecture', 'src/parse.ts', 'Parses CLI arguments into package manager commands parseNi, parseNr, parseNa.'],
      ['architecture', 'src/runner.ts', 'Runs CLI via runCli and getCliCommand using tinyexec.'],
      ['architecture', 'src/storage.ts', 'Persists temporary CLI state including lastRunCommand in _storage.json.'],
      ['architecture', 'src/fs.ts', 'Reads package.json manifests via getPackageJSON and findClosestPackageJson.'],
      ['general', 'package.json', '@antfu/ni package manifest, ESM module exports, dependencies, and scripts.'],
      ['architecture', 'README.md', 'Usage guide for ni, nr, nlx, nu, nun, nci commands.'],
      ['general', 'test/programmatic/catalog-spec.spec.ts', 'Vitest tests for parsePackageSpec and isVerbatimSpec.']
    ],
    queries: {
      ordinary: 'How does ni parse package specifiers and determine whether a catalog specifier is verbatim?',
      exactJson: 'What is the value of `repository.type` in `package.json`?',
      implAndTest: 'Where is parsePackageSpec implemented and which tests call it?'
    }
  },
  {
    key: 'commander',
    name: 'tj/commander.js',
    url: 'https://github.com/tj/commander.js.git',
    commit: 'a5a7dc084d4d2b7932e85ca049c5204e50a2c721',
    records: [
      ['architecture', 'lib/suggestSimilar.js', 'Computes Damerau-Levenshtein editDistance and suggestSimilar suggestions.'],
      ['architecture', 'lib/error.js', 'Defines CommanderError and InvalidArgumentError classes with exitCode and code.'],
      ['architecture', 'lib/option.js', 'Defines Option class and DualOptions valueFromOption positive/negative pairs.'],
      ['architecture', 'lib/argument.js', 'Defines Argument class for required, optional, and variadic arguments.'],
      ['architecture', 'lib/help.js', 'Defines Help class formatting help text, sortOptions, and visibleCommands.'],
      ['architecture', 'lib/command.js', 'Defines Command class, subcommands, hooks, and useColor environment helper.'],
      ['architecture', 'docs/parsing-and-hooks.md', 'Explains parsing lifecycle and preSubcommand, preAction, postAction hooks.'],
      ['general', 'package.json', 'commander v15 package manifest, ESM module type, typings, and test scripts.'],
      ['architecture', 'Readme.md', 'Commander.js documentation for commands, options, arguments, and help output.'],
      ['general', 'tests/useColor.test.js', 'node:test assertions for useColor NO_COLOR, FORCE_COLOR, and CLICOLOR_FORCE.']
    ],
    queries: {
      ordinary: 'How does Commander suggest similar command or option names after an error?',
      exactJson: 'What is the value of `repository.type` in `package.json`?',
      implAndTest: 'Where is useColor implemented and which tests call it?'
    }
  }
];

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

function summarize(values) {
  const mean = values.reduce((acc, v) => acc + v, 0) / Math.max(1, values.length);
  return {
    n: values.length,
    p50: +percentile(values, 0.5).toFixed(2),
    p95: +percentile(values, 0.95).toFixed(2),
    mean: +mean.toFixed(2),
    max: +(values.length ? Math.max(...values) : 0).toFixed(2)
  };
}

function ensureRepoClone(reposBase, spec) {
  const repoDir = path.join(reposBase, spec.key);
  if (fs.existsSync(path.join(repoDir, '.git'))) {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, encoding: 'utf8' }).trim();
    if (head === spec.commit) return repoDir;
  }
  fs.mkdirSync(repoDir, { recursive: true });
  execFileSync('git', ['init'], { cwd: repoDir, stdio: 'pipe' });
  execFileSync('git', ['remote', 'add', 'origin', spec.url], { cwd: repoDir, stdio: 'pipe' });
  execFileSync('git', ['fetch', '--depth', '1', 'origin', spec.commit], { cwd: repoDir, stdio: 'pipe' });
  execFileSync('git', ['checkout', '--detach', 'FETCH_HEAD'], { cwd: repoDir, stdio: 'pipe' });
  return repoDir;
}

function copyTrackedRepo(sourceRepoDir, targetDir) {
  const tracked = execFileSync('git', ['ls-files'], { cwd: sourceRepoDir, encoding: 'utf8' })
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (const rel of tracked) {
    const src = path.join(sourceRepoDir, rel);
    if (!fs.existsSync(src) || !fs.statSync(src).isFile()) continue;
    const dst = path.join(targetDir, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
}

const stageProbeCode = `
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const distDir = process.env.HM_DIST_DIR;
const workspaceDir = process.env.HM_WS_DIR;
const querySpec = JSON.parse(process.env.HM_QUERIES);
const warmupIterations = Number(process.env.HM_WARM_N || '50');

const { TemporalMemoryEngine } = await import(pathToFileURL(path.join(distDir, 'memory', 'temporalMemory.js')).href);
const { HybridSearchEngine } = await import(pathToFileURL(path.join(distDir, 'memory', 'hybridSearch.js')).href);
const { captureTaskSources } = await import(pathToFileURL(path.join(distDir, 'harness', 'taskSources.js')).href);
const { searchGrounded } = await import(pathToFileURL(path.join(distDir, 'memory', 'groundedSearch.js')).href);

const memory = new TemporalMemoryEngine(workspaceDir);
const hybrid = new HybridSearchEngine(workspaceDir, memory);

function profileQuery(query, iterations) {
  const totals = [];
  let stageSums = { captureRefMs: 0, candidateMs: 0, indexingMs: 0, rankingMs: 0, pathMs: 0, readMs: 0, hashMs: 0, excerptMs: 0, decisionMs: 0 };
  let coldTotalMs = 0;
  for (let i = 0; i <= iterations; i++) {
    const timing = { candidateMs: 0, indexingMs: 0, rankingMs: 0, pathMs: 0, readMs: 0, hashMs: 0, excerptMs: 0, decisionMs: 0 };
    const t0 = performance.now();
    const ranked = hybrid.searchRecordsWithScores(query, 20, timing);
    const t1 = performance.now();
    const refs = new Map();
    for (const { record } of ranked) {
      for (const sourcePath of record.artifacts ?? []) {
        if (refs.size >= 64) break;
        try {
          const captured = captureTaskSources(workspaceDir, [sourcePath])[0];
          if (captured?.sha256) refs.set(captured.path, captured);
        } catch {}
      }
      if (refs.size >= 64) break;
    }
    const captureRefMs = performance.now() - t1;
    searchGrounded(hybrid, workspaceDir, query, [...refs.values()], [], timing);
    const total = performance.now() - t0;
    if (i === 0) {
      coldTotalMs = +total.toFixed(2);
    } else {
      totals.push(total);
      stageSums.captureRefMs += captureRefMs;
      for (const k of Object.keys(timing)) stageSums[k] += timing[k];
    }
  }
  const sorted = [...totals].sort((a, b) => a - b);
  const p = (f) => +(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * f) - 1)] ?? 0).toFixed(2);
  const stageMeansMs = Object.fromEntries(Object.entries(stageSums).map(([k, v]) => [k, +(v / iterations).toFixed(2)]));
  return { coldTotalMs, n: iterations, p50Ms: p(0.5), p95Ms: p(0.95), meanMs: +(totals.reduce((a, b) => a + b, 0) / iterations).toFixed(2), maxMs: +Math.max(...totals).toFixed(2), stageMeansMs };
}

const out = {};
for (const [label, q] of Object.entries(querySpec)) {
  out[label] = profileQuery(q, warmupIterations);
}
process.stdout.write(JSON.stringify(out));
`;

const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-s41-latency-'));
const reposBase = process.env.HM40_REPOS_DIR ?? path.join(os.tmpdir(), 'hm-sprint40-repos');

try {
  execFileSync(process.execPath, [npmCli, 'pack', '--ignore-scripts', '--pack-destination', tempRoot], {
    cwd: repoRoot,
    stdio: 'pipe'
  });
  const tarball = path.join(tempRoot, `${manifest.name}-${manifest.version}.tgz`);
  const installDir = path.join(tempRoot, 'install');
  fs.mkdirSync(installDir);
  execFileSync(process.execPath, [npmCli, 'install', '--prefix', installDir, '--no-audit', '--no-fund', tarball], {
    cwd: tempRoot,
    stdio: 'pipe'
  });
  const cli = path.join(installDir, 'node_modules', manifest.name, 'dist', 'cli', 'index.js');
  const distDir = path.join(installDir, 'node_modules', manifest.name, 'dist');
  const offlineCache = path.join(tempRoot, 'empty-cache');
  fs.mkdirSync(offlineCache);
  const offlineEnv = {
    ...process.env,
    npm_config_offline: 'true',
    npm_config_registry: 'http://127.0.0.1:1',
    npm_config_cache: offlineCache
  };

  const results = [];
  for (const spec of REPOS) {
    const cloneDir = ensureRepoClone(reposBase, spec);
    const workspace = path.join(tempRoot, `ws-${spec.key}`);
    fs.mkdirSync(workspace, { recursive: true });
    copyTrackedRepo(cloneDir, workspace);
    execFileSync(process.execPath, [cli, 'setup'], { cwd: workspace, stdio: 'pipe' });

    const mcpEntry = JSON.parse(fs.readFileSync(path.join(workspace, '.mcp.json'), 'utf8')).mcpServers.hypersabmemory;
    const seedClient = new Client({ name: `seed-${spec.key}`, version: '1.0.0' });
    await seedClient.connect(new StdioClientTransport({
      command: mcpEntry.command,
      args: mcpEntry.args,
      cwd: workspace,
      env: offlineEnv,
      stderr: 'pipe'
    }));
    try {
      for (const [category, relPath, content] of spec.records) {
        if (!fs.existsSync(path.join(workspace, relPath))) continue;
        await seedClient.callTool({
          name: 'hypersabmemory_remember',
          arguments: { category, content, artifacts: [relPath] }
        });
      }
    } finally {
      await seedClient.close();
    }

    // 3 fresh MCP cold starts per query class
    const coldStarts = { ordinary: [], exactJson: [], implAndTest: [] };
    for (const [label, q] of Object.entries(spec.queries)) {
      for (let i = 0; i < 3; i++) {
        const client = new Client({ name: `cold-${spec.key}-${label}-${i}`, version: '1.0.0' });
        await client.connect(new StdioClientTransport({
          command: mcpEntry.command,
          args: mcpEntry.args,
          cwd: workspace,
          env: offlineEnv,
          stderr: 'pipe'
        }));
        try {
          const t0 = performance.now();
          const res = await client.callTool({ name: 'hypersabmemory_query_evidence', arguments: { query: q, limit: 5 } });
          assert.ok(!res.isError);
          coldStarts[label].push(performance.now() - t0);
        } finally {
          await client.close();
        }
      }
    }

    // Warm 50-sample MCP runs per query class on one steady client
    const warmSamples = { ordinary: [], exactJson: [], implAndTest: [] };
    const warmClient = new Client({ name: `warm-${spec.key}`, version: '1.0.0' });
    await warmClient.connect(new StdioClientTransport({
      command: mcpEntry.command,
      args: mcpEntry.args,
      cwd: workspace,
      env: offlineEnv,
      stderr: 'pipe'
    }));
    try {
      for (const [label, q] of Object.entries(spec.queries)) {
        // 1 warmup call per class
        await warmClient.callTool({ name: 'hypersabmemory_query_evidence', arguments: { query: q, limit: 5 } });
        for (let i = 0; i < 50; i++) {
          const t0 = performance.now();
          const res = await warmClient.callTool({ name: 'hypersabmemory_query_evidence', arguments: { query: q, limit: 5 } });
          assert.ok(!res.isError);
          warmSamples[label].push(performance.now() - t0);
        }
      }
    } finally {
      await warmClient.close();
    }

    // In-process stage breakdown in isolated child process
    const stageRaw = execFileSync(process.execPath, ['--input-type=module', '-e', stageProbeCode], {
      cwd: workspace,
      env: {
        ...process.env,
        HM_DIST_DIR: distDir,
        HM_WS_DIR: workspace,
        HM_QUERIES: JSON.stringify(spec.queries),
        HM_WARM_N: '50'
      },
      encoding: 'utf8'
    });
    const inProcessStages = JSON.parse(stageRaw);

    results.push({
      repo: spec.name,
      commit: spec.commit,
      coldMcpFirstCallMs: Object.fromEntries(Object.entries(coldStarts).map(([k, vals]) => [k, summarize(vals)])),
      warmMcp50CallsMs: Object.fromEntries(Object.entries(warmSamples).map(([k, vals]) => [k, summarize(vals)])),
      inProcessStageBreakdown: inProcessStages
    });
  }

  process.stdout.write(`${JSON.stringify({ evaluatedAt: new Date().toISOString(), version: manifest.version, profiles: results }, null, 2)}\n`);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
