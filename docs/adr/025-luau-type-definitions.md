# ADR-025: Luau type definitions for bedrock.config.luau

**Date:** 2026-05-19 **Status:** Accepted

Decision Makers: Maintainer
Tags: luau, types, config, distribution, testing, lute, public-api

## Context

Bedrock supports five config formats via c12: TypeScript, JavaScript, YAML, JSON, and Luau. ADR-020 defines the shared `Config` shape and the `defineConfig` helper that the TypeScript surface exposes through `@bedrock-rbx/core/config`. A TypeScript author writes `import { defineConfig, type Config } from "@bedrock-rbx/core/config"` and gets IDE autocomplete, type errors on misspelled fields, structural validation at edit time, and the strict universeId XOR enforced as a discriminated union with branded-error messages that point at the offending field. A Luau author writes a bare table literal and gets none of that. Arktype validates either author's config at load time so deploy-time errors are structured, but the gap between edit-time experience and deploy-time experience is meaningful, and doubly so for agents authoring configs on behalf of users.

ADR-017 names Luau-population developers as a peer audience to TypeScript developers, not a fallback. The expected Luau author runs the bundled bedrock CLI standalone (via `mise` or `rokit`) rather than installing the npm package; their editor reaches type definitions through `.luaurc` aliases, not `node_modules`. So shipping Luau types is not a matter of adding a `.d.luau` to the npm package and trusting resolution to handle the rest. Distribution is a first-class concern.

Three constraints shape the design space:

- **Luau new-solver limitations.** Luau's new type-solver does not narrow object unions from literals ([luau-lang/luau#2205](https://github.com/luau-lang/luau/issues/2205)). Annotating a literal against `ConfigRootUniverseId | ConfigEnvironmentUniverseId` produces a multi-bullet fan-out enumerating per-component mismatches across both variants, including against valid configs. Wrapper functions over the literal hit related problems: generic identity wrappers force exact-match comparisons that flag valid configs as invalid, overload-intersection signatures collapse to "no overloads compatible" without surfacing variant-specific directives, and unchecked `::` casts silently accept XOR violations. These behaviors were verified across a dozen spike fixtures before this decision.

- **API symmetry across the two languages.** The TypeScript public API is `defineConfig({...})` over a discriminated `Config` union; users do not annotate manually because TypeScript narrows on the literal. Diverging the Luau API (introducing per-variant factory functions, requiring a variant annotation on the receiving variable, or adding a discriminator field to the schema) breaks the symmetry that motivates having `defineConfig` at all.

- **Hand-author duality already in the codebase.** ADR-020 paired the TypeScript `Config` interface with a hand-written arktype validator; maintainers update both surfaces per schema change today. Adding a Luau surface as a third hand-author is an increment, not a redesign.

The decision space narrowed to: encode the full TypeScript shape including the XOR variants and accept a degraded Luau diagnostic experience; add a discriminator field to the schema as a workaround for the Luau limitation; or ship a permissive Luau shape that defers XOR enforcement to the existing arktype runtime narrow. This ADR records the third path.

## Decision

### Schema scope

The Luau `Config` type mirrors the TypeScript `Config` structurally with one departure: it is a single permissive shape rather than a discriminated XOR union. Every field optional in TypeScript is also optional in Luau. The root `universe.universeId` and every per-environment `environments[*].universe.universeId` are typed `string?`. No singleton-string directive types. No brand-intersection encoding.

Arktype's existing runtime narrow at `loadConfig` time enforces the XOR rule and produces directive messages identical to the TypeScript branded-error placeholders. A Luau author who declares `universeId` at both the root and a per-environment overlay sees the directive at deploy time rather than edit time. The trade-off is bounded: arktype already attributes the failure to the offending field path; only the surfacing moment moves from editor to CLI invocation.

The permissive type is a structural supertype of the discriminated TypeScript variants. When luau-lang/luau#2205 closes (or another narrowing mechanism lands), the Luau type can be refined into the discriminated union without breaking existing user configs.

### `defineConfig` signature (Luau)

The Luau module exports `defineConfig` as an identity-typed function:

```luau
local function defineConfig(c: Config): Config
    return c
end
```

The parameter is a concrete `Config` (the permissive shape from above), not a union or a generic. Runtime is identity. The signature mirrors the TypeScript shape `defineConfig<T extends Config>(c: T): T` modulo the Luau type-system's inability to express the generic-identity bound without forcing exact-match comparisons on the literal.

Function name and call shape are identical across languages. The TypeScript user writes `defineConfig({...})`; the Luau user writes `defineConfig({...})`. No API divergence.

### Distribution: `bedrock setup`

