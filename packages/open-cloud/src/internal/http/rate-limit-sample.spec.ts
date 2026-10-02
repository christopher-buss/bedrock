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

	it("should reject negative and fractional values", () => {
		expect.assertions(1);

		expect(
			parseRateLimitHeaders({
				"x-ratelimit-remaining": "-5",
				"x-ratelimit-reset": "22.9",
			}),
		).toBeUndefined();
	});

	it.for(["1e2", "0x10", "+3"])("should reject a non-decimal integer token: %s", (value) => {
		expect.assertions(1);

		expect(
			parseRateLimitHeaders({
				"x-ratelimit-remaining": value,
				"x-ratelimit-reset": "23",
			}),
		).toBeUndefined();
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

	it("should drop non-finite tokens such as Infinity", () => {
		expect.assertions(1);

		expect(
			parseRateLimitHeaders({
				"x-ratelimit-remaining": "Infinity",
				"x-ratelimit-reset": "23",
			}),
		).toBeUndefined();
	});

	it("should trim whitespace and ignore blank tokens", () => {
		expect.assertions(1);

		expect(
			parseRateLimitHeaders({
				"x-ratelimit-remaining": " , 5",
				"x-ratelimit-reset": "60, ",
			}),
		).toStrictEqual({ remaining: 5, resetSeconds: 60 });
	});

	it("should read the window capacity from the limit header's policies", () => {
		expect.assertions(1);

		expect(
			parseRateLimitHeaders({
				"x-ratelimit-limit": "3, 3;w=1, 3;w=1",
				"x-ratelimit-remaining": "2",
				"x-ratelimit-reset": "1",
			}),
		).toStrictEqual({
			remaining: 2,
			resetSeconds: 1,
			window: { capacity: 3, windowSeconds: 1 },
		});
	});

	it.for(["100;w=60, 10;w=1", "10;w=1, 100;w=60"])(
		"should pace by the slowest policy when the limit header lists several: %s",
		(value) => {
			expect.assertions(1);

			expect(
				parseRateLimitHeaders({
					"x-ratelimit-limit": value,
					"x-ratelimit-remaining": "9",
					"x-ratelimit-reset": "1",
				}),
			).toStrictEqual({
				remaining: 9,
				resetSeconds: 1,
				window: { capacity: 100, windowSeconds: 60 },
			});
		},
	);

	it.for(["6;w=2, 3;w=1", "3;w=1, 6;w=2"])(
		"should pace by the shorter window among equally slow policies: %s",
		(value) => {
			expect.assertions(1);

			expect(
				parseRateLimitHeaders({
					"x-ratelimit-limit": value,
					"x-ratelimit-remaining": "2",
					"x-ratelimit-reset": "1",
				}),
			).toStrictEqual({
				remaining: 2,
				resetSeconds: 1,
				window: { capacity: 3, windowSeconds: 1 },
			});
		},
	);

	it.for([
		"3",
		"3;w=0",
		"x;w=1",
		"3;w=",
		"0;w=1",
		"99999999999999999;w=1",
		"3;w=99999999999999999",
	])(
		"should leave the window unknown for a limit header without a usable policy: %s",
		(value) => {
			expect.assertions(1);

			expect(
				parseRateLimitHeaders({
					"x-ratelimit-limit": value,
					"x-ratelimit-remaining": "2",
					"x-ratelimit-reset": "1",
				}),
			).toStrictEqual({ remaining: 2, resetSeconds: 1 });
		},
	);
});
