import { describe, expectTypeOf, it } from "vitest";

import type { OpenCloudError } from "../../errors/base.ts";
import type { Result } from "../../types.ts";
import type {
	DeveloperProduct,
	DeveloperProductsClient,
	UpdateDeveloperProductNameDescriptionParameters,
	UpdateDeveloperProductParameters,
	UploadDeveloperProductIconParameters,
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

describe("UpdateDeveloperProductNameDescriptionParameters", () => {
	it("should require productId and languageCode", () => {
		expectTypeOf<UpdateDeveloperProductNameDescriptionParameters>().toExtend<{
			languageCode: string;
			productId: string;
		}>();
	});

	it("should accept identifiers without name or description", () => {
		const parameters: UpdateDeveloperProductNameDescriptionParameters = {
			languageCode: "fr_fr",
			productId: "12345",
		};

		expectTypeOf(parameters).toExtend<UpdateDeveloperProductNameDescriptionParameters>();
	});

	it("should accept name and description as optional fields", () => {
		const parameters: UpdateDeveloperProductNameDescriptionParameters = {
			name: "Gem Pack",
			description: "Premium gems",
			languageCode: "fr_fr",
			productId: "12345",
		};

		expectTypeOf(parameters).toExtend<UpdateDeveloperProductNameDescriptionParameters>();
	});
});

describe("UploadDeveloperProductIconParameters", () => {
	it("should require productId, languageCode, and image", () => {
		expectTypeOf<UploadDeveloperProductIconParameters>().toExtend<{
			image: Blob | Uint8Array;
			languageCode: string;
			productId: string;
		}>();
	});
});

describe("DeveloperProductsClient", () => {
	it("should resolve update() to Result<undefined, OpenCloudError>", () => {
		expectTypeOf<DeveloperProductsClient["update"]>().returns.resolves.toEqualTypeOf<
			Result<undefined, OpenCloudError>
		>();
	});

	it("should resolve localization.updateNameDescription() to Result<undefined, OpenCloudError>", () => {
		expectTypeOf<
			DeveloperProductsClient["localization"]["updateNameDescription"]
		>().returns.resolves.toEqualTypeOf<Result<undefined, OpenCloudError>>();
	});

	it("should resolve localization.uploadIcon() to Result<undefined, OpenCloudError>", () => {
		expectTypeOf<
			DeveloperProductsClient["localization"]["uploadIcon"]
		>().returns.resolves.toEqualTypeOf<Result<undefined, OpenCloudError>>();
	});
});
