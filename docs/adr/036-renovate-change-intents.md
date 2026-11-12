# ADR-036: Repository-owned Renovate change intents

Date: 2026-11-12 Status: Accepted

## Generate explicit intents without running PR code with write credentials

Renovate's grouped catalog updates can affect both shipped dependencies and
development tooling. Native pnpm selects both kinds of consumers for the
existing intent check. We retain ADR-029's explicit-intent policy: compatible
runtime updates receive `patch`, reviewed development tooling receives `none`,
and unknown release impact remains a human decision. The user accepted this
design for implementation after two pairing rounds documented in the
[implementation plan](../plans/2026-11-12-renovate-change-intents.md).

Use one repository-owned pure planner for generation and validation. A
base-owned workflow reads the PR's effective merged tree as data and appends one
signed conditional commit through GitHub's API. It must not run pnpm, install
dependencies, or execute scripts from the PR with write credentials. A dedicated
App token provides signed attribution and subsequent CI delivery. The read-only
PR gate compares the planner's selected packages with pnpm and checks exact
generated content, unresolved review reasons and file ownership.

The existing action was evaluated against its released bundle. It lacks
per-package `none` generation and skips stale generated files, so a wrapper
would need to replace its core behavior. Hosted Renovate's command allowlist is
an external constraint; we do not depend on a `postUpgradeTasks` exception. See
the [assessment](../spikes/renovate-change-intents/action-assessment.md).

The writer owns one reserved file per PR; human intents retain package-local
authority. Foreign edits to the reserved file require an explicit handoff.
Lockfile-only transitive resolution changes and non-catalog root settings keep
today's gate behavior. Unknown bundled/build/type dependencies remain manual
initially. Rollout starts read-only and requires a controlled signed write, CI
and rebase pilot before unattended updates are enabled.

This extends [ADR-029](029-pnpm-native-versioning.md); version planning,
fixed-group propagation and publishing remain native pnpm operations.
