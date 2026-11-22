import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const BASELINE_REF = 'e793844';

function findNpmCli() {
  const candidates = [
    process.env.HM40_NPM_CLI,
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.resolve(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')
  ].filter(Boolean);
  return candidates.find((p) => p.endsWith('.js') && fs.existsSync(p));
}

const npmCli = findNpmCli();

function runNpm(args, cwd) {
  if (npmCli) {
    return execFileSync(process.execPath, [npmCli, ...args], { cwd, encoding: 'utf8', stdio: 'pipe' });
  }
  const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  return execFileSync(npmBin, args, { cwd, encoding: 'utf8', stdio: 'pipe' });
}

function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const p = (f) => +(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * f) - 1)] ?? 0).toFixed(2);
  const mean = values.reduce((acc, v) => acc + v, 0) / Math.max(1, values.length);
  return {
    n: values.length,
    p50: p(0.5),
    p95: p(0.95),
    mean: +mean.toFixed(2),
    max: +(values.length ? Math.max(...values) : 0).toFixed(2)
  };
}

function ensureRepoClone(reposBase, key, url, commit) {
  const repoDir = path.join(reposBase, key);
  if (fs.existsSync(path.join(repoDir, '.git'))) {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, encoding: 'utf8' }).trim();
    if (head === commit) return repoDir;
  }
  fs.mkdirSync(repoDir, { recursive: true });
  execFileSync('git', ['init'], { cwd: repoDir, stdio: 'pipe' });
  execFileSync('git', ['remote', 'add', 'origin', url], { cwd: repoDir, stdio: 'pipe' });
  execFileSync('git', ['fetch', '--depth', '1', 'origin', commit], { cwd: repoDir, stdio: 'pipe' });
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

const REPO_SPECS = [
  {
    key: 'ni',
    name: 'antfu-collective/ni',
    url: 'https://github.com/antfu-collective/ni.git',
    commit: '71e261fd497c9e5f7bc925267ff249f5b9f9bc14',
    records: [
      ['architecture', 'src/catalog/spec.ts', 'Parses package specifiers via parsePackageSpec and checks verbatim catalog specs via isVerbatimSpec.'],
      ['general', 'test/programmatic/catalog-spec.spec.ts', 'Vitest tests for parsePackageSpec and parameterized it.each tests for isVerbatimSpec.'],
      ['architecture', 'src/detect.ts', 'Detects package manager using deno.json check and lockfiles.'],
      ['architecture', 'src/config.ts', 'Loads configuration from .nirc and environment variables.'],
      ['architecture', 'src/catalog/handler.ts', 'Handles pnpm, bun, and yarn catalog version protocol resolution.']
    ],
    snapshotFiles: [
      'src/catalog/spec.ts',
      'test/programmatic/catalog-spec.spec.ts',
      'src/detect.ts'
    ],
    inProcessCases: [
      {
        id: 'ni_isverbatim_param',
        query: 'Where is isVerbatimSpec implemented and which tests call it?',
        expectedSymbol: 'isVerbatimSpec'
      },
      {
        id: 'ni_parsespec_direct',
        query: 'Where is parsePackageSpec implemented and which tests call it?',
        expectedSymbol: 'parsePackageSpec'
      }
    ],
    falseProbes: [
      {
        id: 'shadowed_param',
        path: 'test/programmatic/shadow-param.spec.ts',
        content: "import { expect, it } from 'vitest'\nimport { isVerbatimSpec } from '../../src/catalog/spec'\nit.each(['latest'])('shadow %s', (isVerbatimSpec) => { expect(isVerbatimSpec('latest')).toBe(false) })\n",
        query: 'Where is isVerbatimSpec implemented and which tests call it?'
      },
      {
        id: 'type_only_param',
        path: 'test/programmatic/type-param.spec.ts',
        content: "import { expect, it } from 'vitest'\nimport type { isVerbatimSpec } from '../../src/catalog/spec'\nit.each(['latest'])('type %s', (spec) => { expect(isVerbatimSpec(spec)).toBe(false) })\n",
        query: 'Where is isVerbatimSpec implemented and which tests call it?'
      }
    ],
    mcpQueries: {
      parameterizedTest: 'Where is isVerbatimSpec implemented and which tests call it?',
      directTest: 'Where is parsePackageSpec implemented and which tests call it?',
      ordinarySource: 'How does ni parse catalog package specifiers?'
    }
  },
  {
    key: 'commander',
    name: 'tj/commander.js',
    url: 'https://github.com/tj/commander.js.git',
    commit: 'a5a7dc084d4d2b7932e85ca049c5204e50a2c721',
    records: [
      ['architecture', 'lib/command.js', 'Defines Command class, subcommands, hooks, and useColor environment helper.'],
      ['general', 'tests/useColor.test.js', 'node:test + node:assert/strict assertions for useColor environment handling.'],
      ['architecture', 'lib/option.js', 'Defines Option and DualOptions.valueFromOption positive/negative pairs.'],
      ['general', 'tests/options.dual-options.test.js', 'node:test tests for DualOptions.valueFromOption.'],
      ['architecture', 'lib/suggestSimilar.js', 'Computes editDistance and suggestSimilar command suggestions.']
    ],
    snapshotFiles: [
      'lib/command.js',
      'tests/useColor.test.js',
      'lib/option.js',
      'tests/options.dual-options.test.js'
    ],
    inProcessCases: [
      {
        id: 'commander_usecolor_node_assert',
        query: 'Where is useColor implemented and which tests call it?',
        expectedSymbol: 'useColor'
      },
      {
        id: 'commander_dualoptions_node_assert',
        query: 'Where is valueFromOption implemented and which tests call it?',
        expectedSymbol: 'DualOptions.valueFromOption'
      }
    ],
    falseProbes: [],
    mcpQueries: {
      nodeAssertTest: 'Where is useColor implemented and which tests call it?',
      ordinarySource: 'How does Commander suggest similar option names?'
    }
  }
];

