import { assert, describe, expect, it } from "vitest";

import { ValidationError } from "../../errors/validation.ts";
import { parsePositiveIntegerIds } from "./positive-integer-id.ts";

const FIELD = { code: "invalid_place_id", field: "placeIds" } as const;

describe(parsePositiveIntegerIds, () => {
	it("should return every ID as a number, in order", () => {
		expect.assertions(1);

		expect(parsePositiveIntegerIds(["15098004467", "1"], FIELD)).toStrictEqual({
			data: [15_098_004_467, 1],
			success: true,
		});
	});

	it("should return an empty list for no IDs", () => {
		expect.assertions(1);

		expect(parsePositiveIntegerIds([], FIELD)).toStrictEqual({ data: [], success: true });
	});

	it.for(["abc", "0", "-1", "01", "12.5", " 1", "9007199254740992"])(
		"should reject %j as not a positive safe integer",
		(id) => {
			expect.assertions(2);

			const result = parsePositiveIntegerIds(["1", id, "2"], FIELD);

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ValidationError);
			expect(result.err).toMatchObject({
				code: "invalid_place_id",
				message: `placeIds entry ${JSON.stringify(id)} is not a positive integer ID`,
			});
		},
	);
});
