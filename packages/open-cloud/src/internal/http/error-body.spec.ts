import { describe, expect, it } from "vitest";

import { extractErrorCode, extractErrorMessage } from "./error-body.ts";

describe(extractErrorCode, () => {
	it("should extract errorCode string from body object", () => {
		expect.assertions(1);

		const body = { errorCode: "INVALID_ARGUMENT", message: "bad request" };

		expect(extractErrorCode(body)).toBe("INVALID_ARGUMENT");
	});

	it("should return undefined when body has no errorCode", () => {
		expect.assertions(1);

		const body = { message: "not found" };

		expect(extractErrorCode(body)).toBeUndefined();
	});

	it("should return undefined when body is not an object", () => {
		expect.assertions(1);

		expect(extractErrorCode("string body")).toBeUndefined();
	});

	it("should return undefined when errorCode is not a string", () => {
		expect.assertions(1);

		const body = { errorCode: 42 };

		expect(extractErrorCode(body)).toBeUndefined();
	});

	it("should return undefined when body is null", () => {
		expect.assertions(1);

		// eslint-disable-next-line unicorn/no-null -- verifies JSON `null` body handling
		expect(extractErrorCode(null)).toBeUndefined();
	});

	it("should extract the v2 error field as the code", () => {
		expect.assertions(1);

		const body = { error: "NOT_FOUND", message: "Queue items not found." };

		expect(extractErrorCode(body)).toBe("NOT_FOUND");
	});

	it("should prefer top-level errorCode over the v2 error field", () => {
		expect.assertions(1);

		const body = { error: "V2", errorCode: "MODERN", message: "both" };

		expect(extractErrorCode(body)).toBe("MODERN");
	});

	it("should prefer the v2 error field over legacy errors[].code", () => {
		expect.assertions(1);

		const body = { error: "V2", errors: [{ code: 99, message: "legacy" }] };

		expect(extractErrorCode(body)).toBe("V2");
	});

	it("should extract the cloud v2 top-level code field", () => {
		expect.assertions(1);

		const body = { code: "INVALID_ARGUMENT", message: "Invalid universe ID." };

		expect(extractErrorCode(body)).toBe("INVALID_ARGUMENT");
	});

	it("should prefer top-level errorCode over the cloud v2 code field", () => {
		expect.assertions(1);

		const body = { code: "V2", errorCode: "MODERN" };

		expect(extractErrorCode(body)).toBe("MODERN");
	});

	it("should prefer the cloud v2 code field over the error field", () => {
		expect.assertions(1);

		const body = { code: "INVALID_ARGUMENT", error: "NOT_FOUND" };

		expect(extractErrorCode(body)).toBe("INVALID_ARGUMENT");
	});

	it("should ignore a non-string top-level code field", () => {
		expect.assertions(1);

		const body = { code: 3, message: "numeric" };

		expect(extractErrorCode(body)).toBeUndefined();
	});

	it("should not read a sentence-valued error field as the code", () => {
		expect.assertions(1);

		const body = { error: "Place 1 does not belong to universe 5202621917" };

		expect(extractErrorCode(body)).toBeUndefined();
	});

	it("should not read a sentence ending in a token as the code", () => {
		expect.assertions(1);

		const body = { error: "Lookup failed with NOT_FOUND" };

		expect(extractErrorCode(body)).toBeUndefined();
	});

	it("should not read a lower-case error token as the code", () => {
		expect.assertions(1);

		const body = { error: "not_found" };

		expect(extractErrorCode(body)).toBeUndefined();
	});

	it("should fall back to legacy errors[].code past a sentence-valued error field", () => {
		expect.assertions(1);

		const body = { error: "Something broke", errors: [{ code: 7 }] };

		expect(extractErrorCode(body)).toBe("7");
	});

	it("should ignore a non-string v2 error field", () => {
		expect.assertions(1);

		const body = { error: { status: "NOT_FOUND" }, message: "structured" };

		expect(extractErrorCode(body)).toBeUndefined();
	});

	it("should extract numeric code from legacy errors[] as a string", () => {
		expect.assertions(1);

		const body = { errors: [{ code: 22, message: "Invalid language code" }] };

		expect(extractErrorCode(body)).toBe("22");
	});

	it("should extract string code from legacy errors[]", () => {
		expect.assertions(1);

		const body = { errors: [{ code: "GAME_NOT_FOUND", message: "no" }] };

		expect(extractErrorCode(body)).toBe("GAME_NOT_FOUND");
	});

	it("should prefer top-level errorCode over legacy errors[].code when both present", () => {
		expect.assertions(1);

		const body = { errorCode: "MODERN", errors: [{ code: 99, message: "legacy" }] };

		expect(extractErrorCode(body)).toBe("MODERN");
	});

	it("should return undefined when errors is not an array", () => {
		expect.assertions(1);

		const body = { errors: "not-an-array" };

		expect(extractErrorCode(body)).toBeUndefined();
	});

	it("should return undefined when errors[] is empty", () => {
		expect.assertions(1);

		const body = { errors: [] };

		expect(extractErrorCode(body)).toBeUndefined();
	});

	it("should return undefined when errors[0] is not an object", () => {
		expect.assertions(1);

		const body = { errors: ["bare-string"] };

		expect(extractErrorCode(body)).toBeUndefined();
	});

	it("should return undefined when errors[0].code is neither string nor number", () => {
		expect.assertions(1);

		const body = { errors: [{ code: { nested: true }, message: "hi" }] };

		expect(extractErrorCode(body)).toBeUndefined();
	});
});