const inProcessChildCode = `
import { pathToFileURL } from 'node:url';
import * as fs from 'node:fs';
import { createHash } from 'node:crypto';
import * as path from 'node:path';
import { performance } from 'node:perf_hooks';

const modulePath = process.env.HM43_IMPL_MODULE;
const workspaceDir = process.env.HM43_WS_DIR;
const fileList = JSON.parse(process.env.HM43_FILES);
const cases = JSON.parse(process.env.HM43_CASES);
const falseProbes = JSON.parse(process.env.HM43_FALSE_PROBES);
const warmN = Number(process.env.HM43_WARM_N || '50');

const mod = await import(pathToFileURL(modulePath).href);
const snapshots = fileList.map((rel) => {
  const raw = fs.readFileSync(path.join(workspaceDir, rel), 'utf8');
  const sha = createHash('sha256').update(raw).digest('hex');
  return { path: rel, content: raw, status: 'current', sha256: sha, currentSha256: sha };
});

function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const p = (f) => +(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * f) - 1)] ?? 0).toFixed(3);
  const mean = values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
  return { n: values.length, p50: p(0.5), p95: p(0.95), mean: +mean.toFixed(3), max: +(values.length ? Math.max(...values) : 0).toFixed(3) };
}

const results = [];
for (const c of cases) {
  const diagCold = { astParsed: 0, tsProgramsCreated: 0, cacheHit: false };
  const t0 = performance.now();
  const coldRes = mod.collectImplementationEvidence(c.query, snapshots, diagCold);
  const coldMs = +(performance.now() - t0).toFixed(3);

  const cachedTimes = [];
  for (let i = 0; i < warmN; i++) {
    const start = performance.now();
    mod.collectImplementationEvidence(c.query, snapshots);
    cachedTimes.push(performance.now() - start);
  }

  // Unique trailing token forces cache miss on evidenceResultCache so AST/program cost stays visible.
  const uncachedTimes = [];
  let uncachedAstTotal = 0;
  let uncachedProgramsTotal = 0;
  for (let i = 0; i < 20; i++) {
    const diag = { astParsed: 0, tsProgramsCreated: 0, cacheHit: false };
    const start = performance.now();
    mod.collectImplementationEvidence(c.query + ' /*s' + i + '*/', snapshots, diag);
    uncachedTimes.push(performance.now() - start);
    uncachedAstTotal += diag.astParsed;
    uncachedProgramsTotal += diag.tsProgramsCreated;
  }

  results.push({
    id: c.id,
    coldMs,
    coldDiagnostics: diagCold,
    warmCachedMs: summarize(cachedTimes),
    warmUncachedMs: summarize(uncachedTimes),
    uncachedAstParsedTotal: uncachedAstTotal,
    uncachedProgramsTotal: uncachedProgramsTotal,
    sourceFilesPassed: snapshots.length,
    linkedTestsCount: coldRes.tests.length,
    linkedTestNames: coldRes.tests.map((t) => t.name),
    executionStatuses: [...new Set(coldRes.tests.map((t) => t.execution))],
    responseBytes: Buffer.byteLength(JSON.stringify(coldRes))
  });
}

let falseLinksObserved = 0;
for (const probe of falseProbes) {
  const sha = createHash('sha256').update(probe.content).digest('hex');
  const probeSnapshots = [
    ...snapshots.filter((s) => s.path === 'src/catalog/spec.ts'),
    { path: probe.path, content: probe.content, status: 'current', sha256: sha, currentSha256: sha }
  ];
  const res = mod.collectImplementationEvidence(probe.query, probeSnapshots);
  falseLinksObserved += res.tests.filter((t) => t.source.path === probe.path).length;
}

process.stdout.write(JSON.stringify({ results, falseLinksObserved }));
`;

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-s43-bench-'));
const reposBase = process.env.HM40_REPOS_DIR ?? path.join(os.tmpdir(), 'hm-sprint40-repos');

