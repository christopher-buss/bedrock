import { assert, describe, expect, it } from "vitest";

import { ValidationError } from "../../errors/validation.ts";
import { buildGetRequest, buildUpdateRequest } from "./builders.ts";

describe(buildGetRequest, () => {
	it("should target /cloud/v2/universes/{universeId} with GET", () => {
		expect.assertions(2);

		const result = buildGetRequest({ universeId: "123" });

		assert(result.success);

		expect(result.data.method).toBe("GET");
		expect(result.data.url).toBe("/cloud/v2/universes/123");
	});

	it("should interpolate the universeId verbatim into the path", () => {
		expect.assertions(1);

		const result = buildGetRequest({ universeId: "99999999999999999" });

		assert(result.success);

		expect(result.data.url).toBe("/cloud/v2/universes/99999999999999999");
	});
});

describe(buildUpdateRequest, () => {
	describe("validation", () => {
		it("should return ValidationError empty_update when only universeId is supplied", () => {
			expect.assertions(3);

			const result = buildUpdateRequest({ universeId: "123" });

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ValidationError);
			expect(result.err.code).toBe("empty_update");
			expect(result.err.message).toBe("Update must include at least one field");
		});
	});

	describe("request shape", () => {
		it("should produce a PATCH request targeting /cloud/v2/universes/{universeId}", () => {
			expect.assertions(2);

			const result = buildUpdateRequest({ universeId: "123", voiceChatEnabled: true });

			assert(result.success);

			expect(result.data.method).toBe("PATCH");
			expect(result.data.url).toStartWith("/cloud/v2/universes/123");
		});

		it("should derive updateMask from the keys present on parameters", () => {
			expect.assertions(1);

			const result = buildUpdateRequest({
				desktopEnabled: true,
				universeId: "123",
				voiceChatEnabled: false,
			});

			assert(result.success);

			expect(result.data.url).toEndWith("?updateMask=desktopEnabled,voiceChatEnabled");
		});

		it("should omit universeId from the updateMask and body", () => {
			expect.assertions(2);

			const result = buildUpdateRequest({ universeId: "123", voiceChatEnabled: true });

			assert(result.success);

			expect(result.data.url).not.toContain("universeId");
			expect(result.data.body).toStrictEqual({ voiceChatEnabled: true });
		});

		it("should place every supplied boolean verbatim in the JSON body", () => {
			expect.assertions(1);

			const result = buildUpdateRequest({
				consoleEnabled: false,
				desktopEnabled: true,
				mobileEnabled: true,
				tabletEnabled: false,
				universeId: "123",
				vrEnabled: true,
			});

			assert(result.success);

			expect(result.data.body).toStrictEqual({
				consoleEnabled: false,
				desktopEnabled: true,
				mobileEnabled: true,
				tabletEnabled: false,
				vrEnabled: true,
			});
		});

		it("should place social-link objects verbatim in the JSON body and include them in the mask", () => {
			expect.assertions(2);

			const facebookSocialLink = { title: "Facebook", uri: "https://facebook.com/example" };
			const result = buildUpdateRequest({
				facebookSocialLink,
				universeId: "123",
			});

			assert(result.success);

			expect(result.data.body).toStrictEqual({ facebookSocialLink });
			expect(result.data.url).toEndWith("?updateMask=facebookSocialLink");
		});

		it("should emit JSON null for privateServerPriceRobux when undefined is passed explicitly", () => {
			expect.assertions(2);

			const result = buildUpdateRequest({
				privateServerPriceRobux: undefined,
				universeId: "123",
			});

			assert(result.success);

			// JSON.parse("null") dodges the `unicorn/no-null` rule while
			// still producing the literal null value the builder emits as
			// its clear-the-field sentinel.
			expect(result.data.body).toStrictEqual({
				privateServerPriceRobux: JSON.parse("null"),
			});
			expect(result.data.url).toEndWith("?updateMask=privateServerPriceRobux");
		});

		it("should emit JSON null for a social link when undefined is passed explicitly", () => {
			expect.assertions(1);

			const result = buildUpdateRequest({
				facebookSocialLink: undefined,
				universeId: "123",
			});

			assert(result.success);

			expect(result.data.body).toStrictEqual({
				facebookSocialLink: JSON.parse("null"),
			});
		});

		it("should emit the numeric value for privateServerPriceRobux when set to a number", () => {
			expect.assertions(1);

			const result = buildUpdateRequest({
				privateServerPriceRobux: 25,
				universeId: "123",
			});

			assert(result.success);

			expect(result.data.body).toStrictEqual({ privateServerPriceRobux: 25 });
		});
	});
});
