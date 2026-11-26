# HyperSABMemory — Future Version Backlog (`v1.5.0`–`v2.0.0`)

Items tracked here are **explicitly deferred** so they do not delay or block `v1.5.0-preview.1`:

## Static Test Attribution Expansions (`v1.6.0`, No Call-Graph Engine)
- **P1**: Support `export const fn = (...) => ...` arrow function definitions (`src/memory/implementationEvidence.ts`).
- **P2**: Resolve single-hop barrel re-exports (`index.ts` `export { x } from './mod'`) via TypeChecker aliased symbols.
- **P3**: Support `export default` declarations matched with default import identifiers.
- **P4**: Support `export class` queried by class name with `new` / `assert.rejects(..., Class)` usage.
- **P5**: Single-assignment intra-test dataflow bridge (`const actual = fn(...); assert.deepStrictEqual(actual, ...)`).
- **P6**: Optional safe handling of deterministic dynamic `for...of` test titles without false linking.
- **P7**: Safe opt-in coverage for `.mjs` / CommonJS `require()` unit test attribution without false positives.

## Multi-Agent Coordination & Reliability (`v1.5.0` / `v1.7.0`)
- 50-iteration cross-OS file-lock and atomic-rename stress soak (`Windows`, `macOS`, `Ubuntu`).
- `>= 500`-file cold TypeScript evidence benchmark & incremental program caching.
- Integrate `scripts/sprint42-worktree-eval.mjs` cleanly into `.github/workflows/ci.yml` / `release.yml`.
- Configure GitHub Environments (`npm-preview`, `npm-production`), tag protection, and npm OIDC Trusted Publishing.
- Multi-agent lease conflict diagnostics & `/api/swarm` dashboard enhancements.

## Developer Experience & `v2.0.0` Infrastructure
- Cold MCP CLI process startup profiling (`< 1000 ms` target vs `1.3–1.8 s` Windows diagnostic baseline).
- Tarball hygiene audit for `dist/eval/*` separation.
- Versioned `.hypersabmemory/` store schema migration engine with pre-migration backups (`v2.0.0`).
