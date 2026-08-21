# Security Policy

## Supported Versions

Only the current release on the `main` branch is supported with security fixes. Older versions do not receive patches.

| Version | Supported |
| --- | --- |
| latest on `main` | Yes |
| older releases | No |

## Reporting a Vulnerability

Please report vulnerabilities privately through GitHub Security Advisories:

1. Open the repository on GitHub
2. Go to the **Security** tab
3. Click **Report a vulnerability**

Do not open a public issue for anything you believe is a security problem.

### Scope notes

HyperSABMemory is a local-first tool. When assessing a report, keep this threat model in mind:

- The CLI and MCP server read files from local codebases on your machine
- The checkpoint system executes `git` commands locally (it never pushes)
- The dashboard runs a local HTTP server on port 4321, bound to `127.0.0.1` (localhost only)

Reports about remote exploitation of the dashboard or about the tool escaping its local scope are in scope. Reports requiring an attacker to already run arbitrary code on your machine generally are not, but when in doubt, report anyway.

## Response Timeline

We respond to valid reports on a best-effort basis within **7 days**. After triage we will work with you on a fix and coordinate disclosure timing.
