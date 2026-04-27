import { isRecord } from "./utils/is-record.ts";

/**
 * Wire shape shared by every Roblox commerce resource that carries a
 * `priceInformation` block (game passes, developer products, ...). Resources
 * vary in the literal set their `enabledFeatures` may contain, so the feature
 * type is left as a parameter `F`.
 *
 * @template F - The string-literal union for this resource's pricing-feature flags.
 */
export interface PriceInformationLike<F extends string> {
	/** Default Robux price; `undefined` when the schema returns null. */
	readonly defaultPriceInRobux: number | undefined;
	/** Enabled pricing feature flags, in the order returned by the API. */
	readonly enabledFeatures: ReadonlyArray<F>;
}

/**
 * Narrows `value` to {@link PriceInformationLike} for a given feature literal
 * union by delegating per-element validation to the supplied `isFeature`
 * predicate.
 *
 * @template F - The pricing-feature literal union the caller wants to narrow to.
 * @param value - Unknown wire value to validate.
 * @param isFeature - Type guard for a single `enabledFeatures` element.
 * @returns `true` when `value` is a record whose `defaultPriceInRobux` is a
 *   number, `null`, or absent and whose `enabledFeatures` is an array of
 *   values that all satisfy `isFeature`.
 */
export function isPriceInformationLike<F extends string>(
	value: unknown,
	isFeature: (candidate: unknown) => candidate is F,
): value is PriceInformationLike<F> {
	if (!isRecord(value)) {
		return false;
	}

	const defaultPrice = value["defaultPriceInRobux"] ?? undefined;
	if (defaultPrice !== undefined && typeof defaultPrice !== "number") {
		return false;
	}

	const features = value["enabledFeatures"];
	if (!Array.isArray(features)) {
		return false;
	}

	for (const feature of features) {
		if (!isFeature(feature)) {
			return false;
		}
	}

	return true;
}

/**
 * Returns a fresh {@link PriceInformationLike} value with a new
 * `enabledFeatures` array, so the caller can hand the result on without
 * exposing the wire object's internal storage.
 *
 * @template F - The pricing-feature literal union of the input.
 * @param wire - Already-validated wire shape.
 * @returns A new record with the same defaults and a copied feature array.
 */
export function copyPriceInformation<F extends string>(
	wire: PriceInformationLike<F>,
): PriceInformationLike<F> {
	return {
		defaultPriceInRobux: wire.defaultPriceInRobux ?? undefined,
		enabledFeatures: [...wire.enabledFeatures],
	};
}
