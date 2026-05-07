import { assert, describe, expect, it } from "vitest";

import { buildUpdateRequest } from "./builders.ts";
import type { UpdateBadgeNameDescriptionParameters } from "./types.ts";

describe(buildUpdateRequest, () => {
	it("should use the PATCH method", () => {
		expect.assertions(1);

		const parameters = {
			name: "First Goal",
			badgeId: "12345",
			languageCode: "en_us",
		} satisfies UpdateBadgeNameDescriptionParameters;

		const request = buildUpdateRequest(parameters);

		expect(request.method).toBe("PATCH");
	});

	it("should interpolate badgeId and languageCode into the URL", () => {
		expect.assertions(1);

		const parameters = {
			name: "First Goal",
			badgeId: "12345",
			languageCode: "fr_fr",
		} satisfies UpdateBadgeNameDescriptionParameters;

		const request = buildUpdateRequest(parameters);

		expect(request.url).toBe(
			"/legacy-game-internationalization/v1/badges/12345/name-description/language-codes/fr_fr",
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
			"First Goal",
			"Awarded on first login.",
			{ name: "First Goal", description: "Awarded on first login." },
		],
		["First Goal", undefined, { name: "First Goal" }],
		[undefined, "Awarded on first login.", { description: "Awarded on first login." }],
		[undefined, undefined, {}],
	])(
		"should include name=%j description=%j in the JSON body",
		([name, description, expected]) => {
			expect.assertions(1);

			const parameters = {
				badgeId: "12345",
				languageCode: "en_us",
				...(name === undefined ? {} : { name }),
				...(description === undefined ? {} : { description }),
			} satisfies UpdateBadgeNameDescriptionParameters;

			const request = buildUpdateRequest(parameters);

			expect(request.body).toStrictEqual(expected);
		},
	);

	it("should produce a JSON-shaped body, not FormData", () => {
		expect.assertions(2);

		const parameters = {
			name: "First Goal",
			badgeId: "12345",
			languageCode: "en_us",
		} satisfies UpdateBadgeNameDescriptionParameters;

		const request = buildUpdateRequest(parameters);

		assert(typeof request.body === "object");

		expect(request.body).not.toBeInstanceOf(FormData);
		expect(request.body).toStrictEqual({ name: "First Goal" });
	});
});
