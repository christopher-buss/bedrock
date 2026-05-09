/**
 * Wire-shape pricing fragment produced by {@link derivePriceFields}: the
 * `isForSale` flag and an optional numeric `price`. Mirrors the multipart
 * fields the Open Cloud `developer-products` create and update endpoints
 * accept for setting Robux pricing.
 */
export interface PriceFields {
	/** Whether the developer product should be purchasable. */
	readonly isForSale: boolean;
	/** Default price in Robux; absent when the product is off-sale. */
	readonly price?: number;
}

/**
 * Translate a Mantle-style optional price into the Open Cloud wire shape.
 *
 * `desired.price === undefined` (no price declared) becomes
 * `{ isForSale: false }` and the `price` key is omitted entirely. A defined
 * price (including `0`) becomes `{ isForSale: true, price }`. Both
 * `developerProduct` create and update paths share this helper so the
 * "absent ⇒ off-sale" semantics live in exactly one place.
 *
 * @param desired - Object carrying the user-declared `price`.
 * @returns The wire-shape `{ isForSale, price? }` fragment.
 *
 * @example
 *
 * ```ts
 * import { derivePriceFields } from "@bedrock-rbx/core";
 *
 * expect(derivePriceFields({ price: undefined })).toStrictEqual({ isForSale: false });
 * expect(derivePriceFields({ price: 250 })).toStrictEqual({ isForSale: true, price: 250 });
 * ```
 */
export function derivePriceFields(desired: { readonly price: number | undefined }): PriceFields {
	if (desired.price === undefined) {
		return { isForSale: false };
	}

	return { isForSale: true, price: desired.price };
}
