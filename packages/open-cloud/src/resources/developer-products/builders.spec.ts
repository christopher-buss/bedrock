import { assert, describe, expect, it } from "vitest";

import { buildCreateRequest, buildGetRequest } from "./builders.ts";
import type { CreateDeveloperProductParameters, GetDeveloperProductParameters } from "./types.ts";

describe(buildGetRequest, () => {
	it("should use the GET method", () => {
		expect.assertions(1);

		const parameters = {
			productId: "12345",
			universeId: "67890",
		} satisfies GetDeveloperProductParameters;

		const request = buildGetRequest(parameters);

		expect(request.method).toBe("GET");
	});

	it("should interpolate universeId and productId into the creator URL", () => {
		expect.assertions(1);

		const parameters = {
			productId: "12345",
			universeId: "67890",
		} satisfies GetDeveloperProductParameters;

		const request = buildGetRequest(parameters);

		expect(request.url).toBe(
			"/developer-products/v2/universes/67890/developer-products/12345/creator",
		);
	});

	it("should not set a body", () => {
		expect.assertions(1);

		const parameters = {
			productId: "12345",
			universeId: "67890",
		} satisfies GetDeveloperProductParameters;

		const request = buildGetRequest(parameters);

		expect(request.body).toBeUndefined();
	});
});

describe(buildCreateRequest, () => {
	it("should use the POST method", () => {
		expect.assertions(1);

		const parameters = {
			name: "Gem Pack",
			universeId: "67890",
		} satisfies CreateDeveloperProductParameters;

		const request = buildCreateRequest(parameters);

		expect(request.method).toBe("POST");
	});

	it("should interpolate universeId into the create URL", () => {
		expect.assertions(1);

		const parameters = {
			name: "Gem Pack",
			universeId: "67890",
		} satisfies CreateDeveloperProductParameters;

		const request = buildCreateRequest(parameters);

		expect(request.url).toBe("/developer-products/v2/universes/67890/developer-products");
	});

	it("should append name to a FormData body", () => {
		expect.assertions(1);

		const parameters = {
			name: "Gem Pack",
			universeId: "67890",
		} satisfies CreateDeveloperProductParameters;

		const request = buildCreateRequest(parameters);

		assert(request.body instanceof FormData);

		expect(request.body.get("name")).toBe("Gem Pack");
	});

	it("should append description when provided", () => {
		expect.assertions(1);

		const parameters = {
			name: "Gem Pack",
			description: "A premium gem pack",
			universeId: "67890",
		} satisfies CreateDeveloperProductParameters;

		const request = buildCreateRequest(parameters);

		assert(request.body instanceof FormData);

		expect(request.body.get("description")).toBe("A premium gem pack");
	});

	it("should omit description when not provided", () => {
		expect.assertions(1);

		const parameters = {
			name: "Gem Pack",
			universeId: "67890",
		} satisfies CreateDeveloperProductParameters;

		const request = buildCreateRequest(parameters);

		assert(request.body instanceof FormData);

		expect(request.body.has("description")).toBeFalse();
	});

	it.for<[isForSale: boolean, expected: string]>([
		[true, "true"],
		[false, "false"],
	])("should stringify isForSale=%s into the form body as %j", ([isForSale, expected]) => {
		expect.assertions(1);

		const parameters = {
			name: "Gem Pack",
			isForSale,
			universeId: "67890",
		} satisfies CreateDeveloperProductParameters;

		const request = buildCreateRequest(parameters);

		assert(request.body instanceof FormData);

		expect(request.body.get("isForSale")).toBe(expected);
	});

	it("should omit isForSale when not provided", () => {
		expect.assertions(1);

		const parameters = {
			name: "Gem Pack",
			universeId: "67890",
		} satisfies CreateDeveloperProductParameters;

		const request = buildCreateRequest(parameters);

		assert(request.body instanceof FormData);

		expect(request.body.has("isForSale")).toBeFalse();
	});

	it("should stringify price into the form body when provided", () => {
		expect.assertions(1);

		const parameters = {
			name: "Gem Pack",
			price: 100,
			universeId: "67890",
		} satisfies CreateDeveloperProductParameters;

		const request = buildCreateRequest(parameters);

		assert(request.body instanceof FormData);

		expect(request.body.get("price")).toBe("100");
	});

	it("should omit price when not provided", () => {
		expect.assertions(1);

		const parameters = {
			name: "Gem Pack",
			universeId: "67890",
		} satisfies CreateDeveloperProductParameters;

		const request = buildCreateRequest(parameters);

		assert(request.body instanceof FormData);

		expect(request.body.has("price")).toBeFalse();
	});

	it("should stringify isRegionalPricingEnabled when provided", () => {
		expect.assertions(1);

		const parameters = {
			name: "Gem Pack",
			isRegionalPricingEnabled: true,
			universeId: "67890",
		} satisfies CreateDeveloperProductParameters;

		const request = buildCreateRequest(parameters);

		assert(request.body instanceof FormData);

		expect(request.body.get("isRegionalPricingEnabled")).toBe("true");
	});

	it("should omit isRegionalPricingEnabled when not provided", () => {
		expect.assertions(1);

		const parameters = {
			name: "Gem Pack",
			universeId: "67890",
		} satisfies CreateDeveloperProductParameters;

		const request = buildCreateRequest(parameters);

		assert(request.body instanceof FormData);

		expect(request.body.has("isRegionalPricingEnabled")).toBeFalse();
	});

	it("should wrap a Uint8Array imageFile into a Blob preserving its bytes", () => {
		expect.assertions(2);

		const imageFile = new Uint8Array([1, 2, 3, 4]);
		const parameters = {
			name: "Gem Pack",
			imageFile,
			universeId: "67890",
		} satisfies CreateDeveloperProductParameters;

		const request = buildCreateRequest(parameters);

		assert(request.body instanceof FormData);
		const appended = request.body.get("imageFile");
		assert(appended instanceof Blob);

		expect(appended).toBeInstanceOf(Blob);
		expect(appended.size).toBe(imageFile.byteLength);
	});

	it("should preserve the MIME type of a Blob imageFile", () => {
		expect.assertions(2);

		const imageFile = new Blob([new Uint8Array([1, 2, 3, 4])], {
			type: "image/png",
		});
		const parameters = {
			name: "Gem Pack",
			imageFile,
			universeId: "67890",
		} satisfies CreateDeveloperProductParameters;

		const request = buildCreateRequest(parameters);

		assert(request.body instanceof FormData);
		const appended = request.body.get("imageFile");
		assert(appended instanceof Blob);

		expect(appended).toBeInstanceOf(Blob);
		expect(appended.type).toBe("image/png");
	});

	it("should omit imageFile when not provided", () => {
		expect.assertions(1);

		const parameters = {
			name: "Gem Pack",
			universeId: "67890",
		} satisfies CreateDeveloperProductParameters;

		const request = buildCreateRequest(parameters);

		assert(request.body instanceof FormData);

		expect(request.body.has("imageFile")).toBeFalse();
	});
});
