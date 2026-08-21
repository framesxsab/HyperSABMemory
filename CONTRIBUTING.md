# Contributing to HyperSABMemory

Thanks for your interest in improving HyperSABMemory. This guide covers everything you need to get a development environment running and land a pull request.

## Development setup

You need Node.js 18 or newer.

```bash
git clone https://github.com/framesxsab/HyperSABMemory.git
cd HyperSABMemory
npm ci
npm test
npm run eval
npm run build
```

What each command does:

- `npm ci` installs exact dependencies from the lockfile
- `npm run build` compiles TypeScript to `dist/`
- `npm run dev` runs the compiler in watch mode while you work
- `npm test` runs the full Vitest suite
- `npm run eval` runs MemoryBench, the local recall benchmark (`tests/memorybench.test.ts`). It is fully local: no AWS, no SageMaker, no network calls

## Project layout

The CLI entry point and command definitions live in `src/cli`; the core engine is split between `src/memory` (the persistent fact store with merge and forget) and `src/harness` (the context header and token ceiling); the MCP stdio server that IDEs talk to lives in `src/mcp`, with small helpers in `src/hooks` and `src/server`; all tests, including the MemoryBench recall gate, live in `tests`.

## Pull request guidelines

- Keep PRs small and focused on one change. If you find yourself fixing two unrelated things, open two PRs
- Behavior changes require tests. If you fix a bug, add a regression test first
- Before requesting review, make sure both gates pass locally:

```bash
npm test && npm run eval
```

- Reuse existing modules before adding new files, and avoid new npm dependencies unless the PR explains why they are necessary
- Never commit `.hypersabmemory/` stores or secrets

## Commit style

We use [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/). The common prefixes:

- `feat:` a new feature
- `fix:` a bug fix
- `docs:` documentation only
- `chore:` tooling, deps, and housekeeping

Example: `feat(cli): add --json flag to doctor`

## Reporting issues

Please use the issue templates so we can reproduce problems faster:

- [Bug report](.github/ISSUE_TEMPLATE/bug_report.md) for anything broken, including the output of `hypersabmemory doctor`
- [Feature request](.github/ISSUE_TEMPLATE/feature_request.md) for ideas and proposals

Blank issues are disabled. If your report does not fit either template, pick the closer one and adapt it.

## License

HyperSABMemory is released under the MIT license. By contributing, you agree that your contributions are licensed under MIT as well.
