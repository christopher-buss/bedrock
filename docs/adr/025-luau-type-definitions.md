# ADR-025: Luau type definitions for bedrock.config.luau

**Date:** 2026-05-19 **Status:** Accepted

Decision Makers: Maintainer Tags: luau, types, config, distribution, testing,
lute, public-api

## Context

Bedrock supports five config formats via c12: TypeScript, JavaScript, YAML,
JSON, and Luau. ADR-020 defines the shared `Config` shape and the `defineConfig`
helper that the TypeScript surface exposes through `@bedrock-rbx/core/config`. A
TypeScript author writes
`import { defineConfig, type Config } from "@bedrock-rbx/core/config"` and gets
IDE autocomplete, type errors on misspelled fields, structural validation at
edit time, and the strict universeId XOR enforced as a discriminated union with
branded-error messages that point at the offending field. A Luau author writes a
bare table literal and gets none of that. Arktype validates either author's
config at load time so deploy-time errors are structured, but the gap between
edit-time experience and deploy-time experience is meaningful, and doubly so for
agents authoring configs on behalf of users.

ADR-017 names Luau-population developers as a peer audience to TypeScript
developers, not a fallback. The expected Luau author runs the bundled bedrock
CLI standalone (via `mise` or `rokit`) rather than installing the npm package;
their editor reaches type definitions through `.luaurc` aliases, not
`node_modules`. So shipping Luau types is not a matter of adding a `.d.luau` to
the npm package and trusting resolution to handle the rest. Distribution is a
first-class concern.

Three constraints shape the design space:

