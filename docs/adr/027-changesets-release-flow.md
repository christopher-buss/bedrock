# ADR-027: Changesets for Versioning and Automated npm Publishing

**Date:** 2026-06-22  **Status:** Accepted

Decision Makers: Maintainer  
Tags: developer-workflow, tooling, release, publishing, versioning, changesets

## Context

Bedrock publishes two packages to npm — `@bedrock-rbx/core` and
`@bedrock-rbx/ocale` — and is preparing its first stable release, `0.1.0`.
The current release process is entirely manual and has accreted problems that
a one-off `0.1.0` push would not fix:

1. **Versions are hand-bumped.** Every release to date landed via a
   `update packages to v0.1.0-beta.N` commit that edits both `package.json`
   files by hand, followed by a manual `pnpm publish`. There is no record of
   *what* changed between betas — no changelog, no per-package release notes.
2. **No git tags exist.** `git tag -l` is empty across the whole history,
   even though `0.1.0-beta.1` … `0.1.0-beta.18` are all live on npm. Nothing
   ties a published version back to a commit.
3. **The npm `latest` dist-tag is wrong.** `latest` points at
   `0.1.0-beta.1` (the very first prerelease) while `beta` points at
   `0.1.0-beta.18`. A default `npm install @bedrock-rbx/core` resolves to a
   stale, months-old prerelease.
4. **The docs deploy is already wired for tag-driven releases that never
   fire.** `website-release.yaml` triggers `on: push: tags: ["@bedrock-rbx/core@*"]`
   — the exact tag format Changesets emits — but because no tags are ever
   pushed, it has only ever run via `workflow_dispatch`.

The repository also imposes constraints any automated release flow must
respect:

- **`required_signatures` on every branch.** The repository-level `all`
  ruleset applies `required_signatures` to `~ALL` refs (not just the default
  branch). Any commit pushed to any branch — including a bot's release
  branch — must be signed, or the push is rejected.
- **`GITHUB_TOKEN`-authored pushes do not trigger workflows.** GitHub
  suppresses workflow runs for refs and PRs created with the default
  `GITHUB_TOKEN` to prevent recursion. This affects both CI on a bot-opened
  PR and the `website-release.yaml` tag trigger on a bot-pushed tag.
- **PR titles are linted.** `lint-pr-title.yaml` runs commitlint
  (`type(scope): subject`, scope-enum) on every PR title. A release bot's PR
  title must be conventional or the check fails.
- **`hk` gate + pnpm catalogs.** The pre-commit/CI gate (ADR-013) runs
  lint/typecheck/test/build; dependencies are pinned through pnpm catalogs in
  `pnpm-workspace.yaml`.

`openapi-drift.yaml` already solves the first two constraints for its
automated spec-refresh PR: it commits via `planetscale/ghcommit-action` (which
writes through the GitHub GraphQL API, producing a GitHub-signed commit) and
explicitly dispatches `ci.yaml` against the bot branch. That established
pattern is the template here.

This is an ADR-gated change on two counts under ADR-006: it adopts a new
build/release tool, and it introduces a new mandatory developer policy (a
required changeset per consumer-facing change).

## Decision

Adopt **Changesets** as the source of truth for versions and changelogs for
the two published packages, with an automated, signed, tag-driven publish
pipeline.

### Tooling

- Install `@changesets/cli` and `@changesets/changelog-github` as root
  `devDependencies`, pinned via a new `release` catalog in
  `pnpm-workspace.yaml`.
- `.changeset/config.json` configures:
  - `changelog`: `@changesets/changelog-github` scoped to
    `christopher-buss/bedrock`, so entries link back to PRs and authors.
  - `access`: `public` (belt-and-braces with the existing
    `publishConfig.access`).
  - `baseBranch`: `main`.
  - `updateInternalDependencies`: `patch` — when `ocale` bumps, `core`'s
    `workspace:*` dependency edge produces a patch bump on `core`.
  - **`linked`: `[["@bedrock-rbx/core", "@bedrock-rbx/ocale"]]`** (see below).
