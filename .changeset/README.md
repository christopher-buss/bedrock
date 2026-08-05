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

Configuration lives under the `versioning` key in `pnpm-workspace.yaml`, not in
this directory. See [ADR-029](../docs/adr/029-pnpm-native-versioning.md) for the
full release flow, and `CONTRIBUTING.md` for the day-to-day rules.
