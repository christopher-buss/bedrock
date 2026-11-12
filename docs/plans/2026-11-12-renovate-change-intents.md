# Renovate change intents implementation plan

**Status:** Proposed implementation plan, refined through two pairing rounds
with Opus 5.5. No automation has been enabled.

**Goal:** Compatible Renovate dependency updates carry correct native pnpm
change intents, including grouped catalog updates, without a person adding the
file. Uncertain release decisions remain reviewable.

## Recommended scope

Build a repository-owned intent planner and a thin GitHub writer. Retain the
explicit-intent policy and existing `Require a changeset` check. Use the same
planner inside that check to detect stale bot-generated files. Keep native pnpm
versioning and publishing.

The released mscharley action cannot express mixed `patch`/`none` decisions or
reconcile stale files. A compatibility config and wrapper would not fix those
limitations. See the
[executed assessment](../spikes/renovate-change-intents/action-assessment.md).

Both pairing rounds converge on explicit generated intents. Implicit declines in
the gate would leave runtime intents manual and would change the existing
policy, so they do not complete this goal. The implementation begins with
read-only classification, then adds writes; classification alone is not the
finished feature.

## Policy

Classify effective changes per directly affected versioned package, using
structured base/head manifests and catalogs rather than commit titles or catalog
names alone.

- Compatible updates in `dependencies` or `optionalDependencies` produce
  `patch`.
- Updates in `devDependencies` produce explicit `none` only when the resolved
  package name is on a small reviewed tooling allowlist. Start with test/lint
  tooling. Resolve npm aliases before applying this allowlist, and apply it only
  in a development role.
- Other development dependencies require review initially. This includes bundled
  `@actions/core`, `exsolve`, emitted type dependencies and build tools such as
  TypeScript. They cannot silently become automatic declines. Verified
  shipped-dependency exceptions can later enable automatic patches; that map is
  not required for the first usable version.
- Runtime major updates, pre-1.0 potentially breaking updates, peer range
  changes, additions/removals, unknown specifiers, build-impact ambiguity, and
  unexpected source edits require a human intent. An upstream major does not
  imply a major bump of our own package.
- Merge decisions within each package with `patch` above `none`; unresolved
  review reasons cannot be erased by another safe update in the same PR.
- Name direct consumers and let pnpm propagate fixed-group releases.

Derive the covered set from workspace packages with a version field that are not
in `versioning.ignore`, excluding the workspace root. Today this matches the
gate's public packages plus actions. Share this derivation with the gate,
replacing its special-case actions entry; test equivalence on the current
repository. Ignore unversioned examples and ignored private packages. Never
infer scope from `private` alone.

Lockfile-only transitive updates remain manual initially. Their effect is not
captured by today's package selector; automatic handling would require a
separate dependency-graph policy. Non-catalog workspace settings, including
overrides, and root manifest/packageManager changes keep today's coverage
behavior too. Do not introduce an unresolvable repository-wide review failure
for a change that selects no versioned package. Document these limitations,
especially for bundled actions and CLI binaries; an intentional release can
still be recorded by a human.

## Module and file placement

Put the planner in a private workspace package, provisionally
`packages/change-intents`, with no version field. The root test configuration
already discovers `packages/*`; use its existing Vitest, typecheck, coverage and
mutation-test conventions. Do not add a build/publish pipeline for this package.

One pure interface accepts dependency snapshots, changed paths, existing human
intents and owned-file provenance. It returns desired content or deletion,
affected versioned consumers, per-package decisions, and review reasons.
File/API reads and GitHub writes remain in thin shells. Tests exercise that
interface rather than the private decomposition of the implementation.

Use a declared YAML parser already present in the catalog, subject to confirming
its strict parsing behavior. Parse whole files; support quoting and comments
without dependency-diff regexes. Reuse a validated npm-spec parser if needed
rather than inventing version-range handling.

