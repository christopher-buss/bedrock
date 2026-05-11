import { describe, expect, it } from "vitest";

import { OpenCloudError } from "./base.ts";
import { PollTimeoutError } from "./poll-timeout.ts";

describe(PollTimeoutError, () => {
	it("should set name to PollTimeoutError", () => {
		expect.assertions(1);

		const error = new PollTimeoutError("polling timed out", { timeoutMs: 5000 });

		expect(error.name).toBe("PollTimeoutError");
	});

	it("should be an instance of OpenCloudError", () => {
		expect.assertions(1);

		const error = new PollTimeoutError("polling timed out", { timeoutMs: 5000 });

		expect(error).toBeInstanceOf(OpenCloudError);
	});

	it("should be an instance of Error", () => {
		expect.assertions(1);

		const error = new PollTimeoutError("polling timed out", { timeoutMs: 5000 });

		expect(error).toBeInstanceOf(Error);
	});

	it("should expose timeoutMs from options", () => {
		expect.assertions(1);

		const error = new PollTimeoutError("polling timed out", { timeoutMs: 30_000 });

		expect(error.timeoutMs).toBe(30_000);
	});

	it("should expose lastObservedTask and timeoutMs from options", () => {
		expect.assertions(2);

		const lastObservedTask = { state: "PROCESSING" as const };
		const error = new PollTimeoutError("polling timed out", {
			lastObservedTask,
			timeoutMs: 5000,
		});

		expect(error.lastObservedTask).toBe(lastObservedTask);
		expect(error.timeoutMs).toBe(5000);
	});

	it("should surface lastObservedTask as undefined when not supplied", () => {
		expect.assertions(1);

		const error = new PollTimeoutError("polling timed out", { timeoutMs: 5000 });

		expect(error.lastObservedTask).toBeUndefined();
	});

	it("should preserve message", () => {
		expect.assertions(1);

		const error = new PollTimeoutError("poll budget exhausted", { timeoutMs: 5000 });

		expect(error.message).toBe("poll budget exhausted");
	});

	it("should store cause when provided", () => {
		expect.assertions(1);

		const cause = new Error("original");
		const error = new PollTimeoutError("polling timed out", { cause, timeoutMs: 5000 });

		expect(error.cause).toBe(cause);
	});
});