A new CLI command, `bedrock setup`, materializes the Luau source bundled inside the bedrock binary into `.bedrock/config.luau` in the user's repository and merges an `@bedrock` alias into the user's `.luaurc`. The alias points at the `.bedrock/` directory; users `require("@bedrock/config")` to import the module. The alias subpath structure (`@bedrock/config`) mirrors the TypeScript export path (`@bedrock-rbx/core/config`).

The same setup flow materializes additional `.bedrock/` files in future slices (e.g. `@bedrock/testing` for the type-spec primitives). The `@bedrock` alias is intentionally a directory alias, not a file alias, so future module additions slot in without another `.luaurc` change or a re-run requirement on the user.

`bedrock setup` is the single mutating command for these files; every other `bedrock` subcommand is read-only with respect to `.bedrock/` and `.luaurc`. Three flags control its behavior:

- `--alias <name>` overrides the default `bedrock` alias name when a user already has an `@bedrock` alias pointing elsewhere.
- `--types-path <path>` overrides the default `.bedrock/config.luau` location.
- `--check` runs the staleness check (described below) explicitly without performing any writes.

The chosen alias is persisted in setup state so subsequent runs without `--alias` honor it.

Distribution works the same way for users on the npm install path and users on the bun-compiled standalone binary. The Luau source files live at `packages/bedrock/src/luau/` in the source tree, ship to `dist/luau/` for npm consumers, and are embedded into the binary via Bun's asset embedding mechanism for standalone consumers. `bedrock setup` reads from the appropriate location at runtime.

### Auto-check semantics

Every `bedrock` subcommand other than `setup` calls a content-hash comparison against `.bedrock/config.luau` before its main logic. On mismatch (the on-disk file does not match the version embedded in the running binary), the command prints a stderr warning naming the file and instructing `bedrock setup` as the fix. Execution continues regardless. Missing on-disk content produces no warning, since a user who has not run setup is not in a staleness condition.

The check never blocks execution and never mutates files. Auto-fix was rejected: `.bedrock/config.luau` lives in the user's working tree and is likely checked into version control, where surprising mutations to a file the user may be inspecting in their editor are hostile.

Two opt-outs:

- `BEDROCK_SKIP_TYPES_CHECK=1` environment variable suppresses the check entirely for a single process invocation. Intended for CI environments that prefer to suppress noise.
- `bedrock setup --check` runs the same check explicitly; exit code 0 if fresh, non-zero if stale. Suitable for pre-commit hooks or CI gates that want to fail loudly rather than warn quietly.

### Testing pattern

Type-spec tests live in `packages/bedrock/tests/luau-types/`. Each fixture is a `.spec.luau` file using a `describe`/`it` block structure that mirrors `.spec-d.ts` files on the TypeScript side. The fixture uses three primitives:

| Primitive | Role | TypeScript analog |
|---|---|---|
| `describe(...)` / `it(...)` runtime stubs | Make test boundaries discoverable to the AST walker | Same |
| `-- @expect-error` directive | Assert that the following line produces a `lute check` diagnostic | `// @ts-expect-error` |
| `Expect<A, B>` type-level alias | Assert that two types are structurally equal | `expectTypeOf<A>().toEqualTypeOf<B>()` |

`describe` and `it` are exported as runtime no-op functions from a new `@bedrock/testing` Luau module that `bedrock setup` materializes alongside `@bedrock/config`. Their sole purpose is to be findable by the AST walker. `Expect<A, B>` is a hand-rolled type function in the same module that errors when the two types are not structurally equal.

The Vitest harness orchestrates the pipeline: glob fixtures, run `lute transform` against a parser script to extract describe/it line ranges, run `lute check` and parse diagnostics, cross-reference diagnostics with `@expect-error` directives and test ranges, produce per-fixture pass/fail. A directive without a following diagnostic is an unused-directive failure; a diagnostic on a line without a preceding directive is an unexpected-error failure. The harness asserts diagnostic presence; message text is intentionally not asserted because wording over-binds to specific Luau toolchain versions.

The harness module structure (`parse-tests.luau`, `parse-diagnostics.ts`, `parse-directives.ts`, `runner.ts`) mirrors `jest-roblox-cli/src/typecheck/` so the prototype lifts to that project as a Luau-spec subcommand when ready.

A vitest-style fluent `expectTypeOf(value).toEqualTypeOf(other)` API is not part of the day-1 surface. The same Luau new-solver limitation that drives the schema-scope decision suppresses type-function errors inside generic function bodies, so the fluent shape silently passes every test regardless of type mismatch. The type-level `Expect<A, B>` is the day-1 form; a fluent value-level API can layer on top when the underlying limitation is resolved.

### Parity enforcement