The writer only parses snapshots; it must never run pnpm on a PR tree. The
read-only PR gate runs pnpm and passes its selected versioned package set to the
planner. Require equality with the planner's affected consumer set there, not
only in fixture tests. A mismatch fails with a diagnostic and a manual recovery
path; never silently waive unexplained selection. Human intent coverage cannot
hide a selector mismatch. Keep the existing human-PR policy outside this
Renovate-specific validation unchanged.

## Human and generated intent ownership

Own exactly `.changeset/renovate-pr-<number>.md`. Canonically sort package
entries and dependency/version summaries. Recompute from current inputs; update
or remove this file when the desired output changes. Do not include timestamps
or the triggering head SHA in its bytes.

Preserve human intent files and never rewrite README or ledger. A human intent
added by this PR can supply a deliberate bump or decline for its packages,
retaining today's authority. Remove those packages from generated coverage;
reconcile the remaining owned file. Coverage resolves decisions only for the
named packages, including deliberate human `none` entries. Do not treat an older
intent already on main as this PR's override.

Determine ownership from GitHub-verified writer App attribution on commits
touching the reserved path, not an author-email string or a content marker
alone. If a non-writer changes that path, stop writing and report a handoff
conflict. The explicit recovery is to move the edited content to a normal human
intent filename and remove the reserved file; it then participates in ordinary
per-package human coverage. Do not silently treat a bot-rebased or
foreign-edited generated file as a human exemption from freshness checking.
Exercise attribution after a Renovate squash/rebase in the pilot; prefer a
visible conflict over guessing if provenance is lost.

Unknown cases must remain blocked even if a partial generated intent exists. Do
not let a broad automatically generated `none` conceal a review decision.

## GitHub execution

Run the writer only for authenticated same-repository Renovate PRs, from a
base-owned `pull_request_target` workflow with concurrency per PR. Add a
`workflow_dispatch` recovery entry point that repeats the same identity and
snapshot checks. A label alone is insufficient identity. Read PR files as data
through GitHub, using immutable commit IDs and paginated reads. Execute only
trusted base code; never run pnpm, a PR's scripts, its hooks or its dependency
installation with write credentials. PR metadata is data, not interpolated
shell/script code.

Use a dedicated GitHub App installation token for normal subsequent CI delivery.
App access is a deployment prerequisite, not an assumed existing secret.
Discover existing suitable credentials without exposing them; if new credentials
require the user, use the secret-entry tooling. Do not rely on an unattended CI
cycle from a `GITHUB_TOKEN` write.

Use `createCommitOnBranch` with `expectedHeadOid` for signed append commits.
Verify actual signature/ruleset acceptance and observe the credential's author
email before adding it to Renovate's `gitIgnoredAuthors`. Do not use an invented
custom author in signed mode or force-push branches.

Capture live base B and head H. Obtain GitHub's test merge commit M and verify
its parents are B and H before reading it. Compare B's tree with M's tree; this
is the effective merged snapshot used by the PR gate. A missing, conflicted or
outdated M means retry or report review, not fall back silently to the raw head.
Paginate changed paths and read files at immutable SHAs. Re-read base/head
before writing to H. Discard stale work and retry with a bounded policy. The
head precondition makes the final write conditional; it does not lock the base.
An unchanged desired file is a no-op, including synchronize events caused by the
writer's own commit. Do not rely on a one-commit PR or preservation of generated
files across Renovate rebases.

## Gate and merge semantics

Keep the existing required check's name and explicit coverage logic. For every
Renovate-authored PR, extend the same job with planner validation, even when no
generated file exists. Fail on selector mismatch, unresolved per-package review
reasons without human coverage, reserved-file ownership conflicts, and any
difference between desired and actual owned-file bytes or existence. A stale
generated `none` cannot approve a source edit. Avoid a separate new
required-check name. The writer's success is not proof that the new head passed
CI.

