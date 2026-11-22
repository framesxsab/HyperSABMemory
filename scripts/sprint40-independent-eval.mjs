import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
    license: 'MIT',
    readmeFile: 'README.md',
    records: [
      { category: 'general', path: 'package.json', content: '@antfu/ni package manifest, ESM module exports, dependencies, and Vitest test scripts.' },
      { category: 'architecture', path: 'README.md', content: 'Usage guide for ni, nr, nlx, nu, nun, nci commands to detect and invoke the right package manager (npm, yarn, pnpm, bun, deno).' },
      { category: 'architecture', path: 'src/index.ts', content: 'Main library entry exporting config, detect, parse, runner, utils, and package-manager-detector commands and constants.' },
      { category: 'architecture', path: 'src/detect.ts', content: 'Detects package manager using deno.json check and package-manager-detector lockfiles, optionally auto-installing missing global agent.' },
      { category: 'architecture', path: 'src/config.ts', content: 'Loads configuration from .nirc ini file (NI_CONFIG_FILE) and environment variables (NI_DEFAULT_AGENT, NI_GLOBAL_AGENT, NI_USE_SFW, NI_CATALOG, NI_NO_LAST_COMMAND).' },
      { category: 'architecture', path: 'src/parse.ts', content: 'Parses CLI arguments into package manager commands parseNi, parseNr, parseNa, parseNun, parseNup, parseNlx, and handles UnsupportedCommand errors.' },
      { category: 'architecture', path: 'src/runner.ts', content: 'Runs CLI via runCli and getCliCommand, executes commands with tinyexec, supports interactive agent prompt and debug ? flag.' },
      { category: 'architecture', path: 'src/storage.ts', content: 'Persists and loads temporary CLI storage state including lastRunCommand in CLI_TEMP_DIR _storage.json.' },
      { category: 'architecture', path: 'src/fs.ts', content: 'Reads package.json manifests including Bun JSONC comments and trailing commas via getPackageJSON, findClosestPackageJson, and withPackageRoot.' },
      { category: 'architecture', path: 'src/utils.ts', content: 'Shared helpers CLI_TEMP_DIR, remove, exclude, cmdExists, writeFileSafe, limitText, and terminalLink.' },
      { category: 'architecture', path: 'src/package.ts', content: 'Reads workspace and single-package scripts and descriptions from package.json via readWorkspaceScripts and readPackageScripts.' },
      { category: 'architecture', path: 'src/monorepo.ts', content: 'Finds monorepo subpackages using tinyglobby findPackages and prompts interactive package selection.' },
      { category: 'architecture', path: 'src/completion.ts', content: 'Generates bash, zsh, and fish completion scripts and computes script suggestions with Fzf via getCompletionSuggestions.' },
      { category: 'architecture', path: 'src/environment.ts', content: 'Reads environment-based flags such as NI_AUTO_INSTALL into getEnvironmentOptions.' },
      { category: 'architecture', path: 'src/fetch.ts', content: 'Queries the npm registry search API via fetchNpmPackages for interactive package search.' },
      { category: 'architecture', path: 'src/catalog/detect.ts', content: 'Maps package manager agents pnpm, yarn@berry, and bun to their catalog provider implementations via getCatalogProvider.' },
      { category: 'architecture', path: 'src/catalog/spec.ts', content: 'Parses npm package specifiers via parsePackageSpec and checks version or protocol specifiers via isVerbatimSpec.' },
      { category: 'architecture', path: 'src/catalog/handler.ts', content: 'Coordinates workspace catalog detection, version resolution, prompting, and package.json catalog reference updates during install.' },
      { category: 'architecture', path: 'src/catalog/pnpm.ts', content: 'Detects and updates pnpm-workspace.yaml default and named catalogs for pnpm workspaces.' },
      { category: 'architecture', path: 'src/catalog/yarn.ts', content: 'Detects and updates .yarnrc.yml default and named catalogs for Yarn Berry workspaces.' },
      { category: 'architecture', path: 'src/catalog/bun.ts', content: 'Detects and updates package.json workspaces catalogs for Bun workspaces.' },
      { category: 'architecture', path: 'src/catalog/package-json.ts', content: 'Updates package.json dependency entries to catalog references with sorted keys and detected indentation.' },
      { category: 'architecture', path: 'src/catalog/range-prefix.ts', content: 'Determines semver range prefix from npmrc config or environment variables.' },
      { category: 'architecture', path: 'src/commands/ni.ts', content: 'CLI entry point for interactive and standard dependency installation via handleCatalogInstall and parseNi.' },
      { category: 'architecture', path: 'src/commands/nr.ts', content: 'CLI entry point for running package.json scripts using lastRunCommand storage and Fzf prompt selection.' },
      { category: 'general', path: 'test/config/config.test.ts', content: 'Vitest tests verifying default config values, .nirc file loading, and NI_* environment variable overrides.' },
      { category: 'general', path: 'test/config/warnings.test.ts', content: 'Vitest tests for .nirc unknown key warnings, case typo suggestions, and invalid ini handling.' },
      { category: 'general', path: 'test/programmatic/catalog-spec.spec.ts', content: 'Vitest tests for parsePackageSpec name/version splitting and isVerbatimSpec dist-tag checks.' },
      { category: 'general', path: 'test/package-json.spec.ts', content: 'Vitest tests for getPackageJSON plain JSON, JSONC comments, trailing commas, and withPackageRoot resolution.' },
      { category: 'general', path: 'test/programmatic/catalog-package-json.spec.ts', optional: true },
      { category: 'general', path: 'test/programmatic/package-json.spec.ts', content: 'Vitest tests for updatePackageJsonCatalogRefs alphabetical dependency sorting.' },
      { category: 'general', path: 'test/runner/runCli.test.ts', content: 'Vitest tests verifying runCli error handling, NI_AUTO_INSTALL option forwarding, and detect invocation.' },
      { category: 'general', path: 'test/programmatic/detect.spec.ts', content: 'Vitest matrix tests verifying detect across lockfile and package.json fixtures.' }
    ],
    queries: [
      {
        id: 'ni_detect',
        query: 'How does ni detect the package manager in a directory using lockfiles or package.json?',
        relevantPaths: ['src/detect.ts', 'README.md'],
        acceptablePaths: ['src/detect.ts', 'README.md', 'test/programmatic/detect.spec.ts']
      },
      {
        id: 'ni_config',
        query: 'How does ni load configuration from .nirc files and environment variables?',
        relevantPaths: ['src/config.ts', 'test/config/config.test.ts'],
        acceptablePaths: ['src/config.ts', 'test/config/config.test.ts', 'test/config/warnings.test.ts', 'README.md']
      },
      {
        id: 'ni_catalog_spec',
        query: 'How does ni parse package specifiers and determine whether a catalog specifier is verbatim?',
        relevantPaths: ['src/catalog/spec.ts', 'test/programmatic/catalog-spec.spec.ts'],
        acceptablePaths: ['src/catalog/spec.ts', 'test/programmatic/catalog-spec.spec.ts', 'src/catalog/handler.ts']
      },
      {
        id: 'ni_runner',
        query: 'How does ni run commands and handle interactive prompts or debug flags?',
        relevantPaths: ['src/runner.ts'],
        acceptablePaths: ['src/runner.ts', 'test/runner/runCli.test.ts', 'src/commands/ni.ts', 'src/commands/nr.ts']
      },
      {
        id: 'ni_parse',
        query: 'How does ni parse install, run, upgrade, and uninstall arguments across package managers?',
        relevantPaths: ['src/parse.ts'],
        acceptablePaths: ['src/parse.ts', 'src/index.ts']
      },
      {
        id: 'ni_storage',
        query: 'How does ni persist the last run command in temporary storage?',
        relevantPaths: ['src/storage.ts'],
        acceptablePaths: ['src/storage.ts', 'src/commands/nr.ts', 'src/utils.ts']
      },
      {
        id: 'ni_catalog_detect',
        query: 'How does ni detect workspace catalogs for pnpm, yarn, or bun?',
        relevantPaths: ['src/catalog/detect.ts'],
        acceptablePaths: ['src/catalog/detect.ts', 'src/catalog/pnpm.ts', 'src/catalog/yarn.ts', 'src/catalog/bun.ts', 'src/catalog/handler.ts']
      },
      { id: 'ni_unans_redis', query: 'How does ni authenticate with a private Redis cache cluster?', relevantPaths: [], acceptablePaths: [] },
      { id: 'ni_unans_k8s', query: 'Where is Kubernetes pod autoscaling configured in ni?', relevantPaths: [], acceptablePaths: [] },
      { id: 'ni_unans_pg', query: 'What PostgreSQL migration tool does ni use for schema versioning?', relevantPaths: [], acceptablePaths: [] }
    ],
    implementationChecks: [
      {
        id: 'ni_spec_impl_and_test',
        query: 'Where is parsePackageSpec implemented and which tests call it?',
        expectedSymbol: 'parsePackageSpec',
        expectedCodePath: 'src/catalog/spec.ts',
        expectedTestPath: 'test/programmatic/catalog-spec.spec.ts',
        expectedTestName: 'returns the bare name when no version is given'
      },
      {
        id: 'ni_isverbatim_impl_and_test',
        query: 'Where is isVerbatimSpec implemented and which tests call it?',
        expectedSymbol: 'isVerbatimSpec',
        expectedCodePath: 'src/catalog/spec.ts',
        expectedTestPath: 'test/programmatic/catalog-spec.spec.ts',
        expectedTestName: null
      },
      {
        id: 'ni_detect_code',
        query: 'Where is detect implemented and what does it call?',
        expectedSymbol: 'detect',
        expectedCodePath: 'src/detect.ts',
        expectedCallSnippet: 'detectPM',
        expectedTestPath: null
      }
    ],
    shadowedProbe: {
      testPath: 'test/programmatic/shadowed-spec.spec.ts',
      content: "import { describe, expect, it } from 'vitest'\nimport { parsePackageSpec } from '../../src/catalog/spec'\n\ndescribe('shadowed', () => {\n  it('uses local shadow only', () => {\n    const parsePackageSpec = (raw: string) => ({ raw, name: raw })\n    expect(parsePackageSpec('esbuild')).toEqual({ raw: 'esbuild', name: 'esbuild' })\n  })\n})\n",
      recordContent: 'Shadowed local parsePackageSpec test without calling imported target',
      query: 'Where is parsePackageSpec implemented and which tests call it?'
    },
    exactJsonChecks: [
      { query: 'What is the value of `name` in `package.json`?', expectedValue: '@antfu/ni', path: 'package.json', expectVerified: true },
      { query: 'What is the value of `version` in `package.json`?', expectedValue: '30.6.0', path: 'package.json', expectVerified: true },
      { query: 'What is the value of `type` in `package.json`?', expectedValue: 'module', path: 'package.json', expectVerified: false },
      { query: 'What is the value of `repository.type` in `package.json`?', expectedValue: 'git', path: 'package.json', expectVerified: true },
      { query: 'What is the value of `$.type` in `package.json`?', expectedValue: 'module', path: 'package.json', expectVerified: true },
      { query: 'What is the value of root `type` in `package.json`?', expectedValue: 'module', path: 'package.json', expectVerified: true }
    ],
    exactSymbolCheck: {
      query: 'Where is `parsePackageSpec` defined?',
      symbol: 'parsePackageSpec',
      path: 'src/catalog/spec.ts'
    }
  },
  {
    key: 'commander',
    name: 'tj/commander.js',
    url: 'https://github.com/tj/commander.js.git',
    commit: 'a5a7dc084d4d2b7932e85ca049c5204e50a2c721',
    license: 'MIT',
    readmeFile: 'Readme.md',
    records: [
      { category: 'general', path: 'package.json', content: 'commander v15 package manifest, ESM module type, Node >=22.12.0 engine, typings, and node --test test script.' },
      { category: 'architecture', path: 'Readme.md', content: 'Commander.js documentation covering installation, options, commands, arguments, help output, lifecycle hooks, error handling, and TypeScript support.' },
      { category: 'architecture', path: 'index.js', content: 'Top-level ESM entrypoint exposing default program, createCommand, createOption, createArgument, Command, Option, Argument, Help, CommanderError, InvalidArgumentError.' },
      { category: 'architecture', path: 'lib/suggestSimilar.js', content: 'Computes Damerau-Levenshtein editDistance and suggestSimilar command or option did-you-mean suggestions after CLI errors.' },
      { category: 'architecture', path: 'lib/error.js', content: 'Defines CommanderError and InvalidArgumentError classes storing exitCode, error code, and message.' },
      { category: 'architecture', path: 'lib/option.js', content: 'Defines Option class for flags, defaults, presets, conflicts, implied options, env vars, and DualOptions positive/negative tracking via valueFromOption.' },
      { category: 'architecture', path: 'lib/argument.js', content: 'Defines Argument class handling required <> vs optional [] names, variadic ... arguments, default values, argParser, and choices.' },
      { category: 'architecture', path: 'lib/help.js', content: 'Defines Help class formatting help text, prepareContext, visibleCommands, visibleOptions, visibleGlobalOptions, compareOptions sorting, and wrapping.' },
      { category: 'architecture', path: 'lib/command.js', content: 'Defines Command class, subcommands, option parsing, lifecycle hooks, color output helper useColor, exitOverride, and configureOutput.' },
      { category: 'architecture', path: 'docs/parsing-and-hooks.md', content: 'Explains parsing lifecycle across subcommands, mandatory/conflicting/unknown checks, preSubcommand, preAction, and postAction lifecycle hooks.' },
      { category: 'architecture', path: 'docs/options-in-depth.md', content: 'Explains parsing ambiguity with optional or variadic options, use of -- separator, and short option flag combinations.' },
      { category: 'architecture', path: 'docs/help-in-depth.md', content: 'Explains customizing Help class data properties, sortSubcommands, sortOptions, styling, and NO_COLOR / FORCE_COLOR color stripping.' },
      { category: 'architecture', path: 'docs/terminology.md', content: 'Defines CLI terms option, option-argument, command, and command-argument.' },
      { category: 'architecture', path: 'docs/release-policy.md', content: 'Documents Commander Semantic Versioning 6-month major release schedule and maintenance window.' },
      { category: 'architecture', path: 'docs/deprecated.md', content: 'Documents deprecated Commander APIs and migration guidance.' },
      { category: 'general', path: 'tests/help.suggestion.test.js', content: 'node:test tests for Command.showSuggestionAfterError command and option suggestions using node:assert/strict.' },
      { category: 'general', path: 'tests/command.error.test.js', content: 'node:test tests verifying Command.error() stderr output, exitCode values 1 or 2, and exitOverride thrown CommanderError code.' },
      { category: 'general', path: 'tests/options.dual-options.test.js', content: 'node:test unit tests directly importing Option and DualOptions to test positiveOptions, negativeOptions, and DualOptions.valueFromOption.' },
      { category: 'general', path: 'tests/argument.choices.test.js', content: 'node:test tests verifying Argument.choices accepts allowed values, rejects invalid arguments, and keeps input choices array readonly.' },
      { category: 'general', path: 'tests/command.hook.test.js', content: 'node:test tests verifying preAction FIFO and postAction LIFO hook execution order and error validation.' },
      { category: 'general', path: 'tests/options.conflicts.test.js', content: 'node:test tests verifying Option.conflicts mutually exclusive option checks and error reporting.' },
      { category: 'general', path: 'tests/useColor.test.js', content: 'node:test unit tests directly importing useColor from lib/command.js and asserting behavior for NO_COLOR, FORCE_COLOR, and CLICOLOR_FORCE.' },
      { category: 'general', path: 'tests/help.sortCommands.test.js', content: 'node:test tests verifying Help.sortSubcommands alphabetical ordering.' },
      { category: 'general', path: 'tests/help.sortOptions.test.js', content: 'node:test tests verifying Help.sortOptions option flag ordering.' },
      { category: 'general', path: 'tests/command.exitOverride.test.js', content: 'node:test tests verifying Command.exitOverride prevents process exit and throws CommanderError.' }
    ],
    queries: [
      {
        id: 'cmd_suggest',
        query: 'How does Commander suggest similar command or option names after an error?',
        relevantPaths: ['lib/suggestSimilar.js', 'tests/help.suggestion.test.js'],
        acceptablePaths: ['lib/suggestSimilar.js', 'tests/help.suggestion.test.js', 'lib/command.js']
      },
      {
        id: 'cmd_error',
        query: 'How does Commander define CommanderError and InvalidArgumentError with exit codes?',
        relevantPaths: ['lib/error.js', 'tests/command.error.test.js'],
        acceptablePaths: ['lib/error.js', 'tests/command.error.test.js', 'index.js']
      },
      {
        id: 'cmd_dual_options',
        query: 'How does Commander parse option flags and manage DualOptions positive and negative pairs?',
        relevantPaths: ['lib/option.js', 'tests/options.dual-options.test.js'],
        acceptablePaths: ['lib/option.js', 'tests/options.dual-options.test.js', 'docs/options-in-depth.md']
      },
      {
        id: 'cmd_argument',
        query: 'How does Commander parse required, optional, and variadic command arguments?',
        relevantPaths: ['lib/argument.js', 'tests/argument.choices.test.js'],
        acceptablePaths: ['lib/argument.js', 'tests/argument.choices.test.js', 'docs/terminology.md']
      },
      {
        id: 'cmd_help',
        query: 'How does Commander format help text, sort options, and compute visible commands?',
        relevantPaths: ['lib/help.js'],
        acceptablePaths: ['lib/help.js', 'docs/help-in-depth.md', 'tests/help.sortCommands.test.js', 'tests/help.sortOptions.test.js']
      },
      {
        id: 'cmd_hooks',
        query: 'How does Commander support preAction, postAction, and preSubcommand lifecycle hooks?',
        relevantPaths: ['docs/parsing-and-hooks.md'],
        acceptablePaths: ['docs/parsing-and-hooks.md', 'tests/command.hook.test.js', 'Readme.md', 'lib/command.js']
      },
      {
        id: 'cmd_usecolor',
        query: 'How does Commander determine color output from NO_COLOR, FORCE_COLOR, and CLICOLOR_FORCE environment variables?',
        relevantPaths: ['lib/command.js', 'tests/useColor.test.js'],
        acceptablePaths: ['lib/command.js', 'tests/useColor.test.js', 'docs/help-in-depth.md']
      },
      { id: 'cmd_unans_graphql', query: 'How does Commander manage GraphQL subscriptions over WebSockets?', relevantPaths: [], acceptablePaths: [] },
      { id: 'cmd_unans_oauth', query: 'Where does Commander configure OAuth2 PKCE token refresh intervals?', relevantPaths: [], acceptablePaths: [] },
      { id: 'cmd_unans_sqlite', query: 'What SQLite write-ahead log checkpoint threshold does Commander enforce?', relevantPaths: [], acceptablePaths: [] }
    ],
    implementationChecks: [
      {
        id: 'cmd_usecolor_impl_and_test',
        query: 'Where is useColor implemented and which tests call it?',
        expectedSymbol: 'useColor',
        expectedCodePath: 'lib/command.js',
        expectedTestPath: 'tests/useColor.test.js',
        expectedTestName: 'when no ENV defined then returns undefined'
      },
      {
        id: 'cmd_dualoptions_impl_and_test',
        query: 'Where is valueFromOption implemented and which tests call it?',
        expectedSymbol: 'DualOptions.valueFromOption',
        expectedCodePath: 'lib/option.js',
        expectedTestPath: 'tests/options.dual-options.test.js',
        expectedTestName: 'when negativeOption with false then return true'
      },
      {
        id: 'cmd_suggest_code',
        query: 'Where is suggestSimilar implemented and what does it call?',
        expectedSymbol: 'suggestSimilar',
        expectedCodePath: 'lib/suggestSimilar.js',
        expectedCallSnippet: 'editDistance',
        expectedTestPath: null
      }
    ],
    shadowedProbe: {
      testPath: 'tests/shadowed-useColor.test.js',
      content: "import { describe, test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { useColor } from '../lib/command.js';\n\ndescribe('shadowed', () => {\n  test('calls shadowed local useColor only', () => {\n    const useColor = () => undefined;\n    assert.equal(useColor(), undefined);\n  });\n});\n",
      recordContent: 'Shadowed local useColor test without calling imported target',
      query: 'Where is useColor implemented and which tests call it?'
    },
    exactJsonChecks: [
      { query: 'What is the value of `name` in `package.json`?', expectedValue: 'commander', path: 'package.json', expectVerified: true },
      { query: 'What is the value of `version` in `package.json`?', expectedValue: '15.1.0', path: 'package.json', expectVerified: true },
      { query: 'What is the value of `type` in `package.json`?', expectedValue: 'module', path: 'package.json', expectVerified: false },
      { query: 'What is the value of `repository.type` in `package.json`?', expectedValue: 'git', path: 'package.json', expectVerified: true },
      { query: 'What is the value of `$.type` in `package.json`?', expectedValue: 'module', path: 'package.json', expectVerified: true },
      { query: 'What is the value of root `type` in `package.json`?', expectedValue: 'module', path: 'package.json', expectVerified: true }
    ],
    exactSymbolCheck: {
      query: 'Where is `suggestSimilar` defined?',
      symbol: 'suggestSimilar',
      path: 'lib/suggestSimilar.js'
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

function sha256File(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
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
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, encoding: 'utf8' }).trim();
  assert.equal(head, spec.commit);
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
  execFileSync('git', ['init'], { cwd: targetDir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'Independent Eval'], { cwd: targetDir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'eval@example.invalid'], { cwd: targetDir, stdio: 'pipe' });
  execFileSync('git', ['add', '.'], { cwd: targetDir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'pinned baseline'], { cwd: targetDir, stdio: 'pipe' });
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: targetDir, encoding: 'utf8' }).trim();
}

