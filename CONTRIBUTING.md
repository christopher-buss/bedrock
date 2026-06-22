# Contributing to Bedrock

Bedrock is a solo-maintainer project built in the open. Contributions are
welcome, but the workflow is inverted from a typical OSS repo. This page
describes the model first, then the mechanics.

## Prompt requests, not pull requests

This project is organized around prompt requests, a framing borrowed from
Peter Steinberger:

> I don't like pull requests (PRs) any more. A large chunk code change
> doesn't tell me much about the intent or why it was done.
>
> I now prefer prompt requests. Just share the prompt you ran / want to
> run. If I think it's good, I'll run it myself and merge it.

The default path for an external contribution:

1. Open a [Discussion](https://github.com/christopher-buss/bedrock/discussions)
   describing the change you want.
2. Share the prompt you would run to make it happen. Not the diff, the
   prompt.
3. If the idea lands, I run the prompt, review the output, and merge.

Intent is the scarce thing. A prompt captures it directly; a diff hides it
behind output. Adjusting scope before the model runs is cheaper than
adjusting it after.

## When a pull request is fine

Trivial or mechanical changes (typo, docs fix, one-line bug fix) can come
in as a normal PR. Anything larger should start in Discussions so scope is
aligned before code is written. PRs that should have been prompt requests
will be closed with a pointer here.

## Issues are maintainer-only

Please do not open issues directly. External input goes through
[Discussions](https://github.com/christopher-buss/bedrock/discussions):

- **Q&A** for usage questions
- **Ideas** for feature proposals and prompt requests
- **Bug reports** as a Discussion with reproduction steps

I convert matured Discussions into tracked issues when work is ready to
start.

For security vulnerabilities, see [SECURITY.md](./SECURITY.md). Never
report those publicly.

## Writing a good prompt request

A good prompt is specific enough to produce the change you want, loose
enough that the model has room to pick a reasonable implementation.

Include:

- **Goal.** One sentence about the outcome.
- **Context.** File paths, relevant conventions, ADRs the change touches.
- **Constraints.** Public API stability, TDD discipline, dependency
  policy, anything that must or must not change.
- **Done looks like.** Which tests pass? What is manually verifiable?

Reference the rules in the [rules section below](#rules-the-generated-code-still-has-to-meet)
directly in your prompt so the model does not need a second pass.

## ADR-gated changes

Proposals in any of these buckets need an Architecture Decision Record
before any code runs:

- New dependencies, build tools, or cross-cutting patterns
- New architectural layers, boundaries, or abstractions
- External integrations (APIs, auth, storage backends)
- Data-model or configuration-format changes
- Breaking API changes

See [ADR-006](./docs/adr/006-adr-enforcement.md) for the full list and the
collaborative Q&A process. Start the ADR in a Discussion; I will shape it
into the repo format once the decision is clear.

## Rules the generated code still has to meet

The bar is the same whether a human or an agent writes the diff:

- **Test-driven.** Every line of production code is written in response to
  a failing test (RED -> GREEN -> REFACTOR). See
  [ADR-003](./docs/adr/003-testing-strategy.md).
- **100% coverage** across statements, branches, functions, and lines on
  `src/**`. CI enforces this.
- **Commit style.** `type(scope): kebab-case subject`. Scope-enum:
  `core`, `deps`, `e2e`, `global`, `ocale`, `testing`, `tsconfig`, `vite`,
  `website`. `ci`, `chore`, `docs`, `build`, `refactor` are types, not
  scopes.
- **Changeset.** A change to a published package (`@bedrock-rbx/core`,
  `@bedrock-rbx/ocale`) needs a changeset, or CI fails. See
  [Releases](#releases) below.
- **Public API examples.** Exported symbols carry JSDoc `@example` blocks
  ([ADR-005](./docs/adr/005-jsdoc-example-testing.md)).

## Local setup

If you want to run things locally (or to run the prompt yourself before
sharing it):

```bash
git clone https://github.com/christopher-buss/bedrock.git
cd bedrock
pnpm install
pnpm build
pnpm test
```

| Command                  | Purpose                                     |
| ------------------------ | ------------------------------------------- |
| `pnpm test`              | Vitest                                      |
| `pnpm lint`              | ESLint (auto-fix on)                        |
| `pnpm typecheck`         | TypeScript check across the workspace       |
| `pnpm build`             | Build all packages                          |
| `pnpm gen:example-tests` | Regenerate tests from `@example` JSDoc      |
| `pnpm mutate:changed`    | Stryker mutation tests on changed files     |

The pre-commit hook (managed by [hk](./docs/adr/013-hk-git-hook-manager-with-differentiated-gating.md))
runs lint, typecheck, test, and build.

## Releases

Versioning and publishing run on [Changesets](https://github.com/changesets/changesets)
(see [ADR-027](./docs/adr/027-changesets-release-flow.md)). The two published
packages — `@bedrock-rbx/core` and `@bedrock-rbx/ocale` — are *linked*: they
share one version number and bump together.

**Every PR that changes a published package must include a changeset.** A CI
check (`changeset status`) fails the PR otherwise. Add one with:

```bash
pnpm changeset
```

Pick the bumped packages and the semver level, and write a one-line summary —
it becomes the `CHANGELOG.md` entry, so phrase it for someone *installing* the
package, not for the diff. For a change that genuinely needs no release (a
comment, a test-only tweak on a published package), record that intent
explicitly:

```bash
pnpm changeset add --empty
```

PRs that touch nothing publishable (docs, CI, private packages) do not need a
changeset; the check passes without one.

### How a release happens

1. Changesets accumulate on `main` as PRs merge.
2. The `Release` workflow opens (and keeps refreshing) a **`ci: version
   packages`** PR that applies the version bumps and writes the changelogs.
3. Merging that PR publishes the packages to npm, pushes their git tags, and
   triggers the production docs deploy. Releasing is therefore a deliberate
   act: merge the Version PR when you want a release to go out.

## Code of conduct

By participating in Discussions, issues, or PRs, you agree to the
[Code of Conduct](./CODE_OF_CONDUCT.md).
