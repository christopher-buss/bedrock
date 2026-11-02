/* eslint-disable max-lines -- cohesive environment-resolution module: overlay merge, completeness validation, redaction/prefix application, and the real-display projection are one pipeline; the typed error declarations alone are a third of the file. */

import type { Result } from "@bedrock-rbx/ocale";

import type { Except } from "type-fest";

import { renderDisplayNamePrefix } from "./display-name-prefix.ts";
import { resolveNone } from "./none.ts";
import {
	applyRedaction,
	collectRealDisplay,
	collectRedactionAnnotations,
	type EnvironmentResourceRedaction,
	type RedactionAnnotation,
} from "./redact-resources.ts";
import type { ResourceRealDisplay } from "./resources.ts";
import type {
	BadgeEntry,
	Config,
	EnvironmentEntry,
	ResolvedConfig,
	ResolvedDeveloperProductEntry,
	ResolvedGamePassEntry,
	ResolvedPlaceEntry,
	ResolvedUniverseEntry,
	ResourceEntry,
	UniverseEntry,
	WithoutKey,
} from "./schema.ts";

/**
 * Failure surfaced when `selectEnvironment` is asked for an environment
 * name that is not a key of `config.environments`. Carries the list of
 * declared names so callers can render a "did you mean?" hint or a
 * close-match suggestion.
 *
 * @since 0.1.0
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
 * Failure surfaced when a merged place entry is missing `placeId`: a root
 * place declared without a matching per-environment overlay to supply it.
 * Open Cloud cannot mint places, so the ID is the one field no layer can
 * default. Surfacing it at the resolution boundary attributes the missing
 * field to the offending entry's key instead of letting the deploy fail
 * later against a place it cannot address. `filePath` is not required: an
 * entry without one is a config-only place.
 *
 * @since 0.1.0
 */
export interface IncompletePlaceEntryError {
	/** ResourceKey of the place entry that is missing a required field. */
	readonly key: string;
	/** Environment whose overlay was projected onto the config. */
	readonly environment: string;
	/** Literal discriminator for narrowing. */
	readonly kind: "incompletePlaceEntry";
	/** Field that the merged entry lacks. */
	readonly missingField: "placeId";
}

/**
 * Failure surfaced when a merged `universe` block lacks `universeId`.
 * The schema-level XOR rule normally prevents this by requiring
 * `universeId` either at the root or on every per-environment overlay;
 * this error remains as a typed safety net for callers that bypass
 * `validateConfig` and hand a `Config` to `selectEnvironment` directly.
 *
 * @since 0.1.0
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
 * Failure surfaced when a merged `badges` entry is missing a required
 * field, most often an overlay-only badge declared under
 * `environments.X.badges` with no matching root entry.
 *
 * @since 0.4.0
 */
