import { assert, describe, expect, it } from "vitest";

import { buildUpdateRequest } from "./builders.ts";
import type { UpdateGamePassNameDescriptionParameters } from "./types.ts";

describe(buildUpdateRequest, () => {
	it("should use the PATCH method", () => {
		expect.assertions(1);

		const parameters = {
			name: "Epic Pass",
			gamePassId: "12345",
			languageCode: "en-us",
		} satisfies UpdateGamePassNameDescriptionParameters;

		const request = buildUpdateRequest(parameters);

		expect(request.method).toBe("PATCH");
	});

	it("should interpolate gamePassId and languageCode into the URL", () => {
		expect.assertions(1);

		const parameters = {
			name: "Epic Pass FR",
			gamePassId: "12345",
			languageCode: "fr-fr",
		} satisfies UpdateGamePassNameDescriptionParameters;

		const request = buildUpdateRequest(parameters);

		expect(request.url).toBe(
			"/legacy-game-internationalization/v1/game-passes/12345/name-description/language-codes/fr-fr",
		);
	});

	it.for<
		[
			name: string | undefined,
			description: string | undefined,
			expected: Record<string, string>,
		]
	>([
		[
			"Epic Pass",
			"Unlocks epic stuff",
			{ name: "Epic Pass", description: "Unlocks epic stuff" },
		],
		["Epic Pass", undefined, { name: "Epic Pass" }],
		[undefined, "Unlocks epic stuff", { description: "Unlocks epic stuff" }],
		[undefined, undefined, {}],
	])(
		"should include name=%j description=%j in the JSON body",
		([name, description, expected]) => {
			expect.assertions(1);

			const parameters = {
				gamePassId: "12345",
				languageCode: "en-us",
				...(name === undefined ? {} : { name }),
				...(description === undefined ? {} : { description }),
			} satisfies UpdateGamePassNameDescriptionParameters;

			const request = buildUpdateRequest(parameters);

			expect(request.body).toStrictEqual(expected);
		},
	);

	it("should produce a JSON-shaped body, not FormData", () => {
		expect.assertions(2);

		const parameters = {
			name: "Epic Pass",
			gamePassId: "12345",
			languageCode: "en-us",
		} satisfies UpdateGamePassNameDescriptionParameters;

		const request = buildUpdateRequest(parameters);

		assert(typeof request.body === "object");

		expect(request.body).not.toBeInstanceOf(FormData);
		expect(request.body).toStrictEqual({ name: "Epic Pass" });
	});
});
