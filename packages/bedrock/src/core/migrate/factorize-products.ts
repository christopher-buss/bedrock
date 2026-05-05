import type { DeveloperProductEntry, EnvironmentEntry } from "../schema.ts";
import type { EnvironmentFoldResult } from "./fold-environment.ts";

type ProductOverlayEntry = NonNullable<EnvironmentEntry["products"]>[string];

/**
 * Project the primary environment's folded products onto the bedrock root
 * `Config.products` block. Returns `undefined` when the primary has no
 * products so the caller omits the field entirely.
 *
 * @param primaryFold - The chosen primary environment's fold result.
 * @returns A keyed record of root product entries, or `undefined` when none
 *   are present.
 */
export function buildRootProducts(
	primaryFold: EnvironmentFoldResult,
): Record<string, DeveloperProductEntry> | undefined {
	if (primaryFold.products.length === 0) {
		return undefined;
	}

	return Object.fromEntries(primaryFold.products.map(({ key, entry }) => [key, entry]));
}

/**
 * Build the per-environment products overlay for one environment by diffing
 * each product against the matching primary product. Returns `undefined` when
 * no product diverges, so the caller omits the overlay.
 *
 * Products absent from the primary carry the full entry on the overlay.
 *
 * @param fold - The non-primary environment's fold result.
 * @param primary - The primary environment's fold result, or `undefined` when
 *   the caller is rendering the primary itself.
 * @returns A keyed record of divergent product fields, or `undefined` when no
 *   product diverges from the primary.
 */
export function buildProductsOverlay(
	fold: EnvironmentFoldResult,
	primary: EnvironmentFoldResult | undefined,
): Record<string, ProductOverlayEntry> | undefined {
	const primaryByKey = new Map<string, DeveloperProductEntry>(
		primary?.products.map(({ key, entry }) => [key, entry]),
	);
	const overlay: Record<string, ProductOverlayEntry> = {};
	for (const { key, entry } of fold.products) {
		const primaryEntry = primaryByKey.get(key);
		const productOverlay =
			primaryEntry === undefined
				? { ...entry }
				: buildProductOverlayEntry(entry, primaryEntry);
		if (productOverlay !== undefined) {
			overlay[key] = productOverlay;
		}
	}

	return Object.keys(overlay).length === 0 ? undefined : overlay;
}

function buildProductOverlayEntry(
	entry: DeveloperProductEntry,
	primary: DeveloperProductEntry,
): ProductOverlayEntry | undefined {
	const overlay: ProductOverlayEntry = {};
	if (!Object.is(primary.name, entry.name)) {
		overlay.name = entry.name;
	}

	if (!Object.is(primary.description, entry.description)) {
		overlay.description = entry.description;
	}

	if (!Object.is(primary.icon?.["en-us"], entry.icon?.["en-us"]) && entry.icon !== undefined) {
		overlay.icon = entry.icon;
	}

	if (!Object.is(primary.price, entry.price)) {
		overlay.price = entry.price;
	}

	if (!Object.is(primary.isRegionalPricingEnabled, entry.isRegionalPricingEnabled)) {
		overlay.isRegionalPricingEnabled = entry.isRegionalPricingEnabled;
	}

	if (!Object.is(primary.storePageEnabled, entry.storePageEnabled)) {
		overlay.storePageEnabled = entry.storePageEnabled;
	}

	return Object.keys(overlay).length === 0 ? undefined : overlay;
}
