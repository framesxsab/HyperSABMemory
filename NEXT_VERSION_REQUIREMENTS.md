
# Next-version requirements

The integration target is v1.5.0-preview.2. This work prepares the stable foundation and keeps publication under the existing preview governance. The frozen source baseline is `dcfc8bf1bdf4bd3e59cb2cf6f1e4b504acc5b523`.

| Priority | Required evidence |
|---|---|
| P0 release | Validate the version, lockfile, changelog and Git ref. Build a checkout from committed inputs. Bind the exact tarball to its integrity, evaluated source, acceptance ledger and release commit. Check registry availability, reject duplicates and enforce the preview channel. |
| P0 trusted publishing | Reuse the Release workflow. Give only the protected publish job OIDC permission. Verify post-publication tag, integrity, downloaded bytes and installed CLI/MCP behavior. Support recovery through a read-only verification path. |
| P0 upgrade | Use published stable and prerelease packages in disposable linked worktrees. Preserve old memory records and task state, user notes, tracked instructions and other MCP servers across repeated setup. Verify failure and retry behavior. |
| P1 reliability | Repeat existing writer, atomic-write, lease, session, freshness and containment tests. Exercise a configurable source corpus and report failures as JSON. |
| Deferred | Static test attribution research belongs to v1.6.0. Profile 2 thresholds and a stable publication route require explicit approval. |

The existing v1.5.0-preview.1 ledger is historical evidence for its recorded candidate. Preview.2 requires its own evidence on the exact packed artifact. See [Release Policy](docs/RELEASE_POLICY.md) and [Sprint 3.8 governance](docs/SPRINT_3_8_RELEASE_GOVERNANCE.md).
