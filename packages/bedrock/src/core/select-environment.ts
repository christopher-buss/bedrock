import type { Result } from "@bedrock-rbx/ocale";

import { defu } from "defu";

import { renderDisplayNamePrefix } from "./display-name-prefix.ts";
import { applyRedaction, type EnvironmentResourceRedaction } from "./redact-resources.ts";
import type {
	Config,
	DeveloperProductEntry,
	EnvironmentEntry,
	GamePassEntry,
	ResolvedConfig,
	ResolvedPlaceEntry,
	ResolvedUniverseEntry,
	UniverseEntry,
	WithoutKey,
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

/**
 * Failure surfaced when a merged place entry is missing a required field.
 * Two paths reach this error: a root place declared without a matching
 * per-environment overlay supplying `placeId`, and an overlay-only place
 * declared under `environments.X.places` with no matching root entry to
 * supply `filePath`. Surfacing both at the resolution boundary attributes
 * the missing field to the offending entry's key instead of letting
 * `buildDesired` crash with a generic `fileReadFailed` later on.
 */
export interface IncompletePlaceEntryError {
	/** ResourceKey of the place entry that is missing a required field. */
	readonly key: string;
	/** Environment whose overlay was projected onto the config. */
	readonly environment: string;
	/** Literal discriminator for narrowing. */
	readonly kind: "incompletePlaceEntry";
	/** Field that the merged entry lacks. */
	readonly missingField: "filePath" | "placeId";
}

/**
 * Failure surfaced when a merged `universe` block lacks `universeId`.
 * The schema-level XOR rule normally prevents this by requiring
 * `universeId` either at the root or on every per-environment overlay;
 * this error remains as a typed safety net for callers that bypass
 * `validateConfig` and hand a `Config` to `selectEnvironment` directly.
 */
export interface IncompleteUniverseEntryError {
	/** Environment whose overlay was projected onto the config. */
	readonly environment: string;
	/** Literal discriminator for narrowing. */
	readonly kind: "incompleteUniverseEntry";
	/** Field that the merged entry lacks. V1 only surfaces `"universeId"`. */
	readonly missingField: "universeId";
}

/**
 * Failure surfaced when a merged `passes` entry is missing a required
 * field. The most common path here is an overlay-only pass declared
 * under `environments.X.passes` with no matching root entry: the overlay
 * shape is `Partial<GamePassEntry>`, so a typo on the ResourceKey
 * silently produces an incomplete entry that would otherwise be filled
 * in by `applyRedaction` (when `redacted: true` is set) and pushed as a
 * phantom placeholder pass. Surfacing the missing field at the
 * resolution boundary keeps that case attributable instead of letting
 * normalize fail later with a less specific error.
 */
export interface IncompletePassEntryError {
	/** ResourceKey of the pass entry that is missing a required field. */
	readonly key: string;
	/** Environment whose overlay was projected onto the config. */
	readonly environment: string;
	/** Literal discriminator for narrowing. */
	readonly kind: "incompletePassEntry";
	/** Field that the merged entry lacks. */
	readonly missingField: "description" | "icon" | "name";
}

/** Failure modes returned by {@link selectEnvironment}. */
export type SelectEnvironmentError =
	| IncompletePassEntryError
	| IncompletePlaceEntryError
	| IncompleteUniverseEntryError
	| UnknownEnvironmentError;

/** Successful return shape for {@link selectMergedEnvironment}. */
interface MergedEnvironment {
	/** Per-environment entry that the merge projected onto the root config. */
	readonly entry: EnvironmentEntry;
	/**
	 * Post-merge, pre-redaction `ResolvedConfig`. Resources that opt into
	 * redaction still carry their real `name`, `description`, and `icon`
	 * values, so callers can inspect divergence from placeholder defaults
	 * before {@link selectEnvironment} substitutes them.
	 */
	readonly merged: ResolvedConfig;
}

/**
 * Project a `Config` onto a single environment up to the pre-redaction
 * merge boundary. Looks up the env entry, deep-merges its resource overlay
 * over the root config, and runs the same pass, place, and universe
 * completeness checks {@link selectEnvironment} runs, so the returned
 * `merged` config honours the full `ResolvedConfig` contract. Real
 * `name`, `description`, and `icon` values on redacted resources stay
 * intact, letting callers inspect divergence from placeholder defaults
 * before {@link selectEnvironment} substitutes them.
 *
 * @param config - Validated project config.
 * @param environment - Environment name to project onto.
 * @returns The matched env entry plus the merged config, or any of the
 *   `SelectEnvironmentError` failure modes.
 */
export function selectMergedEnvironment(
	config: Config,
	environment: string,
): Result<MergedEnvironment, SelectEnvironmentError> {
	const entry = config.environments[environment];
	if (entry === undefined) {
		return { err: unknownEnvironment(config, environment), success: false };
	}

	const merged = mergeOverlays(config, entry);
	const incompletePass = findIncompletePass(merged, environment);
	if (incompletePass !== undefined) {
		return { err: incompletePass, success: false };
	}

	const incompletePlace = findIncompletePlace(merged, environment);
	if (incompletePlace !== undefined) {
		return { err: incompletePlace, success: false };
	}

	const incompleteUniverse = findIncompleteUniverse(merged, environment);
	if (incompleteUniverse !== undefined) {
		return { err: incompleteUniverse, success: false };
	}

	return { data: { entry, merged }, success: true };
}

/**
 * Build the per-resource env-overlay redaction layer that `applyRedaction`
 * and `collectRedactionAnnotations` consume. Reads each redactable kind off
 * the environment entry and projects every entry's `redacted` field into
 * the layer; omits kinds the env entry does not declare.
 *
 * @param entry - Environment entry whose overlay redaction values to extract.
 * @returns A `EnvironmentResourceRedaction` ready to pass downstream.
 */
export function extractResourceRedaction(entry: EnvironmentEntry): EnvironmentResourceRedaction {
	return {
		...(entry.passes ? { passes: extractRedactionLayer(entry.passes) } : {}),
		...(entry.places ? { places: extractRedactionLayer(entry.places) } : {}),
		...(entry.products ? { products: extractRedactionLayer(entry.products) } : {}),
	};
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
 * brand-new universe block may still have optional fields missing, since
 * the overlay type only requires the identity-bearing key. The resolver
 * surfaces the entry as-is; the universe driver reports the missing
 * field when it tries to consume the entry. Universe is a singleton with
 * 20+ optional fields, so the same `incompletePlaceEntry`-style validation
 * is deferred to a separate follow-up.
 *
 * When the project sets a `displayNamePrefix` (or omits it, in which case
 * prefixing defaults to enabled) and the chosen environment declares a
 * non-empty `label`, the resolver renders the configured template via
 * `renderDisplayNamePrefix` and prepends the result to `universe.displayName`
 * and every declared place `displayName`. An undeclared `displayName`, an
 * empty/absent label, or an explicit `displayNamePrefix.enabled: false` all
 * skip prefixing for the affected fields.
 *
 * @example
 *
 * ```ts
 * import { selectEnvironment } from "@bedrock-rbx/core";
 * import type { Config } from "@bedrock-rbx/core/config";
 *
 * const config: Config = {
 *     environments: {
 *         production: { universe: { universeId: "999" } },
 *     },
 *     state: { backend: "gist", gistId: "abc123" },
 *     universe: { voiceChatEnabled: true },
 * };
 *
 * const result = selectEnvironment(config, "production");
 *
 * expect(result.success).toBeTrue();
 * if (result.success) {
 *     expect(result.data.universe?.universeId).toBe("999");
 *     expect(result.data.universe?.voiceChatEnabled).toBeTrue();
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
	const mergedResult = selectMergedEnvironment(config, environment);
	if (!mergedResult.success) {
		return mergedResult;
	}

	const { entry, merged } = mergedResult.data;
	return { data: redactAndPrefix({ config, entry, merged }), success: true };
}

function findIncompletePass(
	merged: ResolvedConfig,
	environment: string,
): IncompletePassEntryError | undefined {
	const { passes } = merged;
	if (passes === undefined) {
		return undefined;
	}

	const candidates: Record<string, Partial<GamePassEntry>> = passes;
	for (const [key, entry] of Object.entries(candidates)) {
		if (entry.name === undefined) {
			return { key, environment, kind: "incompletePassEntry", missingField: "name" };
		}

		if (entry.description === undefined) {
			return {
				key,
				environment,
				kind: "incompletePassEntry",
				missingField: "description",
			};
		}

		if (entry.icon === undefined) {
			return { key, environment, kind: "incompletePassEntry", missingField: "icon" };
		}
	}

	return undefined;
}

function mergeEntry<Resolved extends object>(
	overlay: Partial<Resolved>,
	base: Partial<Resolved> | undefined,
): Resolved {
	// Precondition for the cast: every public success path of
	// `selectEnvironment` MUST run completeness validation (today only
	// `findIncompletePlace`) before exposing the merged record to a caller.
	// The cast trades compile-time soundness for the freedom to surface
	// partial entries to a validator that can attribute the missing field to
	// a typed error. New resource kinds that adopt this merge pattern owe
	// their own `findIncomplete<Kind>Entry` validator before returning.
	//
	// defu treats `undefined` as the empty object, so an overlay-only entry
	// (no matching root) flows through unchanged. defu's return type is
	// `MergeObjects<Partial<Resolved>, Partial<Resolved>>` which the compiler
	// cannot prove equals `Resolved`.
	return defu(overlay, base ?? {}) as Resolved;
}

function mergeKeyedRecord<Resolved extends object>(
	overlay: Record<string, Partial<Resolved>> | undefined,
	base: Record<string, Partial<Resolved>> | undefined,
): Record<string, Resolved> | undefined {
	if (overlay === undefined) {
		// Same precondition as `mergeEntry`: passing the base record straight
		// through is sound only when the caller validates completeness on the
		// returned record before publishing it.
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
	overlay: Partial<UniverseEntry> | undefined,
	base: undefined | UniverseEntry,
): ResolvedUniverseEntry | undefined {
	if (overlay === undefined && base === undefined) {
		return undefined;
	}

	// Precondition for the cast: see `mergeEntry`. The schema-level XOR rule
	// guarantees a present `universeId` post-merge whenever the result is
	// non-empty, and `findIncompleteUniverse` re-verifies the invariant on
	// the success path. The `defu` call type-resolves to a wider partial
	// because both sides declare `universeId` as optional; the cast collapses
	// it to the resolved shape.
	return defu(overlay ?? {}, base ?? {}) as ResolvedUniverseEntry;
}

function stripRedacted<T extends { readonly redacted?: unknown }>(
	overlay: Readonly<Record<string, T>> | undefined,
): Record<string, WithoutKey<T, "redacted">> | undefined {
	if (overlay === undefined) {
		return undefined;
	}

	return Object.fromEntries(
		Object.entries(overlay).map(([key, entryValue]) => {
			const { redacted: _redacted, ...rest } = entryValue;
			return [key, rest];
		}),
	);
}

function mergeOverlays(config: Config, entry: EnvironmentEntry): ResolvedConfig {
	const passes = mergeKeyedRecord<GamePassEntry>(stripRedacted(entry.passes), config.passes);
	const places = mergeKeyedRecord<ResolvedPlaceEntry>(stripRedacted(entry.places), config.places);
	const products = mergeKeyedRecord<DeveloperProductEntry>(
		stripRedacted(entry.products),
		config.products,
	);
	const universe = mergeUniverse(entry.universe, config.universe);
	const state = entry.state ?? config.state;

	const {
		places: _placesRoot,
		products: _productsRoot,
		universe: _universeRoot,
		...rest
	} = config;

	return {
		...rest,
		...(passes === undefined ? {} : { passes }),
		...(places === undefined ? {} : { places }),
		...(products === undefined ? {} : { products }),
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

function findIncompleteUniverse(
	projected: ResolvedConfig,
	environment: string,
): IncompleteUniverseEntryError | undefined {
	const { universe } = projected;
	if (universe === undefined) {
		return undefined;
	}

	// `universe` is typed as `ResolvedUniverseEntry` (universeId required)
	// because the merge boundary already promised completeness; this routine
	// exists to honour that promise at runtime, so it widens the view back to
	// `Partial<ResolvedUniverseEntry>` for the duration of the check.
	const candidate: Partial<ResolvedUniverseEntry> = universe;
	if (candidate.universeId === undefined) {
		return { environment, kind: "incompleteUniverseEntry", missingField: "universeId" };
	}

	return undefined;
}

function findIncompletePlace(
	projected: ResolvedConfig,
	environment: string,
): IncompletePlaceEntryError | undefined {
	const { places } = projected;
	if (places === undefined) {
		return undefined;
	}

	// `places` is typed as `Record<string, ResolvedPlaceEntry>` because the
	// merge boundary already promised completeness; this routine exists to
	// honour that promise at runtime, so it widens the view back to
	// `Partial<ResolvedPlaceEntry>` for the duration of the check.
	const candidates: Record<string, Partial<ResolvedPlaceEntry>> = places;
	for (const [key, entry] of Object.entries(candidates)) {
		if (entry.placeId === undefined) {
			return {
				key,
				environment,
				kind: "incompletePlaceEntry",
				missingField: "placeId",
			};
		}

		if (entry.filePath === undefined) {
			return {
				key,
				environment,
				kind: "incompletePlaceEntry",
				missingField: "filePath",
			};
		}
	}

	return undefined;
}

function extractRedactionLayer<Value>(
	overlay: Readonly<Record<string, { readonly redacted?: Value }>>,
): Readonly<Record<string, Value>> {
	const layer: Record<string, Value> = {};
	for (const [key, entryValue] of Object.entries(overlay)) {
		if (entryValue.redacted !== undefined) {
			layer[key] = entryValue.redacted;
		}
	}

	return layer;
}

function resolvePrefix(config: Config, entry: EnvironmentEntry): string | undefined {
	if (config.displayNamePrefix?.enabled === false) {
		return undefined;
	}

	const { label } = entry;
	if (label === undefined || label === "") {
		return undefined;
	}

	return renderDisplayNamePrefix(label, config.displayNamePrefix?.format);
}

function applyUniversePrefix(
	universe: ResolvedUniverseEntry | undefined,
	prefix: string | undefined,
): ResolvedUniverseEntry | undefined {
	if (universe === undefined || prefix === undefined || universe.displayName === undefined) {
		return universe;
	}

	return { ...universe, displayName: prefix + universe.displayName };
}

function applyPlacesPrefix(
	places: Record<string, ResolvedPlaceEntry> | undefined,
	prefix: string | undefined,
): Record<string, ResolvedPlaceEntry> | undefined {
	if (places === undefined || prefix === undefined) {
		return places;
	}

	return Object.fromEntries(
		Object.entries(places).map(([key, place]) => {
			if (place.displayName === undefined) {
				return [key, place];
			}

			return [key, { ...place, displayName: prefix + place.displayName }];
		}),
	);
}

function redactAndPrefix(inputs: {
	readonly config: Config;
	readonly entry: EnvironmentEntry;
	readonly merged: ResolvedConfig;
}): ResolvedConfig {
	const { config, entry, merged } = inputs;
	const redacted = applyRedaction(merged, {
		envLevel: entry.redacted,
		envResource: extractResourceRedaction(entry),
	});
	const prefix = resolvePrefix(config, entry);
	const places = applyPlacesPrefix(redacted.places, prefix);
	const universe = applyUniversePrefix(redacted.universe, prefix);

	return {
		...redacted,
		...(places === undefined ? {} : { places }),
		...(universe === undefined ? {} : { universe }),
	};
}
