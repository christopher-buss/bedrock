import { describe, expect, it } from "vitest";

import { derivePriceFields } from "./derive-price-fields.ts";

describe(derivePriceFields, () => {
	it("should return isForSale false when price is undefined", () => {
		expect.assertions(1);

		const result = derivePriceFields({ price: undefined });

		expect(result).toStrictEqual({ isForSale: false });
	});

	it("should return isForSale true with the price when price is a positive number", () => {
		expect.assertions(1);

		const result = derivePriceFields({ price: 250 });

		expect(result).toStrictEqual({ isForSale: true, price: 250 });
	});

	it("should treat price 0 as on-sale", () => {
		expect.assertions(1);

		const result = derivePriceFields({ price: 0 });

		expect(result).toStrictEqual({ isForSale: true, price: 0 });
	});

	it("should not include the price key when price is undefined", () => {
		expect.assertions(1);

		const result = derivePriceFields({ price: undefined });

		expect("price" in result).toBeFalse();
	});
});
