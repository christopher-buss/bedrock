import { createHash } from "node:crypto";

import { asResourceKey, type ResourceKey } from "../types/ids.ts";
import { REDACTED_ICON_PATH } from "./redacted-icon.ts";
import type { ResourceKind } from "./resources.ts";
import type {
	DeveloperProductEntry,
	GamePassEntry,
	RedactedDeveloperProductOverride,
	RedactedGamePassOverride,
	RedactedPlaceOverride,
	ResolvedConfig,
	ResolvedPlaceEntry,
} from "./schema.ts";

/** Default placeholder name pushed for a redacted game-pass. */
export const REDACTED_PASS_NAME = "Redacted Pass";

/**
 * Common prefix used to build the default name pushed for a redacted
 * developer-product. The full default produced by {@link defaultRedactedProductName}
 * is `${REDACTED_PRODUCT_NAME} ${suffix}`, where `suffix` is a 6-hex-char
 * digest of the resource key (see {@link redactedNameSuffix}). The suffix is
 * required because Roblox enforces per-universe uniqueness on
 * developer-product names, so a shared bare placeholder would collide across
 * multiple redacted entries. The prefix avoids the word `Redacted` and the
 * `#` separator because Roblox's text-moderation filter has been observed
 * silently replacing names matching `Redacted Product #<hex>` with
 * `########################`, which then causes downstream `DuplicateProductName`
 * errors when other redacted entries are moderated to the same string.
 */
export const REDACTED_PRODUCT_NAME = "Hidden Product";

/** Default placeholder description pushed for any redacted resource. */
export const REDACTED_DESCRIPTION = "";

/**
 * Default placeholder Robux price pushed for a redacted game-pass or
 * developer-product whose config price is defined. Off-sale resources
 * (`price === undefined`) keep their off-sale state through redaction so a
 * hidden product is never accidentally listed for sale.
 */
export const REDACTED_PRICE = 1;

/**
 * Per-resource annotation surfaced in plan output for entries that are
 * redacted in the active environment. `hasRealValueEdits` is true when the
 * pre-redaction merged config carries real display values that diverge from
 * the placeholders bedrock pushes, so the renderer can warn the author that
 * their config edits are intentionally not flowing through to Open Cloud.
 */
export interface RedactionAnnotation {
	/** Resource key the annotation describes. */
	readonly key: ResourceKey;
	/** True when any real display field differs from the kind's placeholder default. */
	readonly hasRealValueEdits: boolean;
	/** Resource kind, so the renderer can format `kind:key` consistently with op output. */
	readonly kind: ResourceKind;
}

interface ProductRedactionInputs {
	readonly key: string;
	readonly entry: DeveloperProductEntry;
	readonly override: RedactedDeveloperProductOverride;
}

/**
 * Six-character lowercase hex digest of `SHA-256(key)`, used as the
 * disambiguating suffix on a redacted developer-product's default `name`.
 * Stable across config edits (driven only by the bedrock resource key, not
 * declaration order) and opaque to a Roblox player browsing the marketplace.
 * A natural collision is caught at plan time by `validatePlan`.
 *
 * @param key - Bedrock resource key for the developer product being redacted.
 * @returns The first six lowercase hex characters of the SHA-256 digest of `key`.
 */
export function redactedNameSuffix(key: string): string {
	return createHash("sha256").update(key).digest("hex").slice(0, 6);
}

/**
 * Default redacted name for a developer product with the given resource key.
 * Combines {@link REDACTED_PRODUCT_NAME} with {@link redactedNameSuffix} so
 * each redacted entry resolves to a unique value the upstream API will accept.
 *
 * @param key - Bedrock resource key for the developer product being redacted.
 * @returns The placeholder name pushed to Roblox for this product.
 */
export function defaultRedactedProductName(key: string): string {
	return `${REDACTED_PRODUCT_NAME} ${redactedNameSuffix(key)}`;
}

/**
 * Pure transform that substitutes bedrock-supplied placeholder content for
 * every resource whose effective `redacted` flag is truthy. The effective
 * flag is the per-resource `redacted` value when set, otherwise the
 * `environmentRedacted` fallback. A `redacted` object form replaces
 * matching fields with the supplied values and falls back to the bedrock
 * defaults for the rest. Runs between env-overlay merge and display-name
 * prefix render so the rest of the pipeline (flatten, normalize, diff,
 * apply) operates on already-redacted values and needs no special-case
 * redaction logic.
 *
 * @param config - Post-merge `ResolvedConfig` produced by `selectEnvironment`.
 * @param environmentRedacted - Environment-level redaction toggle. Resources
 *   that omit a per-resource `redacted` flag inherit this value.
 * @returns A `ResolvedConfig` whose redacted entries carry placeholder
 *   values; non-redacted entries pass through verbatim, and the input is
 *   not mutated.
 */
export function applyRedaction(
	config: ResolvedConfig,
	environmentRedacted = false,
): ResolvedConfig {
	const passes = redactPasses(config.passes, environmentRedacted);
	const places = redactPlaces(config.places, environmentRedacted);
	const products = redactProducts(config.products, environmentRedacted);

	if (passes === config.passes && places === config.places && products === config.products) {
		return config;
	}

	return {
		...config,
		...(passes === undefined ? {} : { passes }),
		...(places === undefined ? {} : { places }),
		...(products === undefined ? {} : { products }),
	};
}

/**
 * Inspect the pre-redaction merged config and produce one annotation per
 * resource flagged `redacted: true`. Callers thread the result into plan
 * output so authors can see which resources are redacted in the active
 * environment and whether their real-value edits are being suppressed.
 *
 * Operates on the pre-redaction view because the post-redaction config no
 * longer carries the real `name`/`description`/`icon` values needed to
 * detect divergence from the placeholder defaults.
 *
 * @param merged - `ResolvedConfig` produced by environment overlay merge,
 *   before `applyRedaction` has substituted placeholders.
 * @returns Zero or more annotations, one per redacted resource. Empty when
 *   the config declares no redacted resources.
 */
