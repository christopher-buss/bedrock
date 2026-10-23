import { describe, it } from "vitest";

import { ApiError } from "./api-error.ts";
import { UnexpectedResponseError } from "./unexpected-response.ts";

describe(UnexpectedResponseError, () => {
	it("should set name to UnexpectedResponseError", ({ expect }) => {
		expect.assertions(1);

		const error = new UnexpectedResponseError("Malformed badge response", {
			statusCode: 200,
		});

		expect(error.name).toBe("UnexpectedResponseError");
	});

	it("should be an instance of ApiError", ({ expect }) => {
		expect.assertions(1);

		const error = new UnexpectedResponseError("Malformed badge response", {
			statusCode: 200,
		});

		expect(error).toBeInstanceOf(ApiError);
	});

	it("should carry the raw response body and status code", ({ expect }) => {
		expect.assertions(3);

		const error = new UnexpectedResponseError("Malformed badge response", {
			details: { id: "not-a-number" },
			statusCode: 200,
		});

		expect(error.message).toBe("Malformed badge response");
		expect(error.details).toStrictEqual({ id: "not-a-number" });
		expect(error.statusCode).toBe(200);
	});
});
