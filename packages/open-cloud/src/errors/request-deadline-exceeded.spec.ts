import { describe, expect, it } from "vitest";

import { OpenCloudError } from "./base.ts";
import { RequestDeadlineExceededError } from "./request-deadline-exceeded.ts";

describe(RequestDeadlineExceededError, () => {
	it("should expose the deadline and refused wait details", () => {
		expect.assertions(3);

		const cause = new Error("wait interrupted");
		const error = new RequestDeadlineExceededError("Request deadline elapsed", {
			cause,
			deadlineMs: 1_000_000,
			remainingMs: 412_000,
			waitMs: 1_856_000,
			waitReason: "reported-budget",
		});

		expect(error).toBeInstanceOf(OpenCloudError);
		expect(error.name).toBe("RequestDeadlineExceededError");
		expect({
			cause: error.cause,
			deadlineMs: error.deadlineMs,
			remainingMs: error.remainingMs,
			waitMs: error.waitMs,
			waitReason: error.waitReason,
		}).toStrictEqual({
			cause,
			deadlineMs: 1_000_000,
			remainingMs: 412_000,
			waitMs: 1_856_000,
			waitReason: "reported-budget",
		});
	});
});
