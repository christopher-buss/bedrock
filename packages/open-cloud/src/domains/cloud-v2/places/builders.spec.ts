import { assert, describe, expect, it } from "vitest";

import { ValidationError } from "../../../errors/validation.ts";
import { buildUpdateRequest } from "./builders.ts";

describe(buildUpdateRequest, () => {
	describe("validation", () => {
		it("should return ValidationError empty_update when only identifiers are supplied", () => {
			expect.assertions(3);

			const result = buildUpdateRequest({ placeId: "456", universeId: "123" });

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ValidationError);
			expect(result.err.code).toBe("empty_update");
			expect(result.err.message).toBe("Update must include at least one field");
		});
	});

	describe("request shape", () => {
		it("should produce a PATCH request targeting /cloud/v2/universes/{uid}/places/{pid}", () => {
			expect.assertions(2);

			const result = buildUpdateRequest({
				description: "New description",
				placeId: "456",
				universeId: "123",
			});

			assert(result.success);

			expect(result.data.method).toBe("PATCH");
			expect(result.data.url).toStartWith("/cloud/v2/universes/123/places/456");
		});

		it("should derive updateMask from the keys present on parameters", () => {
			expect.assertions(1);

			const result = buildUpdateRequest({
				description: "New description",
				placeId: "456",
				serverSize: 50,
				universeId: "123",
			});

			assert(result.success);

			expect(result.data.url).toEndWith("?updateMask=description,serverSize");
		});

		it("should omit placeId and universeId from the updateMask and body", () => {
			expect.assertions(3);

			const result = buildUpdateRequest({
				description: "New description",
				placeId: "456",
				universeId: "123",
			});

			assert(result.success);

			expect(result.data.url).not.toContain("universeId=");
			expect(result.data.url).not.toContain("placeId=");
			expect(result.data.body).toStrictEqual({ description: "New description" });
		});

		it("should place every supplied writable field verbatim in the JSON body", () => {
			expect.assertions(1);

			const result = buildUpdateRequest({
				description: "Desc",
				displayName: "Name",
				placeId: "456",
				serverSize: 50,
				universeId: "123",
			});

			assert(result.success);

			expect(result.data.body).toStrictEqual({
				description: "Desc",
				displayName: "Name",
				serverSize: 50,
			});
		});

		it("should send application/json as the content-type header", () => {
			expect.assertions(1);

			const result = buildUpdateRequest({
				description: "Desc",
				placeId: "456",
				universeId: "123",
			});

			assert(result.success);

			expect(result.data.headers).toStrictEqual({
				"content-type": "application/json",
			});
		});
	});
});
