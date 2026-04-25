import type { Result } from "@bedrock/ocale";

import { defu } from "defu";
import type { Except, SetRequired } from "type-fest";

import { resolveStateConfig, type StateNotConfiguredError } from "./resolve-state-config.ts";
import type { Config, GamePassEntry, PlaceEntry, StateConfig, UniverseEntry } from "./schema.ts";

/**
 * Failure surfaced when `selectEnvironment` is asked for an environment
 * name that is not a key of `config.environments`. Carries the list of
 * declared names so callers can render a "did you mean?" hint or a
 * close-match suggestion.
 */
export interface UnknownEnvironmentError {
	/** Environment names that the config actually declared. */
	readonly declared: ReadonlyArray<string>;
	/** Environment name the caller asked for. */
	readonly environment: string;
	/** Literal discriminator for narrowing. */
	readonly kind: "unknownEnvironment";
}

/** Failure modes returned by {@link selectEnvironment}. */
export type SelectEnvironmentError = StateNotConfiguredError | UnknownEnvironmentError;

/**
 * `Config` projected onto a single environment. `environments` and
 * `extends` are stripped because the resolver has already collapsed the
 * overlay into the resource fields, and `state` is non-optional because
 * the resolver resolved it from the env override or the root block.
 */
export type EffectiveConfig = Except<Config, "environments" | "extends" | "state"> & {
	readonly state: StateConfig;
};

interface ProjectInputs {
	readonly config: Config;
	readonly entry: Config["environments"][string];
	readonly state: StateConfig;
}

/**
 * Project a validated `Config` onto a single environment. Looks up the
 * matching `environments[environment]` entry, deep-merges its resource
 * overlay (`passes`, `places`, `universe`) over the root config via defu,
 * and resolves the effective state via {@link resolveStateConfig}.
 *
 * Pure: no I/O. The returned `EffectiveConfig` carries the merged
 * resource fields plus the resolved `state` and is ready to feed into
 * `flattenConfig` or `buildStatePort` without further pre-processing.
 *
 * Defu's merge semantics are deliberate: keyed-map collections merge by
 * key (so a place declared in both root and overlay produces a single
 * entry whose overlay-supplied fields win), and `null` / `undefined` in
 * the overlay are skipped (so the overlay never deletes a root field).
 * State has its own resolution path because it is a tagged union: a
 * full deep-merge of `{ backend: "s3" }` over `{ backend: "gist", gistId }`
 * would produce a malformed `{ backend: "s3", gistId }`.
 *
 * Limitation in v1: a per-environment overlay that introduces a brand-new
 * place or universe overlay key (one not declared at the root) may still
 * have optional fields missing, since the overlay type only requires the
 * identity-bearing key. The resolver surfaces the entry as-is; downstream
 * consumers (`buildDesired`, the universe driver) report the missing
 * field when they try to consume the entry. Post-merge schema validation
 * is deferred to a follow-up that wires it through `validateConfig`.
 *
 * @example
 *
 * ```ts
 * import { selectEnvironment, type Config } from "@bedrock/core";
 *
 * const config: Config = {
 *     environments: {
 *         production: { universe: { universeId: "999" } },
 *     },
 *     state: { backend: "gist", gistId: "abc123" },
 *     universe: { universeId: "111" },
 * };
 *
 * const effective = selectEnvironment(config, "production");
 *
 * expect(effective.success).toBeTrue();
 * if (effective.success) {
 *     expect(effective.data.universe?.universeId).toBe("999");
 *     expect(effective.data.state.backend).toBe("gist");
 * }
 * ```
 *
 * @param config - Validated project config carrying at least one
 * environment under `environments`.
 * @param environment - Environment name to project onto. Must be a key
 * of `config.environments`.
 * @returns `Ok(EffectiveConfig)` with the merged resource fields and the
 * resolved state, or `Err(SelectEnvironmentError)` describing why the
 * projection failed.
 */
export function selectEnvironment(
	config: Config,
	environment: string,
): Result<EffectiveConfig, SelectEnvironmentError> {
	const entry = config.environments[environment];
	if (entry === undefined) {
		return { err: unknownEnvironment(config, environment), success: false };
	}

	const stateResult = resolveStateConfig(config, environment);
	if (!stateResult.success) {
		return stateResult;
	}

	return {
		data: projectConfig({ config, entry, state: stateResult.data }),
		success: true,
	};
}

function mergeEntry<Base extends object>(overlay: Partial<Base>, base: Base | undefined): Base {
	// New overlay-only entries are surfaced as-is; the overlay type guarantees
	// its identity-bearing key, and required base fields the overlay omits
	// surface downstream as typed errors. defu's own return type is
	// `MergeObjects<Partial<Base>, Base>` which the compiler cannot prove
	// equals `Base` for an arbitrary `Base extends object`, but the merge is
	// structurally correct because deep-merging a partial onto a complete
	// entry yields a complete entry.
	return base === undefined ? (overlay as Base) : (defu(overlay, base) as Base);
}

function mergeKeyedRecord<Base extends object>(
	overlay: Record<string, Partial<Base>> | undefined,
	base: Record<string, Base> | undefined,
): Record<string, Base> | undefined {
	if (overlay === undefined) {
		return base;
	}

	return {
		...(base ?? {}),
		...Object.fromEntries(
			Object.entries(overlay).map(([key, partial]) => {
				return [key, mergeEntry(partial, base?.[key])];
			}),
		),
	};
}

function mergeUniverse(
	overlay: SetRequired<Partial<UniverseEntry>, "universeId"> | undefined,
	base: undefined | UniverseEntry,
): undefined | UniverseEntry {
	if (overlay === undefined) {
		return base;
	}

	return mergeEntry(overlay, base);
}

function projectConfig(inputs: ProjectInputs): EffectiveConfig {
	const { config, entry, state } = inputs;
	const passes = mergeKeyedRecord<GamePassEntry>(entry.passes, config.passes);
	const places = mergeKeyedRecord<PlaceEntry>(entry.places, config.places);
	const universe = mergeUniverse(entry.universe, config.universe);

	return {
		...(passes === undefined ? {} : { passes }),
		...(places === undefined ? {} : { places }),
		...(universe === undefined ? {} : { universe }),
		state,
	};
}

function unknownEnvironment(config: Config, environment: string): UnknownEnvironmentError {
	return {
		declared: Object.keys(config.environments),
		environment,
		kind: "unknownEnvironment",
	};
}
