import { parsePlaceResponse } from "#src/resources/places/parsers";
import { assert, describe, expect, it } from "vitest";

import { expectValid, getValidator, loadFixture } from "./_helpers.ts";

describe("places fixtures", () => {
	it("should validate update-response.json against Place", () => {
		expect.assertions(1);

		const validator = getValidator("Place");
		const body = loadFixture("places", "update-response.json");

		expectValid(validator, body);
	});

	describe(parsePlaceResponse, () => {
		it("should round-trip update-response.json into the public Place shape", () => {
			expect.assertions(1);

			const body = loadFixture("places", "update-response.json");

			const result = parsePlaceResponse({ body, headers: {}, status: 200 });

			assert(result.success);

			expect(result.data).toStrictEqual({
				id: "98765",
				createdAt: new Date("2023-06-10T09:15:42.000Z"),
				description: "Explore the realm with your friends.",
				displayName: "Legendary Adventure",
				root: true,
				serverSize: 50,
				universeId: "12345",
				universeRuntimeCreation: false,
				updatedAt: new Date("2024-11-02T17:08:21.500Z"),
			});
		});
	});
});