Drift between the TypeScript and Luau schemas is enforced by code review, not by an automated structural diff. The project `/review` skill is extended to flag any change to `packages/bedrock/src/core/schema.ts` that lacks a parallel change to `packages/bedrock/src/luau/config.luau`, and vice versa. The check excludes the deferred-XOR delta from "drift" (the TypeScript schema has discriminated variants with branded-error properties; the Luau schema does not, intentionally, per this ADR).

The type-spec fixture suite is the safety net for the most common drift classes: a field added to a TypeScript entry type without the matching Luau addition surfaces as a missing-field diagnostic when a fixture exercises the new field.

## Consequences

### Positive

- Luau authors and agent-authored configs get editor-time type safety on misspelled fields, wrong-typed values, and unknown resource kinds, closing the parity gap with TypeScript authors.
- `defineConfig` has the same name and call shape across both languages, preserving the symmetric API surface that ADR-017's peer-audience framing demands.
- `bedrock setup` is the only mutating command for the Luau type files; combined with the warn-only auto-check, users keep full control of their working tree.
- The type-spec testing pattern (`describe`/`it` + `@expect-error` + `Expect<A, B>`) enables TDD on Luau type changes. The harness module structure is lift-ready into jest-roblox-cli for future reuse.
- The permissive Luau `Config` is a structural supertype of the discriminated TypeScript variants, so refining the Luau type later when luau-lang/luau#2205 closes does not break user configs written against the permissive shape.
- The `@bedrock` alias is a directory alias, leaving room for future Luau-side modules (`@bedrock/runtime`, generated constants, etc.) without another `.luaurc` change.

### Negative

- The XOR rule between root and per-environment `universeId` is not enforced at edit time on the Luau side. Luau authors see the failure at deploy via arktype rather than in the editor.
- Hand-author duality grows from two surfaces (TypeScript interface + arktype validator) to three (add Luau type), increasing maintenance per schema change. The `/review` skill becomes load-bearing for parity enforcement.
- Luau users must run `bedrock setup` once before their editor picks up the types, adding a step to onboarding.
- Lute is a hard dependency for both the type-spec test harness and the binary embedding mechanism. Toolchain pinning via `mise.toml` is now consequential.
- The type-spec test harness is bedrock-internal infrastructure until jest-roblox-cli adopts it. The `-- @expect-error` directive convention is locally invented and not portable to other Luau testing frameworks.
- The deferred-XOR creates an intentional asymmetry between the TypeScript discriminated variants and the Luau permissive shape. Future maintainers must respect that the asymmetry is intentional rather than treat it as drift.

## Alternatives Considered

### Discriminated XOR variants in the Luau `Config` type

**Rejected because:** Luau's new type-solver does not narrow object unions from literals. Annotating a literal against `ConfigRootUniverseId | ConfigEnvironmentUniverseId` produces a multi-bullet fan-out enumerating per-component mismatches across both variants. Verified during spike work, where both valid root-only and valid env-only configs produced 9-12 bullet diagnostics. "Verbose-but-shipped" is not a viable middle ground because the verbosity fires on correct configs, not just XOR violations.

### Top-level discriminator field on the schema (`mode: "root" | "env"`)

**Rejected because:** this works at the type-checker level, with a non-generic `defineConfig(c: Config): Config` producing clean variant-pinned diagnostics in both directions. But the discriminator is a schema field added purely to work around a transient Luau type-solver limitation. Adding it locks every user config into carrying a redundant field that arktype would derive on its own from `universeId` placement. Removing it later once Luau ships union narrowing is a wire-contract change.

### API divergence alternatives: two factory functions per variant, or no `defineConfig` at all

**Rejected because:** both shapes produce clean variant-pinned diagnostics. Two factories (`defineConfigWithRootUniverse` / `defineConfigWithEnvironmentUniverses`) work because each parameter is a single non-union variant; dropping `defineConfig` and requiring `local config: ConfigRootUniverseId = {...}` works because the annotation pins the variant. Both diverge from the TypeScript API in user-visible ways: the first adds two named functions where TypeScript has one, the second removes the function entirely. ADR-017 names API symmetry across the two audiences as a property worth preserving, not a coincidence to be sacrificed.

### Wrapper-function encodings of `defineConfig` (identity generic, overload intersection, unchecked cast)

**Rejected because:** every wrapper that influences types degrades the diagnostic. A generic identity wrapper (`defineConfig<T>(c: T): T`) infers `T` from the literal and forces exact-match comparisons that flag valid configs as invalid. An overload-intersection signature collapses to "None of the overloads for function that accept 1 arguments are compatible" without surfacing the variant-specific directive. An unchecked `::` cast silently accepts XOR violations entirely. The only wrapper-free path that preserves the clean diagnostic is direct variant annotation, which the previous alternative addresses.

