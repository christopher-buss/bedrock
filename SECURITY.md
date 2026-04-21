# Security Policy

## Supported versions

Bedrock is pre-1.0 and under active development. Only the latest release
is supported; fixes are not backported to older versions.

| Version       | Supported |
| ------------- | --------- |
| Latest `main` | Yes       |
| Everything else | No      |

## Reporting a vulnerability

**Do not open a public GitHub issue for security reports.**

Please use GitHub's [private vulnerability reporting](https://github.com/christopher-buss/bedrock/security/advisories/new)
to submit a report. This creates a private advisory visible only to the
maintainer and you.

If private reporting is not available for any reason, email
`christopher.buss@pm.me` instead.

Please include:

- A description of the issue and its impact.
- Steps to reproduce or a proof-of-concept.
- The affected package(s) and version(s).
- Any suggested remediation you have in mind.

## What to expect

- **Acknowledgement** within 3 business days.
- **Initial assessment** (severity, scope) within 7 business days.
- **Fix target**: critical issues patched and released within 30 days;
  lower-severity issues handled on the next regular release cycle.
- **Credit** in the release notes and advisory once a fix ships, unless
  you prefer to remain anonymous.

## Scope

The following are in scope:

- Vulnerabilities in published packages (`bedrock`, `@bedrock/ocale`).
- Vulnerabilities in the deployment flow that could leak secrets, corrupt
  state, or cause unauthorized access to a Roblox experience the user
  controls.
- Supply-chain issues in our own build and release pipeline.

The following are out of scope:

- Vulnerabilities in Roblox Open Cloud itself. Report those to Roblox via
  their [HackerOne program](https://hackerone.com/roblox).
- Misuse of a valid API key that the user themselves exposed.
- Issues in third-party dependencies that have already been disclosed
  upstream; please follow the upstream project's process instead.

## Threat model notes

- Bedrock authenticates to Roblox via Open Cloud API keys only. The legacy
  `ROBLOSECURITY` cookie is never used (see
  [ADR-007](./docs/adr/007-open-cloud-only.md)).
- State files are stored in GitHub Gists and contain only resource IDs
  (public data). Secrets are never written to state.
- `@bedrock/ocale` has zero runtime dependencies (see
  [ADR-008](./docs/adr/008-zero-runtime-dependencies.md)) to minimise
  supply-chain surface area.
