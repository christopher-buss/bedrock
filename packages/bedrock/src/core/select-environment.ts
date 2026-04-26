import type { Result } from "@bedrock/ocale";

import { defu } from "defu";
import type { SetRequired } from "type-fest";

import type {
	Config,
	GamePassEntry,
	ResolvedConfig,
	ResolvedPlaceEntry,
	UniverseEntry,
} from "./schema.ts";

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
export type SelectEnvironmentError = UnknownEnvironmentError;

interface ProjectInputs {
	readonly config: Config;
	readonly entry: Config["environments"][string];
}

/**
 * Project a validated `Config` onto a single environment. Looks up the
 * matching `environments[environment]` entry, deep-merges its resource
 * overlay (`passes`, `places`, `universe`) over the root config via defu,
 * and applies the env-level state override when present (the env entry's
 * `state` field wins; otherwise the root `state` flows through).
 *
 * Pure: no I/O. Returns a `ResolvedConfig` ready to feed into downstream
 * functions (`flattenConfig`, `buildDefaultRegistry`, `resolveStateConfig`).
 * The post-merge view promotes `places` from `Record<string, PlaceEntry>`
 * (root: file-paths only) to `Record<string, ResolvedPlaceEntry>` (root +
 * overlay merged). `environments` and `extends` are passed through
 * unchanged because they preserve the shape relationship to `Config`;
 * downstream consumers do not read them post-merge.
 *
 * Defu's merge semantics are deliberate: keyed-map collections merge by
 * key (so a place declared in both root and overlay produces a single
 * entry whose overlay-supplied fields win), and `null` / `undefined` in
 * the overlay are skipped (so the overlay never deletes a root field).
 * State has its own resolution path (a single replacement, not a
 * deep-merge) because it is a tagged union: a deep-merge of
 * `{ backend: "s3" }` over `{ backend: "gist", gistId }` would produce
 * a malformed `{ backend: "s3", gistId }`.
 *
 * State is left absent when neither the env override nor the root block
 * provides one. Callers that require a resolved `StateConfig` should
 * route through `resolveStateConfig` or `buildStatePort`; the absent
 * case surfaces as a typed `stateNotConfigured` there.
 *
 * Limitation in v1: a per-environment universe overlay that introduces a
 * brand-new universe block (one not declared at the root) may still have
 * optional fields missing, since the overlay type only requires the
 * identity-bearing key. The resolver surfaces the entry as-is; the
 * universe driver reports the missing field when it tries to consume the
 * entry. The matching gap for `places` is closed: post-merge entries
 * without a `placeId` are rejected as `incompletePlaceEntry` here.
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
 * const result = selectEnvironment(config, "production");
 *
 * expect(result.success).toBeTrue();
 * if (result.success) {
 *     expect(result.data.universe?.universeId).toBe("999");
 *     expect(result.data.state?.backend).toBe("gist");
 * }
 * ```
 *
 * @param config - Validated project config carrying at least one
 * environment under `environments`.
 * @param environment - Environment name to project onto. Must be a key
 * of `config.environments`.
 * @returns `Ok(ResolvedConfig)` with the merged resource fields and the
 * resolved state, or `Err(SelectEnvironmentError)` describing why the
 * projection failed.
 */
export function selectEnvironment(
	config: Config,
	environment: string,
): Result<ResolvedConfig, SelectEnvironmentError> {
	const entry = config.environments[environment];
	if (entry === undefined) {
		return { err: unknownEnvironment(config, environment), success: false };
	}

	return {
		data: projectConfig({ config, entry }),
		success: true,
	};
}

function mergeEntry<Resolved extends object>(
	overlay: Partial<Resolved>,
	base: Partial<Resolved> | undefined,
): Resolved {
	// defu treats `undefined` as the empty object, so an overlay-only entry
	// (no matching root) flows through unchanged. Required fields the overlay
	// omits and the base lacks are caught by post-merge validation
	// (`incompletePlaceEntry` for places). defu's return type is
	// `MergeObjects<Partial<Resolved>, Partial<Resolved>>` which the compiler
	// cannot prove equals `Resolved`; the merge is structurally correct when
	// the union of overlay + base fields covers every required field of
	// `Resolved`.
	return defu(overlay, base ?? {}) as Resolved;
}

function mergeKeyedRecord<Resolved extends object>(
	overlay: Record<string, Partial<Resolved>> | undefined,
	base: Record<string, Partial<Resolved>> | undefined,
): Record<string, Resolved> | undefined {
	if (overlay === undefined) {
		return base as Record<string, Resolved> | undefined;
	}

	return {
		...((base ?? {}) as Record<string, Resolved>),
		...Object.fromEntries(
			Object.entries(overlay).map(([key, partial]) => {
				return [key, mergeEntry<Resolved>(partial, base?.[key])];
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

function projectConfig(inputs: ProjectInputs): ResolvedConfig {
	const { config, entry } = inputs;
	const passes = mergeKeyedRecord<GamePassEntry>(entry.passes, config.passes);
	const places = mergeKeyedRecord<ResolvedPlaceEntry>(entry.places, config.places);
	const universe = mergeUniverse(entry.universe, config.universe);
	const state = entry.state ?? config.state;

	const { places: _placesRoot, ...rest } = config;

	return {
		...rest,
		...(passes === undefined ? {} : { passes }),
		...(places === undefined ? {} : { places }),
		...(state === undefined ? {} : { state }),
		...(universe === undefined ? {} : { universe }),
	};
}

function unknownEnvironment(config: Config, environment: string): UnknownEnvironmentError {
	return {
		declared: Object.keys(config.environments),
		environment,
		kind: "unknownEnvironment",
	};
}