try {
  // Prepare built baseline implementationEvidence.js from BASELINE_REF
  const baselineDir = path.join(tempRoot, 'baseline');
  fs.mkdirSync(baselineDir, { recursive: true });
  const archiveTar = path.join(tempRoot, 'baseline.tar');
  execFileSync('git', ['archive', '--format=tar', '-o', archiveTar, BASELINE_REF], { cwd: repoRoot, stdio: 'pipe' });
  execFileSync('tar', ['-xf', archiveTar, '-C', baselineDir], { cwd: tempRoot, stdio: 'pipe' });
  const linkType = process.platform === 'win32' ? 'junction' : 'dir';
  fs.symlinkSync(path.join(repoRoot, 'node_modules'), path.join(baselineDir, 'node_modules'), linkType);
  execFileSync(process.execPath, [path.join(baselineDir, 'scripts', 'build.mjs')], { cwd: baselineDir, stdio: 'pipe' });

  // Prepare installed current package tarball
  runNpm(['pack', '--ignore-scripts', '--pack-destination', tempRoot], repoRoot);
  const tarball = path.join(tempRoot, `${manifest.name}-${manifest.version}.tgz`);
  const installDir = path.join(tempRoot, 'install dir');
  fs.mkdirSync(installDir, { recursive: true });
  runNpm(['install', '--prefix', installDir, '--no-audit', '--no-fund', tarball], tempRoot);
  const cli = path.join(installDir, 'node_modules', manifest.name, 'dist', 'cli', 'index.js');

  const emptyCache = path.join(tempRoot, 'empty-cache');
  const emptyPrefix = path.join(tempRoot, 'empty-prefix');
  fs.mkdirSync(emptyCache, { recursive: true });
  fs.mkdirSync(emptyPrefix, { recursive: true });
  const offlineEnv = {
    ...process.env,
    npm_config_offline: 'true',
    npm_config_registry: 'http://127.0.0.1:1',
    npm_config_cache: emptyCache,
    npm_config_prefix: emptyPrefix
  };

  const baselineImplModule = path.join(baselineDir, 'dist', 'memory', 'implementationEvidence.js');
  const currentImplModule = path.join(installDir, 'node_modules', manifest.name, 'dist', 'memory', 'implementationEvidence.js');

  const inProcessComparison = [];
  const mcpInstalledBenchmarks = [];

  for (const spec of REPO_SPECS) {
    const cloneDir = ensureRepoClone(reposBase, spec.key, spec.url, spec.commit);
    const workspace = path.join(tempRoot, `ws-${spec.key}`);
    fs.mkdirSync(workspace, { recursive: true });
    copyTrackedRepo(cloneDir, workspace);

    const runInProcessProbe = (implModule) => JSON.parse(execFileSync(
      process.execPath,
      ['--input-type=module', '-e', inProcessChildCode],
      {
        cwd: workspace,
        env: {
          ...process.env,
          HM43_IMPL_MODULE: implModule,
          HM43_WS_DIR: workspace,
          HM43_FILES: JSON.stringify(spec.snapshotFiles),
          HM43_CASES: JSON.stringify(spec.inProcessCases),
          HM43_FALSE_PROBES: JSON.stringify(spec.falseProbes),
          HM43_WARM_N: '50'
        },
        encoding: 'utf8'
      }
    ));

    const before = runInProcessProbe(baselineImplModule);
    const after = runInProcessProbe(currentImplModule);
    inProcessComparison.push({ repo: spec.name, commit: spec.commit, before, after });

    // Installed-package offline MCP benchmark
    execFileSync(process.execPath, [cli, 'setup'], { cwd: workspace, env: offlineEnv, stdio: 'pipe' });
    const mcpEntry = JSON.parse(fs.readFileSync(path.join(workspace, '.mcp.json'), 'utf8')).mcpServers.hypersabmemory;
    const seedClient = new Client({ name: `s43-seed-${spec.key}`, version: '1.0.0' });
    await seedClient.connect(new StdioClientTransport({
      command: mcpEntry.command,
      args: mcpEntry.args,
      cwd: workspace,
      env: offlineEnv,
      stderr: 'pipe'
    }));
    try {
      for (const [category, relPath, content] of spec.records) {
        await seedClient.callTool({ name: 'hypersabmemory_remember', arguments: { category, content, artifacts: [relPath] } });
      }
    } finally {
      await seedClient.close();
    }

    const coldByClass = {};
    const warmByClass = {};
    const responseBytesByClass = {};
    const linkedCountsByClass = {};

    for (const [label, q] of Object.entries(spec.mcpQueries)) {
      const coldTimes = [];
      for (let i = 0; i < 3; i++) {
        const client = new Client({ name: `s43-cold-${spec.key}-${label}-${i}`, version: '1.0.0' });
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
          coldTimes.push(performance.now() - t0);
        } finally {
          await client.close();
        }
      }
      coldByClass[label] = summarize(coldTimes);
    }

    const warmClient = new Client({ name: `s43-warm-${spec.key}`, version: '1.0.0' });
    await warmClient.connect(new StdioClientTransport({
      command: mcpEntry.command,
      args: mcpEntry.args,
      cwd: workspace,
      env: offlineEnv,
      stderr: 'pipe'
    }));
    try {
      for (const [label, q] of Object.entries(spec.mcpQueries)) {
        const warmup = await warmClient.callTool({ name: 'hypersabmemory_query_evidence', arguments: { query: q, limit: 5 } });
        assert.ok(!warmup.isError);
        const packet = JSON.parse(warmup.content[0].text);
        responseBytesByClass[label] = Buffer.byteLength(warmup.content[0].text);
        linkedCountsByClass[label] = packet.implementationEvidence?.tests?.length ?? 0;

        const times = [];
        for (let i = 0; i < 50; i++) {
          const t0 = performance.now();
          const res = await warmClient.callTool({ name: 'hypersabmemory_query_evidence', arguments: { query: q, limit: 5 } });
          assert.ok(!res.isError);
          times.push(performance.now() - t0);
        }
        warmByClass[label] = summarize(times);
      }
    } finally {
      await warmClient.close();
    }

    mcpInstalledBenchmarks.push({
      repo: spec.name,
      commit: spec.commit,
      coldMcpFirstCallMs: coldByClass,
      warmMcp50CallsMs: warmByClass,
      responseBytes: responseBytesByClass,
      linkedTests: linkedCountsByClass
    });
  }

  // Assert expected Sprint 4.3 outcomes
  const niComp = inProcessComparison.find((x) => x.repo === 'antfu-collective/ni');
  assert.equal(niComp.before.results[0].linkedTestsCount, 0);
  assert.equal(niComp.after.results[0].linkedTestsCount, 2);
  assert.equal(niComp.after.falseLinksObserved, 0);
  const cmdComp = inProcessComparison.find((x) => x.repo === 'tj/commander.js');
  assert.equal(cmdComp.after.results[0].linkedTestsCount, 4);
  assert.equal(cmdComp.after.results[1].linkedTestsCount, 4);

  process.stdout.write(`${JSON.stringify({
    evaluatedAt: new Date().toISOString(),
    baselineRef: BASELINE_REF,
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    installedPackage: `${manifest.name}@${manifest.version}`,
    inProcessComparison,
    mcpInstalledBenchmarks
  }, null, 2)}\n`);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
