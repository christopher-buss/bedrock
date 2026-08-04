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
			caseName: string,
			fields: Partial<Pick<UpdateBadgeNameDescriptionParameters, "description" | "name">>,
		]
	>([
		[
			"both name and description",
			{ name: "First Goal", description: "Awarded on first login." },
		],
		["only a name", { name: "First Goal" }],
		["only a description", { description: "Awarded on first login." }],
		["neither field", {}],
	])("should include %s in the JSON body", ([, fields]) => {
		expect.assertions(1);

		const parameters = {
			badgeId: "12345",
			languageCode: "en_us",
			...fields,
		} satisfies UpdateBadgeNameDescriptionParameters;

		const request = buildUpdateRequest(parameters);

		expect(request.body).toStrictEqual(fields);
	});

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
