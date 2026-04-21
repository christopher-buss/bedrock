# Contributing to Bedrock

Thanks for the interest. Bedrock is a small project in active development,
and outside contributions are welcome for bug fixes, docs improvements, and
features that fit the direction laid out in the [ADRs](./docs/adr/).

This document covers the essentials. The [root `CLAUDE.md`](./CLAUDE.md) is
the fuller reference; anything here supersedes it for human contributors.

## Ground rules

- **Test-driven.** Every line of production code must be written in response
  to a failing test (RED → GREEN → REFACTOR). See
  [ADR-003](./docs/adr/003-testing-strategy.md).
- **100% coverage** across statements, branches, functions, and lines on
  `src/**`. CI enforces this.
- **Be kind.** See the [Code of Conduct](./CODE_OF_CONDUCT.md).

## Getting set up

Prerequisites: [Bun](https://bun.sh) >= 1.3, [pnpm](https://pnpm.io) >= 10,
Node >= 24.12 (for consumers of published packages; Bun is the dev runtime).

```bash
git clone https://github.com/christopher-buss/bedrock.git
cd bedrock
pnpm install
```

Useful scripts:

| Command                     | Purpose                                     |
| --------------------------- | ------------------------------------------- |
| `pnpm test`                 | Run the Vitest suite.                       |
| `pnpm lint`                 | ESLint check (auto-fix on).                 |
| `pnpm typecheck`            | TypeScript validation across the workspace. |
| `pnpm build`                | Build all packages.                         |
| `pnpm gen:example-tests`    | Regenerate tests from `@example` JSDoc.     |
| `pnpm mutate:changed`       | Stryker mutation tests on changed files.    |

The pre-commit hook (managed by [hk](./docs/adr/013-hk-git-hook-manager-with-differentiated-gating.md))
runs lint, typecheck, test, and build. A red commit is rejected before it
lands.

## Workflow

1. **Open or pick up an issue.** For anything larger than a bug fix, please
   open an issue first so we can align on scope before code is written. The
   [project board](https://github.com/christopher-buss/bedrock/projects)
   lists work that is ready to pick up.
2. **Branch from `main`.** Use a descriptive branch name.
3. **Write the test first.** Commit RED and GREEN together as one commit
   per behaviour slice (the pre-commit hook rejects a pure-RED commit).
   REFACTOR lands as a separate commit only when it adds value.
4. **Keep commits small.** One commit per behaviour slice; the history is
   expected to show TDD compliance.
5. **Open a pull request.** The PR template will guide you through what to
   include. CI must be green before review.

## Architectural changes need an ADR

If your change falls into any of these buckets, an Architecture Decision
Record is required **before** implementation:

- New dependencies, build tools, or cross-cutting patterns
- New architectural layers, boundaries, or abstractions
- External integrations (APIs, auth, storage backends)
- Data model or configuration format changes
- Breaking API changes

See [ADR-006: ADR Enforcement](./docs/adr/006-adr-enforcement.md) for the
full list and the collaborative Q&A process for drafting one.

## Commit and PR title format

Titles are linted by commitlint. Two rules trip people up most often:

1. **Subject must be lowercase kebab-case**, including identifiers.
   `mergeConfig` becomes `merge-config`, `GamePassesClient` becomes
   `game-passes-client`.
2. **Scope must be one of**: `bedrock`, `e2e`, `global`, `ocale`, `testing`,
   `tsconfig`, `vite`, `website`. `ci`, `chore`, `docs`, `build`, `refactor`
   are **types**, not scopes. Write `ci: …` with no scope rather than
   `fix(ci): …`.

Prefer outcome-focused subjects that read well in a changelog: `add
game-passes client` over `slice-1 client implementation`.

## Public API examples

Every symbol exported from a package's `src/index.ts` should carry a JSDoc
`@example` block when the usage is non-trivial. Examples are dual-purpose:
compiled into tests by `pnpm gen:example-tests` and rendered into the docs
site by TypeDoc. See [ADR-005](./docs/adr/005-jsdoc-example-testing.md) for
the full contract.

## Reporting security vulnerabilities

Do **not** open a public issue for security reports. Use GitHub's private
vulnerability reporting or see [SECURITY.md](./SECURITY.md).

## Questions

Open a [discussion](https://github.com/christopher-buss/bedrock/discussions)
or file an issue using the question template. Response times are
best-effort.
