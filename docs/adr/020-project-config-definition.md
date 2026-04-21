# ADR-020: Project Config Definition

**Date:** 2026-04-22 **Status:** Accepted

Decision Makers: Maintainer  
Tags: config, c12, define-config, arktype, mantle, migration, public-api

## Context

Bedrock needs a way for users to define their project configuration. The shape
must serve two modes of use established by ADR-017:

- **Static**: a config consumed by the library and a future CLI with no
  modification, including by non-TypeScript authors writing YAML or JSON.
- **Dynamic**: a config a user script can mutate or compute before deploying,
  to support scheduled price changes, environment-specific overrides,
  multi-game orchestration, and other programmatic flows.

Three constraints shaped the decision. Mantle parity governs migration:
existing Mantle users have YAML configs to bring over, and Bedrock replaces
Mantle as the Roblox IaC tool. ADR-019 locks the desired-state shape as flat
`{ kind, key, ... }` resource arrays with pre-computed `iconFileHash`; the
config shape must bridge cleanly to that. ADR-017 treats Luau-population game
developers as a peer audience to TypeScript-native users, so the config must
read naturally in YAML and JSON without degrading the programmatic experience.

Scheduling, overlay systems, first-class environments, state locking, and
deploy provenance are out of scope for this ADR and tracked separately in
issues #110, #122, and #123. The config shape must not preclude them.

## Decision

### Format and loader

