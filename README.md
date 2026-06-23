# Bedrock

Infrastructure-as-Code deployment for Roblox, written in TypeScript.

[![CI](https://github.com/christopher-buss/bedrock/actions/workflows/ci.yaml/badge.svg)](https://github.com/christopher-buss/bedrock/actions/workflows/ci.yaml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

> **Pre-release.** Bedrock is pre-1.0 — the API and config schema may
> change between minor versions until 1.0. Follow the repository or the
> [project board](https://github.com/christopher-buss/bedrock/projects)
> for progress.

## What is Bedrock?

Bedrock declaratively manages Roblox experiences the way Terraform manages
cloud resources. Describe the universe, places, game passes, and developer
products an experience should have in a config file; Bedrock figures out
what to create or update to match.

It is a spiritual successor to [Mantle](https://github.com/blake-mealey/mantle)
(no longer maintained), rebuilt in TypeScript on top of Roblox Open Cloud.

## Why

- **Open Cloud only.** No `ROBLOSECURITY` cookies or legacy endpoints.
  Authenticate with API keys, the way Roblox now recommends.
- **Programmatic first, CLI second.** Consume Bedrock as a library from
  your own tooling, or reach for the CLI for day-to-day deploys. See
  [ADR-017](./docs/adr/017-product-framing-programmatic-iac-with-cli.md).
- **State in a GitHub Gist.** Zero external services to stand up; a
  `BEDROCK_GITHUB_TOKEN` is enough. Extensible to other backends.
- **Multi-format config.** TypeScript, JavaScript, YAML, JSON, or Luau via c12.

## Packages

| Package                                               | Description                                      |
| ----------------------------------------------------- | ------------------------------------------------ |
| [`@bedrock-rbx/core`](./packages/bedrock)                 | The deployment library and CLI.                  |
| [`@bedrock-rbx/ocale`](./packages/open-cloud)             | Standalone HTTP client for Roblox Open Cloud.    |

## Status

Bedrock is pre-1.0 and under active development. What works today:

- Open Cloud client (`@bedrock-rbx/ocale`) with typed clients across universes,
  places, game passes, developer products, badges, storage, and Luau execution,
  plus built-in rate limiting, retries, and 100% test coverage.
- State data model and diff algebra ([ADR-019](./docs/adr/019-state-data-model-and-diff-algebra.md)).
- FCIS + Ports architecture with explicit primary/driven port distinction
  ([ADR-018](./docs/adr/018-fcis-ports-with-primary-driven-distinction.md)).
- The `bedrock` CLI (`deploy`, `diff`, `migrate`) and the programmatic
  `deploy()` workflow.

Track scope and timing on the
[project board](https://github.com/christopher-buss/bedrock/projects).

## Getting started

Install the deployment library and bundled `bedrock` CLI from npm:

```bash
pnpm add -D @bedrock-rbx/core
# or: npm install --save-dev @bedrock-rbx/core
# or: bun add -d @bedrock-rbx/core
```

See the [getting-started guide](https://bedrock-livid.vercel.app/) for a full
walkthrough.

To develop Bedrock itself locally:

```bash
git clone https://github.com/christopher-buss/bedrock.git
cd bedrock
pnpm install
pnpm build
pnpm test
```

The repository uses [pnpm](https://pnpm.io) workspaces and [Bun](https://bun.sh)
(>= 1.3) as the runtime. TypeScript builds, tests, and task orchestration run
through [Vite+](./docs/adr/014-vite-plus-unified-toolchain.md).

## Documentation

- [Documentation site](https://bedrock-livid.vercel.app/) (work in progress)
- [Architecture Decision Records](./docs/adr/) covering every significant
  design choice

## Contributing

This is a solo-maintainer project with an inverted contribution model.
External input runs through
[Discussions](https://github.com/christopher-buss/bedrock/discussions) as
**prompt requests**: share the prompt you would run rather than opening a
PR, and I will run it myself if the idea lands. Issues are maintainer-only.
Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening anything.

By participating, you agree to abide by the [Code of Conduct](./CODE_OF_CONDUCT.md).

To report a security vulnerability, follow [SECURITY.md](./SECURITY.md).

## License

[MIT](./LICENSE) (c) Christopher Buss.
