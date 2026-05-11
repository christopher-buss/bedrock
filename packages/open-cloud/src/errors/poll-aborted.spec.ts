import { describe, expect, it } from "vitest";

import { OpenCloudError } from "./base.ts";
import { PollAbortedError } from "./poll-aborted.ts";

describe(PollAbortedError, () => {
	it("should set name to PollAbortedError", () => {
		expect.assertions(1);

		const error = new PollAbortedError("polling aborted");

		expect(error.name).toBe("PollAbortedError");
	});

	it("should be an instance of OpenCloudError", () => {
		expect.assertions(1);

		const error = new PollAbortedError("polling aborted");

		expect(error).toBeInstanceOf(OpenCloudError);
	});

	it("should be an instance of Error", () => {
		expect.assertions(1);

		const error = new PollAbortedError("polling aborted");

		expect(error).toBeInstanceOf(Error);
	});

	it("should expose the reason from options when supplied", () => {
		expect.assertions(1);

		const reason = new Error("caller cancelled");
		const error = new PollAbortedError("polling aborted", { reason });

		expect(error.reason).toBe(reason);
	});

	it("should surface reason as undefined when not supplied", () => {
		expect.assertions(1);

		const error = new PollAbortedError("polling aborted");

		expect(error.reason).toBeUndefined();
	});

	it("should preserve message", () => {
		expect.assertions(1);

		const error = new PollAbortedError("poll was aborted by caller");

		expect(error.message).toBe("poll was aborted by caller");
	});

	it("should store cause when provided", () => {
		expect.assertions(1);

		const cause = new Error("original");
		const error = new PollAbortedError("polling aborted", { cause });

		expect(error.cause).toBe(cause);
	});
});