Bedrock supports **TypeScript, JavaScript, YAML, and JSON** config files via
[c12](https://github.com/unjs/c12). A single config file declares the project;
c12 handles discovery, parsing, and layered composition.

Discovery follows c12 defaults:

- `bedrock.config.{ts,js,mjs,cjs,yaml,yml,json}`
- `.bedrockrc`, `.bedrockrc.{json,yaml,yml,ts,js}`
- `package.json#bedrock`

c12's `extends` layering is available for future environment overlay work
(tracked in #110).

### Config shape

The config has a flat root with one wrapper for experience-level singleton
metadata. Every other top-level key is a resource collection.

- **`experience`** (singleton object): holds experience-level metadata
  fields. Acts as the namespace for properties of the one experience the
  config describes.
- **Resource collections** (plural keyed maps): each top-level collection
  holds entries of one resource kind. Entry keys are user-supplied
  `ResourceKey` values, stable across deploys, opaque to Roblox, and used
  to correlate desired and current state per ADR-019.
- **Reserved keys**: `environments` and `extends` are reserved at the root
  and must not be claimed by resource collections. They are the slots
  future ADRs will use for environment modeling (#110) and config layering.

Collection-to-kind mapping for `buildDesired` (ADR-019):

| Config key | `kind`              |
| ---------- | ------------------- |
| `places`   | `place`             |
| `passes`   | `gamePass`          |
| `badges`   | `badge`             |
| `products` | `developerProduct`  |
| `assets`   | `asset`             |

The schema of each resource-kind's entry body is owned by the issue that
implements that kind, not by this ADR.

### `defineConfig` signature

`defineConfig` is exported from `@bedrock/bedrock` and accepts either a plain
config object or a function producing one. The function may be synchronous or
asynchronous, and receives a `ctx` argument whose shape is intentionally
minimal so future ADRs can extend it without breaking changes.

```ts
type ConfigInput = ((ctx: Context) => Config | Promise<Config>) | Config;

export function defineConfig<T extends ConfigInput>(config: T): T;
```

`Context` is an empty object in this ADR. Future ADRs may populate it.

### Validation

Config is validated at load time against an [arktype](https://arktype.io)
schema. The schema is the single source of truth; TypeScript types for the
public `Config` interface are inferred from it. arktype exposes its validator
via the [Standard Schema](https://github.com/standard-schema/standard-schema)
specification, which keeps the library swappable. Validation runs inside
`loadConfig` before returning. Malformed configs surface as a structured error
attributed to source file and location.

### `loadConfig` semantics

```ts
export function loadConfig(options?: LoadConfigOptions): Promise<Result<Config, ConfigError>>;
```

- Returns a **plain mutable** `Config`, not `Readonly<Config>` and not
  frozen. Mutation is the intended programmatic path: users adjust fields
  before calling `deploy()`.
- **Fresh per call.** Every invocation re-reads, re-resolves, and
  re-validates. Long-running scripts see up-to-date values on each call.
- Errors return via the `Result` type (ADR-009); file errors, parse errors,
  and validation errors are distinct cases.

### Mantle migration

Migrating from a Mantle YAML is a mechanical transform:

1. Strip the `target` wrapper.
2. Lift the resource collections nested under `target.experience` to the
   root.
3. Merge the contents of `target.experience.configuration` into
   `experience`.

The `bedrock migrate` command (tracked in #104) automates this.

## Consequences

### Positive

- Multi-format support meets ADR-017's Luau-population audience on its
  terms: YAML and JSON authors get the same structural guarantees as
  TypeScript authors.
- c12 provides discovery, layered composition, and environment overlays
  without Bedrock owning those concepts directly.
- Plain mutable return matches the programmatic mutation flow ADR-017
  describes and aligns with TypeScript ecosystem norms.
- Flat keyed-map structure matches Roblox tooling idiom (Wally, Rokit,
  Mantle), minimising cognitive overhead for the Luau-population audience.
- Runtime validation catches typos at load time rather than during deploy,
  which matters most for YAML and JSON authors who lack TypeScript
  compile-time checks.
- Reserved root keys preserve extensibility seams for future environment
  and overlay work without preemptive commitment to their shape.
- Function-form `defineConfig` gives TypeScript users a first-class path
  for computed configs without requiring them to escape to a separate
  script.

### Negative

- c12 and arktype are runtime dependencies of `@bedrock/bedrock`. ADR-008's
  zero-runtime-dependencies rule is scoped to `@bedrock/open-cloud` and
  does not apply here, but dependency count is nonzero.
- Adding non-experience target types later requires a 0.x breaking change
  and a codemod to reintroduce a `target` wrapper. Mantle designed for
  this seam; Bedrock accepts the breaking-change risk in exchange for a
  flatter default shape today.
- The config schema cannot enforce `{kind, key}` uniqueness at the
  TypeScript type level, but the keyed-map structure makes duplicate keys
  structurally impossible within a single collection.

## Alternatives Considered

### Mantle-nested (`target.experience.*`)

**Rejected because:** the `target` wrapper was designed by Mantle as a
discriminated-union seam for future non-experience target types
(`target.plugin`, `target.model`) that were never shipped. Bedrock's v0.1
scope is experience-only, so the wrapper would add two levels of
accessor depth without earning that cost. If non-experience target types
are added later, the seam can be reintroduced with a codemod during the
0.x series.

### Terraform-style typed blocks (singular keys, `game_pass`)

**Rejected because:** the singular-noun convention surprises Roblox
developers. Every widely-used Roblox tool (Wally, Rokit, Mantle) uses
plural keyed-map collections.

### Resource-array (Kubernetes manifest style)

**Rejected because:** arrays of self-describing entries are verbose in
YAML and foreign to Roblox's "label is identity" convention. The
composition advantages for TypeScript users are covered by c12's `defu`
merging and function-form `defineConfig`.

### Relational, reference-graph, or entity-component shapes

**Rejected because:** references are opaque in YAML for the
Luau-population audience, and entity-component structure imports
game-engine vocabulary without solving a problem Bedrock has.

### TypeScript types only (no runtime validator)

**Rejected because:** YAML and JSON authors have no compile-time
protection. Without runtime validation, typos surface as deep errors in
`buildDesired` or deploy-time failures.

### Zod or Valibot as the validator

**Not rejected on quality.** arktype was chosen to align with the
maintainer's existing package preferences. Standard Schema compliance
keeps the choice reversible with a codemod if the preference changes.

### Frozen or `Readonly<Config>` return from `loadConfig`

**Rejected because:** the programmatic mutation flow is the headline use
case; freezing forces users into `structuredClone` or type-level casts
for every mutation. c12's own internals assume mutable config objects,
so freezing our return would risk incompatibility with c12 utilities.

## Implementation Notes

- The `Config` type is inferred from the arktype schema; there is no
  separately-maintained TypeScript interface to drift out of sync.
- Each resource-kind schema (for `places`, `passes`, etc.) is defined in
  the issue that implements that kind, and composed into the root schema
  at the package boundary.
- `ConfigError` is a discriminated union per ADR-009, with distinct cases
  for file resolution, parsing, and validation failures.
- The `bedrock migrate` command (tracked in #104) performs the Mantle
  transform described above.

## Related Decisions

- ADR-017 — Product Framing: establishes the programmatic-primary,
  CLI-convenience model and the peer-audience constraint.
- ADR-018 — FCIS Ports: config loading is a driven-port concern; the
  loader lives at the shell boundary.
- ADR-019 — State Data Model: desired-state shape that `buildDesired`
  produces from the config declared here.
- ADR-009 — Result Types Over Exceptions: `loadConfig` returns a `Result`.

## References

- [c12](https://github.com/unjs/c12) — configuration loader
- [arktype](https://arktype.io) — runtime schema validator
- [Standard Schema](https://github.com/standard-schema/standard-schema) — cross-library validator spec
- Issue #95 — project config definition (this ADR)
- Issues #104, #110, #122, #123 — adjacent work tracked separately