In the gate, verify the merge checkout against its actual base/head parent SHAs
and use that base SHA for both pnpm selection and planner snapshots. If the
remote base has advanced beyond the checkout, request a rerun instead of mixing
trees. Correct the stale two-dot comment in the workflow. Read-only dry runs use
the same merged snapshot contract. Exercise a base adding a catalog consumer
while the PR remains open, not only changes to the head. Use dispatch to recover
a stuck PR after bounded retries; verify Renovate's normal behind-base rebase
behavior during the pilot.

Hold mixed-group automerge only for the write pilot. Restore it after
classification agrees with human decisions and the final generated head passes
the extended check. Verify the existing head-check and behind-base rebase
behavior rather than making a general branch-protection redesign a prerequisite.
Do not weaken existing branch rules or claim that head write preconditions alone
guarantee base freshness.

## Delivery slices

1. **Record the decision.** Document policy, ownership and the write workflow's
   trust model. Use the current CLAUDE.md ADR bar; the new write credential and
   trust model warrant an ADR. Reconcile with ADR-029 through a dated amendment
   or linked decision. Draft is not acceptance. This plan does not create or
   mark an ADR accepted.
2. **Implement the planner test-first.** Fixtures cover named/default catalogs,
   direct edits, npm aliases, unresolved workspace/spec cases, runtime/tooling
   and mixed groups, review for unknown/bundled/build dependencies,
   ignored/unversioned packages, human coverage, unknown edits and stable
   output. Match pnpm selection on real workspace fixtures. Use the established
   RED/GREEN commit cadence.
3. **Add lifecycle behavior.** Test no-op repeat, grouped additions/removals,
   retained stale file, rebase dropping file, multiple commits, owned-file
   conflict, provenance loss, human override and desired-file deletion. Include
   a retained stale `none` followed by a source edit and PR #912's archived diff
   as regressions. For #912, state-s3's runtime update requires a patch;
   classify the other selected consumers from the final allowlist and report
   review rather than assuming every tooling change is allowlisted.
4. **Wire read-only reporting.** Run against real Renovate PR snapshots without
   changing the current gate result or writing to GitHub. Show proposed file,
   package decisions and review reasons. Cover a complete mixed patch cycle.
5. **Enforce the gate, then add the writer.** Add runtime pnpm parity, review
   reasons and freshness validation inside `Require a changeset` before enabling
   any write. Existing manual intents provide the transition path. Mock GitHub
   for race/retry/pagination/deletion and stale merge-parent cases. Add signed
   conditional writes, dispatch, identity checks and ownership handling. Deploy
   the writer with grouped automerge held for the pilot and the necessary App
   credential configured.
6. **Pilot and enable.** On a controlled Renovate PR, verify signature,
   downstream CI, final intent contents, pnpm's release plan, a no-op repeat,
   Renovate extension/rebase and a base advance. Restore grouped automerge after
   the extended check passes and classification agrees with human review.
   Document any live event/provenance limitation instead of enabling a
   non-convergent writer.

Run focused tests, typecheck and the repository's required checks for each
slice. Before rollout, meet the repository's coverage/mutation standards for the
new module. A proposed workflow or mocked transport is not a live proof of token
permissions, signature acceptance or CI event delivery.

## Changes and rollback

Expected changes: the private planner package and fixtures; a writer workflow;
the existing changeset-check workflow; Renovate author-ignore and temporary
automerge configuration; CONTRIBUTING.md and .changeset/README.md; and the
decision record. Change the lockfile only for declared dependencies of the new
private package. Do not add classic Changesets tooling/config.

Rollback disables the writer and restores the existing gate behavior and
Renovate settings. Human intents remain intact; unmerged bot PRs can remove
their owned generated file. Never delete already merged release history.

## Outstanding deployment facts

Confirm usable App credentials, its observed signed attribution, live branch
rules/check origins, existing rebase behavior and event recovery. TypeScript and
other unproven build dependencies default to review, so they do not need a
product decision before starting. Automatic bundled-dependency patches,
lockfile/override analysis and hosted `postUpgradeTasks` are follow-ups. These
are bounded implementation/pilot checks; none require enabling the writer during
this planning task.
