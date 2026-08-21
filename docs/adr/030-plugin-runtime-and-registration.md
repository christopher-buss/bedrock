# ADR-030: Plugin Runtime and Registration

**Date:** 2026-08-21 **Status:** Accepted

Decision Makers: Maintainer  
Tags: architecture, plugins, config, extensibility, state, migration

## Context

ADR-017 and ADR-018 made `ResourceDriver<K>`, `ResourceKindModule<K>`,
`StatePort`, and `ProgressPort` public contracts, on the stated intent that
third parties could implement them. What shipped was the contracts, not a way to
get an implementation of one into a deploy.

Today the only route is programmatic: a caller passes `opts.statePort` or a
prepared registry to `deploy()`. That serves a library consumer and nobody else.
A user driving the CLI from `bedrock.config.ts` has no way to name an
implementation, so every extension point is effectively closed to them.

A second state **Backend** is what forces the question. Two things block
`state: { backend: "s3", bucket: "..." }` from working at all:

1. `buildStatePort` dispatches over a closed set and returns
   `unsupportedBackend` for anything else, with a hint pointing back at
   `opts.statePort`.
2. The config schema for the `state` block is `onUndeclaredKey("reject")`, so
   `bucket` fails validation before dispatch is ever reached. A backend cannot
   carry its own configuration without core declaring that configuration.

Point 2 is the structural one. Extension is not a matter of adding one more
`case`; it requires config validation to admit keys core does not know.

Under ADR-006 this clears the bar on three counts: a new category of
integration, a cross-package pattern other packages must adopt, and a trust
boundary, since the mechanism executes code named by user config.

## Decision

### Plugins are named in config and imported when config loads

A top-level `plugins` field lists module specifiers:

```ts
export default defineConfig({
	plugins: ["@bedrock-rbx/state-s3"],
	state: { backend: "s3", bucket: "my-bucket", region: "eu-west-2" },
});
```

Core imports each listed specifier while loading config and registers what it
contributes, before validating the rest of the config. A specifier that cannot
be resolved, throws on import, or exports nothing recognizable fails the config
load, naming the specifier and the underlying error.

Failing at load rather than at point of use is deliberate. Deferring until a
`state.backend` value needs the plugin moves the discovery of a broken install
to state-write time, which is after **Apply** has already changed things
upstream.

### A plugin contributes declarations, not privileged code paths

For a **State port** **Backend**, a plugin supplies:

- an adapter builder, returning a `Result` so credential and configuration
  failures stay typed;
- an arktype schema fragment for its own `state` keys, merged into the `state`
  block's schema so validation extends without core knowing the keys;
- declarative descriptions of the fields `bedrock migrate` should prompt for:
  label, placeholder, validation message, order, and a condition on prior
  answers;
- a **Migrate descriptor**.

First-party plugins use the same declarations. There is no privileged path a
third party cannot reach, which is the property that makes the contract worth
having.

### Prompts are descriptors, not code

A plugin does not receive the interactive prompt port and does not write prompt
code. It declares its fields; core renders them, so plugin-supplied prompts
match the rest of the CLI and the prompt port stays private.

The ceiling is what an ordered list of conditional fields can express. That
covers backend coordinates. A flow that genuinely needs branching beyond it
wants a dedicated escape hatch, added when a real case appears.

### Backend names resolve to exactly one adapter

A backend name claimed by two loaded plugins, or by a plugin and a builtin, is
an error that names both specifiers. Silent shadowing of the state backend is
how a deploy runs against the wrong store and the operator learns it from the
state file.

### Core does not enumerate plugin failures

Core wraps a plugin's own typed failure in a `pluginStateBackend` variant
carrying the module specifier alongside the plugin's payload. Enumerating every
backend's error shapes in core is precisely the coupling this ADR removes.

Concepts that any state backend has - not found, access denied, conflict - are
backend-neutral and belong in `StateError`, so the CLI can render them well.
Backend-shaped detail stays in the opaque payload.

`StateError` is a single shape today, `{ file, kind, reason }`, as sketched in
ADR-019. It widens into a discriminated union to carry those concepts. The
widening is additive: the existing shape stays as one arm, so the Gist
**Backend** and every current consumer keep narrowing on the same discriminator.

### Migration is a plugin capability

`bedrock migrate` reads another tool's state and writes bedrock **State**
through a backend. A plugin participates at both ends: it fetches and stores
bytes at coordinates only it understands, and it translates the other tool's
state-location config into bedrock's `state` block.

The split is bytes versus format. A plugin never learns what Mantle YAML is;
core parses it. That keeps foreign-format knowledge in one place while letting a
user whose state has only ever lived in a bucket migrate without downloading it
first.

### Plugins get the same test seam as core

Adapter tests inject a fake transport rather than mocking a client. Whatever
seam a first-party plugin uses is exported from `@bedrock-rbx/testing`, so a
third-party author writes the same kind of test against the same kind of fake.

### First-party plugins version with core

`@bedrock-rbx/state-s3` and any later first-party plugin join the fixed version
group with `@bedrock-rbx/core` and `@bedrock-rbx/ocale`. See the 2026-08-21
amendment to ADR-029.

## Consequences

### Positive

- A new **Backend** ships without a core release and without core learning
  anything about it.
- Config validation extends to keys core does not declare, which was the hard
  blocker.
- The contract is exercised by first-party use, so a gap in it surfaces here
  rather than in someone else's package.
- `deploy()`'s programmatic options keep working unchanged; `plugins` is the
  config-driven route to the same place.

### Costs

- Config load executes code named by config. The entries are user-authored, at
  the same trust level as the config file itself, and core does not sandbox
  them. A config file is already executable in the TypeScript and Luau formats,
  so this widens what runs at load rather than introducing execution.
- Declarative prompts trade expressiveness for a private prompt port.
- A fixed version group means a first-party plugin releases whenever core does,
  including when nothing in the plugin changed.
