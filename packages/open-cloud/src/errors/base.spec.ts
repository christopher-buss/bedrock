import { describe, expect, it } from "vitest";

import { OpenCloudError } from "./base";

describe(OpenCloudError, () => {
	it("should set name to OpenCloudError", () => {
		expect.assertions(1);

		const error = new OpenCloudError("test");

		expect(error.name).toBe("OpenCloudError");
	});

	it("should set message from constructor argument", () => {
		expect.assertions(1);

		const error = new OpenCloudError("something went wrong");

		expect(error.message).toBe("something went wrong");
	});

	it("should be an instance of Error", () => {
		expect.assertions(1);

		const error = new OpenCloudError("test");

		expect(error).toBeInstanceOf(Error);
	});

	it("should store cause when provided", () => {
		expect.assertions(1);

		const cause = new Error("original");
		const error = new OpenCloudError("wrapped", { cause });

		expect(error.cause).toBe(cause);
	});

	it("should have undefined cause when not provided", () => {
		expect.assertions(1);

		const error = new OpenCloudError("test");

		expect(error.cause).toBeUndefined();
	});
});
