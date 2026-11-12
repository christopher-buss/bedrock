# Renovate change intents for pnpm

Research snapshot: 2026-11-12. Recommendation only; no workflow or Renovate
configuration was changed.

## Recommendation

For hosted Mend Renovate, add a small repository-owned GitHub workflow that
reconciles **one deterministic pnpm intent per Renovate PR**, committed through
GitHub's signed commit API. Keep `platformCommit: "enabled"` and the existing
native pnpm release pipeline. Prefer generating the intent inside Renovate's own
commit through `postUpgradeTasks` **only if the installed Mend plan explicitly
permits the generator command**. Repository configuration alone cannot grant
that permission.

The generator must distinguish release policy from gate coverage: runtime
updates normally warrant `patch`; development-only changes to gated packages
need explicit `none` entries. Resolve catalog entries to their actual consumers.
Do not infer bump type from the PR title: the repository config defaults to
`chore(deps)`, while live grouped PR #912 uses `fix(deps)`; neither title
identifies every affected consumer or its release policy.

## Repository evidence

The exact config is [`.github/renovate.json`](../../../.github/renovate.json).
It enables `npm`, `github-actions`, and `mise`; uses platform commits; disables
automerge globally but enables it for the `patch updates` group (non-breaking
patches plus pins/digests, excluding patched Stryker/Vitest dependencies). That
group can mix development tools, runtime dependencies and workflow pins. An
intent generator must evaluate every constituent change, not assign one policy
to the group.

The [gate](../../../.github/workflows/changeset-check.yaml) runs on PRs
targeting `main`, except `changeset-release/*`. It derives public workspace
packages and adds private-but-versioned `@bedrock-rbx/actions`. It asks pnpm for
changed packages without the `...` dependents prefix, then requires each gated
result to appear in the frontmatter of an intent added or modified by this PR.
An intent already on the base does not count. Its text matching checks coverage,
not bump validity or correctness; an empty changeset cannot cover a package.

[ADR-029](../../adr/029-pnpm-native-versioning.md),
[the intent README](../../../.changeset/README.md), and
[workspace settings](../../../pnpm-workspace.yaml) establish native pnpm
versioning, without `@changesets/cli` or `.changeset/config.json`. Public core,
ocale and state-s3 form a fixed version group; actions is versioned
independently. `maxBump: minor` prevents an accidental 1.0 release. The current
[root manifest](../../../package.json) pins pnpm **11.28.10**, newer than the
ADR's original 11.20.0.

The [release workflow](../../../.github/workflows/release.yaml) consumes intents
using `pnpm version -r`, commits a Version PR through `ghcommit-action`, and
explicitly dispatches CI/smoke. Its comments document required signatures on all
branches. The
[action release workflow](../../../.github/workflows/release-actions.yaml)
bundles action dependencies onto its release tag. Live rulesets and installed
app settings were not queried in this research.

### Catalog-only edits really do reach the gate

Confirmed by inspecting the installed pnpm 11.28.10 bundle,
[getChangedProjects and catalog handling](D:/packages/mise/i/pnpm-ovzetc6m/dist/pnpm.mjs:245883):

- `getChangedProjects` first computes `git merge-base <ref> HEAD`, then compares
  that base with the working tree.
- If `pnpm-workspace.yaml` changed, it compares old/current catalogs and marks
  consumers of changed entries as source changes. It checks `dependencies`,
  `devDependencies`, `optionalDependencies`, and `peerDependencies`, including
  catalog aliases.
- Therefore changing only `catalogs.test.vitest` can require intents for public
  packages and actions even when their manifests remain byte-identical. A root
  lockfile-only edit has no analogous importer-to-consumer expansion in this
  code path.

The gate comment describing pnpm as two-dot is stale for this installed version.
On GitHub's normal PR merge checkout the base is already an ancestor, so the
distinction usually disappears. A generator running on the raw PR head must
explicitly choose the same base/merge semantics; do not compare an old head
directly with an advanced base and accidentally include unrelated base changes.
This was source inspection, not a mutation experiment against the shared
checkout.

