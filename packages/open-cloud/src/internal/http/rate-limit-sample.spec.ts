import { describe, expect, it } from "vitest";

import { parseRateLimitHeaders } from "./rate-limit-sample.ts";

describe(parseRateLimitHeaders, () => {
	it("should parse single-valued remaining and reset headers", () => {
		expect.assertions(1);

		expect(
			parseRateLimitHeaders({
				"x-ratelimit-remaining": "97",
				"x-ratelimit-reset": "23",
			}),
		).toStrictEqual({ remaining: 97, resetSeconds: 23 });
	});

	it("should take the smallest remaining and largest reset from comma lists", () => {
		expect.assertions(1);

		expect(
			parseRateLimitHeaders({
				"x-ratelimit-remaining": "0, 70000",
				"x-ratelimit-reset": "22, 0",
			}),
		).toStrictEqual({ remaining: 0, resetSeconds: 22 });
	});

	it("should reduce regardless of token order", () => {
		expect.assertions(1);

		expect(
			parseRateLimitHeaders({
				"x-ratelimit-remaining": "70000, 0",
				"x-ratelimit-reset": "0, 22",
			}),
		).toStrictEqual({ remaining: 0, resetSeconds: 22 });
	});

	it("should floor fractional values and clamp negatives to zero", () => {
		expect.assertions(1);

		expect(
			parseRateLimitHeaders({
				"x-ratelimit-remaining": "-5",
				"x-ratelimit-reset": "22.9",
			}),
		).toStrictEqual({ remaining: 0, resetSeconds: 22 });
	});

	it("should return undefined when the remaining header is absent", () => {
		expect.assertions(1);

		expect(parseRateLimitHeaders({ "x-ratelimit-reset": "23" })).toBeUndefined();
	});

	it("should return undefined when the reset header is absent", () => {
		expect.assertions(1);

		expect(parseRateLimitHeaders({ "x-ratelimit-remaining": "97" })).toBeUndefined();
	});

	it("should return undefined when a header has no numeric tokens", () => {
		expect.assertions(1);

		expect(
			parseRateLimitHeaders({
				"x-ratelimit-remaining": "abc",
				"x-ratelimit-reset": "23",
			}),
		).toBeUndefined();
	});
});
