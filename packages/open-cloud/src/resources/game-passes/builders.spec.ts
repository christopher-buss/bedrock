import { assert, describe, expect, it } from "vitest";

import { buildCreateRequest, buildGetRequest } from "./builders.ts";
import type { CreateGamePassParameters, GetGamePassParameters } from "./types.ts";

describe(buildGetRequest, () => {
	it("should use the GET method", () => {
		expect.assertions(1);

		const params = {
			gamePassId: "12345",
			universeId: "67890",
		} satisfies GetGamePassParameters;

		const request = buildGetRequest(params);

		expect(request.method).toBe("GET");
	});

	it("should interpolate universeId and gamePassId into the creator URL", () => {
		expect.assertions(1);

		const params = {
			gamePassId: "12345",
			universeId: "67890",
		} satisfies GetGamePassParameters;

		const request = buildGetRequest(params);

		expect(request.url).toBe(
			"/game-passes/v1/universes/67890/game-passes/12345/creator",
		);
	});

	it("should not set a body", () => {
		expect.assertions(1);

		const params = {
			gamePassId: "12345",
			universeId: "67890",
		} satisfies GetGamePassParameters;

		const request = buildGetRequest(params);

		expect(request.body).toBeUndefined();
	});
});

describe(buildCreateRequest, () => {
	it("should use the POST method", () => {
		expect.assertions(1);

		const params = {
			name: "Epic Pass",
			universeId: "67890",
		} satisfies CreateGamePassParameters;

		const request = buildCreateRequest(params);

		expect(request.method).toBe("POST");
	});

	it("should interpolate universeId into the create URL", () => {
		expect.assertions(1);

		const params = {
			name: "Epic Pass",
			universeId: "67890",
		} satisfies CreateGamePassParameters;

		const request = buildCreateRequest(params);

		expect(request.url).toBe("/game-passes/v1/universes/67890/game-passes");
	});

	it("should append name to a FormData body", () => {
		expect.assertions(1);

		const params = {
			name: "Epic Pass",
			universeId: "67890",
		} satisfies CreateGamePassParameters;

		const request = buildCreateRequest(params);

		assert(request.body instanceof FormData);
		expect(request.body.get("name")).toBe("Epic Pass");
	});

	it("should append description when provided", () => {
		expect.assertions(1);

		const params = {
			description: "Unlocks epic stuff",
			name: "Epic Pass",
			universeId: "67890",
		} satisfies CreateGamePassParameters;

		const request = buildCreateRequest(params);

		assert(request.body instanceof FormData);
		expect(request.body.get("description")).toBe("Unlocks epic stuff");
	});

	it("should omit description when not provided", () => {
		expect.assertions(1);

		const params = {
			name: "Epic Pass",
			universeId: "67890",
		} satisfies CreateGamePassParameters;

		const request = buildCreateRequest(params);

		assert(request.body instanceof FormData);
		expect(request.body.has("description")).toBeFalse();
	});

	it.for<[isForSale: boolean, expected: string]>([
		[true, "true"],
		[false, "false"],
	])(
		"should stringify isForSale=%s into the form body as %j",
		([isForSale, expected]) => {
			expect.assertions(1);

			const params = {
				isForSale,
				name: "Epic Pass",
				universeId: "67890",
			} satisfies CreateGamePassParameters;

			const request = buildCreateRequest(params);

			assert(request.body instanceof FormData);
			expect(request.body.get("isForSale")).toBe(expected);
		},
	);

	it("should omit isForSale when not provided", () => {
		expect.assertions(1);

		const params = {
			name: "Epic Pass",
			universeId: "67890",
		} satisfies CreateGamePassParameters;

		const request = buildCreateRequest(params);

		assert(request.body instanceof FormData);
		expect(request.body.has("isForSale")).toBeFalse();
	});

	it("should stringify price into the form body when provided", () => {
		expect.assertions(1);

		const params = {
			name: "Epic Pass",
			price: 100,
			universeId: "67890",
		} satisfies CreateGamePassParameters;

		const request = buildCreateRequest(params);

		assert(request.body instanceof FormData);
		expect(request.body.get("price")).toBe("100");
	});

	it("should omit price when not provided", () => {
		expect.assertions(1);

		const params = {
			name: "Epic Pass",
			universeId: "67890",
		} satisfies CreateGamePassParameters;

		const request = buildCreateRequest(params);

		assert(request.body instanceof FormData);
		expect(request.body.has("price")).toBeFalse();
	});

	it("should stringify isRegionalPricingEnabled when provided", () => {
		expect.assertions(1);

		const params = {
			isRegionalPricingEnabled: true,
			name: "Epic Pass",
			universeId: "67890",
		} satisfies CreateGamePassParameters;

		const request = buildCreateRequest(params);

		assert(request.body instanceof FormData);
		expect(request.body.get("isRegionalPricingEnabled")).toBe("true");
	});

	it("should omit isRegionalPricingEnabled when not provided", () => {
		expect.assertions(1);

		const params = {
			name: "Epic Pass",
			universeId: "67890",
		} satisfies CreateGamePassParameters;

		const request = buildCreateRequest(params);

		assert(request.body instanceof FormData);
		expect(request.body.has("isRegionalPricingEnabled")).toBeFalse();
	});
});