const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-s40-independent-'));
const reposBase = process.env.HM40_REPOS_DIR ?? path.join(os.tmpdir(), 'hm-sprint40-repos');

try {
  const packStart = performance.now();
  execFileSync(process.execPath, [npmCli, 'pack', '--ignore-scripts', '--pack-destination', tempRoot], {
    cwd: repoRoot,
    stdio: 'pipe'
  });
  const packMs = +(performance.now() - packStart).toFixed(2);
  const tarball = path.join(tempRoot, `${manifest.name}-${manifest.version}.tgz`);
  const tarballBytes = fs.statSync(tarball).size;

  const installDir = path.join(tempRoot, 'install');
  fs.mkdirSync(installDir);
  const installStart = performance.now();
  execFileSync(process.execPath, [npmCli, 'install', '--prefix', installDir, '--no-audit', '--no-fund', tarball], {
    cwd: tempRoot,
    stdio: 'pipe'
  });
  const installMs = +(performance.now() - installStart).toFixed(2);

  const cli = path.join(installDir, 'node_modules', manifest.name, 'dist', 'cli', 'index.js');
  const installedVersion = execFileSync(process.execPath, [cli, '--version'], { encoding: 'utf8' }).trim();
  assert.equal(installedVersion, manifest.version);

  const emptyCache = path.join(tempRoot, 'offline-npm-cache');
  const emptyPrefix = path.join(tempRoot, 'offline-npm-prefix');
  fs.mkdirSync(emptyCache, { recursive: true });
  fs.mkdirSync(emptyPrefix, { recursive: true });
  const offlineEnv = {
    ...process.env,
    npm_config_offline: 'true',
    npm_config_registry: 'http://127.0.0.1:1',
    npm_config_cache: emptyCache,
    npm_config_prefix: emptyPrefix
  };

  async function connectMcp(cwd, name, launch) {
    const client = new Client({ name, version: '1.0.0' });
    const started = performance.now();
    await client.connect(new StdioClientTransport({
      command: launch.command,
      args: launch.args,
      cwd,
      env: offlineEnv,
      stderr: 'pipe'
    }));
    const tools = await client.listTools();
    const resources = await client.listResources();
    const startupAndDiscoveryMs = +(performance.now() - started).toFixed(2);
    return { client, tools: tools.tools.map((t) => t.name), resources: resources.resources.map((r) => r.uri), startupAndDiscoveryMs };
  }

  const repoReports = [];

  for (const spec of REPOS) {
    const cloneDir = ensureRepoClone(reposBase, spec);
    const workspace = path.join(tempRoot, `ws-${spec.key}`);
    fs.mkdirSync(workspace, { recursive: true });
    const baselineHead = copyTrackedRepo(cloneDir, workspace);

    // D. Consumer setup & idempotency + direct offline MCP config verification
    const setupStart = performance.now();
    execFileSync(process.execPath, [cli, 'setup'], { cwd: workspace, stdio: 'pipe' });
    const setupFirstMs = +(performance.now() - setupStart).toFixed(2);

    const claudeEntry = JSON.parse(fs.readFileSync(path.join(workspace, '.mcp.json'), 'utf8')).mcpServers?.hypersabmemory;
    const cursorEntry = JSON.parse(fs.readFileSync(path.join(workspace, '.cursor', 'mcp.json'), 'utf8')).mcpServers?.hypersabmemory;
    const vscodeEntry = JSON.parse(fs.readFileSync(path.join(workspace, '.vscode', 'mcp.json'), 'utf8')).servers?.hypersabmemory;
    assert.ok(claudeEntry && cursorEntry && vscodeEntry, `${spec.key} setup must write all three host configs`);
    assert.equal(claudeEntry.command, process.execPath, `${spec.key} setup must use installed Node executable without npx`);
    assert.equal(path.resolve(claudeEntry.args[0]), path.resolve(cli), `${spec.key} setup must point to installed dist/cli/index.js`);
    assert.equal(claudeEntry.args[1], 'mcp');
    const offlineConfigGenerated =
      claudeEntry.command === process.execPath &&
      !claudeEntry.args.includes('npx') &&
      cursorEntry.command === process.execPath &&
      vscodeEntry.command === process.execPath;

    const storePath = path.join(workspace, '.hypersabmemory', 'memory_store.json');
    const firstStore = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    const firstSeeds = firstStore.filter((r) => r.source === 'seed').map((r) => ({ id: r.id, content: r.content }));

    const setupRepeatStart = performance.now();
    execFileSync(process.execPath, [cli, 'setup'], { cwd: workspace, stdio: 'pipe' });
    const setupRepeatMs = +(performance.now() - setupRepeatStart).toFixed(2);
    const repeatStore = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    const repeatSeeds = repeatStore.filter((r) => r.source === 'seed');
    assert.equal(repeatSeeds.length, firstSeeds.length, `${spec.key} repeat setup must not duplicate seeds`);
    assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workspace, encoding: 'utf8' }).trim(), baselineHead, `${spec.key} setup must not commit`);

    const mcp = await connectMcp(workspace, `eval-${spec.key}-1`, claudeEntry);
    try {
      const scoped = await mcp.client.callTool({ name: 'hypersabmemory_scope_sources', arguments: {} });
      assert.ok(!scoped.isError, `scope_sources failed for ${spec.key}`);
      const discoveredSources = scoped.structuredContent?.sources ?? [];
      const rootReadme = discoveredSources.find((s) => s.path === spec.readmeFile);
      assert.ok(rootReadme, `${spec.key} must discover exact root documentation ${spec.readmeFile}`);
      assert.equal(rootReadme.status, 'current');
      assert.equal(rootReadme.sha256, sha256File(path.join(workspace, spec.readmeFile)));
      const remembered = [];
      for (const entry of spec.records) {
        if (!entry.content) continue;
        const abs = path.join(workspace, entry.path);
        if (!fs.existsSync(abs)) continue;
        const res = await mcp.client.callTool({
          name: 'hypersabmemory_remember',
          arguments: { category: entry.category, content: entry.content, artifacts: [entry.path] }
        });
        assert.ok(!res.isError, `remember failed for ${entry.path}`);
        remembered.push(entry.path);
      }

      // A. Retrieval Quality
      const retrievalLatencyMs = [];
      const responseBytes = [];
      const queryDetails = [];
      let answerableP5Sum = 0;
      let answerableR5Sum = 0;
      let answerableMrrSum = 0;
      let answerableTop1Hits = 0;
      let answerableCount = 0;
      let unrelatedStrictTop5 = 0;
      let unrelatedAcceptableTop5 = 0;
      let noAnswerUnsupportedAssertions = 0;
      let attributionChecks = 0;
      let attributionValid = 0;

      for (const item of spec.queries) {
        const qStart = performance.now();
        const res = await mcp.client.callTool({
          name: 'hypersabmemory_query_evidence',
          arguments: { query: item.query, limit: 5 }
        });
        const elapsed = +(performance.now() - qStart).toFixed(2);
        retrievalLatencyMs.push(elapsed);
        const text = res.content[0]?.text ?? '';
        responseBytes.push(Buffer.byteLength(text, 'utf8'));
        assert.ok(!res.isError, `query_evidence failed for ${item.id}`);
        const packet = JSON.parse(text);
        const topPaths = packet.evidence.map((e) => e.source.path);
        for (const e of packet.evidence) {
          attributionChecks++;
          const diskSha = fs.existsSync(path.join(workspace, e.source.path))
            ? sha256File(path.join(workspace, e.source.path))
            : null;
          if (/^[a-f0-9]{64}$/.test(e.source.sha256) && e.source.freshness === 'current' && diskSha === e.source.sha256) {
            attributionValid++;
          }
        }
        if (item.relevantPaths.length > 0) {
          answerableCount++;
          const hits = topPaths.filter((p) => item.relevantPaths.includes(p));
          const p5 = hits.length / 5;
          const r5 = hits.length / item.relevantPaths.length;
          const firstIdx = topPaths.findIndex((p) => item.relevantPaths.includes(p));
          const rr = firstIdx >= 0 ? 1 / (firstIdx + 1) : 0;
          const top1 = topPaths.length > 0 && item.relevantPaths.includes(topPaths[0]);
          const unrelatedStrict = topPaths.filter((p) => !item.relevantPaths.includes(p)).length;
          const unrelatedAcceptable = topPaths.filter((p) => !item.acceptablePaths.includes(p)).length;
          answerableP5Sum += p5;
          answerableR5Sum += r5;
          answerableMrrSum += rr;
          if (top1) answerableTop1Hits++;
          unrelatedStrictTop5 += unrelatedStrict;
          unrelatedAcceptableTop5 += unrelatedAcceptable;
          queryDetails.push({
            id: item.id,
            answerable: true,
            topPaths,
            relevantPaths: item.relevantPaths,
            hits,
            pAt5: +p5.toFixed(4),
            rAt5: +r5.toFixed(4),
            mrr: +rr.toFixed(4),
            top1Hit: top1,
            unrelatedStrict,
            unrelatedAcceptable,
            answerVerified: packet.answerVerified,
            latencyMs: elapsed
          });
        } else {
          if (packet.answerVerified || packet.assertions.length > 0) noAnswerUnsupportedAssertions++;
          queryDetails.push({
            id: item.id,
            answerable: false,
            topPaths,
            recordCount: packet.records.length,
            evidenceCount: packet.evidence.length,
            evidenceClassification: packet.evidenceClassification ?? null,
            groundedSourceExcerpts: packet.evidenceSummary?.groundedSourceExcerpts ?? 0,
            weakCandidateExcerpts: packet.evidenceSummary?.weakCandidateExcerpts ?? 0,
            answerVerified: packet.answerVerified,
            assertionsCount: packet.assertions.length,
            status: packet.status,
            latencyMs: elapsed
          });
        }
      }

      // B. Implementation & Test Evidence
      const implLatencies = [];
      const implResults = [];
      for (const check of spec.implementationChecks) {
        const start = performance.now();
        const res = await mcp.client.callTool({
          name: 'hypersabmemory_query_evidence',
          arguments: { query: check.query, limit: 5 }
        });
        const elapsed = +(performance.now() - start).toFixed(2);
        implLatencies.push(elapsed);
        const packet = JSON.parse(res.content[0].text);
        const codeEntries = packet.implementationEvidence?.code ?? [];
        const testEntries = packet.implementationEvidence?.tests ?? [];
        const matchedCode = codeEntries.find((c) => c.symbol === check.expectedSymbol && c.source.path === check.expectedCodePath);
        const codeShaOk = matchedCode ? matchedCode.source.sha256 === sha256File(path.join(workspace, check.expectedCodePath)) : false;
        const callOk = check.expectedCallSnippet
          ? Boolean(matchedCode?.facts?.some((f) => f.kind === 'call_site' && f.source.excerpt.includes(check.expectedCallSnippet)))
          : true;
        let testLinked = false;
        let testExecutionUnverified = true;
        let matchedTestDetail = null;
        if (check.expectedTestPath) {
          const tMatch = testEntries.find((t) =>
            t.symbol === check.expectedSymbol &&
            t.source.path === check.expectedTestPath &&
            (!check.expectedTestName || t.name === check.expectedTestName)
          );
          if (tMatch) {
            testLinked = true;
            testExecutionUnverified = tMatch.execution === 'unverified';
            matchedTestDetail = {
              symbol: tMatch.symbol,
              name: tMatch.name,
              path: tMatch.source.path,
              startLine: tMatch.source.startLine,
              execution: tMatch.execution,
              shaMatch: tMatch.source.sha256 === sha256File(path.join(workspace, check.expectedTestPath))
            };
          }
        }
        implResults.push({
          id: check.id,
          query: check.query,
          latencyMs: elapsed,
          codeFound: Boolean(matchedCode),
          codeShaOk,
          callOk,
          expectedTestPath: check.expectedTestPath,
          testLinked: check.expectedTestPath ? testLinked : null,
          testExecutionUnverified,
          matchedTestDetail,
          allReturnedCodeSymbols: codeEntries.map((c) => ({ symbol: c.symbol, path: c.source.path, lines: [c.source.startLine, c.source.endLine], callSites: c.facts.length })),
          allReturnedTests: testEntries.map((t) => ({ symbol: t.symbol, name: t.name, path: t.source.path, line: t.source.startLine, execution: t.execution }))
        });
      }

      // Shadowed import negative probe (in isolated disposable test file removed afterwards)
      const shadowAbs = path.join(workspace, spec.shadowedProbe.testPath);
      fs.writeFileSync(shadowAbs, spec.shadowedProbe.content);
      const shadowMem = await mcp.client.callTool({
        name: 'hypersabmemory_remember',
        arguments: { category: 'general', content: spec.shadowedProbe.recordContent, artifacts: [spec.shadowedProbe.testPath] }
      });
      assert.ok(!shadowMem.isError);
      const shadowRes = await mcp.client.callTool({
        name: 'hypersabmemory_query_evidence',
        arguments: { query: spec.shadowedProbe.query, limit: 5 }
      });
      const shadowPacket = JSON.parse(shadowRes.content[0].text);
      const shadowedLinked = (shadowPacket.implementationEvidence?.tests ?? []).some(
        (t) => t.source.path === spec.shadowedProbe.testPath
      );
      const shadowId = shadowMem.content[0].text.match(/\[([^\]]+)\]/)?.[1];
      if (shadowId) await mcp.client.callTool({ name: 'hypersabmemory_forget', arguments: { id: shadowId } });
      fs.unlinkSync(shadowAbs);

      // Parameterized false-link probes (shadowed parameter & type-only import inside it.each) on ni
      let parameterizedFalseLinksRejected = null;
      if (spec.key === 'ni') {
        const paramProbes = [
          {
            file: 'test/programmatic/shadowed-param.spec.ts',
            code: "import { expect, it } from 'vitest'\nimport { isVerbatimSpec } from '../../src/catalog/spec'\nit.each(['latest'])('shadowed %s', (isVerbatimSpec) => {\n  expect(isVerbatimSpec('latest')).toBe(false)\n})\n"
          },
          {
            file: 'test/programmatic/typeonly-param.spec.ts',
            code: "import { expect, it } from 'vitest'\nimport type { isVerbatimSpec } from '../../src/catalog/spec'\nit.each(['latest'])('erased %s', (spec) => {\n  expect(isVerbatimSpec(spec)).toBe(false)\n})\n"
          }
        ];
        parameterizedFalseLinksRejected = true;
        for (const p of paramProbes) {
          const abs = path.join(workspace, p.file);
          fs.writeFileSync(abs, p.code);
          const mem = await mcp.client.callTool({
            name: 'hypersabmemory_remember',
            arguments: { category: 'general', content: `Negative parameterized probe ${p.file}`, artifacts: [p.file] }
          });
          const qRes = await mcp.client.callTool({
            name: 'hypersabmemory_query_evidence',
            arguments: { query: 'Where is isVerbatimSpec implemented and which tests call it?', limit: 5 }
          });
          const qPacket = JSON.parse(qRes.content[0].text);
          if ((qPacket.implementationEvidence?.tests ?? []).some((t) => t.source.path === p.file)) {
            parameterizedFalseLinksRejected = false;
          }
          const memId = mem.content[0].text.match(/\[([^\]]+)\]/)?.[1];
          if (memId) await mcp.client.callTool({ name: 'hypersabmemory_forget', arguments: { id: memId } });
          fs.unlinkSync(abs);
        }
      }

      // C. Grounding Safety, Exact Checks, Freshness & Containment
      const exactJsonResults = [];
      for (const jc of spec.exactJsonChecks) {
        const res = await mcp.client.callTool({
          name: 'hypersabmemory_query_evidence',
          arguments: { query: jc.query, limit: 5 }
        });
        const packet = JSON.parse(res.content[0].text);
        const ev = packet.evidence.find((e) => e.source.path === jc.path);
        const lines = fs.readFileSync(path.join(workspace, jc.path), 'utf8').split(/\r?\n/);
        const lineAccurate = Boolean(ev?.source?.line && lines[ev.source.line - 1]?.includes(jc.expectedValue));
        const expectedSha = sha256File(path.join(workspace, jc.path));
        exactJsonResults.push({
          query: jc.query,
          expectedValue: jc.expectedValue,
          expectVerified: jc.expectVerified,
          answerVerified: packet.answerVerified,
          matchedExpectation: packet.answerVerified === jc.expectVerified,
          hasAssertion: jc.expectVerified
            ? packet.assertions.some((a) => a.claim.includes(jc.expectedValue))
            : packet.assertions.length === 0,
          shaMatch: jc.expectVerified ? ev?.source?.sha256 === expectedSha : true,
          line: ev?.source?.line ?? null,
          lineAccurate: jc.expectVerified ? lineAccurate : null
        });
      }

      const symRes = await mcp.client.callTool({
        name: 'hypersabmemory_query_evidence',
        arguments: { query: spec.exactSymbolCheck.query, limit: 5 }
      });
      const symPacket = JSON.parse(symRes.content[0].text);
      const symEv = symPacket.evidence.find((e) => e.source.path === spec.exactSymbolCheck.path);
      const symLines = fs.readFileSync(path.join(workspace, spec.exactSymbolCheck.path), 'utf8').split(/\r?\n/);
      const exactSymbolResult = {
        query: spec.exactSymbolCheck.query,
        answerVerified: symPacket.answerVerified,
        sourcePath: symEv?.source?.path ?? null,
        line: symEv?.source?.line ?? null,
        lineAccurate: Boolean(symEv?.source?.line && symLines[symEv.source.line - 1]?.includes(spec.exactSymbolCheck.symbol)),
        shaMatch: symEv?.source?.sha256 === sha256File(path.join(workspace, spec.exactSymbolCheck.path))
      };

      // Same-size rewrite + deleted file + conflict + containment via task tools
      const sameSizePath = 'sprint40-decision-probe.md';
      const origText = 'Decision: Keep cache keys deterministic.\nRationale: Preserve reproducible builds.\n';
      const sameSizeText = 'Decision: Keep cache keys DETERMINISTIC.\nRationale: Preserve reproducible builds.\n';
      assert.equal(Buffer.byteLength(origText), Buffer.byteLength(sameSizeText));
      fs.writeFileSync(path.join(workspace, sameSizePath), origText);

      const deletedPath = 'sprint40-deleted-probe.md';
      fs.writeFileSync(path.join(workspace, deletedPath), 'Decision: Temporary probe source.\n');

      const taskCreated = await mcp.client.callTool({
        name: 'hypersabmemory_task_create',
        arguments: {
          goal: `Verify ${spec.key} grounding safety`,
          acceptanceCriteria: ['Check same-size rewrite and missing file detection'],
          sourceRefs: [spec.readmeFile, sameSizePath, deletedPath]
        }
      });
      assert.ok(!taskCreated.isError);
      const taskId = taskCreated.structuredContent.taskId;

      const freshTaskQuery = await mcp.client.callTool({
        name: 'hypersabmemory_task_grounded_query',
        arguments: { taskId, query: 'Does `sprint40-decision-probe.md` contain `Keep cache keys deterministic.`?' }
      });
      assert.equal(freshTaskQuery.structuredContent.canAssert, true);

      // Overwrite with identical byte length & unlink deletedPath
      fs.writeFileSync(path.join(workspace, sameSizePath), sameSizeText);
      fs.unlinkSync(path.join(workspace, deletedPath));

      const staleTaskQuery = await mcp.client.callTool({
        name: 'hypersabmemory_task_grounded_query',
        arguments: { taskId, query: 'Does `sprint40-decision-probe.md` contain `Keep cache keys deterministic.`?' }
      });
      const sameSizeDetected =
        staleTaskQuery.structuredContent.canAssert === false &&
        staleTaskQuery.structuredContent.staleSources.some((s) => s.path === sameSizePath && s.status === 'modified') &&
        staleTaskQuery.structuredContent.evidence.every((e) => e.source.path !== sameSizePath);

      const missingTaskQuery = await mcp.client.callTool({
        name: 'hypersabmemory_task_grounded_query',
        arguments: { taskId, query: 'Does `sprint40-deleted-probe.md` contain `Temporary probe source.`?' }
      });
      const missingDetected =
        missingTaskQuery.structuredContent.canAssert === false &&
        missingTaskQuery.structuredContent.staleSources.some((s) => s.path === deletedPath && s.status === 'missing');

      // Forgotten-memory exclusion (opaque sentinel avoids colliding with repo-name subtokens)
      const sentinel = `sprint40canarytoken918273${spec.key}`;
      const addedSecret = await mcp.client.callTool({
        name: 'hypersabmemory_remember',
        arguments: { category: 'bug', content: `${sentinel} transient note`, artifacts: [spec.readmeFile] }
      });
      const secretId = addedSecret.content[0].text.match(/\[([^\]]+)\]/)?.[1];
      assert.ok(secretId, 'remember returns record id');
      const beforeForget = await mcp.client.callTool({ name: 'hypersabmemory_query', arguments: { query: sentinel, source: 'memory' } });
      assert.ok(beforeForget.content[0].text.includes(sentinel));
      await mcp.client.callTool({ name: 'hypersabmemory_forget', arguments: { id: secretId } });
      const afterForgetQuery = await mcp.client.callTool({ name: 'hypersabmemory_query', arguments: { query: sentinel, source: 'memory' } });
      const afterForgetEvidence = await mcp.client.callTool({ name: 'hypersabmemory_query_evidence', arguments: { query: sentinel, limit: 5 } });
      const afterForgetEvPacket = JSON.parse(afterForgetEvidence.content[0].text);
      const forgottenExcluded =
        !afterForgetQuery.content[0].text.includes(sentinel) &&
        afterForgetEvPacket.records.length === 0 &&
        afterForgetEvPacket.evidence.length === 0 &&
        afterForgetEvPacket.assertions.length === 0 &&
        !JSON.stringify({
          records: afterForgetEvPacket.records,
          evidence: afterForgetEvPacket.evidence,
          claims: afterForgetEvPacket.claims,
          assertions: afterForgetEvPacket.assertions
        }).includes(sentinel);

      // Conflicting evidence abstention
      const conflictA = 'sprint40-conflict-decision.md';
      const conflictB = 'sprint40-conflict-rules.md';
      fs.writeFileSync(path.join(workspace, conflictA), 'Decision: Reject ambiguous flags.\nRationale: Prevent silent bugs.\n');
      fs.writeFileSync(path.join(workspace, conflictB), 'Decision-Source: sprint40-conflict-decision.md\nConstraint: Reject ambiguous flags.\nConstraint: Accept ambiguous flags.\n');
      const conflictTask = await mcp.client.callTool({
        name: 'hypersabmemory_task_create',
        arguments: {
          goal: 'Verify conflict abstention',
          acceptanceCriteria: ['Must abstain on contradiction'],
          sourceRefs: [conflictA, conflictB]
        }
      });
      const conflictRes = await mcp.client.callTool({
        name: 'hypersabmemory_task_grounded_query',
        arguments: { taskId: conflictTask.structuredContent.taskId, query: `What constraint in \`${conflictB}\` is recorded for the decision in \`${conflictA}\`?` }
      });
      const declaredConflictRes = await mcp.client.callTool({
        name: 'hypersabmemory_task_grounded_query',
        arguments: { taskId, query: `What decision was recorded?`, conflictingPaths: [spec.readmeFile] }
      });
      const conflictAbstained =
        conflictRes.structuredContent.canAssert === false &&
        declaredConflictRes.structuredContent.status === 'CONFLICTING_EVIDENCE' &&
        declaredConflictRes.structuredContent.canAssert === false;

      // Workspace containment & error clarity
      const escapeRes = await mcp.client.callTool({
        name: 'hypersabmemory_task_create',
        arguments: { goal: 'Escape test', acceptanceCriteria: ['Must fail'], sourceRefs: ['../outside.txt'] }
      });
      const emptyQueryRes = await mcp.client.callTool({
        name: 'hypersabmemory_query_evidence',
        arguments: { query: '   ' }
      });
      const unknownTaskRes = await mcp.client.callTool({
        name: 'hypersabmemory_task_context',
        arguments: { taskId: 'nonexistent-task-id-999' }
      });

      const workspaceContainmentRejected = escapeRes.isError === true && /escape|invalid/i.test(escapeRes.content[0]?.text ?? '');
      const errorClarityOk =
        emptyQueryRes.isError === true &&
        /non-empty/i.test(emptyQueryRes.content[0]?.text ?? '') &&
        unknownTaskRes.isError === true &&
        unknownTaskRes.structuredContent?.error?.code === 'TASK_NOT_FOUND';

      // Offline MCP restart using setup-generated .mcp.json entry
      await mcp.client.close();
      const restartedMcp = await connectMcp(workspace, `eval-${spec.key}-restart`, claudeEntry);
      let offlineRestartOk = false;
      try {
        const probeQuery = spec.queries[0].query;
        const probeRes = await restartedMcp.client.callTool({
          name: 'hypersabmemory_query_evidence',
          arguments: { query: probeQuery, limit: 5 }
        });
        offlineRestartOk = !probeRes.isError && JSON.parse(probeRes.content[0].text).evidence.length > 0;
      } finally {
        await restartedMcp.client.close();
      }

      // Cleanup disposable files
      for (const f of [sameSizePath, conflictA, conflictB]) {
        if (fs.existsSync(path.join(workspace, f))) fs.unlinkSync(path.join(workspace, f));
      }

      repoReports.push({
        repo: spec.name,
        key: spec.key,
        commit: spec.commit,
        license: spec.license,
        indexedRecords: remembered.length,
        consumerExperience: {
          offlineConfigGenerated,
          offlineRestartOk,
          rootReadmeDiscovered: rootReadme.path,
          rootReadmeShaMatch: rootReadme.sha256 === sha256File(path.join(workspace, spec.readmeFile)),
          setupFirstMs,
          setupRepeatMs,
          setupIdempotent: true,
          zeroCommitsCreated: true,
          seedCount: firstSeeds.length,
          seedIds: firstSeeds.map((s) => s.id),
          mcpStartupAndDiscoveryMs: mcp.startupAndDiscoveryMs,
          toolsCount: mcp.tools.length,
          resourcesCount: mcp.resources.length,
          ordinaryQueryLatencyMs: summarize(retrievalLatencyMs),
          implQueryLatencyMs: summarize(implLatencies),
          responseBytes: summarize(responseBytes),
          errorClarityOk
        },
        retrieval: {
          totalQueries: spec.queries.length,
          answerableQueries: answerableCount,
          noAnswerQueries: spec.queries.length - answerableCount,
          precisionAt5: +(answerableP5Sum / answerableCount).toFixed(4),
          macroRecallAt5: +(answerableR5Sum / answerableCount).toFixed(4),
          meanReciprocalRank: +(answerableMrrSum / answerableCount).toFixed(4),
          top1SuccessRate: +(answerableTop1Hits / answerableCount).toFixed(4),
          unrelatedEvidenceStrictTop5: unrelatedStrictTop5,
          unrelatedEvidenceAcceptableTop5: unrelatedAcceptableTop5,
          noAnswerUnsupportedAssertions,
          sourceAttributionValid: attributionValid,
          sourceAttributionChecks: attributionChecks,
          perQuery: queryDetails
        },
        implementationEvidence: {
          checks: implResults,
          shadowedImportRejected: !shadowedLinked,
          ...(parameterizedFalseLinksRejected !== null ? { parameterizedFalseLinksRejected } : {})
        },
        groundingSafety: {
          exactJsonChecks: exactJsonResults,
          exactSymbolCheck: exactSymbolResult,
          sameSizeRewriteDetected: sameSizeDetected,
          missingFileDetected: missingDetected,
          forgottenMemoryExcluded: forgottenExcluded,
          conflictAbstained,
          workspaceContainmentRejected
        }
      });
    } finally {
      try { await mcp.client.close(); } catch {}
    }
  }

  const output = {
    evaluatedAt: new Date().toISOString(),
    package: {
      name: manifest.name,
      version: manifest.version,
      tarballBytes,
      packMs,
      installMs,
      installedVersion
    },
    repositories: repoReports
  };

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
