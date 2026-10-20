import { describe, it } from "vitest";

import { OpenCloudError } from "./base.ts";
import { ValidationError } from "./validation.ts";

describe(ValidationError, () => {
	it("should set name to ValidationError", ({ expect }) => {
		expect.assertions(1);

		const error = new ValidationError("body is empty", { code: "empty_body" });

		expect(error.name).toBe("ValidationError");
	});

	it("should set message from constructor argument", ({ expect }) => {
		expect.assertions(1);

		const error = new ValidationError("bytes do not match format", {
			code: "format_mismatch",
		});

		expect(error.message).toBe("bytes do not match format");
	});

	it("should be an instance of OpenCloudError", ({ expect }) => {
		expect.assertions(1);

		const error = new ValidationError("body is empty", { code: "empty_body" });

		expect(error).toBeInstanceOf(OpenCloudError);
	});

	it("should be an instance of Error", ({ expect }) => {
		expect.assertions(1);

		const error = new ValidationError("body is empty", { code: "empty_body" });

		expect(error).toBeInstanceOf(Error);
	});

	it("should store code empty_body", ({ expect }) => {
		expect.assertions(1);

		const error = new ValidationError("body is empty", { code: "empty_body" });

		expect(error.code).toBe("empty_body");
	});

	it("should store code format_mismatch", ({ expect }) => {
		expect.assertions(1);

		const error = new ValidationError("bytes do not match format", {
			code: "format_mismatch",
		});

		expect(error.code).toBe("format_mismatch");
	});

	it("should store cause when provided", ({ expect }) => {
		expect.assertions(1);

		const cause = new Error("original");
		const error = new ValidationError("body is empty", {
			cause,
			code: "empty_body",
		});

		expect(error.cause).toBe(cause);
	});
});
