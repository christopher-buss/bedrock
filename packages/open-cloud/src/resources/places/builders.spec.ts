import { assert, describe, expect, it } from "vitest";

import { ValidationError } from "../../errors/validation.ts";
import { buildPublishRequest, buildUpdateRequest } from "./builders.ts";
import { RBXL_SIGNATURE, RBXLX_SIGNATURE } from "./signatures.ts";
import type { PublishParameters } from "./types.ts";

function makeParameters(overrides: Partial<PublishParameters> = {}): PublishParameters {
	return {
		body: new Uint8Array(RBXL_SIGNATURE),
		format: "rbxl",
		placeId: "456",
		universeId: "123",
		...overrides,
	};
}

describe(buildPublishRequest, () => {
	describe("validation", () => {
		it("should return ValidationError empty_body for a zero-byte body", () => {
			expect.assertions(3);

			const result = buildPublishRequest(
				makeParameters({ body: new Uint8Array(0) }),
				"Published",
			);

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ValidationError);
			expect(result.err.code).toBe("empty_body");
			expect(result.err.message).toBe("Place body is empty");
		});

		it("should return ValidationError format_mismatch for rbxl declared with rbxlx bytes", () => {
			expect.assertions(3);

			const result = buildPublishRequest(
				makeParameters({ body: new Uint8Array(RBXLX_SIGNATURE), format: "rbxl" }),
				"Published",
			);

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ValidationError);
			expect(result.err.code).toBe("format_mismatch");
			expect(result.err.message).toBe('Place body does not match the declared "rbxl" format');
		});

		it("should return ValidationError format_mismatch for rbxlx declared with rbxl bytes", () => {
			expect.assertions(1);

			const result = buildPublishRequest(
				makeParameters({ body: new Uint8Array(RBXL_SIGNATURE), format: "rbxlx" }),
				"Saved",
			);

			assert(!result.success);

			expect(result.err.code).toBe("format_mismatch");
		});

		it("should return ValidationError format_mismatch for unrecognized prefix bytes", () => {
			expect.assertions(1);

			const result = buildPublishRequest(
				makeParameters({
					body: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
					format: "rbxl",
				}),
				"Published",
			);

			assert(!result.success);

			expect(result.err.code).toBe("format_mismatch");
		});

		it("should reject empty bodies before checking the format signature", () => {
			expect.assertions(1);

			const result = buildPublishRequest(
				makeParameters({ body: new Uint8Array(0), format: "rbxlx" }),
				"Published",
			);

			assert(!result.success);

			expect(result.err.code).toBe("empty_body");
		});
	});

	describe("request shape", () => {
		it("should produce a POST request", () => {
			expect.assertions(1);

			const result = buildPublishRequest(makeParameters(), "Published");

			assert(result.success);

			expect(result.data.method).toBe("POST");
		});

		it("should pass the original Uint8Array body through unmodified", () => {
			expect.assertions(1);

			const body = new Uint8Array(RBXL_SIGNATURE);
			const result = buildPublishRequest(makeParameters({ body }), "Published");

			assert(result.success);

			expect(result.data.body).toBe(body);
		});

		it("should target /universes/{universeId}/places/{placeId}/versions with the Published query for publish", () => {
			expect.assertions(1);

			const result = buildPublishRequest(
				makeParameters({ placeId: "999", universeId: "111" }),
				"Published",
			);

			assert(result.success);

			expect(result.data.url).toBe(
				"/universes/v1/111/places/999/versions?versionType=Published",
			);
		});

		it("should switch the query string to Saved for save", () => {
			expect.assertions(1);

			const result = buildPublishRequest(makeParameters(), "Saved");

			assert(result.success);

			expect(result.data.url).toEndWith("?versionType=Saved");
		});

		it("should set Content-Type application/octet-stream for the rbxl format", () => {
			expect.assertions(1);

			const result = buildPublishRequest(
				makeParameters({ body: new Uint8Array(RBXL_SIGNATURE), format: "rbxl" }),
				"Published",
			);

			assert(result.success);

			expect(result.data.headers).toStrictEqual({
				"content-type": "application/octet-stream",
			});
		});

		it("should set Content-Type application/xml for the rbxlx format", () => {
			expect.assertions(1);

			const result = buildPublishRequest(
				makeParameters({ body: new Uint8Array(RBXLX_SIGNATURE), format: "rbxlx" }),
				"Published",
			);

			assert(result.success);

			expect(result.data.headers).toStrictEqual({
				"content-type": "application/xml",
			});
		});
	});
});

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