describe(extractErrorMessage, () => {
	it("should extract a top-level message string from a modern body", () => {
		expect.assertions(1);

		const body = { errorCode: "INVALID_ARGUMENT", message: "bad request" };

		expect(extractErrorMessage(body)).toBe("bad request");
	});

	it("should extract message from legacy errors[]", () => {
		expect.assertions(1);

		const body = { errors: [{ code: 22, message: "Invalid language code" }] };

		expect(extractErrorMessage(body)).toBe("Invalid language code");
	});

	it("should prefer top-level message over legacy errors[].message when both present", () => {
		expect.assertions(1);

		const body = { errors: [{ code: 1, message: "legacy" }], message: "modern" };

		expect(extractErrorMessage(body)).toBe("modern");
	});

	it("should read a sentence-valued error field as the message", () => {
		expect.assertions(1);

		const body = { error: "Place 1 does not belong to universe 5202621917" };

		expect(extractErrorMessage(body)).toBe("Place 1 does not belong to universe 5202621917");
	});

	it("should not read a canonical error token as the message", () => {
		expect.assertions(1);

		const body = { error: "NOT_FOUND" };

		expect(extractErrorMessage(body)).toBeUndefined();
	});

	it("should prefer top-level message over a sentence-valued error field", () => {
		expect.assertions(1);

		const body = { error: "Something broke", message: "modern" };

		expect(extractErrorMessage(body)).toBe("modern");
	});

	it("should prefer a sentence-valued error field over legacy errors[].message", () => {
		expect.assertions(1);

		const body = { error: "Something broke", errors: [{ message: "legacy" }] };

		expect(extractErrorMessage(body)).toBe("Something broke");
	});

	it("should return undefined when body is not an object", () => {
		expect.assertions(1);

		expect(extractErrorMessage("string body")).toBeUndefined();
	});

	it("should return undefined when body is null", () => {
		expect.assertions(1);

		// eslint-disable-next-line unicorn/no-null -- verifies JSON `null` body handling
		expect(extractErrorMessage(null)).toBeUndefined();
	});

	it("should join a ProblemDetails title with its first field error", () => {
		expect.assertions(1);

		const body = {
			errors: {
				BleedOffDurationMinutes: ["BleedOffDurationMinutes must be between 1 and 240."],
				PlaceIds: ["PlaceIds must not be empty."],
			},
			status: 400,
			title: "One or more validation errors occurred.",
			traceId: "00-abc-def-00",
			type: "https://tools.ietf.org/html/rfc9110#section-15.5.1",
		};

		expect(extractErrorMessage(body)).toBe(
			"One or more validation errors occurred. BleedOffDurationMinutes must be between 1 and 240.",
		);
	});

	it("should read a ProblemDetails title alone when it has no field errors", () => {
		expect.assertions(1);

		const body = { status: 400, title: "Bad Request" };

		expect(extractErrorMessage(body)).toBe("Bad Request");
	});

	it("should read a ProblemDetails field error alone when it has no title", () => {
		expect.assertions(1);

		const body = { errors: { PlaceIds: ["PlaceIds must not be empty."] } };

		expect(extractErrorMessage(body)).toBe("PlaceIds must not be empty.");
	});

	it.for([{ PlaceIds: "not an array" }, { PlaceIds: [] }, { PlaceIds: [42] }])(
		"should ignore ProblemDetails field errors that are not string arrays: %j",
		(errors) => {
			expect.assertions(1);

			const title = "One or more validation errors occurred.";

			expect(extractErrorMessage({ errors, title })).toBe(title);
		},
	);

	// eslint-disable-next-line unicorn/no-null -- verifies JSON `null` errors handling
	it.for([null, "oops"])("should ignore a null or non-object errors field: %j", (errors) => {
		expect.assertions(1);

		expect(extractErrorMessage({ errors, title: "Bad Request" })).toBe("Bad Request");
	});

	it("should ignore a non-string ProblemDetails title", () => {
		expect.assertions(1);

		const body = { errors: {}, title: 400 };

		expect(extractErrorMessage(body)).toBeUndefined();
	});

	it("should prefer top-level message over a ProblemDetails title", () => {
		expect.assertions(1);

		const body = { message: "modern", title: "Bad Request" };

		expect(extractErrorMessage(body)).toBe("modern");
	});

	it("should return undefined when neither shape carries a message", () => {
		expect.assertions(1);

		const body = { errors: [{ code: 1 }] };

		expect(extractErrorMessage(body)).toBeUndefined();
	});

	it("should return undefined when message is not a string", () => {
		expect.assertions(1);

		const body = { message: 42 };

		expect(extractErrorMessage(body)).toBeUndefined();
	});
});
