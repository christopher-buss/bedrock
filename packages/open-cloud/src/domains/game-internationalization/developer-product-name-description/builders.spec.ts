import { assert, describe, expect, it } from "vitest";

import { buildUpdateRequest } from "./builders.ts";
import type { UpdateDeveloperProductNameDescriptionParameters } from "./types.ts";

describe(buildUpdateRequest, () => {
	it("should use the PATCH method", () => {
		expect.assertions(1);

		const parameters = {
			name: "Gem Pack",
			languageCode: "en-us",
			productId: "12345",
		} satisfies UpdateDeveloperProductNameDescriptionParameters;

		const request = buildUpdateRequest(parameters);

		expect(request.method).toBe("PATCH");
	});

	it("should interpolate productId and languageCode into the URL", () => {
		expect.assertions(1);

		const parameters = {
			name: "Gold Coin",
			languageCode: "fr-fr",
			productId: "12345",
		} satisfies UpdateDeveloperProductNameDescriptionParameters;

		const request = buildUpdateRequest(parameters);

		expect(request.url).toBe(
			"/legacy-game-internationalization/v1/developer-products/12345/name-description/language-codes/fr-fr",
		);
	});

	it.for<
		[
			name: string | undefined,
			description: string | undefined,
			expected: Record<string, string>,
		]
	>([
		["Gem Pack", "Premium gems", { name: "Gem Pack", description: "Premium gems" }],
		["Gem Pack", undefined, { name: "Gem Pack" }],
		[undefined, "Premium gems", { description: "Premium gems" }],
		[undefined, undefined, {}],
	])(
		"should include name=%j description=%j in the JSON body",
		([name, description, expected]) => {
			expect.assertions(1);

			const parameters = {
				languageCode: "en-us",
				productId: "12345",
				...(name === undefined ? {} : { name }),
				...(description === undefined ? {} : { description }),
			} satisfies UpdateDeveloperProductNameDescriptionParameters;

			const request = buildUpdateRequest(parameters);

			expect(request.body).toStrictEqual(expected);
		},
	);

	it("should produce a JSON-shaped body, not FormData", () => {
		expect.assertions(2);

		const parameters = {
			name: "Gem Pack",
			languageCode: "en-us",
			productId: "12345",
		} satisfies UpdateDeveloperProductNameDescriptionParameters;

		const request = buildUpdateRequest(parameters);

		assert(typeof request.body === "object");

		expect(request.body).not.toBeInstanceOf(FormData);
		expect(request.body).toStrictEqual({ name: "Gem Pack" });
	});
});
