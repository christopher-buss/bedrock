import type { DeveloperProductEntry, EnvironmentEntry } from "../schema.ts";
import type { EnvironmentFoldResult } from "./fold-environment.ts";
import type { ProductFoldEntry } from "./fold-products.ts";

type ProductOverlayEntry = NonNullable<EnvironmentEntry["products"]>[string];

type OptionalProductField = "icon" | "isRegionalPricingEnabled" | "price" | "storePageEnabled";

interface ConsensusInputs<F extends OptionalProductField> {
	readonly field: F;
	readonly folds: ReadonlyArray<EnvironmentFoldResult>;
	readonly productKey: string;
}

interface FieldEqualInputs {
	readonly field: OptionalProductField;
	readonly left: DeveloperProductEntry[OptionalProductField];
	readonly right: DeveloperProductEntry[OptionalProductField];
}

/**
 * Project the per-environment product folds into bedrock's root `products`
 * block, giving each optional field (`icon`, `price`, `isRegionalPricingEnabled`,
 * `storePageEnabled`) a value only when every environment that owns the
 * product key agrees. Required fields (`name`, `description`) fall back to
 * the primary's values; divergence on those surfaces in each environment's
 * overlay. Optional fields that diverge stay off root so an environment that
 * omits an optional field does not silently inherit the primary's value
 * through defu's "undefined treated as empty" merge.
 *
 * @param folds - Per-environment fold results, keyed by environment name.
 * @param primaryFold - The chosen primary environment's fold; supplies the
 *   product key list and the `name` / `description` fallbacks.
 * @returns The root `products` block, or `undefined` when the primary has
 *   no product folds.
 */
export function buildRootProducts(
	folds: ReadonlyMap<string, EnvironmentFoldResult>,
	primaryFold: EnvironmentFoldResult,
): Record<string, DeveloperProductEntry> | undefined {
	if (primaryFold.products.length === 0) {
		return undefined;
	}

	const folded = [...folds.values()];
	return Object.fromEntries(
		primaryFold.products.map(({ key, entry }) => [
			key,
			buildRootProductEntry(entry, { folds: folded, productKey: key }),
		]),
	);
}

/**
 * Build the per-environment overlay for `products`, carrying each field only
 * when the environment's value diverges from the resolved root entry. Fields
 * the environment omits are absent from the overlay so the consumer's defu
 * merge resolves them to the root's (also absent) value rather than
 * inheriting a primary value the environment never had.
 *
 * @param fold - The per-environment fold whose products are being overlaid.
 * @param rootProducts - The already-built root `products` block; per-product
 *   field values from this map suppress overlay entries that match.
 * @returns The overlay `products` block, or `undefined` when no product
 *   diverges from the root.
 */
export function buildProductsOverlay(
	fold: EnvironmentFoldResult,
	rootProducts: Record<string, DeveloperProductEntry> | undefined,
): Record<string, ProductOverlayEntry> | undefined {
	const overlay: Record<string, ProductOverlayEntry> = {};
	for (const { key, entry } of fold.products) {
		const productOverlay = buildProductOverlayEntry(entry, rootProducts?.[key]);
		if (Object.keys(productOverlay).length > 0) {
			overlay[key] = productOverlay;
		}
	}

	return Object.keys(overlay).length === 0 ? undefined : overlay;
}

function entryForKey(
	fold: EnvironmentFoldResult,
	productKey: string,
): DeveloperProductEntry | undefined {
	return fold.products.find(({ key }) => key === productKey)?.entry;
}

function asIcon(
	value: DeveloperProductEntry[OptionalProductField],
): Record<"en-us", string> | undefined {
	return typeof value === "object" ? value : undefined;
}

function optionalFieldEqual(inputs: FieldEqualInputs): boolean {
	if (inputs.field === "icon") {
		return Object.is(asIcon(inputs.left)?.["en-us"], asIcon(inputs.right)?.["en-us"]);
	}

	return Object.is(inputs.left, inputs.right);
}

function productOptionalFieldConsensus<F extends OptionalProductField>(
	inputs: ConsensusInputs<F>,
): DeveloperProductEntry[F] | undefined {
	const values = inputs.folds.flatMap((fold): ReadonlyArray<DeveloperProductEntry[F]> => {
		const entry = entryForKey(fold, inputs.productKey);
		return entry === undefined ? [] : [entry[inputs.field]];
	});

	const [first] = values;
	return values.every((value) => {
		return optionalFieldEqual({ field: inputs.field, left: first, right: value });
	})
		? first
		: undefined;
}

function buildRootProductEntry(
	primaryEntry: ProductFoldEntry["entry"],
	consensusBase: {
		readonly folds: ReadonlyArray<EnvironmentFoldResult>;
		readonly productKey: string;
	},
): DeveloperProductEntry {
	const icon = productOptionalFieldConsensus({ ...consensusBase, field: "icon" });
	const isRegionalPricingEnabled = productOptionalFieldConsensus({
		...consensusBase,
		field: "isRegionalPricingEnabled",
	});
	const price = productOptionalFieldConsensus({ ...consensusBase, field: "price" });
	const isStorePageEnabled = productOptionalFieldConsensus({
		...consensusBase,
		field: "storePageEnabled",
	});

	return {
		name: primaryEntry.name,
		description: primaryEntry.description,
		...(icon !== undefined && { icon }),
		...(isRegionalPricingEnabled !== undefined && { isRegionalPricingEnabled }),
		...(price !== undefined && { price }),
		...(isStorePageEnabled !== undefined && { storePageEnabled: isStorePageEnabled }),
	};
}

function buildProductOverlayEntry(
	entry: ProductFoldEntry["entry"],
	rootEntry: DeveloperProductEntry | undefined,
): ProductOverlayEntry {
	return {
		...(entry.name !== rootEntry?.name && { name: entry.name }),
		...(entry.description !== rootEntry?.description && { description: entry.description }),
		...(!Object.is(rootEntry?.icon?.["en-us"], entry.icon?.["en-us"]) && { icon: entry.icon }),
		...(!Object.is(rootEntry?.price, entry.price) && { price: entry.price }),
		...(!Object.is(rootEntry?.isRegionalPricingEnabled, entry.isRegionalPricingEnabled) && {
			isRegionalPricingEnabled: entry.isRegionalPricingEnabled,
		}),
		...(!Object.is(rootEntry?.storePageEnabled, entry.storePageEnabled) && {
			storePageEnabled: entry.storePageEnabled,
		}),
	};
}
