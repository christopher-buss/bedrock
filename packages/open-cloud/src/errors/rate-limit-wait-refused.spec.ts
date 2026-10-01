import { describe, expect, it } from "vitest";

import { OpenCloudError } from "./base.ts";
import { RateLimitWaitRefusedError } from "./rate-limit-wait-refused.ts";
import { RateLimitError } from "./rate-limit.ts";

describe(RateLimitWaitRefusedError, () => {
	it("should expose the refused rate limit's evidence", () => {
		expect.assertions(3);

		const cause = new RateLimitError("Rate limited", {
			code: "RESOURCE_EXHAUSTED",
			remaining: 0,
			responseHeaders: { "retry-after": "300", "x-ratelimit-remaining": "0" },
			retryAfterSeconds: 300,
		});
		const error = new RateLimitWaitRefusedError("Rate limit asks for a 300s wait", { cause });

		expect(error).toBeInstanceOf(OpenCloudError);
		expect(error.name).toBe("RateLimitWaitRefusedError");
		expect({
			cause: error.cause,
			code: error.code,
			remaining: error.remaining,
			responseHeaders: error.responseHeaders,
			retryAfterSeconds: error.retryAfterSeconds,
		}).toStrictEqual({
			cause,
			code: "RESOURCE_EXHAUSTED",
			remaining: 0,
			responseHeaders: { "retry-after": "300", "x-ratelimit-remaining": "0" },
			retryAfterSeconds: 300,
		});
	});
});
