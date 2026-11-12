# Assessment: dependency-changesets-action v1.2.5

Assessed 2026-11-12 against **`874dac2372a085cb94f750e8bdf5b1173a838a75`**.
**No-go as an unattended drop-in for Bedrock's current gate and runtime/`none`
policy.** The action is a credible implementation reference: catalog expansion,
private-package inclusion, deterministic filenames and signed writes already
exist. A shim config plus an ordinary workflow wrapper fixes startup and
operational wiring, but cannot add per-package `none`, accurate
versioned-package selection or stale-intent reconciliation through the published
inputs. A simpler policy that patches every detected versioned consumer makes a
limited pilot plausible; it deliberately causes tooling-only releases and still
needs lifecycle controls.

Only this assessment was written in the repository. No commits, PRs,
workflow/config changes or GitHub writes were made. Research and fixtures were
performed directly, without subagents.

## Immutable target and execution fidelity

GitHub's release API reports v1.2.5 published **2026-07-15 05:09:01 UTC**. The
annotated tag object is `e23e7239288a519c33664e043343c3fd8a144bdd`; its peeled
commit, and the SHA to pin in `uses:`, is
**`874dac2372a085cb94f750e8bdf5b1173a838a75`**.
[Release API](https://api.github.com/repos/mscharley/dependency-changesets-action/releases/tags/v1.2.5),
[tag object](https://api.github.com/repos/mscharley/dependency-changesets-action/git/tags/e23e7239288a519c33664e043343c3fd8a144bdd).

The release
[action manifest](https://github.com/mscharley/dependency-changesets-action/blob/874dac2372a085cb94f750e8bdf5b1173a838a75/action.yml)
runs **Node 24**, executing checked-in `dist/index.js`. I inspected the bundled
loader, catalog calculator, parser, generator, processor and publisher against
their TypeScript counterparts; the assessed decisions agree. More strongly,
fixtures invoked those functions **from the release bundle**, not a
reimplementation. No install or rebuild was needed. This is semantic inspection
and execution of the relevant bundled paths, not proof of a reproducible full
build; the referenced source-map file is absent from the downloaded release
tree.
[Bundled artifact](https://github.com/mscharley/dependency-changesets-action/blob/874dac2372a085cb94f750e8bdf5b1173a838a75/dist/index.js).

At inspection, main was `e088977f093aa512b8686569ff8721ba5cfc7d77`. The
release-to-main comparison changes only `package.json`, `pnpm-lock.yaml` and
`.github/workflows/stale.yml` (dependency/security and workflow maintenance); no
parser, policy or writer fix is present. Moving to main does not resolve the
findings below.
[Comparison](https://github.com/mscharley/dependency-changesets-action/compare/874dac2372a085cb94f750e8bdf5b1173a838a75...e088977f093aa512b8686569ff8721ba5cfc7d77).

## Bedrock contract

Bedrock uses native pnpm versioning and has **no `.changeset/config.json`**.
`versioning.ignore` excludes five named private packages; core, ocale and
state-s3 form a fixed group, actions is private but independently versioned, and
`maxBump: minor` caps plans. Private examples without versions are excluded by
pnpm without needing that ignore list. The action does not read any of these
`versioning` settings. [Workspace](../../../pnpm-workspace.yaml),
[intent convention](../../../.changeset/README.md),
[root manifest](../../../package.json).

The gate derives public packages plus actions, asks pnpm for changed consumers,
and requires a package entry in an intent added or modified by this PR. An empty
changeset or skipping a tooling update cannot supply that coverage. `none` is an
explicit supported decline; release.yaml says declines form no plan and the next
real release consumes them. The existing gate checks package presence, not
correct policy or freshness.
[Gate](../../../.github/workflows/changeset-check.yaml),
[release pipeline](../../../.github/workflows/release.yaml).

Core and state-s3 consume arktype as runtime; state-s3 consumes AWS SDK packages
as runtime. Vitest is development tooling across the gated packages. Actions
declares `@actions/core` in **devDependencies**, but bundles it into its shipped
artifact, so dependency section alone is insufficient for Bedrock's policy. Core
also lists inlined exsolve/type-fest dependencies, warranting deliberate
artifact-policy choices. [Core](../../../packages/bedrock/package.json),
[state-s3](../../../packages/state-s3/package.json),
[ocale](../../../packages/open-cloud/package.json),
[actions manifest](../../../packages/actions/package.json),
[actions bundler](../../../packages/actions/tsdown.config.ts),
[action release](../../../.github/workflows/release-actions.yaml).

Renovate groups patch/pin/digest updates across npm, Actions and mise; platform
signing is enabled and patch-group automerge is enabled. Its default semantic
type is `chore`, whereas the observed PR #912 commit is
`fix(deps): update patch updates`. `gitIgnoredAuthors` is absent.
[Renovate configuration](../../../.github/renovate.json).

Read-only GitHub inspection confirmed PR #912 had exactly one commit,
**`453a63839112c9904d51990a6d4ba5050f12c3b5`**, and base
`12f33e0bfaecd1aa3fba3603c8aa9e72a2f9c68f`. Changes include workflows, mise,
root package.json, lockfile and workspace YAML; no intent. Its runtime catalog
change is `@aws-sdk/credential-provider-node` 3.972.90 → 3.972.96 alongside
tooling changes. Thus “multiple commits” is not an initial blocker for this PR.
[PR](https://github.com/christopher-buss/bedrock/pull/912),
[immutable commit diff](https://github.com/christopher-buss/bedrock/commit/453a63839112c9904d51990a6d4ba5050f12c3b5).

## Release data path and gaps

### Loading and package selection

`fetchRequiredGithubFiles` concurrently loads PR commits/diff and config,
workspace YAML, lockfile and root package.json. Config uses the **required**
loader: missing config throws, with **no default or fallback to pnpm settings**.
`{}` passes its permissive configuration guard, but does not encode Bedrock's
ignore policy. Workspace/root/lock are optional. The optional loader catches all
request failures as missing, so access/network errors can silently disable
catalog detection. Reads use the mutable head **branch name**, and PR
diff/commit endpoints, rather than one immutable snapshot.
[Loader](https://github.com/mscharley/dependency-changesets-action/blob/874dac2372a085cb94f750e8bdf5b1173a838a75/src/io/fetchRequiredGithubFiles.ts),
[file reader](https://github.com/mscharley/dependency-changesets-action/blob/874dac2372a085cb94f750e8bdf5b1173a838a75/src/io/github/getFile.ts),
[config guard](https://github.com/mscharley/dependency-changesets-action/blob/874dac2372a085cb94f750e8bdf5b1173a838a75/src/model/ChangesetsConfiguration.ts).

Selection takes changed package.json paths plus catalog consumers; filters
changeset-directory scope, private policy, then workspace globs
(`pnpmWorkspace.packages` preferred to root workspaces). It removes config
`ignore` glob matches, unnamed packages and packages with a `workspaces`
property. **Private packages default to included**: omission of
`privatePackages`, `true`, or `{version:true}` allows actions.
`false`/`{version:false}` removes all private packages, including actions. There
is **no requirement for a version field**. Consequently copying only pnpm's
ignore list includes private unversioned examples; a shim must additionally
ignore those, or explicitly allow only the intended package set through suitable
ignore patterns. No fixed-group propagation is needed in this writer: pnpm can
propagate from direct intents later.
[Processor and filters](https://github.com/mscharley/dependency-changesets-action/blob/874dac2372a085cb94f750e8bdf5b1173a838a75/src/processPullRequest.ts),
[generator](https://github.com/mscharley/dependency-changesets-action/blob/874dac2372a085cb94f750e8bdf5b1173a838a75/src/generateChangeset.ts),
[main wiring](https://github.com/mscharley/dependency-changesets-action/blob/874dac2372a085cb94f750e8bdf5b1173a838a75/src/main.ts).

### Catalogs and YAML

Named and default catalogs are supported. The calculator maps **current
dependency name + current catalog version** to lockfile importers whose
specifier equals `catalog:<name>` (default `catalog:`). It considers
dependencies, devDependencies, peerDependencies and optionalDependencies
**equally**, losing the role when it returns consumer paths. It needs lock
importers; absent lock gives an empty mapping/warning, and a present
lockfileVersion other than string `9.0` disables catalog handling. Bedrock's
current lockfile works.
[Calculator](https://github.com/mscharley/dependency-changesets-action/blob/874dac2372a085cb94f750e8bdf5b1173a838a75/src/pnpm/calculateCatalogUpdates.ts),
[lock guard](https://github.com/mscharley/dependency-changesets-action/blob/874dac2372a085cb94f750e8bdf5b1173a838a75/src/model/PnpmLock.ts),
[loader](https://github.com/mscharley/dependency-changesets-action/blob/874dac2372a085cb94f750e8bdf5b1173a838a75/src/io/fetchRequiredGithubFiles.ts).

Full YAML loading uses the YAML parser, but **diff extraction uses a regex on
added lines**, allowing optional double quotes only. Double-quoted scoped keys
and plain arktype work; single-quoted scoped keys and inline-comment version
lines fail lookup in executed fixtures. Bedrock currently uses compatible double
quotes. Issue **#691** reports the single-quote bug for this exact release and
is closed as not planned after staleness, not fixed. The parser also does not
track YAML section/catalog context: an added override line can match a
same-name/version catalog entry, and identical name/version entries across
catalogs share a lookup key (potential over-selection). Lockfile-only resolution
changes do not expand to importers. These latter observations are static
findings, not fixture results.
[Diff parser](https://github.com/mscharley/dependency-changesets-action/blob/874dac2372a085cb94f750e8bdf5b1173a838a75/src/parsePatch.ts),
[issue #691](https://github.com/mscharley/dependency-changesets-action/issues/691).

### Bump policy and lifecycle

The **sole commit message**, not PR title or dependency SemVer, determines one
shared bump: `fix` → patch, `feat` → minor, breaking marker → major,
other/unrecognized → none. Conventional mode defaults true. Turning it off
forces patch. Crucially, detected `none` **returns null**; it never serializes
`"package": none`. Every selected package receives the same bump and the message
body is the commit message. This cannot express runtime patch plus
development-only none in one group. A direct package.json edit is considered
regardless of whether the edit changes dependencies.
[Commit parser](https://github.com/mscharley/dependency-changesets-action/blob/874dac2372a085cb94f750e8bdf5b1173a838a75/src/parseConventionalCommitMessage.ts),
[generator](https://github.com/mscharley/dependency-changesets-action/blob/874dac2372a085cb94f750e8bdf5b1173a838a75/src/generateChangeset.ts),
[manifest defaults](https://github.com/mscharley/dependency-changesets-action/blob/874dac2372a085cb94f750e8bdf5b1173a838a75/action.yml).

Output is deterministic: **`.changeset/dependencies-GH-<PR>.md`**. Processing
refuses any commit count other than one. It skips if that exact output path
appears anywhere in the PR diff, without checking content, bump policy or
freshness. Human intents with other filenames do not suppress generation.
Existing generated intent on the base is not detected merely by existence;
unsigned creation can then fail because it does not supply a file SHA, while
signed addition can replace that path. Neither behavior constitutes deliberate
reconciliation.
[Processor](https://github.com/mscharley/dependency-changesets-action/blob/874dac2372a085cb94f750e8bdf5b1173a838a75/src/processPullRequest.ts),
[publisher](https://github.com/mscharley/dependency-changesets-action/blob/874dac2372a085cb94f750e8bdf5b1173a838a75/src/io/publishChangeset.ts).

After its own write there will normally be two commits, so a rerun skips. If
Renovate rebases to one commit and drops the generated file, it can regenerate.
If Renovate folds/preserves it in one commit, it skips even when dependencies
changed; if the PR retains multiple commits, it skips before parsing. This is
write-once idempotence, **not** update/delete reconciliation. There is no byte
comparison, obsolete-intent deletion or override protocol.
[Processor](https://github.com/mscharley/dependency-changesets-action/blob/874dac2372a085cb94f750e8bdf5b1173a838a75/src/processPullRequest.ts).

### Signing, races and CI

With **`sign-commits: true`**, it calls GraphQL `createCommitOnBranch` with
`expectedHeadOid: pr.head.sha`. GitHub documents that mutation as appending a
commit whose parent is current branch HEAD; **this action does not amend
Renovate's original commit**, and has no alternate amend implementation. The
precondition protects the signed write from a changed head. It does not freeze
earlier branch-name reads, protect against a changed base, or retry/recompute a
rejected write. The unsigned REST contents path lacks an expected-head
precondition. Custom authors conflict with signing and throw.
[Publisher](https://github.com/mscharley/dependency-changesets-action/blob/874dac2372a085cb94f750e8bdf5b1173a838a75/src/io/publishChangeset.ts),
[GitHub commit API contract](https://docs.github.com/en/graphql/reference/commits#createcommitonbranch).

The signed author's identity comes from the credential; GitHub signs
automatically where supported. Bedrock's release workflow documents signature
requirements on all branches, so the action's **default unsigned mode is
unsuitable**. Use a token with contents write plus access to read PR
metadata/commits and repository files; an installation token with contents write
and pull requests read is a straightforward choice. Explicitly pass `token`:
although action.yml marks it optional, `parseInput` requires it and implements
no `github.token` fallback. Do not copy the README's custom-author example into
signed mode. Actual ruleset acceptance, installed app permissions and the
observed author's email still need a controlled integration test.
[Inputs](https://github.com/mscharley/dependency-changesets-action/blob/874dac2372a085cb94f750e8bdf5b1173a838a75/src/io/parseInput.ts),
[release signing precedent](../../../.github/workflows/release.yaml),
[upstream README](https://github.com/mscharley/dependency-changesets-action/blob/874dac2372a085cb94f750e8bdf5b1173a838a75/README.md).

Add the **observed credential author's email** to Renovate `gitIgnoredAuthors`;
otherwise the extra author makes Renovate consider the branch modified and stop
updating it. Ignoring the author permits Renovate updates, but supplies no
promise that the action's file survives or stays current.
[Renovate contract](https://docs.renovatebot.com/configuration-options/#gitignoredauthors).

Prefer an App installation token/PAT that permits normal CI event delivery.
Current GitHub docs distinguish suppressed push events from approval-required
opened/synchronize/reopened PR runs for `GITHUB_TOKEN`; unattended CI cannot be
assumed. With that token, explicit dispatch/validation wiring is necessary,
including the intent gate, which currently only runs on pull_request and expects
`github.base_ref`. Merely dispatching existing CI/smoke does not solve that
gate. A wrapper should run trusted base code, authenticate the Renovate
actor/same-repo branch, avoid executing PR code, serialize per PR and validate
the resulting head before automerge. The upstream action itself checks only that
the PR is open, not its bot identity.
[GitHub event behavior](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow),
[main](https://github.com/mscharley/dependency-changesets-action/blob/874dac2372a085cb94f750e8bdf5b1173a838a75/src/main.ts),
[gate](../../../.github/workflows/changeset-check.yaml).

## Executed fixtures

Used Node **24.15.0**, no dependency installation. Downloaded the release into a
unique temp directory, removed only its terminal `run()` invocation, exported
internal bundled functions, and selected `node:path.posix` operations to model
the intended Ubuntu runner while executing on Windows.
Parser/generator/loader/publisher logic was otherwise unchanged. Synthetic
catalog updates used Bedrock's real current workspace, lock importers and
manifests; GitHub calls were mocked. These are isolated component fixtures, not
full action/CI integration tests.

| Scenario                                                                         | Observed result                                                                                         |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Missing config, as Bedrock stands                                                | Required loader rejects `.changeset/config.json`; no fallback                                           |
| Runtime catalog-only arktype + AWS client-s3                                     | Shim ignoring pnpm's five named packages emits core patch + state-s3 patch                              |
| Dev catalog-only Vitest with `fix`                                               | actions, core, ocale, state-s3 all receive patch; no none entries                                       |
| Same Vitest update with `chore`                                                  | No intent                                                                                               |
| Private actions bundled `@actions/core`                                          | Included as patch with private versioning enabled; omitted entirely with privatePackages false          |
| Mixed arktype + Vitest                                                           | All four gated consumers get patch; cannot give ocale/actions none                                      |
| One-commit rebase retaining stale generated intent                               | Returns null, even with changed dependency inputs                                                       |
| Two commits after writer                                                         | Returns null                                                                                            |
| One-commit rebase dropping generated intent                                      | Regenerates intent                                                                                      |
| YAML scoped key quoting                                                          | Double quotes work; single quotes fail; inline version comment fails                                    |
| Signed publisher, mocked transport                                               | Captured createCommitOnBranch addition and exact `expectedHeadOid`; no network write                    |
| Conventional parser                                                              | fix patch, feat minor, chore none, `fix!` major, unrecognized none                                      |
| Actual PR #912 diff and immutable-head workspace/lock, shim ignore = pnpm ignore | Emits **state-s3 patch plus private unversioned example-ci-codegen patch**; confirms the shim scope gap |

The synthetic harness records 15 result groups, plus the actual-PR fixture
separately. For the actual-PR run, manifests were read from the shared checkout
(the PR does not modify those consumer manifests); head workspace and lock were
downloaded at the supplied SHA. PowerShell-added CRLF in the saved diff was
normalized to LF before parsing. Initial CRLF transport and absent-source-map
probe failures were corrected/isolated; the final actual-PR fixture passes. No
upstream full test suite, real commit signature, race mutation, pnpm release
plan or required-check delivery was exercised.

Reproduction artifacts:
[fixture harness](D:/temp/agents/dependency-action-assessment-20261112-7370dae1/fixtures.mjs),
[results](D:/temp/agents/dependency-action-assessment-20261112-7370dae1/results.json),
[actual PR harness](D:/temp/agents/dependency-action-assessment-20261112-7370dae1/extra.mjs),
[actual PR result](D:/temp/agents/dependency-action-assessment-20261112-7370dae1/pr912-result.json).
These temp artifacts are supplementary; findings and observed outputs are
captured here.

## Adoption decision and minimum changes

**Blocker for unchanged adoption:** no config means immediate failure. **High
severity for the proposed Bedrock policy:** no explicit none generation, no
mixed bumps, no stale-intent refresh, and scope mismatches for unversioned
private workspaces. **Medium severity:** quote/comment parsing limitations,
mutable reads, no signed-write retry, CI/token integration. Compatible Node
runtime and signed expected-head protection are strengths, not gaps. These
severities assess unattended adoption, not upstream's narrower intended use.

Three practical options:

1. **Limited patch-every-consumer pilot:** add a minimal config with a
   maintained ignore set covering _all_ unversioned/ignored packages while
   retaining actions; set `use-conventional-commits: false` and
   `sign-commits: true`; pass an installation token; add the observed author
   email to Renovate's ignore list; pin the release SHA in a trusted, per-PR
   workflow. Keep human review/disable patch-group automerge until
   regenerated-head behavior and checks are proven. Accept releases for
   Vitest/tooling and manually handle stale generated files/multiple commits.
   This is enough to try the action without a fork, but is a conscious policy
   concession. A config shim is adapter metadata, not a reason to restore the
   Changesets CLI or replace pnpm's release pipeline.
2. **Keep Bedrock's runtime-patch/dev-none policy:** use a small
   repository-owned reconciler, or a maintained fork modifying loader, package
   selection, generator and lifecycle. It must resolve actual gated/versioned
   consumers, preserve dependency roles with explicit shipped-bundle exceptions,
   merge per-package bump choices, emit none, and update/delete its
   deterministic file from current inputs. Signed API commits with expected head
   can reuse this action's approach. A wrapper that adds those missing
   computations and bypasses write-once processing is effectively the custom
   implementation; no published input unlocks them.
3. **Reduce automation scope:** automatically handle only verified compatible
   runtime updates and let humans record declines for tooling/mixed cases. This
   avoids imposing every broader-research design on a small pilot, but leaves
   the gate intentionally manual outside that scope. A title-only filter cannot
   reliably identify those cases in the current mixed patch group.

Recommendation: **choose option 2 for unattended grouped automerge; option 1
only if tooling-only releases and manual lifecycle repair are acceptable.** Do
not fork solely to add a config fallback: the substantive work is policy and
reconciliation. Before enablement, validate signed author/ruleset acceptance,
actual Renovate rebase behavior and final-head required checks on a controlled
PR. None of those live writes was authorized or attempted here.

The broader [research note](README.md) correctly identifies catalog support,
missing-config failure, one-commit refusal and existing-file skipping. This
release assessment adds the important qualifications: private actions are
supported through config; current PR #912 meets the initial commit-count
requirement; dev catalogs are detected but indiscriminately bumped; API signing
appends rather than amends; a simplistic pnpm-ignore shim includes unversioned
private examples; and main contains no functional fix for these behaviors.