### Generate Luau types from the TypeScript schema

**Rejected because:** the TypeScript schema is already hand-paired with an arktype runtime validator per ADR-020; maintainers update both surfaces per schema change. Adding a Luau surface as a third hand-author is incremental. A generator would need per-construct rules for TypeScript features Luau cannot express (branded errors, key-pattern indexers, the XOR discriminated union itself), which is substantial machinery for the same outcome a `/review` skill update achieves.

### Vitest-style fluent `expectTypeOf().toEqualTypeOf()` for type assertions

**Rejected because:** the same Luau new-solver limitation that drives the schema-scope decision suppresses type-function errors inside generic function bodies. A wrapper like `expectTypeOf<T>(_: T): { toEqualTypeOf: <U>(_: U) -> () }` looks correct syntactically but silently passes every test regardless of type mismatch. The type-level `Expect<A, B>` form works correctly; a fluent value-level API can layer on top when the underlying limitation is resolved.

### Automated TypeScript-to-Luau structural diff for parity enforcement

**Rejected because:** the deferred-XOR delta is an intentional asymmetry between the two schemas. A structural diff would need a hand-maintained allow-list of intentional differences that grows every time the asymmetry expands. The `/review` skill is a higher-leverage place to capture the parity expectation because the skill already encodes domain context that an automated diff cannot.

### Auto-fix stale on-disk types on every `bedrock` command

**Rejected because:** `.bedrock/config.luau` lives in the user's working tree and is likely checked into version control. A `bedrock deploy` invocation that silently rewrites a file the user may be inspecting in their editor, or that turns up as an unexpected diff at commit time, is hostile. `bedrock setup` being the single mutating command is the predictable mental model; the auto-check warns the user so they choose when to run setup.

## Implementation Notes

- The Luau source files live at `packages/bedrock/src/luau/config.luau` and `packages/bedrock/src/luau/testing.luau`. Per-resource entry types compose into the root `Config` type in the same file.
- The `bedrock setup` command is implemented as `packages/bedrock/src/cli/commands/setup.ts` wrapping a shell function. The `.luaurc` parse/merge logic is a pure function in `src/core/luaurc.ts`; I/O orchestration lives in the shell layer.
- The staleness check uses a content hash of the bundled and on-disk Luau sources. Any byte difference counts as stale.
- Bun's asset embedding mechanism carries the Luau source files into the compiled binary. For npm consumers, the same files ship under `dist/luau/` via `vp pack`.
- The type-spec harness lives at `packages/bedrock/tests/luau-types/`. Module structure mirrors `jest-roblox-cli/src/typecheck/` so the prototype lifts to that project as a Luau-spec subcommand.
- Lute is the analyzer: `lute check` produces structured diagnostics; `lute transform` walks the AST. Pinned via `mise.toml`.
- Implementation is tracked via PRD [#441](https://github.com/christopher-buss/bedrock/issues/441), broken into six AFK-ready slices.

## Related Decisions

- ADR-003 — Testing Strategy: TDD and 100% coverage apply to the new modules; the type-spec harness extends the testing surface to Luau.
- ADR-009 — Result Types Over Exceptions: `setupLuauTypes` and `checkLuauTypesStale` shell functions return `Result`.
- ADR-017 — Product Framing: peer-audience principle that motivates same-named APIs across TypeScript and Luau.
- ADR-018 — FCIS Ports: pure `.luaurc` logic lives in core; setup orchestration lives in shell; the CLI command is a primary adapter.
- ADR-020 — Project Config Definition: the TypeScript-side `Config` and `defineConfig` that this ADR mirrors for Luau.

## References

- [Lute](https://github.com/luau-lang/lute) — Luau runtime used as the type-checker (`lute check`) and AST walker (`lute transform`).
- [luau-lang/luau#2205](https://github.com/luau-lang/luau/issues/2205) — upstream Luau issue tracking object-union narrowing from literals; defines the forward-compatibility path.
- [typeforge](https://github.com/typeforge-luau/typeforge) — reference implementation of Luau type functions; the `Expect<A, B>` pattern is hand-rolled in the same style.
- [jest-roblox-cli](https://github.com/christopher-buss/jest-roblox-cli) — lift target for the type-spec harness; module structure here intentionally mirrors `src/typecheck/`.
- PRD [#441](https://github.com/christopher-buss/bedrock/issues/441) — implementation specification.
- Issue [#315](https://github.com/christopher-buss/bedrock/issues/315) — predecessor issue raising the question.
- [docs/spikes/luau-types/](../spikes/luau-types/) — feasibility evidence with 11 numbered sections covering every encoding pattern explored.
