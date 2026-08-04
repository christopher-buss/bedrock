import { assert, describe, expect, it } from "vitest";

import { buildUpdateRequest } from "./builders.ts";
import type { UpdateDeveloperProductNameDescriptionParameters } from "./types.ts";

describe(buildUpdateRequest, () => {
	it("should use the PATCH method", () => {
		expect.assertions(1);

		const parameters = {
			name: "Gem Pack",
			languageCode: "en_us",
			productId: "12345",
		} satisfies UpdateDeveloperProductNameDescriptionParameters;

		const request = buildUpdateRequest(parameters);

		expect(request.method).toBe("PATCH");
	});

	it("should interpolate productId and languageCode into the URL", () => {
		expect.assertions(1);

		const parameters = {
			name: "Gold Coin",
			languageCode: "fr_fr",
			productId: "12345",
		} satisfies UpdateDeveloperProductNameDescriptionParameters;

		const request = buildUpdateRequest(parameters);

		expect(request.url).toBe(
			"/legacy-game-internationalization/v1/developer-products/12345/name-description/language-codes/fr_fr",
		);
	});

	it.for<
		[
			caseName: string,
			fields: Partial<
				Pick<UpdateDeveloperProductNameDescriptionParameters, "description" | "name">
			>,
		]
	>([
		["both name and description", { name: "Gem Pack", description: "Premium gems" }],
		["only a name", { name: "Gem Pack" }],
		["only a description", { description: "Premium gems" }],
		["neither field", {}],
	])("should include %s in the JSON body", ([, fields]) => {
		expect.assertions(1);

		const parameters = {
			languageCode: "en_us",
			productId: "12345",
			...fields,
		} satisfies UpdateDeveloperProductNameDescriptionParameters;

		const request = buildUpdateRequest(parameters);

		expect(request.body).toStrictEqual(fields);
	});

	it("should produce a JSON-shaped body, not FormData", () => {
		expect.assertions(2);

		const parameters = {
			name: "Gem Pack",
			languageCode: "en_us",
			productId: "12345",
		} satisfies UpdateDeveloperProductNameDescriptionParameters;

		const request = buildUpdateRequest(parameters);

		assert(typeof request.body === "object");

		expect(request.body).not.toBeInstanceOf(FormData);
		expect(request.body).toStrictEqual({ name: "Gem Pack" });
	});
});