- The five private packages (`testing`, `vite-config`, `typescript-config`,
  `apps/website`, `apps/e2e`, and the root) carry `private: true` and are
  ignored by Changesets automatically; no `ignore` entries are needed.

### Linked, not fixed or independent

`core` and `ocale` are **linked**: they share a single version number, but a
package is only re-released when it (or, via the `workspace:*` edge, its
internal dependency) actually changed.

- **Independent** was rejected: the two packages ship as a matched set today
  and `core` cannot function without a compatible `ocale`. Divergent version
  numbers (`core@0.4.0` + `ocale@0.7.2`) carry no useful information for this
  pair and complicate the "which versions go together" question for
  consumers.
- **Fixed** was rejected: fixed forces a release of *both* packages on *any*
  change to *either*, including the untouched one. Because `core` depends on
  `ocale`, an `ocale` change already cascades a dependency bump into `core`;
  linked achieves the same alignment without publishing a no-op `ocale`
  release when only `core` changed.

### Automated publish via the ghcommit-action pattern (not `changesets/action`)

The stock `changesets/action` commits the version bump with plain `git` and
pushes it to a `changeset-release/<branch>` branch using `GITHUB_TOKEN`. Those
commits are **unsigned**, so the `required_signatures` ruleset rejects the
push and no Version PR is ever created. Rather than weaken the ruleset or
manage a bot GPG key, `release.yaml` reuses the `openapi-drift.yaml` approach:

- **Trigger:** `on: push: branches: [main]`.
- **Version mode** (pending changesets present): run `pnpm changeset version`
  (which also refreshes the lockfile), commit the result to
  `changeset-release/main` via `planetscale/ghcommit-action` (GitHub-signed),
  open or refresh a PR titled **`ci: version packages`** via the `gh` CLI, and
  dispatch `ci.yaml` against the bot branch so the Version PR gets checks.
- **Publish mode** (no pending changesets — i.e. a Version PR has just
  merged): run `pnpm release` (`pnpm build && changeset publish`), which
  publishes changed packages to npm and creates `@bedrock-rbx/<pkg>@<version>`
  tags. Tags are pushed with a token that re-triggers workflows so
  `website-release.yaml` fires.
- **Provenance:** the job grants `id-token: write` and sets
  `NPM_CONFIG_PROVENANCE=true`; combined with `NODE_AUTH_TOKEN` (from the
  `NPM_TOKEN` secret) this attaches a signed build-provenance attestation to
  each publish. (`id-token: write` alone is necessary but not sufficient — the
  `NPM_CONFIG_PROVENANCE` flag is what actually enables provenance.)

### Mandatory changeset gate

A CI job runs `changeset status --since=origin/main` on pull requests and
**fails** a PR that introduces no changeset. The bot's own
`changeset-release/*` branch is exempt (its Version PR legitimately drains all
changesets). Genuinely non-releasing PRs (docs-only, CI) use the documented
`pnpm changeset add --empty` escape hatch. This is the new mandatory developer
policy that makes this an ADR-gated decision.

### First release: 0.1.0 via a single patch changeset

The first release through the pipeline graduates the packages from
`0.1.0-beta.18` to `0.1.0`. No manual version edit is required:
`semver.inc("0.1.0-beta.18", "patch")` is `"0.1.0"` — a patch bump on a
prerelease *drops* the prerelease suffix rather than incrementing — and
Changesets uses exactly this. A single `patch`-type changeset with a
hand-written summary ("Initial 0.1.0 stable release.") drives the whole
graduation through the normal bot flow. Publishing a non-prerelease version
also resets the npm `latest` dist-tag to `0.1.0`, fixing constraint 3.

## Consequences

### Positive

