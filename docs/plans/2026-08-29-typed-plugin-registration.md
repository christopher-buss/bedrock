# Typed Plugin Registration Implementation Plan

**Goal:** Let a TypeScript config register a plugin by importing it, and have
the `state` block type itself from what that plugin declares.

```ts
import { defineConfig } from "@bedrock-rbx/core/config";
import { bedrockS3Plugin } from "@bedrock-rbx/state-s3";

export default defineConfig({
	environments: { production: {} },
	plugins: [bedrockS3Plugin],
	state: { backend: "s3", bucket: "my-bucket", region: "eu-west-2" },
});
```

`bucket`, `region`, `prefix`, and every other key `s3StateSchema` declares
complete in the editor; a misspelled key, a missing required key, and a
`backend` no listed plugin claims are all compile errors.

**Tracking:** none yet.

**Delivery:** one PR titled
`feat(core): accept plugin objects in the config plugins list`. Commit
granularity emerges from RED+GREEN per behaviour slice.

---

## Context

ADR-030 registers a plugin by module specifier, which is the only form a YAML,
JSON, or Luau config can express. A TypeScript config pays for that generality:
`state` resolves to `PluginStateConfig`, whose index signature accepts every
key, so the editor offers nothing and a typo survives until `bedrock deploy`
reads the config back and validates it against the plugin's own arktype
fragment.

The information to do better is already present. `s3StateSchema` is typed
`type.Any<S3StateConfig>`, so the shape a **Backend** accepts is a real
TypeScript type sitting one property away from the declaration that claims the
backend name. What loses it is erasure at three points: `plugins` is
`ReadonlyArray<string>`, `StateBackendDeclaration.name` is `string` rather than
the literal a declaration claims, and `defineConfig` is an identity generic that
relates nothing to nothing.

The object form recovers all three. A TypeScript config already imports and
executes arbitrary code at load, so passing the plugin value rather than its
name widens nothing about what runs; it only lets the type system watch.

## Decisions

| #   | Decision                                                                                                                                                             | Rationale                                                                                                                                                                                                                                                                                   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `plugins` accepts a plugin object or a module specifier, mixed freely in one list.                                                                                   | A specifier is the only form the non-TypeScript config formats can express, so it stays. The object form is what a TypeScript config gets in exchange for being TypeScript.                                                                                                                 |
| 2   | With every entry an object, `state` closes to gist plus exactly the backends those plugins declare. With `plugins` absent, it closes to gist alone.                  | A closed union is what makes a typo an error rather than an accepted key. A config naming no plugins can only reach a builtin, so gist is the whole set.                                                                                                                                    |
| 3   | A specifier anywhere in the list re-opens `state` to `PluginStateConfig`.                                                                                            | Core cannot see through a string to what the module declares. Reporting the keys it cannot check as errors would make the string form unusable in a TypeScript config that has a reason to use it.                                                                                          |
| 4   | `BedrockPlugin.name` becomes required.                                                                                                                               | Every diagnostic that names a plugin is written against the specifier the config listed. An object arrives with no specifier, and a conflict error that names one claimant and shrugs at the other is worse than the conflict.                                                              |
| 5   | Diagnostics name the specifier when the config wrote one, and `plugin.name` otherwise.                                                                               | The specifier is the text the user can go and edit. For an object entry there is no such text, and the plugin's own name is what the import statement above it says.                                                                                                                        |
| 6   | The loader normalizes `plugins` to a list of strings before validating, so the validated `Config` keeps `plugins?: ReadonlyArray<string>` and `state?: StateConfig`. | `serializeConfig` renders a `Config` as an object literal. A plugin object reaching it would emit arktype internals and `createPort` bodies into a generated `bedrock.config.ts`. Normalizing also leaves the root arktype schema and every downstream consumer of `Config` untouched.      |
| 7   | The plugin-aware types live on `defineConfig`'s input, never on `Config`.                                                                                            | `Config` is what the loader returns and what the whole pipeline reads; the plugin tuple is knowable only where the config is authored. Genericizing `Config` would push a type parameter through `EnvironmentEntry`, `ResolvedConfig`, and both arms of the universeId union to no benefit. |
| 8   | `defineConfig` becomes three overloads: async function, sync function, then object literal last.                                                                     | Overload order decides which failure TypeScript reports. With the object form last, a bad key in the common form is attributed to that key under tsgo. The function forms attribute to the call, which is the cost of accepting a callback at all.                                          |
| 9   | `StateBackendDeclaration` gains a second type parameter for its backend name, defaulted to `string`.                                                                 | The `state` union is keyed on `backend`, so the name has to survive as a literal. Defaulting it keeps every existing single-argument use compiling unchanged.                                                                                                                               |
| 10  | Negative cases are asserted against the authored `state` type, not by putting `@ts-expect-error` on a `defineConfig` call.                                           | tsgo and tsc disagree on where an overload failure is reported: tsgo names the offending property, tsc names the call. Both check this repo, so no single directive placement satisfies them. Asserting the type states the same contract and holds under either.                           |

