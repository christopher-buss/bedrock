# @bedrock-rbx/actions

GitHub Actions that deploy a Roblox project with Bedrock and persist the
regenerated codegen back to the repository. This context owns the CI/git
vocabulary of that pipeline — distinct from Open Cloud (`@bedrock-rbx/ocale`)
and the IaC engine (`@bedrock-rbx/core`).

## Distribution

The actions ship from this directory of the monorepo, consumed as
`christopher-buss/bedrock/packages/actions/deploy@actions-v<x.y.z>`. The package
is private, so it never reaches npm; its version exists to name that tag, and
`release.yaml` cuts the tag from it (see the 2026-08-30 amendment to ADR-029).

The README pins its `uses:` examples to that same version, and
`src/meta.readme-pins.spec.ts` asserts every pin matches the manifest, so a bump
that leaves the prose behind fails the suite instead of shipping a stale pin.

Staying in the monorepo has a standing cost, accepted deliberately. The runner
materialises an action by extracting the whole repository tarball and keying it
on `{owner}/{repo}/{ref}` — the subpath only selects which `action.yml` runs —
so every consumer downloads the entire repo (~1.8 MiB gzipped) to use ~19 KiB of
source, and a break anywhere in the tree can break an action download, as
dangling symlinks did in #602. Nothing inside the monorepo can narrow that:
GitHub's immutable-action packages, the one mechanism that would, require an
`action.yml` at the repository root, which also rules out a Marketplace listing.
A dedicated repository is what trades those away, and the action source living
next to the code it deploys is what was chosen instead.

## Language

**Commit-back**: Persisting the codegen files a deploy regenerated back onto the
deploy branch. The capability and the primitive action that performs it.
_Avoid_: write-back, sync.

**Reflow**: The race-safe mechanism inside commit-back: snapshot the changed
files, reset onto the latest branch tip, restore only those files (codegen ids
overwrite — never a merge), commit, and push, retrying when the tip moves.
_Avoid_: rebase, merge (it is neither).

**Generated set**: The exact files that changed under `codegen.output` after a
deploy — what commit-back reflows. Discovered by a path-scoped
`git status --porcelain` (so a first deploy's newly created files count too),
never a hand-kept list. _Avoid_: dirty files, artifacts.

**Deploy App**: The per-repository GitHub App a consumer creates and owns to
mint the write-capable token commit-back pushes with. There is no shared, hosted
App. _Avoid_: bot, the Bedrock bot, integration.

**Primitive**: The standalone commit-back action — the reusable reflow, composed
by users who want their own pipeline.

**Composite**: The drop-in deploy action that wires deploy → token → commit-back
around the primitive.