- **Every release has a changelog and a tag.** `CHANGELOG.md` per package,
  generated from changeset intent files and linked to PRs; a
  `@bedrock-rbx/<pkg>@<version>` git tag per published version.
- **The `latest` dist-tag self-heals** the moment a non-prerelease publishes.
- **The pre-wired docs deploy finally fires.** The core tag triggers
  `website-release.yaml` with no change to that workflow.
- **Signing and CI-trigger constraints are satisfied by a known-good
  pattern.** `release.yaml` reuses the exact `ghcommit-action` +
  `gh workflow run` mechanism already proven in `openapi-drift.yaml`.
- **Release intent is captured at PR time**, when the author knows whether a
  change is patch/minor/major and why, instead of reconstructed at bump time.

### Negative

- **`release.yaml` is bespoke.** Choosing the ghcommit-action pattern over the
  stock `changesets/action` means hand-rolling the version/publish branching,
  PR creation, and CI dispatch. It is more code to maintain than a single
  `uses: changesets/action@v1` step, and it tracks two upstreams
  (`@changesets/cli` and `planetscale/ghcommit-action`).
- **Two new dev dependencies and a new catalog.** Mitigated by catalog
  pinning and `@changesets/cli` being widely used and actively maintained.
- **Contributors must remember a changeset.** The blocking gate enforces it,
  but it adds a step to every consumer-facing PR. The `--empty` escape hatch
  and the gate's clear failure message mitigate the friction.
- **Secrets and a repo setting are external prerequisites.** The pipeline
  cannot publish until an `NPM_TOKEN` secret exists and "Allow GitHub Actions
  to create and approve pull requests" is enabled. These are documented but
  cannot be provisioned in code.

### Neutral

- **`changeset publish` runs outside `vp`.** Consistent with `knip`
  (ADR-016) and `mutate:changed` (ADR-015): release orchestration is outside
  ADR-014's build/test/task unification scope.
- **The first 0.1.0 changelog entry sits under a "Patch Changes" heading.**
  A cosmetic artifact of the prerelease-graduation semver math; the
  hand-written summary line carries the real meaning.

## Alternatives Considered

### Status quo — keep hand-bumping versions

**Rejected.** It produced the three defects in Context (no changelog, no
tags, broken `latest`) and does not scale past a solo maintainer's memory. A
one-off `0.1.0` push would reset `latest` but leave every other defect in
place and guarantee they recur.

### release-please

Google's manifest-driven release-PR tool.

**Rejected.** It derives versions from Conventional Commits on the default
branch, which fits a squash-merge repo less cleanly than changeset intent
files authored per PR, and its pnpm-catalog / `workspace:*` handling is weaker
than Changesets'. It would still hit the `required_signatures` wall and need
the same ghcommit workaround, so it buys no simplification on the hard
constraint while fitting the existing conventions worse.

### semantic-release

Fully automated, commit-message-driven publishing on merge.

**Rejected.** It versions from commit messages and publishes immediately on
merge, with no human-gated "release now" step — a poor fit for a maintainer
who batches betas and decides release timing deliberately. Its monorepo story
requires third-party plugins, and immediate-publish-on-merge removes the
Version PR review point this decision deliberately keeps.

### Stock `changesets/action`

The first-party Changesets GitHub Action.

**Rejected for the commit step, adopted in spirit.** Its unsigned
`GITHUB_TOKEN` push to the release branch is rejected by `required_signatures`
(see Decision). The remaining options to keep it — a managed bot GPG key, or a
`required_signatures` bypass actor — were both rejected: the former adds key
generation, storage, and rotation for one workflow; the latter weakens a
deliberately-enabled security control across all branches. The ghcommit-action
pattern keeps the signing guarantee intact with machinery the repo already
runs.

### Fixed or independent versioning

Covered under Decision § "Linked, not fixed or independent." Fixed publishes
no-op releases of the untouched package; independent produces uninformative
version skew for a matched pair. Linked is the middle ground that matches how
the packages actually ship.

## Implementation Notes

