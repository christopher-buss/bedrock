import { describe, expectTypeOf, it } from "vitest";

import type {
	CreateDeveloperProductParameters,
	UpdateDeveloperProductParameters,
} from "#src/domains/developer-products/products/types";
import { listDeprecatedMultipartFields, listMultipartProperties } from "./_helpers.ts";

// Create and update currently expose the same body fields. Both type pins
// ensure a new parameter on either operation must be covered by this guard.
const DEVELOPER_PRODUCT_KEYS = [
	"description",
	"imageFile",
	"isForSale",
	"isManagedPricingEnabled",
	"name",
	"price",
] as const;

type DeveloperProductKey = (typeof DEVELOPER_PRODUCT_KEYS)[number];

expectTypeOf<DeveloperProductKey>().toEqualTypeOf<
	Exclude<keyof CreateDeveloperProductParameters, "universeId">
>();
expectTypeOf<DeveloperProductKey>().toEqualTypeOf<
	Exclude<keyof UpdateDeveloperProductParameters, "productId" | "universeId">
>();

describe.for([
	{
		method: "post",
		route: "/developer-products/v2/universes/{universeId}/developer-products",
	},
	{
		method: "patch",
		route: "/developer-products/v2/universes/{universeId}/developer-products/{productId}",
	},
] as const)("developer-product $method multipart pin", ({ method, route }) => {
	it.for(DEVELOPER_PRODUCT_KEYS)(
		"should expose %s as a declared non-deprecated multipart property",
		(key, { expect }) => {
			expect.assertions(2);

			expect(listMultipartProperties(route, method)).toContain(key);
			expect(listDeprecatedMultipartFields(route, method)).not.toContain(key);
		},
	);
});
