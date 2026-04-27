/**
 * One Mantle resource entry pulled out of `environments.<name>` in a
 * `.mantle-state.yml` file.
 *
 * `kind` and `key` are derived by splitting Mantle's `id` field on the
 * first `_`. `inputs` is the bare payload from `inputs[kind]`; nulls have
 * been recursively normalized to `undefined` per the project type
 * convention. `outputs` is `outputs[kind]` when Mantle emitted a payload
 * map, or `undefined` when Mantle emitted the bare-string discriminator
 * form (`outputs: <kind>`).
 *
 * `inputs` and `outputs` are typed `unknown` so per-kind fold modules
 * narrow to a kind-specific shape with their own runtime checks; the
 * parser is intentionally generic.
 */
export interface MantleResource {
	/** Stable resource key (the suffix after the first `_` in Mantle's `id`). */
	readonly key: string;
	/** Other Mantle `id`s this resource depends on; copied verbatim from the YAML. */
	readonly dependencies: ReadonlyArray<string>;
	/** Bare payload from `inputs[kind]`, with nulls normalized to `undefined`. */
	readonly inputs: unknown;
	/** Resource discriminator (the prefix before the first `_` in Mantle's `id`). */
	readonly kind: string;
	/** Bare payload from `outputs[kind]`, or `undefined` for bare-string outputs. */
	readonly outputs: unknown;
}

/**
 * Mantle v6 state file envelope: a top-level `version` literal plus one
 * resource list per environment, keyed by environment name. Every Mantle
 * resource within an environment carries a string `id` of the form
 * `<kind>_<key>` (singletons are spelled `<kind>_singleton`); the parser
 * splits this into the discriminator-bearing fields on `MantleResource`.
 */
export interface MantleStateV6 {
	/** Per-environment resource list keyed by environment name. */
	readonly environments: Readonly<Record<string, ReadonlyArray<MantleResource>>>;
	/** State schema version literal; v0.1 supports `"6"` only. */
	readonly version: "6";
}
