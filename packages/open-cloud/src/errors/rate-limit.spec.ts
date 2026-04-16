import { describe, expect, it } from "vitest";

import { OpenCloudError } from "./base";
import { RateLimitError } from "./rate-limit";

describe(RateLimitError, () => {
	it("should set name to RateLimitError", () => {
		expect.assertions(1);

		const error = new RateLimitError("rate limited", { retryAfterSeconds: 30 });

		expect(error.name).toBe("RateLimitError");
	});

	it("should set message from constructor argument", () => {
		expect.assertions(1);

		const error = new RateLimitError("too many requests", { retryAfterSeconds: 5 });

		expect(error.message).toBe("too many requests");
	});

	it("should be an instance of OpenCloudError", () => {
		expect.assertions(1);

		const error = new RateLimitError("rate limited", { retryAfterSeconds: 10 });

		expect(error).toBeInstanceOf(OpenCloudError);
	});

	it("should be an instance of Error", () => {
		expect.assertions(1);

		const error = new RateLimitError("rate limited", { retryAfterSeconds: 10 });

		expect(error).toBeInstanceOf(Error);
	});

	it("should store retryAfterSeconds", () => {
		expect.assertions(1);

		const error = new RateLimitError("rate limited", { retryAfterSeconds: 42 });

		expect(error.retryAfterSeconds).toBe(42);
	});

	it("should store cause when provided", () => {
		expect.assertions(1);

		const cause = new Error("original");
		const error = new RateLimitError("rate limited", { cause, retryAfterSeconds: 10 });

		expect(error.cause).toBe(cause);
	});
});