export function collectRedactionAnnotations(
	merged: ResolvedConfig,
): ReadonlyArray<RedactionAnnotation> {
	const passes = Object.entries(merged.passes ?? {})
		.filter(([, entry]) => entry.redacted === true)
		.map(([key, entry]): RedactionAnnotation => {
			return {
				key: asResourceKey(key),
				hasRealValueEdits: passHasRealValueEdits(entry),
				kind: "gamePass",
			};
		});
	const products = Object.entries(merged.products ?? {})
		.filter(([, entry]) => entry.redacted === true)
		.map(([key, entry]): RedactionAnnotation => {
			return {
				key: asResourceKey(key),
				hasRealValueEdits: productHasRealValueEdits(key, entry),
				kind: "developerProduct",
			};
		});

	return [...passes, ...products];
}

function redactPass(entry: GamePassEntry, override: RedactedGamePassOverride): GamePassEntry {
	return {
		...entry,
		name: override.name ?? REDACTED_PASS_NAME,
		description: override.description ?? REDACTED_DESCRIPTION,
		icon: override.icon ?? { "en-us": REDACTED_ICON_PATH },
		...(entry.price === undefined ? {} : { price: override.price ?? REDACTED_PRICE }),
	};
}

function redactPasses(
	passes: ResolvedConfig["passes"],
	environmentRedacted: boolean,
): ResolvedConfig["passes"] {
	if (passes === undefined) {
		return undefined;
	}

	const hasAnyRedaction = Object.values(passes).some(
		(entry) => (entry.redacted ?? environmentRedacted) !== false,
	);
	if (!hasAnyRedaction) {
		return passes;
	}

	return Object.fromEntries(
		Object.entries(passes).map(([key, entry]) => {
			const effective = entry.redacted ?? environmentRedacted;
			if (effective === false) {
				return [key, entry] as const;
			}

			const override: RedactedGamePassOverride =
				typeof effective === "object" ? effective : {};
			return [key, redactPass(entry, override)] as const;
		}),
	);
}

function redactPlace(
	entry: ResolvedPlaceEntry,
	override: RedactedPlaceOverride,
): ResolvedPlaceEntry {
	return {
		...entry,
		description: override.description ?? REDACTED_DESCRIPTION,
		displayName: override.displayName ?? entry.displayName,
	};
}

function redactPlaces(
	places: ResolvedConfig["places"],
	environmentRedacted: boolean,
): ResolvedConfig["places"] {
	if (places === undefined) {
		return undefined;
	}

	const hasAnyRedaction = Object.values(places).some(
		(entry) => (entry.redacted ?? environmentRedacted) !== false,
	);
	if (!hasAnyRedaction) {
		return places;
	}

	return Object.fromEntries(
		Object.entries(places).map(([key, entry]) => {
			const effective = entry.redacted ?? environmentRedacted;
			if (effective === false) {
				return [key, entry] as const;
			}

			const override: RedactedPlaceOverride = typeof effective === "object" ? effective : {};
			return [key, redactPlace(entry, override)] as const;
		}),
	);
}

function redactProduct(inputs: ProductRedactionInputs): DeveloperProductEntry {
	const { key, entry, override } = inputs;
	return {
		...entry,
		name: override.name ?? defaultRedactedProductName(key),
		description: override.description ?? REDACTED_DESCRIPTION,
		icon: override.icon ?? { "en-us": REDACTED_ICON_PATH },
		...(entry.price === undefined ? {} : { price: override.price ?? REDACTED_PRICE }),
	};
}

function redactProducts(
	products: ResolvedConfig["products"],
	environmentRedacted: boolean,
): ResolvedConfig["products"] {
	if (products === undefined) {
		return undefined;
	}

	const hasAnyRedaction = Object.values(products).some(
		(entry) => (entry.redacted ?? environmentRedacted) !== false,
	);
	if (!hasAnyRedaction) {
		return products;
	}

	return Object.fromEntries(
		Object.entries(products).map(([key, entry]) => {
			const effective = entry.redacted ?? environmentRedacted;
			if (effective === false) {
				return [key, entry] as const;
			}

			const override: RedactedDeveloperProductOverride =
				typeof effective === "object" ? effective : {};
			return [key, redactProduct({ key, entry, override })] as const;
		}),
	);
}

function passHasRealValueEdits(entry: GamePassEntry): boolean {
	return (
		entry.name !== REDACTED_PASS_NAME ||
		entry.description !== REDACTED_DESCRIPTION ||
		entry.icon["en-us"] !== REDACTED_ICON_PATH ||
		(entry.price !== undefined && entry.price !== REDACTED_PRICE)
	);
}

function productHasRealValueEdits(key: string, entry: DeveloperProductEntry): boolean {
	// A redacted product's `name` is a placeholder when it equals either the
	// suffixed default for this key (what `applyRedaction` synthesizes) or
	// the bare `REDACTED_PRODUCT_NAME` constant (what an author may have
	// hand-typed). Any other value, including `Hidden Product Deluxe` or a
	// suffix that doesn't match this key's hash, is treated as a real edit.
	const isPlaceholderName =
		entry.name === defaultRedactedProductName(key) || entry.name === REDACTED_PRODUCT_NAME;
	return (
		!isPlaceholderName ||
		entry.description !== REDACTED_DESCRIPTION ||
		(entry.icon !== undefined && entry.icon["en-us"] !== REDACTED_ICON_PATH) ||
		(entry.price !== undefined && entry.price !== REDACTED_PRICE)
	);
}
