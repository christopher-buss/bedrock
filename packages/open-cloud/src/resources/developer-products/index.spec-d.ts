import { describe, expectTypeOf, it } from "vitest";

import type { OpenCloudError } from "../../errors/base.ts";
import type { Result } from "../../types.ts";
import type {
	DeveloperProduct,
	DeveloperProductsClient,
	UpdateDeveloperProductParameters,
} from "./index.ts";

describe("UpdateDeveloperProductParameters", () => {
	it("should require productId and universeId", () => {
		expectTypeOf<UpdateDeveloperProductParameters>().toExtend<{
			productId: string;
			universeId: string;
		}>();
	});

	it("should accept identifiers without any optional fields", () => {
		const parameters: UpdateDeveloperProductParameters = {
			productId: "12345",
			universeId: "999",
		};

		expectTypeOf(parameters).toExtend<UpdateDeveloperProductParameters>();
	});

	it("should accept every wire field as optional", () => {
		const parameters: UpdateDeveloperProductParameters = {
			name: "Gem Pack",
			description: "Premium gems",
			isForSale: true,
			isRegionalPricingEnabled: false,
			price: 250,
			productId: "12345",
			storePageEnabled: true,
			universeId: "999",
		};

		expectTypeOf(parameters).toExtend<UpdateDeveloperProductParameters>();
	});
});

describe("DeveloperProduct", () => {
	it("should have an id and a name", () => {
		expectTypeOf<DeveloperProduct>().toExtend<{ id: string; name: string }>();
	});
});

describe("DeveloperProductsClient", () => {
	it("should resolve update() to Result<undefined, OpenCloudError>", () => {
		expectTypeOf<DeveloperProductsClient["update"]>().returns.resolves.toEqualTypeOf<
			Result<undefined, OpenCloudError>
		>();
	});
});