## Current upstream capabilities

**Renovate integration:** no documented first-class changeset/intent writer was
found in the current configuration reference or npm manager docs. The upstream
[Changesets integration request](https://github.com/renovatebot/renovate/discussions/24882)
remains a requirements discussion, including an August 2026 request to integrate
pnpm's flag. This is bounded evidence, not proof about every deployed build.
Renovate's changelog features fetch upstream release information for PRs; they
do not establish a release intent for this workspace.
[Configuration reference](https://docs.renovatebot.com/configuration-options/#fetchchangelogs).

**Catalog manager:** the npm manager handles `pnpm-workspace.yaml`. Catalog
entries have dynamic dependency types such as `pnpm.catalog.runtime`, rather
than `dependencies` or `devDependencies`. Rules matching only `devDependencies`
miss catalog updates; the catalog name is still not proof of a consumer's
runtime role.
[Manager documentation](https://docs.renovatebot.com/modules/manager/npm/),
[catalog extraction source](https://github.com/renovatebot/renovate/blob/main/lib/modules/manager/npm/extract/pnpm.ts).

**Post-upgrade hook:** runs before commit; use branch execution for grouped
changes and include `.changeset/*.md` in `fileFilters`. `platformCommit` uses
GitHub App API signing. A second bot's commits require `gitIgnoredAuthors` or
Renovate may stop updating the branch.
[Options](https://docs.renovatebot.com/configuration-options/#postupgradetasks).

**Hosted restriction:** Mend documents a limited, changeable approved command
list visible as `allowedCommands` in job logs. Permission varies by plan;
arbitrary `node scripts/...` or `pnpm change` cannot be assumed allowed. The
allowlist is operator-controlled, not a repository setting. Inspect logs and
plan capabilities before choosing this route.
[Hosted app restrictions](https://docs.renovatebot.com/mend-hosted/hosted-apps-config/#allowed-post-upgrade-commands),
[operator allowlist](https://docs.renovatebot.com/self-hosted-configuration/#allowedcommands).

**pnpm's own commands:** [`pnpm change`](https://pnpm.io/cli/change) writes
compatible Markdown/YAML intents non-interactively with package names, bump and
summary, including `none`. Directly serializing that format is also sufficient
and makes deterministic filenames easier. Do not add the Changesets CLI.
[`pnpm update --changeset`](https://pnpm.io/cli/update#--changeset) is not a
post-hoc diff generator: it records updates made during that command. In the
installed
[implementation](D:/packages/mise/i/pnpm-ovzetc6m/dist/pnpm.mjs:302028), it
requires `.changeset/config.json`, skips private packages and development-only
updates, and creates random filenames. It therefore misses actions and gate
declines here, even apart from Renovate not invoking that update mode. Do not
restore a stub config merely for this feature.

## Proposed bump policy

These are recommended repository policies, not automatic implications of
dependency SemVer:

| Change                                                                      | Intent policy                                                                                                                  |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Runtime/optional dependency patch or minor, compatible integration          | `patch` for each directly affected versioned consumer                                                                          |
| Development/test/lint/docs tooling only                                     | `none` for every consumer the gate selects; no intent when none is gated                                                       |
| A dependency bundled into a shipped artifact                                | Treat as runtime even when declared in `devDependencies`                                                                       |
| Upstream major, peer range change, replacement or uncertain artifact impact | Require review; choose `patch` for compatible internals or `minor` for a breaking pre-1.0 consumer change; never infer `major` |
| Workflow/mise pin or digest only                                            | No intent unless it changes a gated package; then decline or bump based on shipped impact                                      |
| Lockfile-only security/runtime resolution change                            | Review actual shipped impact; emit a release intent when needed even if today's gate selects nothing                           |

Concrete mappings: [core](../../../packages/bedrock/package.json) and
[state-s3](../../../packages/state-s3/package.json) consume `arktype` as
runtime; [e2e](../../../apps/e2e/package.json) is ignored for releases. Core
declares `exsolve` as a dev dependency, so inspect build output before treating
it as tooling. [Actions](../../../packages/actions/package.json) declares
`@actions/core` as a dev dependency but bundles it into the shipped action: its
update warrants an actions patch.
[Ocale](../../../packages/open-cloud/package.json) currently has only dev
dependencies. A Vitest-only update should produce `none`, not gratuitously
release the fixed group.

For mixed grouped patches, combine per-package results with `patch` taking
precedence over `none`; record a sorted dependency/version summary. Name direct
consumers only and let pnpm propagate fixed-group/dependent releases. A real
bump to any public group member releases all three; all-`none` intents produce
no release plan and remain pending until a real release consumes them, as
documented in `release.yaml`.

## Implementation outline and operational tradeoff

### Preferred when the hosted command is permitted

Run a trusted generator through `postUpgradeTasks`, once per branch, after
Renovate updates manifests/catalogs/lockfile. Recompute the entire desired
intent from the effective base and resulting tree each time; reconcile or remove
only generator-owned files. Preserve human intents. Include generated files in
the same platform-signed Renovate commit. This avoids a second writer, a second
CI cycle, author-ignore configuration and external-commit rebase races. Confirm
a permitted runtime and command in Mend logs first; no generic built-in
Changesets setting substitutes for the generator.

### Practical default for hosted Renovate

1. Run a base-branch-owned workflow on PR opened/reopened/synchronize, with
   concurrency per PR. Verify the expected Renovate app identity,
   same-repository head and allowed branch prefix; a label alone is
   insufficient. If using `pull_request_target`, read PR files as data through
   APIs or an isolated checkout; never execute PR scripts or install its
   dependencies with a write token. Run the trusted parser/generator from the
   base.
2. Capture live PR head **H** and base **B**; fetch all manifests, catalogs,
   lockfile and intents at immutable SHAs, with full pagination and failures
   handled closed. Derive policy consumers and the gate's coverage set,
   accounting for catalog aliases. Reject unrelated source edits or ambiguous
   major/peer updates for manual review.
3. Reconcile `.changeset/renovate-pr-<number>.md` to canonical sorted content.
   Replace outdated package/version/bump entries; delete it if nothing needs
   coverage or release. An existing generated file is not evidence it is
   current. Do not touch README, ledger or human intent files. Never use a
   random filename on each run.
4. Re-read head/base before writing. If either advanced, discard and recompute.
   Use GraphQL `createCommitOnBranch` with `expectedHeadOid: H` for an atomic
   head precondition; abort/retry on mismatch rather than force-push. GitHub
   documents automatic signing and credential-derived authorship. Verify the
   actual bot identity/signature under the repo rules.
   [API contract](https://docs.github.com/en/graphql/reference/commits#createcommitonbranch),
   [head precondition](https://docs.github.com/en/graphql/reference/commits#createcommitonbranchinput).
5. Configure `gitIgnoredAuthors` for the **observed API author's email**,
   preferably a dedicated GitHub App. A made-up author conflicts with API
   signing. Reconciliation must rerun after Renovate rebases or extends a
   grouped update: ignored commits may be discarded and must be regenerated.
   Respect a human review override instead of repeatedly undoing it.
6. If desired bytes equal current bytes, do not commit. Keep timestamps and the
   triggering head SHA out of generated content: including the previous head
   creates an endless self-update loop. A signed commit from the generator may
   itself trigger synchronize; that run must be a no-op. Track input
   fingerprints as checks/metadata, or fingerprint only dependency inputs, not
   the generated commit.
7. Require a semantic reconciliation check on the final head/merge result before
   automerge. The existing gate alone accepts stale frontmatter, and
   catalog-only changes to the group could otherwise merge before the writer
   runs. Publish success only after confirming current H/B and matching
   generated content; never reuse success from the pre-intent head. Re-evaluate
   after a base advance, including an update that eliminates an obsolete intent.

The workflow approach gives control without changing hosting, but introduces a
second writer, signing/token setup and required-check coordination. Signature
validity and event delivery are separate concerns: `platformCommit` signs
Renovate's commit, not an arbitrary follow-up `git push`.

### CI delivery must be designed explicitly

Current
[GitHub trigger documentation](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)
says `GITHUB_TOKEN` suppresses push-triggered workflows;
opened/synchronize/reopened PR events can create **approval-required** runs,
while explicit dispatches run. This is newer than the repo comments' blanket
suppression description. Do not rely on unattended PR CI from `GITHUB_TOKEN`
writes. A dedicated installation token can trigger normal PR workflows; make the
generator idempotent to prevent recursion.

If using `GITHUB_TOKEN`, explicitly wire trusted validation/dispatch to the
resulting commit. CI and smoke already allow dispatch, but changeset-check
currently does not, and its `github.base_ref` input assumes a PR event. A future
implementation must add an appropriate reusable/dispatch interface or equivalent
exact-head gate, rather than assume dispatching CI/smoke also satisfies
`Require a changeset`. Ensure required check names and allowed app origins match
branch protection. Dispatching a moving branch ref alone is not proof that H was
tested: verify the run's SHA and current PR head before reporting success.

## Existing automation alternatives

- [`changesets/action`](https://github.com/changesets/action) automates
  versioning/publishing and now offers PR reporting actions; its main release
  action requires `@changesets/cli`. It does not generate the dependency intents
  needed here. Keep the native release workflow.
- [`changesets/bot`](https://github.com/changesets/bot) detects intents and
  comments with an add-file link. It assists humans but does not implement
  automatic dependency policy.
- [`mscharley/dependency-changesets-action`](https://github.com/mscharley/dependency-changesets-action)
  is a relevant third-party writer with API signing support. Its current
  [catalog code](https://github.com/mscharley/dependency-changesets-action/blob/main/src/pnpm/calculateCatalogUpdates.ts)
  supports pnpm catalogs; claiming it cannot handle catalogs would be wrong.
  However, its
  [file loader](https://github.com/mscharley/dependency-changesets-action/blob/main/src/io/fetchRequiredGithubFiles.ts)
  requires `.changeset/config.json`, and
  [PR processor](https://github.com/mscharley/dependency-changesets-action/blob/main/src/processPullRequest.ts)
  refuses multiple commits and skips an already present generated intent. Those
  assumptions do not satisfy native pnpm settings, mixed `none`/patch policy and
  continuous stale-intent reconciliation here. Treat it as an implementation
  reference or adaptation candidate, not a drop-in.

## Remaining validation before implementation

Confirmed locally: config, manifests, release topology, gate logic, pinned pnpm
help and installed source behavior. Confirmed upstream: documented
hooks/signing, catalog extraction, current action source and GitHub trigger
semantics. A live read of
[PR #912](https://github.com/christopher-buss/bedrock/pull/912) confirms
Mend-hosted Renovate, grouped catalog/tool/workflow updates, and no intent among
its changed files at inspection time. Unknown: actual Mend plan/allowlist, live
required checks/rulesets, bot email and token permissions, and third-party
action release tags corresponding to the inspected moving `main` sources.

Before enabling grouped automerge, exercise fixtures for runtime catalog-only
changes, dev catalog-only changes, mixed groups, action bundled dependencies,
ignored private consumers, direct manifests, lockfile-only updates, peer/major
review, a no-op repeat, an interrupted write, a force-rebase, a group update
removing a dependency, a base advance, and a human-authored intent. Then verify
signed commits and required checks on a real Renovate PR.
`pnpm change status`/`pnpm version -r --dry-run` can inspect the plan, but do
not replace PR-specific semantic validation. No such live experiment was
performed in this research-only task.