## Shapes

Type-checked end to end against tsgo before this plan was written; all eleven
call-site cases behave as described.

```ts
// core/plugin.ts
export interface StateBackendDeclaration<
	TState extends object = object,
	TName extends string = string,
> {
	readonly name: TName;
	// ...unchanged
}

export interface BedrockPlugin<
	TBackends extends ReadonlyArray<DeclarationLike> =
		ReadonlyArray<DeclarationLike>,
> {
	/** How diagnostics name this plugin when the config listed no specifier. */
	readonly name: string;
	readonly stateBackends?: TBackends;
}

/**
 * Structural bound loose enough to admit a declaration over any state shape.
 */
interface DeclarationLike {
	readonly name: string;
}
```

The derivation, and the authoring shape it feeds:

```ts
type PluginEntry = BedrockPlugin | string;

type StateOfDeclaration<D> =
	D extends StateBackendDeclaration<infer S, infer N>
		? S & { readonly backend: N; readonly locking?: boolean }
		: never;

type StateOfPlugin<P> = P extends { readonly stateBackends?: infer B }
	? B extends ReadonlyArray<unknown>
		? StateOfDeclaration<B[number]>
		: never
	: never;

type StateFor<TPlugins extends ReadonlyArray<PluginEntry>> =
	| ([Extract<TPlugins[number], string>] extends [never]
			? never
			: PluginStateConfig)
	| GistStateConfig
	| StateOfPlugin<TPlugins[number]>;
```

`AuthoredConfig<TPlugins>` is `Config` with `plugins` narrowed to `TPlugins` and
every `state` position (root and per environment) narrowed to
`StateFor<TPlugins>`. The `const` type parameter is what keeps the array literal
a tuple, so a declaration's `name` reaches `StateOfDeclaration` as `"s3"` rather
than `string`.

`isolatedDeclarations` decides how a plugin is exported: `as const satisfies`
fails with TS9010/TS9013, so the annotation carries the tuple.

```ts
// packages/state-s3/src/plugin.ts
export const bedrockS3Plugin: BedrockPlugin<
	readonly [StateBackendDeclaration<S3StateConfig, "s3">]
> = {
	name: "@bedrock-rbx/state-s3",
	stateBackends: [s3StateBackend],
};
```

## Slices

Each slice is RED+GREEN in one commit, with a refactor commit only where one
earns its place.

1. **A declaration carries its backend name as a literal.**
   `StateBackendDeclaration` gains `TName`; `s3StateBackend` is re-annotated so
   `.name` is `"s3"`. Type tests cover both the annotated and the defaulted
   form.
2. **A plugin names itself.** `BedrockPlugin.name` is required, the shape check
   in `load-plugins.ts` rejects a plugin missing it, and the s3 plugin supplies
   one. The rejection reads as an `invalidExport` alongside the existing
   `stateBackends` message, and names an inline plugin by its position in the
   list, which is all there is to point at before a name is read.
3. **`defineConfig` types `state` from an object-plugin tuple.** The three
   overloads and the `StateFor` derivation, proved by `.spec-d.ts` over the
   whole table: keys complete, a typo fails, a missing required key fails, an
   unclaimed `backend` fails, and a per-environment `state` override gets the
   same treatment.
4. **A specifier keeps the open arm, an absent `plugins` closes to gist.** The
   two boundary cases of decision 2 and 3, as type tests.
5. **`loadPluginsAsync` registers an inline plugin object.** An object entry
   skips the importer and goes straight to the declaration check; a string entry
   is unchanged. The registry records `plugin.name` as the label, and a conflict
   between an object and a specifier names both.
6. **The loader normalizes `plugins` before validating.** `loadPluginsAsync`
   returns each plugin's label alongside the registry, and the loader validates
   the config with those labels in place, so `LoadedProject.config.plugins` is
   always a list of strings.
7. **`@bedrock-rbx/state-s3` exports `bedrockS3Plugin`.** The annotated export,
   with an `@example` driving `defineConfig` through the object form so the
   generated example test is the end-to-end proof.
8. **Docs.** A dated amendment to ADR-030 recording the object form and the
   closed union, plus the config docs on the website.

## Verification

`pnpm gen:example-tests`, then lint, build, test, typecheck, and
`pnpm mutate:changed` after the commit. New symbols carry `@since unreleased`,
and the PR records a change intent for the fixed group.

Two existing type tests in `index.spec-d.ts` change with slice 3:
`defineConfig(literal)` no longer returns the literal's own type, and
`parameter(0)` no longer resolves on an overloaded function. Property access on
the result is unaffected, so the `@example` on `defineConfig` stands.

## Out of scope

- Deduplicating repeated plugin entries. Listing one plugin twice is a
  `stateBackendConflict` today and stays one; c12's layering makes that
  reachable through `extends`, and it wants its own decision.
- Emitting the object form from `serializeConfig`. A generated config would need
  an import statement above the literal, which the emitter has no concept of.
- Any type parameter on `Config` itself.