**Files to create/modify:**

- `pnpm-workspace.yaml` — add a `release` catalog with `@changesets/cli` and
  `@changesets/changelog-github`.
- `package.json` (root) — add the two deps under `devDependencies`
  (`catalog:release`); add scripts `changeset`, `version`
  (`changeset version && pnpm install --lockfile-only`), and `release`
  (`pnpm build && changeset publish`).
- `.changeset/config.json` (new) — config per Decision § Tooling.
- `.changeset/README.md` (new) — generated by `changeset init`.
- `.github/workflows/release.yaml` (new) — version/publish job per Decision,
  mirroring `openapi-drift.yaml` (pinned action SHAs, `./.github/actions/setup`).
- `.github/workflows/lint-pr-title.yaml` — skip for `changeset-release/*` head
  refs (the `ci: version packages` title already passes, this avoids a
  redundant run).
- CI changeset gate — a job (in `ci.yaml` or a dedicated workflow) running
  `changeset status --since=origin/main`, skipped for `changeset-release/*`.
- `knip.ts` — confirm the Changesets plugin (auto-activated by
  `.changeset/config.json`) keeps the new deps accounted for; add to root
  `ignoreDependencies` only if knip cannot see them through config + scripts.
- Lint ignores — ensure generated `CHANGELOG.md` and `.changeset/*.md` do not
  fail `hk check`'s lint step.
- `CONTRIBUTING.md` — document the changeset-per-change policy and the
  `--empty` escape hatch.

**External prerequisites (cannot be provisioned in code):**

- Repository secret `NPM_TOKEN` (npm granular/automation token with publish
  scope on `@bedrock-rbx/*`).
- Repository setting: "Allow GitHub Actions to create and approve pull
  requests" enabled.
- A token for the publish step's tag push that re-triggers workflows (so
  `website-release.yaml` fires), per the `openapi-drift.yaml` precedent.

**Verification:**

- `pnpm changeset status` runs clean on a checkout with a pending changeset.
- `pnpm changeset version` locally turns `0.1.0-beta.18` into `0.1.0` and
  refreshes the lockfile.
- `publint` and `npm pack --dry-run` on both packages confirm the published
  tarball's `exports`/`types`/`files` resolve.
- The changeset gate fails a PR with no changeset and passes one with a
  changeset or `--empty`.

ADR-006 requires this ADR to be accepted before implementation begins.

## Related Decisions

- **ADR-006**: ADR Enforcement — this decision is ADR-gated as both a new
  tool and a new mandatory developer policy (the changeset gate).
- **ADR-004**: Documentation Site — `website-release.yaml` already keys off
  the Changesets tag format; this decision is what finally produces those
  tags.
- **ADR-008**: Zero Runtime Dependencies in `@bedrock-rbx/ocale` — Changesets
  is a dev dependency only; the zero-runtime-dependency constraint is
  unaffected.
- **ADR-013**: hk for Git Hook Management — the blocking changeset gate is a
  CI check, not a new local hook tier; it does not alter ADR-013's
  pre-commit/pre-push contract.
- **ADR-014**: Vite+ Unified Toolchain — `changeset` runs outside `vp`,
  consistent with `knip` (ADR-016) and `mutate:changed` (ADR-015).
- **ADR-016**: Knip — the Changesets plugin must keep the new dev deps
  accounted for so the `lint:unused` gate stays green.

## References

- [Changesets](https://github.com/changesets/changesets)
- [Changesets config reference](https://github.com/changesets/changesets/blob/main/docs/config-file-options.md)
- [`@changesets/changelog-github`](https://github.com/changesets/changesets/tree/main/packages/changelog-github)
- [npm provenance](https://docs.npmjs.com/generating-provenance-statements)
- [`planetscale/ghcommit-action`](https://github.com/planetscale/ghcommit-action)
- `openapi-drift.yaml` — the in-repo signed-commit + CI-dispatch precedent.
