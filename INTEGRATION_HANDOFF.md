
# HyperSABMemory preview.2 integration handoff

The isolated implementation is in `C:\Users\singa\Desktop\hypermemory-next-codex`. The frozen baseline is `dcfc8bf1bdf4bd3e59cb2cf6f1e4b504acc5b523`. The full runtime regression tip is `3c3198837774ceacfbfdf1878317935df3964f6d`. The final engineering tip is 4a9bc70dd5a6a2a1bdac16bfae332c57e76b18e1, which adds the verified Windows-only test harness cleanup. The documentation commit follows it on the same local HEAD.

**Integration target is v1.5.0-preview.2.** Local engineering evidence supports review. Publication still requires an approved, version-specific acceptance ledger and configured trusted publisher.

## Inspect and reproduce

```powershell
$checkout = 'C:\Users\singa\Desktop\hypermemory-next-codex'
$baseline = 'dcfc8bf1bdf4bd3e59cb2cf6f1e4b504acc5b523'
git -C $checkout log --reverse --oneline "$baseline..HEAD"
git -C $checkout diff --stat $baseline HEAD
git -C $checkout format-patch --stdout "$baseline..HEAD"
```

Apply the local series in order after review. The release plumbing starts in `567d3aa` and `533c8a9`. The upgrade/config fix starts in `baf6463`. `2cc412e` and `e0e5ff1` finalize the consolidated workflow, evidence binding, rollback, and prerelease fixture. `3c31988` adds the reliability runner and index fixture. 4a9bc70 closes the Windows upgrade-fixture cleanup issue. Run the commands in [Implementation report](IMPLEMENTATION_REPORT.md) with the complete series applied.

## Exact changed files

| Area | Paths |
|---|---|
| Release workflow and commands | `.github/workflows/release.yml`, `package.json`, `scripts/package-smoke.mjs`, `scripts/release-candidate.mjs`, `tests/releaseCandidate.test.ts`, `tests/releasePreflight.test.ts` |
| Setup and upgrade | `src/cli/index.ts`, `src/cli/oneShotSetup.ts`, `src/harness/mcpAccess.ts`, `scripts/upgrade-regression.mjs`, `tests/mcpAccess.test.ts` |
| Reliability | `scripts/reliability-stress.mjs`, `tests/reliabilityIndex.test.ts` |
| Handoff | `NEXT_VERSION_STATUS.md`, `NEXT_VERSION_REQUIREMENTS.md`, `IMPLEMENTATION_REPORT.md`, `INTEGRATION_HANDOFF.md` |

## Runtime impact for scoped delta acceptance

- `setup` validates and applies the MCP configuration before seeding, synchronizing Memory.md, injecting adapters or changing Git excludes. It returns status 1 on failure. Direct `connect` uses the same config validation and write path.
- The three server mappings retain user entries and other top-level properties. Supported JSON, including an initial UTF-8 BOM, is reserialized on success. The HyperSABMemory entry is refreshed to the candidate CLI. Invalid, non-object, incompatible server mappings and symlinked config paths fail with the config path. Existing JSONC therefore needs conversion to JSON before setup.
- Config updates stage same-filesystem replacements. When a later replacement throws, earlier files are restored byte-for-byte and newly created config files and directories are removed. If the filesystem prevents rollback, the CLI reports a recovery directory with numbered originals. The transaction is bounded to MCP configuration. A killed process or a later non-MCP setup failure can leave partial setup work.
- Retrieval, MCP tool payloads, static test attribution, JSON memory storage and SQLite task-coordinator schemas carry no runtime edits in this series. The upgrade matrix found no need for standalone memory migration tooling.

The least delta acceptance scope is the packaged setup/connect flow and recovery against the three published fixtures, plus release tooling and hosted CI delta checks. Current `src/` hash is `db1d6a8bab1e4096a3ec9da65d623aa9630b3f71bf19e8458661341a879072a5` (47 files), and the historical preview ledger correctly rejects it. Keep the old ledger as published evidence.

## Trusted Publishing setup

Gemini or the release owner can configure the following during integration.

- In GitHub, create the `npm-preview` environment and set the approved reviewer and preview-tag deployment rules. Protect creation of release tags. Only the Ubuntu publish job requests `id-token: write`. Every job reads repository contents.
- In npm package settings for `hypersabmemory`, add a GitHub Actions trusted publisher for owner `framesxsab`, repository `HyperSABMemory`, workflow **`release.yml`**, environment **`npm-preview`**. Enable direct `npm publish`. Leave standalone dist-tag management disabled. Review old token permissions during the owner-led cutover.
- The proposed job selects Node 24 and rejects toolchains below Node 22.14 and npm 11.5.1. It publishes from runner temp with an explicit npm registry and empty npm user/global config. It has no token secret reference and rejects legacy token environment variables. The publish command requires the computed `preview` tag. Stable publication stays blocked pending approved Profile 2 enforcement. [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/) · [GitHub publishing guide](https://docs.github.com/en/actions/tutorials/publish-packages/publish-nodejs-packages)

## Prepare preview.2

After applying the series, update package and lockfile versions and add the dated changelog. Commit these changes before collecting evidence. From a pristine checkout with dependencies installed, use the Linux/Node/npm release toolchain to make the exact evaluation tarball.

```sh
npm ci
npm run release:candidate -- pack /tmp/hypersabmemory-preview2
npm run package:smoke -- /tmp/hypersabmemory-preview2/hypersabmemory-1.5.0-preview.2.tgz
```

Use `pack.json` to capture the evaluated commit and tarball SHA-256, and run the approved preview acceptance procedure against those bytes. Commit the resulting version-specific ledger separately. The packaging workflow validates the existing Profile 1 gate, requires evaluated-commit ancestry and an identical committed source tree, and compares the freshly rebuilt tarball to the ledger's SHA-256. The candidate report also binds the exact release SHA and acceptance ledger digest. Treat changes to packed inputs, npm, build tooling or line endings as candidate changes whenever the hash moves.

## Diagnose and recover post-publication verification

The candidate artifact contains `prepare.json` and the tarball. `verify.json` shows the pre-publish recheck. `published.json` records registry metadata verification and `smoke.json` reports the exact install/CLI/MCP smoke step's outcome. A skipped smoke points to an earlier download or verification failure. A failed smoke requires inspecting the step log. The npm publish is the last step of its own job.

If publication succeeded and the smoke job failed, rerun **failed jobs** so the successful publish job is retained. If publication is ambiguous or a rerun would include the publish job, download the original candidate artifact, check out its exact clean commit and use the following read-only steps. The original preview tag must still point to the version under test for the original tag verification to pass.

```sh
candidate=/absolute/path/to/downloaded/npm-candidate
version="$(node -p "require('./package.json').version")"
GITHUB_REF_TYPE=tag GITHUB_REF_NAME="v$version" GITHUB_SHA="$(git rev-parse HEAD)" \
  node scripts/release-candidate.mjs published "$candidate"
download="$(mktemp -d)"
npm pack "hypersabmemory@$version" --registry https://registry.npmjs.org --ignore-scripts --pack-destination "$download"
cmp "$candidate/hypersabmemory-$version.tgz" "$download/hypersabmemory-$version.tgz"
npm ci
npm run package:smoke -- "$download/hypersabmemory-$version.tgz"
```

**Next executable task for Gemini** is to inspect the local series, integrate it in a clean preview.2 staging checkout, bump metadata and run the three commands under “Prepare preview.2” to produce the evaluated artifact. The hosted OIDC exchange and approved delta acceptance are pending.
