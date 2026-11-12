# Change intents

Every `*.md` file here (except this README) is a **change intent**: a record of
which packages a change affects, how far to bump each one, and the summary that
becomes the `CHANGELOG.md` entry.

Record one with:

```bash
pnpm change
```

To state that a change to a published package deliberately needs no release:

```bash
pnpm change --bump none @bedrock-rbx/core
```

Preview what the pending intents will produce:

```bash
pnpm change status
```

Intents are consumed by `pnpm version -r`, which runs in CI and opens the
`ci: version packages` PR. Merging that PR publishes. Never hand-edit package
versions.

`ledger.yaml` is written by `pnpm version -r` and records which intents each
released version consumed. Do not edit it by hand.

Renovate intent automation is deployed in shadow mode until its dedicated
GitHub App and pilot are configured. When enabled, compatible runtime updates
receive `patch` and allowlisted development tooling receives an explicit `none`.
Unknown build, bundled, peer and potentially breaking dependency changes still
need a human intent. Lockfile-only transitive changes retain the manual policy.

The writer reserves `renovate-pr-<number>.md`. Put deliberate human decisions
in another file. To take over an edited reserved intent, move its contents to
a normal intent filename and remove the reserved file. Existing intents from
the base branch do not cover a new PR. See the
[operator guide](../packages/change-intents/README.md) for rollout and recovery.

Configuration lives under the `versioning` key in `pnpm-workspace.yaml`, not in
this directory. See [ADR-029](../docs/adr/029-pnpm-native-versioning.md) for the
full release flow, and `CONTRIBUTING.md` for the day-to-day rules.
