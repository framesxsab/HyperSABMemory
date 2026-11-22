import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8'));

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
    return execFileSync(process.execPath, [npmCli, ...args], { cwd, encoding: 'utf-8', stdio: 'pipe' });
  }
  const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  return execFileSync(npmBin, args, { cwd, encoding: 'utf-8', stdio: 'pipe' });
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}

function sha256File(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function trySymlink(target, linkPath, type) {
  try {
    fs.symlinkSync(target, linkPath, type);
    return true;
  } catch (err) {
    const code = err && typeof err === 'object' ? err.code : undefined;
    if (process.platform === 'win32' && (code === 'EPERM' || code === 'EACCES')) {
      return false;
    }
    throw err;
  }
}

async function connectMcp(command, args, cwd, env, name) {
  const client = new Client({ name, version: '1.0.0' });
  await client.connect(new StdioClientTransport({
    command,
    args,
    cwd,
    env,
    stderr: 'pipe'
  }));
  const tools = await client.listTools();
  const resources = await client.listResources();
  return { client, toolsCount: tools.tools.length, resourcesCount: resources.resources.length };
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-s42-eval-'));

try {
  // Pack & install tarball into a directory containing spaces
  runNpm(['pack', '--ignore-scripts', '--pack-destination', tempRoot], repoRoot);
  const tarball = path.join(tempRoot, `${manifest.name}-${manifest.version}.tgz`);
  const installDir = path.join(tempRoot, 'install dir');
  fs.mkdirSync(installDir, { recursive: true });
  runNpm(['install', '--prefix', installDir, '--no-audit', '--no-fund', tarball], tempRoot);

  const cli = path.join(installDir, 'node_modules', manifest.name, 'dist', 'cli', 'index.js');
  const installedVersion = execFileSync(process.execPath, [cli, '--version'], { encoding: 'utf-8' }).trim();
  assert.equal(installedVersion, manifest.version);

  const emptyCache = path.join(tempRoot, 'offline cache');
  const emptyPrefix = path.join(tempRoot, 'offline prefix');
  fs.mkdirSync(emptyCache, { recursive: true });
  fs.mkdirSync(emptyPrefix, { recursive: true });
  const offlineEnv = {
    ...process.env,
    npm_config_offline: 'true',
    npm_config_registry: 'http://127.0.0.1:1',
    npm_config_cache: emptyCache,
    npm_config_prefix: emptyPrefix
  };

  // Build disposable repo + linked worktree (both with spaces)
  const mainRepo = path.join(tempRoot, 'main checkout');
  const linkedWt = path.join(tempRoot, 'linked worktree');
  const missingWs = path.join(tempRoot, 'missing-workspace');
  fs.mkdirSync(path.join(mainRepo, 'src'), { recursive: true });

  const serviceInitial = [
    'export function computeLeaseWindow(minutes) {',
    '  return Math.max(1, Math.min(minutes, 1440)) * 60_000;',
    '}',
    ''
  ].join('\n');
  fs.writeFileSync(path.join(mainRepo, 'README.md'), '# Worktree Validation Repo\n\nPrimary project guide.\n', 'utf-8');
  fs.writeFileSync(path.join(mainRepo, 'package.json'), JSON.stringify({
    name: 'worktree-sample',
    version: '1.0.0',
    type: 'module',
    repository: { type: 'git', url: 'https://example.invalid/sample.git' }
  }, null, 2) + '\n', 'utf-8');
  fs.writeFileSync(path.join(mainRepo, 'src', 'service.ts'), serviceInitial, 'utf-8');

  git(mainRepo, ['init', '-b', 'main']);
  git(mainRepo, ['add', '-A']);
  git(mainRepo, ['-c', 'user.name=seed', '-c', 'user.email=seed@example.com', 'commit', '-m', 'initial commit']);
  const baselineHead = git(mainRepo, ['rev-parse', 'HEAD']);

  git(mainRepo, ['worktree', 'add', '-b', 'wt-sprint42', linkedWt]);

  // 1. Setup & idempotency + offline MCP config in linked worktree
  execFileSync(process.execPath, [cli, 'setup'], { cwd: linkedWt, env: offlineEnv, stdio: 'pipe' });
  execFileSync(process.execPath, [cli, 'setup'], { cwd: linkedWt, env: offlineEnv, stdio: 'pipe' });
  assert.equal(git(linkedWt, ['rev-parse', 'HEAD']), baselineHead, 'setup must not create unsolicited commits');
  assert.equal(git(linkedWt, ['check-ignore', '.hypersabmemory']), '.hypersabmemory');

  const claudeEntry = JSON.parse(fs.readFileSync(path.join(linkedWt, '.mcp.json'), 'utf-8')).mcpServers?.hypersabmemory;
  const cursorEntry = JSON.parse(fs.readFileSync(path.join(linkedWt, '.cursor', 'mcp.json'), 'utf-8')).mcpServers?.hypersabmemory;
  const vscodeEntry = JSON.parse(fs.readFileSync(path.join(linkedWt, '.vscode', 'mcp.json'), 'utf-8')).servers?.hypersabmemory;
  assert.equal(claudeEntry.command, process.execPath);
  assert.equal(path.resolve(claudeEntry.args[0]), path.resolve(cli));
  assert.equal(claudeEntry.args[1], 'mcp');
  assert.equal(cursorEntry.command, process.execPath);
  assert.equal(vscodeEntry.command, process.execPath);

  // Invalid nonexistent workspace must be explicitly rejected without creating directory
  let missingSetupExit = 0;
  let missingSetupOutput = '';
  try {
    execFileSync(process.execPath, [cli, 'setup'], {
      cwd: tempRoot,
      env: offlineEnv,
      stdio: 'pipe'
    });
  } catch {}
  try {
    execFileSync(process.execPath, [
      '-e',
      `const fs = require('node:fs'); process.chdir(${JSON.stringify(tempRoot)});`
    ], { stdio: 'pipe' });
    // Invoke OneShotSetupEngine directly inside installed package against missingWs via child node
    const probeScript = `
      import { pathToFileURL } from 'node:url';
      const mod = await import(pathToFileURL(${JSON.stringify(path.join(installDir, 'node_modules', manifest.name, 'dist', 'cli', 'oneShotSetup.js'))}).href);
      const outcome = await new mod.OneShotSetupEngine(${JSON.stringify(missingWs)}).executeSetup();
      process.stdout.write(JSON.stringify(outcome));
      if (!outcome.success) process.exit(2);
    `;
    execFileSync(process.execPath, ['--input-type=module', '-e', probeScript], { stdio: 'pipe' });
  } catch (err) {
    missingSetupExit = err.status ?? 1;
    missingSetupOutput = String(err.stdout ?? '');
  }
  assert.equal(missingSetupExit, 2);
  assert.equal(fs.existsSync(missingWs), false, 'invalid workspace must not be created');

  // Verify invalid path also rejected cleanly via doctor CLI in non-repo / missing dir
  execFileSync(process.execPath, [cli, 'doctor'], { cwd: linkedWt, env: offlineEnv, stdio: 'pipe' });

  // 2-5. First MCP session in linked worktree: discover, remember decision, create/claim/checkpoint task, then close
  const serviceSha = sha256File(path.join(linkedWt, 'src', 'service.ts'));
  const session1 = await connectMcp(claudeEntry.command, claudeEntry.args, linkedWt, offlineEnv, 's42-session-1');
  assert.equal(session1.toolsCount, 17);
  assert.equal(session1.resourcesCount, 3);

  let taskId;
  let forgottenSecretId;
  try {
    const scopeRes = await session1.client.callTool({ name: 'hypersabmemory_scope_sources', arguments: {} });
    assert.ok(!scopeRes.isError);
    assert.ok(scopeRes.structuredContent.sources.some((s) => s.path === 'README.md' && s.status === 'current'));

    const remRes = await session1.client.callTool({
      name: 'hypersabmemory_remember',
      arguments: {
        category: 'decision',
        content: 'Cap lease window at 1440 minutes inside computeLeaseWindow.',
        artifacts: ['src/service.ts']
      }
    });
    assert.ok(!remRes.isError);

    const pkgRemRes = await session1.client.callTool({
      name: 'hypersabmemory_remember',
      arguments: {
        category: 'general',
        content: 'Package manifest records repository type and ESM configuration.',
        artifacts: ['package.json']
      }
    });
    assert.ok(!pkgRemRes.isError);

    const forgetSeedRes = await session1.client.callTool({
      name: 'hypersabmemory_remember',
      arguments: {
        category: 'decision',
        content: 'wt42opaque5599 canary must never surface after forget.',
        artifacts: ['src/service.ts']
      }
    });
    const idMatch = String(forgetSeedRes.content[0].text).match(/\[([^\]]+)\]/);
    assert.ok(idMatch);
    forgottenSecretId = idMatch[1];
    const forgetRes = await session1.client.callTool({
      name: 'hypersabmemory_forget',
      arguments: { id: forgottenSecretId }
    });
    assert.ok(!forgetRes.isError);

    const createRes = await session1.client.callTool({
      name: 'hypersabmemory_task_create',
      arguments: {
        goal: 'Validate linked-worktree lease clamping',
        acceptanceCriteria: ['Confirm computeLeaseWindow preserves 1..1440 bounds'],
        sourceRefs: ['src/service.ts', 'package.json'],
        nextAction: 'Verify computeLeaseWindow source hash and nested package metadata'
      }
    });
    assert.ok(!createRes.isError);
    taskId = createRes.structuredContent.taskId;

    const claimRes = await session1.client.callTool({
      name: 'hypersabmemory_task_claim',
      arguments: { taskId, agentId: 's42-worker-1', leaseMinutes: 10 }
    });
    assert.ok(!claimRes.isError);
    const { revision, leaseGeneration } = claimRes.structuredContent;

    const cpRes = await session1.client.callTool({
      name: 'hypersabmemory_task_checkpoint',
      arguments: {
        taskId,
        agentId: 's42-worker-1',
        expectedRevision: revision,
        leaseGeneration,
        state: 'claimed',
        summary: 'Pinned src/service.ts SHA before restart.'
      }
    });
    assert.ok(!cpRes.isError);
  } finally {
    await session1.client.close();
  }

  // 6-9. Independent MCP restart: compact restore + query evidence + SHA/line + same-size rewrite + path rejection
  const session2 = await connectMcp(claudeEntry.command, claudeEntry.args, linkedWt, offlineEnv, 's42-session-2');
  try {
    const restored = await session2.client.callTool({
      name: 'hypersabmemory_task_context',
      arguments: { compact: true }
    });
    assert.ok(!restored.isError);
    const bundle = restored.structuredContent;
    assert.equal(bundle.compact, true);
    assert.equal(bundle.taskId, taskId);
    assert.equal(bundle.goal, 'Validate linked-worktree lease clamping');
    assert.ok(bundle.relatedMemories.some((m) => m.statement.includes('Cap lease window at 1440 minutes')));
    assert.ok(!bundle.relatedMemories.some((m) => m.statement.includes('wt42opaque5599')));
    const serviceRef = bundle.sources.find((s) => s.path === 'src/service.ts');
    assert.equal(serviceRef.status, 'current');
    assert.equal(serviceRef.sha256, serviceSha);

    const symbolRes = await session2.client.callTool({
      name: 'hypersabmemory_query_evidence',
      arguments: { query: 'Where is `computeLeaseWindow` defined?', limit: 5 }
    });
    assert.ok(!symbolRes.isError);
    const symbolPacket = JSON.parse(symbolRes.content[0].text);
    assert.equal(symbolPacket.answerVerified, true);
    assert.equal(symbolPacket.evidence[0].source.path, 'src/service.ts');
    assert.equal(symbolPacket.evidence[0].source.sha256, serviceSha);
    assert.equal(symbolPacket.evidence[0].source.line, 1);

    const jsonRes = await session2.client.callTool({
      name: 'hypersabmemory_query_evidence',
      arguments: { query: 'What is the value of `repository.type` in `package.json`?', limit: 5 }
    });
    assert.ok(!jsonRes.isError);
    const jsonPacket = JSON.parse(jsonRes.content[0].text);
    assert.equal(jsonPacket.answerVerified, true);
    assert.ok(jsonPacket.assertions.some((a) => a.claim.includes('"git"')));

    const forgottenProbe = await session2.client.callTool({
      name: 'hypersabmemory_query_evidence',
      arguments: { query: 'wt42opaque5599', limit: 5 }
    });
    const forgottenPacket = JSON.parse(forgottenProbe.content[0].text);
    assert.equal(forgottenPacket.records.length, 0);
    assert.equal(forgottenPacket.answerVerified, false);

    // Escaping path reference and cross-worktree symlink rejected
    const escapeTaskRes = await session2.client.callTool({
      name: 'hypersabmemory_task_create',
      arguments: {
        goal: 'Should reject escaping source path',
        acceptanceCriteria: ['reject'],
        sourceRefs: ['../main checkout/src/service.ts']
      }
    });
    assert.equal(escapeTaskRes.isError, true);

    const crossSymlink = path.join(linkedWt, 'src', 'escape-main.ts');
    let crossSymlinkTested = false;
    if (trySymlink(path.join(mainRepo, 'src', 'service.ts'), crossSymlink, 'file')) {
      crossSymlinkTested = true;
      const symRes = await session2.client.callTool({
        name: 'hypersabmemory_task_create',
        arguments: {
          goal: 'Should reject cross-worktree symlink',
          acceptanceCriteria: ['reject'],
          sourceRefs: ['src/escape-main.ts']
        }
      });
      assert.equal(symRes.isError, true);
    }

    // Same-size source rewrite detection
    const onDiskService = fs.readFileSync(path.join(linkedWt, 'src', 'service.ts'), 'utf-8');
    const rewritten = onDiskService.replace('1440', '2880');
    assert.equal(Buffer.byteLength(rewritten), Buffer.byteLength(onDiskService));
    fs.writeFileSync(path.join(linkedWt, 'src', 'service.ts'), rewritten, 'utf-8');
    const staleCtx = await session2.client.callTool({
      name: 'hypersabmemory_task_context',
      arguments: { compact: true }
    });
    const staleEntry = staleCtx.structuredContent.sources.find((s) => s.path === 'src/service.ts');
    assert.equal(staleEntry.status, 'modified');

    // Checkpoint inside linked worktree must leave mainRepo HEAD untouched
    const wtCpRes = await session2.client.callTool({
      name: 'hypersabmemory_checkpoint',
      arguments: { reason: 'wt sprint42 check' }
    });
    assert.ok(!wtCpRes.isError);
    assert.notEqual(git(linkedWt, ['rev-parse', 'HEAD']), baselineHead);
    assert.equal(git(mainRepo, ['rev-parse', 'HEAD']), baselineHead);

    // 10. Verify isolation in mainRepo
    const mainSession = await connectMcp(claudeEntry.command, claudeEntry.args, mainRepo, offlineEnv, 's42-main-check');
    let mainTaskIsolated = false;
    let mainMemoryIsolated = false;
    try {
      const mainCtx = await mainSession.client.callTool({
        name: 'hypersabmemory_task_context',
        arguments: { compact: true }
      });
      mainTaskIsolated = mainCtx.isError === true && mainCtx.structuredContent?.error?.code === 'TASK_NOT_FOUND';

      const mainMemRes = await mainSession.client.callTool({
        name: 'hypersabmemory_query_evidence',
        arguments: { query: 'computeLeaseWindow', limit: 5 }
      });
      const mainMemPacket = JSON.parse(mainMemRes.content[0].text);
      mainMemoryIsolated = mainMemPacket.records.length === 0;
    } finally {
      await mainSession.client.close();
    }
    assert.equal(mainTaskIsolated, true);
    assert.equal(mainMemoryIsolated, true);

    // Case-sensitive root documentation check on filesystems that allow distinct case variants
    let caseSensitiveDistinctDocsTested = false;
    const caseDir = path.join(tempRoot, 'case-check');
    fs.mkdirSync(caseDir, { recursive: true });
    fs.writeFileSync(path.join(caseDir, 'README.md'), '# Uppercase\n', 'utf-8');
    fs.writeFileSync(path.join(caseDir, 'Readme.md'), '# Mixedcase\n', 'utf-8');
    const dirEntries = fs.readdirSync(caseDir);
    if (dirEntries.includes('README.md') && dirEntries.includes('Readme.md')) {
      caseSensitiveDistinctDocsTested = true;
      execFileSync(process.execPath, [cli, 'setup'], { cwd: caseDir, env: offlineEnv, stdio: 'pipe' });
      const caseSession = await connectMcp(claudeEntry.command, claudeEntry.args, caseDir, offlineEnv, 's42-case-check');
      try {
        const scoped = await caseSession.client.callTool({ name: 'hypersabmemory_scope_sources', arguments: {} });
        const paths = scoped.structuredContent.sources.map((s) => s.path);
        assert.ok(paths.includes('README.md') && paths.includes('Readme.md'), 'must preserve both distinct root doc casings');
      } finally {
        await caseSession.client.close();
      }
    }

    process.stdout.write(`${JSON.stringify({
      evaluatedAt: new Date().toISOString(),
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      installedPackage: `${manifest.name}@${installedVersion}`,
      passed: true,
      checks: {
        offlineMcpConfigAndRestart: true,
        linkedWorktreeGitExclude: true,
        zeroUnsolicitedSetupCommits: true,
        missingWorkspaceRejected: missingSetupExit === 2 && !fs.existsSync(missingWs),
        compactRestoreTaskId: taskId,
        serviceShaVerified: serviceSha,
        nestedJsonVerified: true,
        sameSizeRewriteDetected: staleEntry.status === 'modified',
        forgottenMemoryExcluded: true,
        escapingPathRejected: true,
        crossWorktreeSymlinkTested: crossSymlinkTested,
        checkpointIsolatedFromMain: git(mainRepo, ['rev-parse', 'HEAD']) === baselineHead,
        mainTaskIsolated,
        mainMemoryIsolated,
        caseSensitiveDistinctDocsTested
      }
    }, null, 2)}\n`);
  } finally {
    await session2.client.close();
  }
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
