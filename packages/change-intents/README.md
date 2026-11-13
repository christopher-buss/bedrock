# Renovate change intent operations

The planner is read-only by default. The existing `Require a changeset` job
continues requiring explicit intents while reporting semantic diagnostics for
Renovate PRs. No classic Changesets config or CLI is required.

## Configure the writer

Create a GitHub App installed only on this repository with Contents: write and
Pull requests: read. Store its **Client ID** (not the numeric App ID) in
`RENOVATE_INTENTS_APP_ID` and its private key in
`RENOVATE_INTENTS_APP_PRIVATE_KEY` as repository Actions secrets. The retained
secret name supplies `client-id` to create-github-app-token v3. Never reuse a
developer's token or an unrelated service credential.

Set `RENOVATE_INTENTS_WRITER_LOGIN` to the App's actual bot login. Verify the
App-authenticated API commit is GitHub-signed and accepted by the all-branches
signature ruleset. Observe the resulting commit's author email and add that
exact email to Renovate `gitIgnoredAuthors`; signing does not support an
invented custom author.

`RENOVATE_INTENTS_MODE` controls deployment:

- Unset or `shadow`: report proposals without changing the existing gate.
- `enforce`: block Renovate PRs on unexplained changes, selection mismatches,
  ownership conflicts and stale or missing generated intents. Writers remain
  read-only.
- `write`: enforce the same gate and allow the trusted writer to reconcile
  `.changeset/renovate-pr-<number>.md` using the App credential.

The writer's commit becomes the PR head, so Renovate's failing
`renovate/artifacts` status on its own commit no longer blocks a merge. The gate
reads that status and fails until the artifact update is fixed.

Setting `write` without usable App credentials must fail visibly. A successful
writer run does not mean that CI tested its resulting commit. Confirm the checks
on the final PR head. Do not assume the check name is protected: inspect actual
repository branch rules during the pilot.

## Pilot

First compare shadow decisions with human review over a mixed update cycle. Hold
the grouped patch rule's `automerge` off explicitly during the write pilot.
Enable enforcement before writes. Then verify a controlled runtime update,
allowlisted development update, grouped extension, no-op repeat, Renovate
rebase, and a base advance adding a catalog consumer. Check signatures, final
head checks, and the pnpm release plan before restoring the patch rule's
previous automerge setting.

`tsdown` builds the shipped bundle, so a compatible update receives `patch` like
a runtime dependency. TypeScript, other build tools, bundled development
dependencies and unknown version specifications require human review.
Lockfile-only resolution changes and non-catalog overrides retain the existing
gate coverage behavior; add a human intent when those changes need a release.

## Recover and roll back

Dispatch the writer workflow with the PR number after a stale merge snapshot or
a bounded retry failure. It repeats identity and immutable-snapshot checks.
Never force-push or execute PR code with the App token.

If someone changes the reserved generated path, move the intentional contents to
another `.changeset/*.md` filename and delete the reserved file. Human intents
added or modified by the PR cover only their named packages. An old intent
already on the base branch does not count.

To roll back, disable writes and restore the former gate and Renovate settings.
Leave human intents and merged release history intact. Clean up a generated file
only on the affected unmerged PR.
