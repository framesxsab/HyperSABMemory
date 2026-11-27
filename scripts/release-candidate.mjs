
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runReleasePreflight } from './release-preflight.mjs';

const name = 'hypersabmemory';
const registry = 'https://registry.npmjs.org';
const releasePattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-preview\.(0|[1-9]\d*))?$/;
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (file) => JSON.parse(readFileSync(file, 'utf8'));

export function releaseChannel(version, changelog, ref) {
  const match = typeof version === 'string' && releasePattern.exec(version);
  assert.ok(match && match[0] === version, 'expected a canonical stable or preview version');
  if (ref !== undefined) assert.equal(ref, 'v' + version, 'tag/package version mismatch');
  const headings = [...changelog.matchAll(/^## \[([^\]]+)\][ \t]+-[ \t]+\d{4}-\d{2}-\d{2}[ \t]*\r?$/gm)];
  assert.equal(headings[0]?.[1], version, 'top dated changelog release must match package version');
  assert.equal(headings.filter((heading) => heading[1] === version).length, 1, 'duplicate changelog release');
  return match[4] === undefined ? 'latest' : 'preview';
}

export function checkRegistry(metadata, candidate, published = false) {
  const tags = metadata?.['dist-tags'];
  const versions = metadata?.versions;
  assert.equal(metadata?.name, name, 'registry package identity mismatch');
  assert.ok(tags && versions && Object.hasOwn(versions, tags.latest), 'registry metadata is incomplete');
  if (candidate.tag === 'preview') {
    assert.ok(releasePattern.test(tags.latest) && !tags.latest.includes('-'), 'registry latest must point to a stable version');
  }
  if (published) {
    assert.equal(tags[candidate.tag], candidate.version, 'published distribution tag mismatch');
    assert.equal(versions[candidate.version]?.dist?.integrity, candidate.integrity, 'published integrity mismatch');
    if (candidate.tag === 'preview') assert.equal(tags.latest, candidate.latestBefore, 'preview changed latest');
    return;
  }
  assert.ok(!Object.hasOwn(versions, candidate.version), 'version already published');
  const current = tags[candidate.tag];
  if (current === undefined) return;
  assert.ok(Object.hasOwn(versions, current), 'distribution tag points to a missing version');
  const from = releasePattern.exec(current);
  const to = releasePattern.exec(candidate.version);
  assert.ok(from && (from[4] === undefined) === (to[4] === undefined), 'distribution tag has an unexpected release channel');
  for (let i = 1; i <= (candidate.tag === 'preview' ? 4 : 3); i++) {
    if (BigInt(to[i]) > BigInt(from[i])) return;
    if (BigInt(to[i]) < BigInt(from[i])) break;
  }
  throw new Error('distribution tag would move backwards');
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function inspectTarball(file) {
  const bytes = readFileSync(file);
  return {
    sha256: digest(bytes),
    integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64')
  };
}

async function registryMetadata() {
  const response = await fetch(registry + '/' + name, { signal: AbortSignal.timeout(15_000), redirect: 'error' });
  assert.ok(response.ok, 'npm registry metadata returned HTTP ' + response.status);
  return response.json();
}

function candidateIdentity() {
  const manifest = json('package.json');
  const lock = json('package-lock.json');
  assert.equal(manifest.name, name, 'unexpected package name');
  for (const entry of [lock, lock.packages?.['']]) {
    assert.equal(entry?.name, name, 'lockfile package name mismatch');
    assert.equal(entry.version, manifest.version, 'lockfile version mismatch');
  }
  assert.equal(manifest.publishConfig, undefined, 'publishConfig could override release policy');
  const version = manifest.version;
  const ref = process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : undefined;
  if (process.env.GITHUB_REF_TYPE === 'tag') assert.ok(ref, 'missing release tag');
  const tag = releaseChannel(version, readFileSync('CHANGELOG.md', 'utf8'), ref);
  const commit = git('rev-parse', 'HEAD');
  if (process.env.GITHUB_SHA) assert.equal(commit, process.env.GITHUB_SHA, 'runner SHA mismatch');
  const ledgerPath = 'docs/acceptance/v' + version + '-acceptance.json';
  const ledger = json(ledgerPath);
  assert.match(ledger.candidateCommit, /^[a-f0-9]{40}$/);
  assert.match(ledger.tarballSha256, /^[a-f0-9]{64}$/, 'acceptance ledger must identify its evaluated tarball');
  git('merge-base', '--is-ancestor', ledger.candidateCommit, commit);
  git('diff', '--exit-code', ledger.candidateCommit, commit, '--', 'src');
  return {
    name, version, tag, commit, ledgerSha256: digest(readFileSync(ledgerPath)),
    evaluatedCommit: ledger.candidateCommit, evaluatedTarballSha256: ledger.tarballSha256
  };
}

async function main(mode, directory) {
  assert.ok(['prepare', 'verify', 'published'].includes(mode) && directory, 'usage: release-candidate.mjs prepare|verify|published DIRECTORY');
  const report = { schemaVersion: 1, mode, passed: false };
  mkdirSync(directory, { recursive: true });
  try {
    assert.equal(git('status', '--porcelain', '--untracked-files=all'), '', 'release checkout must be clean');
    const identity = candidateIdentity();
    report.candidate = identity;
    const file = path.join(directory, name + '-' + identity.version + '.tgz');
    if (mode === 'prepare') {
      report.preflight = runReleasePreflight();
      assert.equal(report.preflight.eligible, true, 'release preflight denied publication');
      assert.equal(identity.tag, 'preview', 'stable release is pending approved Profile 2 enforcement');
      const metadata = await registryMetadata();
      checkRegistry(metadata, identity);
      const npmCli = process.env.npm_execpath;
      assert.ok(npmCli, 'run prepare through npm exec');
      const [packed] = JSON.parse(execFileSync(process.execPath, [
        npmCli, 'pack', '--ignore-scripts', '--json', '--pack-destination', directory
      ], { encoding: 'utf8', timeout: 60_000 }));
      assert.equal(packed.name, name);
      assert.equal(packed.version, identity.version);
      const files = new Set(packed.files.map((entry) => entry.path));
      for (const required of ['package.json', 'dist/cli/index.js', 'dist/index.js', 'dist/index.d.ts', 'docs/AGENT_HANDOFF.md']) {
        assert.ok(files.has(required), 'required package file missing: ' + required);
      }
      const hashes = inspectTarball(file);
      assert.equal(hashes.integrity, packed.integrity, 'npm package integrity mismatch');
      Object.assign(report.candidate, hashes, { latestBefore: metadata['dist-tags'].latest });
    } else {
      assert.equal(process.env.GITHUB_REF_TYPE, 'tag', 'publication requires a release tag');
      assert.equal(identity.tag, 'preview', 'stable release is pending approved Profile 2 enforcement');
      const prepared = json(path.join(directory, 'prepare.json'));
      assert.equal(prepared.schemaVersion, 1);
      assert.equal(prepared.mode, 'prepare');
      assert.equal(prepared.passed, true, 'candidate preparation did not pass');
      assert.equal(prepared.preflight?.eligible, true, 'candidate has no passing preflight');
      for (const [key, value] of Object.entries({ ...identity, ...inspectTarball(file) })) {
        assert.equal(prepared.candidate[key], value, 'candidate binding mismatch: ' + key);
      }
      report.candidate = prepared.candidate;
      const metadata = await registryMetadata();
      checkRegistry(metadata, report.candidate, mode === 'published');
      if (mode === 'verify') {
        assert.equal(metadata['dist-tags'].latest, report.candidate.latestBefore, 'latest changed after candidate preparation');
        assert.ok(process.env.ACTIONS_ID_TOKEN_REQUEST_URL && process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN, 'GitHub OIDC is unavailable');
        assert.ok(!process.env.NODE_AUTH_TOKEN && !process.env.NPM_TOKEN, 'long-lived npm credentials are forbidden');
        writeFileSync(process.env.GITHUB_OUTPUT, 'tarball=' + file + '\ntag=' + identity.tag + '\n', { flag: 'a' });
      }
    }
    report.passed = true;
  } catch (error) {
    report.error = error.message;
    process.exitCode = 1;
  } finally {
    const output = JSON.stringify(report, null, 2) + '\n';
    writeFileSync(path.join(directory, mode + '.json'), output);
    process.stdout.write(output);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv[2], process.argv[3]);
}