export interface IncompleteBadgeEntryError {
	/** ResourceKey of the badge entry that is missing a required field. */
	readonly key: string;
	/** Environment whose overlay was projected onto the config. */
	readonly environment: string;
	/** Literal discriminator for narrowing. */
	readonly kind: "incompleteBadgeEntry";
	/** Field that the merged entry lacks. */
	readonly missingField: "description" | "icon" | "name";
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

/**
 * Failure surfaced when a merged `products` entry is missing a required
 * field. Mirrors {@link IncompletePassEntryError}: the overlay shape is
 * `Partial<DeveloperProductEntry>`, so an overlay-only product declared
 * under `environments.X.products` with no matching root entry (a typo on
 * the ResourceKey, most often) would otherwise be pushed as a phantom
 * product with no name.
 */
export interface IncompleteProductEntryError {
	/** ResourceKey of the product entry that is missing a required field. */
	readonly key: string;
	/** Environment whose overlay was projected onto the config. */
	readonly environment: string;
	/** Literal discriminator for narrowing. */
	readonly kind: "incompleteProductEntry";
	/** Field that the merged entry lacks. */
	readonly missingField: "description" | "name";
}

/**
 * Failure modes returned by {@link selectEnvironment}.
 *
 * @since 0.1.0
 */
export type SelectEnvironmentError =
	| IncompleteBadgeEntryError
	| IncompletePassEntryError
	| IncompletePlaceEntryError
	| IncompleteProductEntryError
	| IncompleteUniverseEntryError
	| UnknownEnvironmentError;

/**
 * Resolved view an orchestrator needs from one environment projection:
 * the deploy-ready (redacted, prefixed) config and the real-display sibling
 * map derived from the same pre-redaction merge.
 */
interface ResolvedEnvironment {
	/**
	 * Redacted, prefixed `ResolvedConfig`, the same value {@link
	 * selectEnvironment} returns.
	 */
	readonly config: ResolvedConfig;
	/**
	 * Real (pre-redaction) display values for redacted resources, keyed by the
	 * `kind:key` composite the diff uses. Empty when nothing is redacted.
	 */
	readonly realDisplay: Readonly<Record<string, ResourceRealDisplay>>;
	/**
	 * Redaction annotations captured before placeholders and prefixes
	 * are applied.
	 */
	readonly redactions: ReadonlyArray<RedactionAnnotation>;
}

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
 * The overlay merge before completeness resolution. Every collection entry
 * may still be missing a field the resolved contract requires, because an
 * overlay-only entry has no root entry to fall through to.
 */
interface MergedConfig extends Except<
	ResolvedConfig,
	"badges" | "passes" | "places" | "products" | "universe"
> {
	readonly badges?: EnvironmentEntry["badges"] | undefined;
	readonly passes?: EnvironmentEntry["passes"];
	readonly places?: Record<string, ResourceEntry<Partial<ResolvedPlaceEntry>>>;
	readonly products?: EnvironmentEntry["products"];
	readonly universe?: Partial<UniverseEntry>;
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
	const resolved = resolveCollections(merged, environment);
	if (!resolved.success) {
		return resolved;
	}

	return {
		data: { entry, merged: { ...withoutCollections(merged), ...resolved.data } },
		success: true,
	};
}

/**
 * Project a `Config` onto a single environment and return both the deploy-ready
 * config and the real-display map, computed from one shared pre-redaction
 * merge. The config is identical to {@link selectEnvironment}'s output; the
 * map is what {@link collectRealDisplay} derives from the same merged view and
 * redaction layers, so the placeholders bedrock pushes and the real values it
 * persists out of band stay in lockstep. Used by the deploy orchestrator so it
 * resolves the environment once rather than redacting twice.
 *
 * @param config - Validated project config.
 * @param environment - Environment name to project onto.
 * @returns The resolved config plus real-display map, or any
 *   {@link SelectEnvironmentError}.
 */
export function resolveEnvironment(
	config: Config,
	environment: string,
): Result<ResolvedEnvironment, SelectEnvironmentError> {
	const mergedResult = selectMergedEnvironment(config, environment);
	if (!mergedResult.success) {
		return mergedResult;
	}

	const { entry, merged } = mergedResult.data;
	const redactionInputs = {
		envLevel: entry.redacted,
		envResource: extractResourceRedaction(entry),
	};
	return {
		data: {
			config: redactAndPrefix({ config, entry, merged }),
			realDisplay: collectRealDisplay(merged, redactionInputs),
			redactions: collectRedactionAnnotations(merged, redactionInputs.envResource),
		},
		success: true,
	};
}

/**
 * Project a validated `Config` onto a single environment. Looks up the
 * matching `environments[environment]` entry, deep-merges its resource
 * overlay (`passes`, `places`, `products`, `universe`) over the root config,
 * and applies the env-level state override when present (the env entry's
 * `state` field wins; otherwise the root `state` flows through).
 *
 * Pure: no I/O. Returns a `ResolvedConfig` ready to feed into downstream
 * functions (`flattenConfig`, `buildDefaultRegistry`, `resolveStateConfig`).
 * The post-merge view promotes `places` from `Record<string, PlaceEntry>`
 * (root: file-paths only) to `Record<string,
 * ResourceEntry<ResolvedPlaceEntry>>` (root + overlay merged). `environments`
 * and `extends` are passed through unchanged because they preserve the shape
 * relationship to `Config`; downstream consumers do not read them post-merge.
 *
 * The merge semantics are deliberate: keyed-map collections merge by key
 * (so a place declared in both root and overlay produces a single entry
 * whose overlay-supplied fields win). Within an entry, a field the overlay
 * omits inherits the root value, and a field the overlay sets to
 * `none` turns it off: `price: none` on a pass or product overlay
 * takes that resource off sale in this environment only. After the merge,
 * every `none` becomes `undefined` on the resolved entry, so redaction
 * never mistakes an off-sale price for a real one.
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
 * @since 0.1.0
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
	const resolved = resolveEnvironment(config, environment);
	if (!resolved.success) {
		return resolved;
	}

	return { data: resolved.data.config, success: true };
}

/**
 * Lay an overlay's fields over a base entry, one level deep. A key the
 * overlay declares wins; a key the overlay omits inherits the base value.
 * Every object-valued entry field (`icon`, the universe social links)
 * requires all of its own keys, so replacing it whole matches a deep merge.
 *
 * An overlay-only entry (no matching root) flows through unchanged, still
 * missing whatever the root would have supplied. The `resolve<Kind>` pass
 * downstream is what turns a complete merge into the resolved shape; a new
 * resource kind adopting this merge pattern owes its own resolver.
 *
 * @template Resolved - Entry shape both layers are partials of.
 * @param overlay - Per-environment overlay fields.
 * @param base - Root entry fields, if the root declares the entry.
 * @returns The merged entry fields.
 */
function mergeEntry<Resolved extends object>(
	overlay: ResourceEntry<Partial<Resolved>>,
	base: ResourceEntry<Partial<Resolved>> | undefined,
): ResourceEntry<Partial<Resolved>> {
	if ("retired" in overlay) {
		return overlay;
	}

	return { ...base, ...overlay };
}

function mergeKeyedRecord<Resolved extends object>(
	overlay: Record<string, ResourceEntry<Partial<Resolved>>> | undefined,
	base: Record<string, ResourceEntry<Partial<Resolved>>> | undefined,
): Record<string, ResourceEntry<Partial<Resolved>>> | undefined {
	if (overlay === undefined) {
		return base;
	}

	return {
		...base,
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
): Partial<UniverseEntry> | undefined {
	if (overlay === undefined && base === undefined) {
		return undefined;
	}

	return mergeEntry<UniverseEntry>(overlay ?? {}, base);
}

function stripRedacted<T extends { readonly redacted?: unknown }>(
	overlay: Readonly<Record<string, T>> | undefined,
): Record<string, WithoutKey<T, "redacted">> | undefined {
	if (overlay === undefined) {
		return undefined;
	}

	return Object.fromEntries(
		Object.entries(overlay).map(([key, entryValue]) => {
			if ("retired" in entryValue) {
				return [key, entryValue];
			}

			const { redacted: _redacted, ...rest } = entryValue;
			return [key, rest];
		}),
	);
}

function mergeBadges(config: Config, entry: EnvironmentEntry): Pick<MergedConfig, "badges"> {
	return {
		badges: mergeKeyedRecord<NonNullable<EnvironmentEntry["badges"]>[string]>(
			stripRedacted(entry.badges),
			config.badges,
		),
	};
}

function mergeOverlays(config: Config, entry: EnvironmentEntry): MergedConfig {
	const passes = mergeKeyedRecord<NonNullable<EnvironmentEntry["passes"]>[string]>(
		stripRedacted(entry.passes),
		config.passes,
	);
	const places = mergeKeyedRecord<ResolvedPlaceEntry>(stripRedacted(entry.places), config.places);
	const products = mergeKeyedRecord<NonNullable<EnvironmentEntry["products"]>[string]>(
		stripRedacted(entry.products),
		config.products,
	);
	const universe = mergeUniverse(entry.universe, config.universe);
	const state = entry.state ?? config.state;

	const {
		badges: _badgesRoot,
		places: _placesRoot,
		products: _productsRoot,
		universe: _universeRoot,
		...rest
	} = config;

	return {
		...rest,
		...mergeBadges(config, entry),
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

function incompleteBadge(
	err: Except<IncompleteBadgeEntryError, "kind">,
): Result<never, IncompleteBadgeEntryError> {
	return { err: { ...err, kind: "incompleteBadgeEntry" }, success: false };
}

function resolveBadges(
	{ badges }: MergedConfig,
	environment: string,
): Result<Pick<ResolvedConfig, "badges">, IncompleteBadgeEntryError> {
	if (badges === undefined) {
		return { data: {}, success: true };
	}

	const resolved: Record<string, ResourceEntry<BadgeEntry>> = {};
	for (const [key, entry] of Object.entries(badges)) {
		if ("retired" in entry) {
			resolved[key] = entry;
			continue;
		}

		const { name, description, icon } = entry;
		if (name === undefined) {
			return incompleteBadge({ key, environment, missingField: "name" });
		}

		if (description === undefined) {
			return incompleteBadge({ key, environment, missingField: "description" });
		}

		if (icon === undefined) {
			return incompleteBadge({ key, environment, missingField: "icon" });
		}

		resolved[key] = { ...entry, name, description, icon };
	}

	return { data: { badges: resolved }, success: true };
}

// eslint-disable-next-line flawless/max-lines-per-function -- marker bypass and field-specific completeness diagnostics belong to the same resolver
function resolvePasses(
	{ passes }: MergedConfig,
	environment: string,
): Result<
	Record<string, ResourceEntry<ResolvedGamePassEntry>> | undefined,
	IncompletePassEntryError
> {
	if (passes === undefined) {
		return { data: undefined, success: true };
	}

	const resolved: Record<string, ResourceEntry<ResolvedGamePassEntry>> = {};
	for (const [key, entry] of Object.entries(passes)) {
		if ("retired" in entry) {
			resolved[key] = entry;
			continue;
		}

		const { name, description, icon, isManagedPricingEnabled = false } = entry;
		if (name === undefined) {
			return {
				err: { key, environment, kind: "incompletePassEntry", missingField: "name" },
				success: false,
			};
		}

		if (description === undefined) {
			return {
				err: { key, environment, kind: "incompletePassEntry", missingField: "description" },
				success: false,
			};
		}

		if (icon === undefined) {
			return {
				err: { key, environment, kind: "incompletePassEntry", missingField: "icon" },
				success: false,
			};
		}

		resolved[key] = resolveNone({ ...entry, name, description, icon, isManagedPricingEnabled });
	}

	return { data: resolved, success: true };
}

// eslint-disable-next-line flawless/max-lines-per-function -- marker bypass and field-specific completeness diagnostics belong to the same resolver
function resolveProducts(
	{ products }: MergedConfig,
	environment: string,
): Result<
	Record<string, ResourceEntry<ResolvedDeveloperProductEntry>> | undefined,
	IncompleteProductEntryError
> {
	if (products === undefined) {
		return { data: undefined, success: true };
	}

	const resolved: Record<string, ResourceEntry<ResolvedDeveloperProductEntry>> = {};
	for (const [key, entry] of Object.entries(products)) {
		if ("retired" in entry) {
			resolved[key] = entry;
			continue;
		}

		const { name, description, isManagedPricingEnabled = false } = entry;
		if (name === undefined) {
			return {
				err: { key, environment, kind: "incompleteProductEntry", missingField: "name" },
				success: false,
			};
		}

		if (description === undefined) {
			return {
				err: {
					key,
					environment,
					kind: "incompleteProductEntry",
					missingField: "description",
				},
				success: false,
			};
		}

		resolved[key] = resolveNone({ ...entry, name, description, isManagedPricingEnabled });
	}

	return { data: resolved, success: true };
}

function resolveUniverse(
	{ universe }: MergedConfig,
	environment: string,
): Result<ResolvedUniverseEntry | undefined, IncompleteUniverseEntryError> {
	if (universe === undefined) {
		return { data: undefined, success: true };
	}

	const { universeId } = universe;
	if (universeId === undefined) {
		return {
			err: { environment, kind: "incompleteUniverseEntry", missingField: "universeId" },
			success: false,
		};
	}

	return { data: resolveNone({ ...universe, universeId }), success: true };
}

function resolvePlaces(
	{ places }: MergedConfig,
	environment: string,
): Result<
	Record<string, ResourceEntry<ResolvedPlaceEntry>> | undefined,
	IncompletePlaceEntryError
> {
	if (places === undefined) {
		return { data: undefined, success: true };
	}

	const resolved: Record<string, ResourceEntry<ResolvedPlaceEntry>> = {};
	for (const [key, entry] of Object.entries(places)) {
		if ("retired" in entry) {
			resolved[key] = entry;
			continue;
		}

		const { placeId } = entry;
		if (placeId === undefined) {
			return {
				err: { key, environment, kind: "incompletePlaceEntry", missingField: "placeId" },
				success: false,
			};
		}

		// `filePath` stays optional: an entry without one is a config-only
		// place bedrock reconciles by metadata alone.
		resolved[key] = { ...entry, placeId };
	}

	return { data: resolved, success: true };
}

function resolveOtherCollections(
	merged: MergedConfig,
	environment: string,
): Result<Partial<ResolvedConfig>, SelectEnvironmentError> {
	const passes = resolvePasses(merged, environment);
	if (!passes.success) {
		return passes;
	}

	const places = resolvePlaces(merged, environment);
	if (!places.success) {
		return places;
	}

	const products = resolveProducts(merged, environment);
	if (!products.success) {
		return products;
	}

	const universe = resolveUniverse(merged, environment);
	if (!universe.success) {
		return universe;
	}

	return {
		data: {
			...(passes.data === undefined ? {} : { passes: passes.data }),
			...(places.data === undefined ? {} : { places: places.data }),
			...(products.data === undefined ? {} : { products: products.data }),
			...(universe.data === undefined ? {} : { universe: universe.data }),
		},
		success: true,
	};
}

/**
 * Resolve every collection on a merged config, short-circuiting on the first
 * entry that is still missing a required field.
 *
 * @param merged - The post-overlay merge, before completeness resolution.
 * @param environment - Environment name the merge projects onto.
 * @returns Only the collections that are present, or the first failure.
 */
function resolveCollections(
	merged: MergedConfig,
	environment: string,
): Result<Partial<ResolvedConfig>, SelectEnvironmentError> {
	const badges = resolveBadges(merged, environment);
	if (!badges.success) {
		return badges;
	}

	const others = resolveOtherCollections(merged, environment);
	return others.success ? { data: { ...badges.data, ...others.data }, success: true } : others;
}

/**
 * Strip the partial collections from a merged config, leaving the fields that
 * pass through to the resolved shape untouched.
 *
 * @param merged - The post-overlay merge.
 * @returns The merge without its resource collections.
 */
function withoutCollections({
	badges: _badges,
	passes: _passes,
	places: _places,
	products: _products,
	universe: _universe,
	...rest
}: MergedConfig): Except<MergedConfig, "badges" | "passes" | "places" | "products" | "universe"> {
	return rest;
}

function extractRedactionLayer<Value>(
	overlay: Readonly<Record<string, { readonly redacted?: Value }>>,
): Readonly<Record<string, Value>> {
	const layer: Record<string, Value> = {};
	for (const [key, entryValue] of Object.entries(overlay)) {
		if (!("retired" in entryValue) && entryValue.redacted !== undefined) {
			layer[key] = entryValue.redacted;
		}
	}

	return layer;
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
function extractResourceRedaction(entry: EnvironmentEntry): EnvironmentResourceRedaction {
	return {
		...(entry.badges ? { badges: extractRedactionLayer(entry.badges) } : {}),
		...(entry.passes ? { passes: extractRedactionLayer(entry.passes) } : {}),
		...(entry.places ? { places: extractRedactionLayer(entry.places) } : {}),
		...(entry.products ? { products: extractRedactionLayer(entry.products) } : {}),
	};
}

function resolvePrefix(config: Config, { label }: EnvironmentEntry): string | undefined {
	if (config.displayNamePrefix?.enabled === false) {
		return undefined;
	}

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
	places: Record<string, ResourceEntry<ResolvedPlaceEntry>> | undefined,
	prefix: string | undefined,
): Record<string, ResourceEntry<ResolvedPlaceEntry>> | undefined {
	if (places === undefined || prefix === undefined) {
		return places;
	}

	return Object.fromEntries(
		Object.entries(places).map(([key, place]) => {
			if ("retired" in place || place.displayName === undefined) {
				return [key, place];
			}

			return [key, { ...place, displayName: prefix + place.displayName }];
		}),
	);
}

function redactAndPrefix({
	config,
	entry,
	merged,
}: {
	readonly config: Config;
	readonly entry: EnvironmentEntry;
	readonly merged: ResolvedConfig;
}): ResolvedConfig {
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