- **Luau new-solver limitations.** Luau's new type-solver does not narrow object
  unions from literals
  ([luau-lang/luau#2205](https://github.com/luau-lang/luau/issues/2205)).
  Annotating a literal against
  `ConfigRootUniverseId | ConfigEnvironmentUniverseId` produces a multi-bullet
  fan-out enumerating per-component mismatches across both variants, including
  against valid configs. Wrapper functions over the literal hit related
  problems: generic identity wrappers force exact-match comparisons that flag
  valid configs as invalid, overload-intersection signatures collapse to "no
  overloads compatible" without surfacing variant-specific directives, and
  unchecked `::` casts silently accept XOR violations. These behaviors were
  verified across a dozen spike fixtures before this decision.

- **API symmetry across the two languages.** The TypeScript public API is
  `defineConfig({...})` over a discriminated `Config` union; users do not
  annotate manually because TypeScript narrows on the literal. Diverging the
  Luau API (introducing per-variant factory functions, requiring a variant
  annotation on the receiving variable, or adding a discriminator field to the
  schema) breaks the symmetry that motivates having `defineConfig` at all.

- **Hand-author duality already in the codebase.** ADR-020 paired the TypeScript
  `Config` interface with a hand-written arktype validator; maintainers update
  both surfaces per schema change today. Adding a Luau surface as a third
  hand-author is an increment, not a redesign.

The decision space narrowed to: encode the full TypeScript shape including the
XOR variants and accept a degraded Luau diagnostic experience; add a
discriminator field to the schema as a workaround for the Luau limitation; or
ship a permissive Luau shape that defers XOR enforcement to the existing arktype
runtime narrow. This ADR records the third path.

## Decision

### Schema scope

The Luau `Config` type mirrors the TypeScript `Config` structurally with one
departure: it is a single permissive shape rather than a discriminated XOR
union. Every field optional in TypeScript is also optional in Luau. The root
`universe.universeId` and every per-environment
`environments[*].universe.universeId` are typed `string?`. No singleton-string
directive types. No brand-intersection encoding.

Arktype's existing runtime narrow at `loadConfig` time enforces the XOR rule and
produces directive messages identical to the TypeScript branded-error
placeholders. A Luau author who declares `universeId` at both the root and a
per-environment overlay sees the directive at deploy time rather than edit time.
The trade-off is bounded: arktype already attributes the failure to the
offending field path; only the surfacing moment moves from editor to CLI
invocation.

The permissive type is a structural supertype of the discriminated TypeScript
variants. When luau-lang/luau#2205 closes (or another narrowing mechanism
lands), the Luau type can be refined into the discriminated union without
breaking existing user configs.

### `defineConfig` signature (Luau)

The Luau module exports `defineConfig` as an identity-typed function:

```luau
local function defineConfig(c: Config): Config
    return c
end
```

The parameter is a concrete `Config` (the permissive shape from above), not a
union or a generic. Runtime is identity. The signature mirrors the TypeScript
shape `defineConfig<T extends Config>(c: T): T` modulo the Luau type-system's
inability to express the generic-identity bound without forcing exact-match
comparisons on the literal.

Function name and call shape are identical across languages. The TypeScript user
writes `defineConfig({...})`; the Luau user writes `defineConfig({...})`. No API
divergence.

### Distribution: `bedrock setup`

A new CLI command, `bedrock setup`, materializes the Luau source bundled inside
the bedrock binary into `.bedrock/config.luau` in the user's repository and
merges an `@bedrock` alias into the user's `.luaurc`. The alias points at the
`.bedrock/` directory; users `require("@bedrock/config")` to import the module.
The alias subpath structure (`@bedrock/config`) mirrors the TypeScript export
path (`@bedrock-rbx/core/config`).

The `@bedrock` alias points at a directory, leaving room for future modules
without changing the alias. Type-test assertions come from jest-roblox-cli;
`bedrock setup` distributes only the config module.

`bedrock setup` is the single mutating command for these files; every other
`bedrock` subcommand is read-only with respect to `.bedrock/` and `.luaurc`.
Three flags control its behavior:

- `--alias <name>` overrides the default alias name when a user already has an
  `@bedrock` alias pointing elsewhere.
- `--types-path <path>` overrides the default `.bedrock/config.luau` location.
- `--check` runs the staleness check (described below) explicitly without
  performing any writes.

The chosen alias is persisted in setup state so subsequent runs without
`--alias` honor it.

Distribution works the same way for users on the npm install path and users on
the bun-compiled standalone binary. The Luau source files live at
`packages/bedrock/src/luau/` in the source tree, ship to `dist/luau/` for npm
consumers, and are embedded into the binary via Bun's asset embedding mechanism
for standalone consumers. `bedrock setup` reads from the appropriate location at
runtime.

### Auto-check semantics

Every `bedrock` subcommand other than `setup` calls a content-hash comparison
against `.bedrock/config.luau` before its main logic. On mismatch (the on-disk
file does not match the version embedded in the running binary), the command
prints a stderr warning naming the file and instructing `bedrock setup` as the
fix. Execution continues regardless. Missing on-disk content produces no
warning, since a user who has not run setup is not in a staleness condition.

The check never blocks execution and never mutates files. Auto-fix was rejected:
`.bedrock/config.luau` lives in the user's working tree and is likely checked
into version control, where surprising mutations to a file the user may be
inspecting in their editor are hostile.

Two opt-outs:

- `BEDROCK_SKIP_TYPES_CHECK=1` environment variable suppresses the check
  entirely for a single process invocation. Intended for CI environments that
  prefer to suppress noise.
- `bedrock setup --check` runs the same check explicitly; exit code 0 if fresh,
  non-zero if stale. Suitable for pre-commit hooks or CI gates that want to fail
  loudly rather than warn quietly.

### Testing pattern

Type-spec tests live in `packages/bedrock/tests/luau-types/` as `*.spec-d.luau`
files, mirroring `.spec-d.ts` on the TypeScript side. They run through
jest-roblox-cli's Luau Type Tests. The package's `test:luau-types` script
invokes `jest-roblox --typecheckOnly`, and CI runs that command. It checks types
on the host without building a place or calling Roblox. Lute is pinned in
`mise.toml` to the nightly needed for readable type assertion diagnostics.

Every spec starts with `--!strict`. The package `.luaurc` maps `bedrock` to
`src/luau` and `jest` to `.jest-roblox/lib`. The `pretest:luau-types` script
copies the installed `@isentinel/jest-roblox/lib` into that ignored directory
because Lute cannot traverse pnpm's package symlinks on Linux. Specs import
`@bedrock/config` and the assertion library at `@jest/typecheck`.

`t.describe` and `t.it` name the tests. `t.expectType<<T>>()` and
`t.expectTypeOf(value)` select a type; `:toEqualType<<U>>()` and
`:toEqualTypeOf(value)` compare types structurally. `.never` negates equality,
and `:toExtend<<U>>()` checks Luau assignability. Failed equality assertions
print readable `Expected:` and `Received:` types.

A `-- @expect-error` directive asserts that the next statement in the same block
produces a type error. It covers the statement's whole span, including fields
inside a multiline literal, and checks diagnostic presence rather than wording.
A directive with no matching diagnostic fails its test. Negative config specs
use wrong-typed values; Luau does not perform excess-property checks on
misspelled optional fields.

Bedrock uses the runner and assertion library supplied by jest-roblox-cli. It
adds no diagnostic parser, directive parser, AST walker, or test runner.

### Parity enforcement

Drift between the TypeScript and Luau schemas is enforced by code review, not by
an automated structural diff. The project `/review` skill is extended to flag
any change to `packages/bedrock/src/core/schema.ts` that lacks a parallel change
to `packages/bedrock/src/luau/config.luau`, and vice versa. The check excludes
the deferred-XOR delta from "drift" (the TypeScript schema has discriminated
variants with branded-error properties; the Luau schema does not, intentionally,
per this ADR).

The type-spec fixture suite is the safety net for the most common drift classes:
a field added to a TypeScript entry type without the matching Luau addition
surfaces as a missing-field diagnostic when a fixture exercises the new field.

## Consequences

### Positive

- Luau authors and agent-authored configs get editor-time type safety on
  misspelled fields, wrong-typed values, and unknown resource kinds, closing the
  parity gap with TypeScript authors.
- `defineConfig` has the same name and call shape across both languages,
  preserving the symmetric API surface that ADR-017's peer-audience framing
  demands.
- `bedrock setup` is the only mutating command for the Luau type files; combined
  with the warn-only auto-check, users keep full control of their working tree.
- The type-spec testing pattern (`t.describe`/`t.it`, `@expect-error`, and
  fluent type assertions) enables TDD on Luau type changes through
  jest-roblox-cli.
- The permissive Luau `Config` is a structural supertype of the discriminated
  TypeScript variants, so refining the Luau type later when luau-lang/luau#2205
  closes does not break user configs written against the permissive shape.
- The `@bedrock` alias is a directory alias, leaving room for future Luau-side
  modules (`@bedrock/runtime`, generated constants, etc.) without another
  `.luaurc` change.

### Negative

- The XOR rule between root and per-environment `universeId` is not enforced at
  edit time on the Luau side. Luau authors see the failure at deploy via arktype
  rather than in the editor.
- Hand-author duality grows from two surfaces (TypeScript interface + arktype
  validator) to three (add Luau type), increasing maintenance per schema change.
  The `/review` skill becomes load-bearing for parity enforcement.
- Luau users must run `bedrock setup` once before their editor picks up the
  types, adding a step to onboarding.
- Lute is a hard dependency for both the Luau type tests and the binary
  embedding mechanism. Toolchain pinning via `mise.toml` is now consequential.
- The deferred-XOR creates an intentional asymmetry between the TypeScript
  discriminated variants and the Luau permissive shape. Future maintainers must
  respect that the asymmetry is intentional rather than treat it as drift.

## Alternatives Considered

### Discriminated XOR variants in the Luau `Config` type

**Rejected because:** Luau's new type-solver does not narrow object unions from
literals. Annotating a literal against
`ConfigRootUniverseId | ConfigEnvironmentUniverseId` produces a multi-bullet
fan-out enumerating per-component mismatches across both variants. Verified
during spike work, where both valid root-only and valid env-only configs
produced 9-12 bullet diagnostics. "Verbose-but-shipped" is not a viable middle
ground because the verbosity fires on correct configs, not just XOR violations.

### Top-level discriminator field on the schema (`mode: "root" | "env"`)

**Rejected because:** this works at the type-checker level, with a non-generic
`defineConfig(c: Config): Config` producing clean variant-pinned diagnostics in
both directions. But the discriminator is a schema field added purely to work
around a transient Luau type-solver limitation. Adding it locks every user
config into carrying a redundant field that arktype would derive on its own from
`universeId` placement. Removing it later once Luau ships union narrowing is a
wire-contract change.

### API divergence alternatives: two factory functions per variant, or no `defineConfig` at all

**Rejected because:** both shapes produce clean variant-pinned diagnostics. Two
factories (`defineConfigWithRootUniverse` /
`defineConfigWithEnvironmentUniverses`) work because each parameter is a single
non-union variant; dropping `defineConfig` and requiring
`local config: ConfigRootUniverseId = {...}` works because the annotation pins
the variant. Both diverge from the TypeScript API in user-visible ways: the
first adds two named functions where TypeScript has one, the second removes the
function entirely. ADR-017 names API symmetry across the two audiences as a
property worth preserving, not a coincidence to be sacrificed.

### Wrapper-function encodings of `defineConfig` (identity generic, overload intersection, unchecked cast)

**Rejected because:** every wrapper that influences types degrades the
diagnostic. A generic identity wrapper (`defineConfig<T>(c: T): T`) infers `T`
from the literal and forces exact-match comparisons that flag valid configs as
invalid. An overload-intersection signature collapses to "None of the overloads
for function that accept 1 arguments are compatible" without surfacing the
variant-specific directive. An unchecked `::` cast silently accepts XOR
violations entirely. The only wrapper-free path that preserves the clean
diagnostic is direct variant annotation, which the previous alternative
addresses.

### Generate Luau types from the TypeScript schema

**Rejected because:** the TypeScript schema is already hand-paired with an
arktype runtime validator per ADR-020; maintainers update both surfaces per
schema change. Adding a Luau surface as a third hand-author is incremental. A
generator would need per-construct rules for TypeScript features Luau cannot
express (branded errors, key-pattern indexers, the XOR discriminated union
itself), which is substantial machinery for the same outcome a `/review` skill
update achieves.

### Automated TypeScript-to-Luau structural diff for parity enforcement

**Rejected because:** the deferred-XOR delta is an intentional asymmetry between
the two schemas. A structural diff would need a hand-maintained allow-list of
intentional differences that grows every time the asymmetry expands. The
`/review` skill is a higher-leverage place to capture the parity expectation
because the skill already encodes domain context that an automated diff cannot.

### Auto-fix stale on-disk types on every `bedrock` command

**Rejected because:** `.bedrock/config.luau` lives in the user's working tree
and is likely checked into version control. A `bedrock deploy` invocation that
silently rewrites a file the user may be inspecting in their editor, or that
turns up as an unexpected diff at commit time, is hostile. `bedrock setup` being
the single mutating command is the predictable mental model; the auto-check
warns the user so they choose when to run setup.

## Implementation Notes

- The Luau config source lives at `packages/bedrock/src/luau/config.luau`.
  Per-resource entry types compose into the root `Config` type in the same file.
- The `bedrock setup` command is implemented as
  `packages/bedrock/src/cli/commands/setup.ts` wrapping a shell function. The
  `.luaurc` parse/merge logic is a pure function in `src/core/luaurc.ts`; I/O
  orchestration lives in the shell layer.
- The staleness check uses a content hash of the bundled and on-disk Luau
  sources. Any byte difference counts as stale.
- Bun's asset embedding mechanism carries the Luau source files into the
  compiled binary. For npm consumers, the same files ship under `dist/luau/` via
  `vp pack`.
- The type specs live at `packages/bedrock/tests/luau-types/` and run through
  jest-roblox-cli. Lute checks them on the host and is pinned via `mise.toml`.
- Implementation is tracked via PRD
  [#441](https://github.com/christopher-buss/bedrock/issues/441), broken into
  six AFK-ready slices.

## Amendment — 2026-10-26: resource coverage and collection checking

The Luau types now mirror every authored resource kind in `schema.ts`: game
passes, developer products, places, and the singleton universe, together with
their environment overlays and redaction overrides. Root collections remain
optional. Place overlays require `placeId`; universe ID placement remains a
load-time check. The type specs also pin root and environment settings against
the TypeScript shapes.

The pinned Lute `1.0.1-nightly.20261021` does not check entries in an inline
optional root map such as `passes: { [string]: GamePassEntry }?`. Both a string
price and an entry missing `name` pass through `defineConfig`. The same occurs
for the root `products` and `places` maps. The tested alternatives did not fix
this while preserving optional collections:

- Naming the map type and using `Map?`, intersecting it with `{}` before making
  it optional, and using `(Map | {})?` still accept invalid entries.
- Making each map value optional, `{ [string]: Entry? }?`, still accepts invalid
  entries.
- A required `{ [string]: Entry? }` map checks entries, but rejects a config
  that omits the collection. Requiring empty maps changes the authored schema
  and is not an acceptable substitute.

Retain the optional-map encoding. No tested replacement preserves the schema and
restores root entry checking. `known-limitations.spec-d.luau` pins the accepted
invalid inline root values. For reliable editor checking, authors can annotate
entries as `GamePassEntry`, `DeveloperProductEntry`, or `PlaceEntry` before
inserting them into a collection; the negative specs exercise those exported
types directly.

Checking depends on context: the same invalid entry inside
`defineConfig({ environments = { production = { passes = ... } } })` is
rejected. The required outer `environments` map checks environment entries,
including their nested resource overlays. The price and missing-place-identity
negative specs exercise this inline environment case rather than claiming that
every optional map has the same behavior.

Luau also accepts unknown root resource kinds and misspelled optional fields.
The passing limitation specs preserve these observations without an
`@expect-error` that would falsely promise rejection. This corrects the earlier
Positive Consequences claim of editor-time checking for misspelled fields and
unknown resource kinds. Arktype rejects unknown keys, misspellings, and invalid
root collection entries when the config loads, and continues to enforce the
deferred universe ID XOR rule.

## Amendment — 2026-10-26: checked authoring types

This amendment supersedes the permissive authoring signature and the earlier
amendment's decision to defer root collection and unknown-key checking. The
maintainer requested equivalent config authoring checks after the TypeForge
investigation demonstrated that type functions can inspect the supplied type.

`defineConfig(value)` validates the original input type, including nested
resource entries, required fields, unknown keys, unions, intersections, real map
indexers, and the TypeScript config union's universe identity rules. Diagnostics
identify the offending config path. The factory returns the same table at
runtime. Optional collections remain optional; no discriminator or required
empty map is added to the wire schema.

The final signature does not add a broad contextual schema. A contextual
prototype accepted the initial literal matrix but could not distinguish its
synthetic indexer from a structurally identical real caller indexer. Skipping
that indexer admitted conflicting universe IDs. The final validator always
checks supplied indexers and requires definite identities. It also preserves
required fields on the returned original type, so assigning `nil` to an
established root identity is an error.

Use typed constants for singleton values in generic factory calls:

```luau
--!strict
local bedrock = require("@bedrock/config")

return bedrock.defineConfig({
    environments = { production = {} },
    state = { backend = bedrock.gistBackend, gistId = "abc" },
    passes = {
        vip = {
            name = "VIP",
            description = "VIP perks",
            icon = { ["en-us"] = "vip.png" },
            price = bedrock.none,
        },
    },
})
```

`None` and `none` represent the existing `"$none"` string. `gistBackend` is the
typed `"gist"` backend tag. Raw literals can widen to `string` in an
unconstrained generic call; the constants preserve the intended singleton.
Concrete constituent annotations can still use their accepted raw literals.
These constants add no new wire values or clearing behavior.

`defineEnvironment(value)` checks a standalone environment's nested entries and
returns that same table. Its state shape remains open like the TypeScript
`EnvironmentEntry`; the containing config applies the authored backend rule. Use
the factories for literal and already-typed values:

```luau
--!strict
local bedrock = require("@bedrock/config")

type Environment = { universe: { universeId: string } }
local environments: { [string]: Environment } = {
    production = { universe = { universeId = "123" } },
}
local value = { environments = environments }
local config: bedrock.Config<typeof(value)> = bedrock.defineConfig(value)

local override = { passes = { vip = { price = bedrock.none } } }
local environment: bedrock.EnvironmentEntry<typeof(override)> =
    bedrock.defineEnvironment(override)

return config
```

`Config<Actual>` and `EnvironmentEntry<Actual>` require the actual type argument
and a factory result. Neither is a raw initializer annotation: even an otherwise
valid table must pass through the corresponding factory. Required private
never-valued proof fields prevent ordinary table literals from forging the
checked result. The proof fields exist only in types. A narrowly scoped internal
result assertion attaches that proof after the public argument guard checks the
original type; no incoming value is cast around validation, and no marker is
added to the runtime table. Healthy field types and mutation checks are pinned
by the public type specs.

This replaces old bare `Config` and `EnvironmentEntry` annotations and receives
a minor bump under the pre-1.0 policy. Individual resource, overlay, locale, and
redaction records reject undeclared keys directly. This is intentionally
stricter than TypeScript width subtyping for pretyped values: a root
`PlaceEntry`, for example, excludes the overlay-only `placeId`. Metadata shape
and required overlay identity assertions remain separate in the specs.

Authored state follows TypeScript's `defineConfig` boundary. With no plugins or
an empty plugin list, root and environment state require the Gist backend and
`gistId`, allow optional boolean `locking`, and reject undeclared keys. String
plugin specifiers open backend names and custom keys while retaining common
field checks. The plugin validates its own keys at load time. The result type's
underlying loaded `StateConfig` remains open like TypeScript `Config`.

Universe authority follows the actual TypeScript union, including its optional
root block. An absent root universe block permits uniformly metadata-only
environment overlays; shared root metadata without an ID instead requires IDs on
present environment universe overlays. A present root ID cannot coexist with an
environment ID. These checks do not replace arktype's load-time checks,
including identity availability and resource-key formats.

Luau `nil` removes a table key, so TypeScript's present-`undefined` distinction
has no identical table representation. Omission retains inherited values;
`bedrock.none` explicitly clears supported fields. JavaScript plugin declaration
objects, config callbacks, and Promise inputs remain TypeScript host APIs,
outside the Luau config-data surface. This is validation parity for supported
config authoring, not identical syntax or assignability across the languages.

The implementation uses local type functions with no TypeForge dependency. The
investigation and rejected encodings are recorded in
[the TypeForge research note](../spikes/luau-types/typeforge-parity-research.md).

## Amendment — 2026-10-26: repository parity review

The
[package's TS/Luau config parity checklist](../../packages/bedrock/CLAUDE.md#tsluau-config-parity-review)
is the authoritative review policy. `/code-review` supplies it to the Standards
reviewer through repository standards discovery. This replaces the original plan
to extend `/review`, which is no longer present.

Parity remains enforced by review with type-spec evidence rather than an
automated structural diff. The checked-authoring amendment above supersedes the
original blanket deferred-XOR exemption: Luau now checks universe identity
relationships. Review distinguishes intentional language/encoding differences
from missing supported fields or validation behaviour.

## Related Decisions

- ADR-003 — Testing Strategy: TDD and 100% coverage apply to the new modules;
  jest-roblox-cli Luau Type Tests extend the testing surface to Luau.
- ADR-009 — Result Types Over Exceptions: `setupLuauTypes` and
  `checkLuauTypesStale` shell functions return `Result`.
- ADR-017 — Product Framing: peer-audience principle that motivates same-named
  APIs across TypeScript and Luau.
- ADR-018 — FCIS Ports: pure `.luaurc` logic lives in core; setup orchestration
  lives in shell; the CLI command is a primary adapter.
- ADR-020 — Project Config Definition: the TypeScript-side `Config` and
  `defineConfig` that this ADR mirrors for Luau.

## References

- [Lute](https://github.com/luau-lang/lute) — Luau runtime used as the
  type-checker (`lute check`) for Luau Type Tests.
- [luau-lang/luau#2205](https://github.com/luau-lang/luau/issues/2205) —
  upstream Luau issue tracking object-union narrowing from literals; defines the
  forward-compatibility path.
- [jest-roblox-cli](https://github.com/christopher-buss/jest-roblox-cli) — host
  runner and assertion library for Luau Type Tests.
- PRD [#441](https://github.com/christopher-buss/bedrock/issues/441) —
  implementation specification.
- Issue [#315](https://github.com/christopher-buss/bedrock/issues/315) —
  predecessor issue raising the question.
- [docs/spikes/luau-types/](../spikes/luau-types/) — feasibility evidence with
  11 numbered sections covering every encoding pattern explored.
