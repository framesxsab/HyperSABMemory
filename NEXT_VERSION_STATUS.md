
# Next-version status

- Workspace is `C:\Users\singa\Desktop\hypermemory-next-codex`, independently cloned at `dcfc8bf1bdf4bd3e59cb2cf6f1e4b504acc5b523`.
- Target for integration is v1.5.0-preview.2. The manifest retains its baseline version during engineering verification.
- P0 release automation passed clean local packing, exact-byte and evidence binding, tamper rejection and read-only post-publication checks with controlled fixtures. The live registry read rejected a duplicate. The OIDC workflow passed local YAML, shell, permission and outcome checks.
- P0 upgrade and config recovery passed against published 1.4.0, 1.4.1 and 1.5.0-preview.1. Setup preserves the workspace on malformed MCP input and rolls back earlier writes on an injected late config replacement failure.
- P1 reliability passed two 79-test iterations with a 48-file index. The full regression suite passed 387 tests, and typecheck and package smoke passed.
- P2 attribution research is deferred and excluded from the integration commits.
- Integration is ready for review. Preview.2 candidacy depends on a version bump, approved acceptance evidence on the exact artifact, hosted CI and configuration of the protected GitHub environment and npm trusted publisher. Stable Profile 2 remains unapproved.

See [Implementation report](IMPLEMENTATION_REPORT.md) for executed verification and [Integration handoff](INTEGRATION_HANDOFF.md) for the local commits, runtime delta and operator steps.
