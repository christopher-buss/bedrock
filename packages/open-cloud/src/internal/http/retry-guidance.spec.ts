import { describe, expect, it } from "vitest";

import {
	parseQuotaResetSeconds,
	parseRetryAfterSeconds,
	resolveRetryGuidance,
} from "./retry-guidance.ts";

describe(parseRetryAfterSeconds, () => {
	it("should parse delay-seconds", () => {
		expect.assertions(1);

		expect(parseRetryAfterSeconds("5")).toBe(5);
	});

	it("should trim delay-seconds", () => {
		expect.assertions(1);

		expect(parseRetryAfterSeconds(" 5 ")).toBe(5);
	});

	it.for([
		"Thu, 01 Jan 1970 00:00:07 GMT",
		"Thursday, 01-Jan-70 00:00:07 GMT",
		"Thu Jan  1 00:00:07 1970",
	])("should parse the HTTP-date form %s relative to the current time", (value) => {
		expect.assertions(1);

		expect(parseRetryAfterSeconds(value, 0)).toBe(7);
	});

	it("should round an HTTP date up so the retry does not begin early", () => {
		expect.assertions(1);

		expect(parseRetryAfterSeconds("Thu, 01 Jan 1970 00:00:07 GMT", 500)).toBe(7);
	});

	it("should clamp a past HTTP date to an immediate retry", () => {
		expect.assertions(1);

		expect(parseRetryAfterSeconds("Thu, 01 Jan 1970 00:00:07 GMT", 8000)).toBe(0);
	});

	it("should accept the maximum clock fields in an HTTP date", () => {
		expect.assertions(1);

		expect(parseRetryAfterSeconds("Thu, 01 Jan 1970 23:59:59 GMT", 0)).toBe(86_399);
	});

	it("should interpret an RFC 850 year more than 50 years ahead as the past year", () => {
		expect.assertions(1);

		expect(
			parseRetryAfterSeconds("Saturday, 01-Jan-77 00:00:00 GMT", Date.UTC(2026, 0, 1)),
		).toBe(0);
	});

	it("should retain an RFC 850 year exactly 50 years ahead", () => {
		expect.assertions(1);

		const nowMs = Date.UTC(2020, 0, 1);

		expect(parseRetryAfterSeconds("Wednesday, 01-Jan-70 00:00:00 GMT", nowMs)).toBe(
			(Date.UTC(2070, 0, 1) - nowMs) / 1000,
		);
	});

	it.for([
		undefined,
		"abc",
		"-3",
		"3.5",
		"Infinity",
		"22, 0",
		"9".repeat(309),
		"Tue, 31 Feb 2026 00:00:00 GMT",
		"Sun, 01 Jan 1970 00:00:07 GMT",
		"Thu, 01 Jan 1970 24:00:00 GMT",
		"Thu, 01 Jan 1970 00:60:00 GMT",
		"Thu, 01 Jan 1970 00:00:60 GMT",
	])("should reject an invalid Retry-After value: %s", (value) => {
		expect.assertions(1);

		expect(parseRetryAfterSeconds(value)).toBeUndefined();
	});
});

describe(parseQuotaResetSeconds, () => {
	it("should take the largest window from a comma-separated reset header", () => {
		expect.assertions(1);

		expect(parseQuotaResetSeconds("22, 0")).toBe(22);
	});

	it("should take the largest window regardless of token order", () => {
		expect.assertions(1);

		expect(parseQuotaResetSeconds("0, 22")).toBe(22);
	});

	it.for([undefined, "abc", "Infinity"])(
		"should reject an invalid quota reset value: %s",
		(value) => {
			expect.assertions(1);

			expect(parseQuotaResetSeconds(value)).toBeUndefined();
		},
	);
});

describe(resolveRetryGuidance, () => {
	it("should use Retry-After while remaining is nonzero", () => {
		expect.assertions(1);

		expect(
			resolveRetryGuidance({
				headers: { "retry-after": "5", "x-ratelimit-reset": "22" },
				remaining: 3,
			}),
		).toBe(5);
	});

	it("should use the later quota reset when remaining is zero", () => {
		expect.assertions(1);

		expect(
			resolveRetryGuidance({
				headers: { "retry-after": "5", "x-ratelimit-reset": "22" },
				remaining: 0,
			}),
		).toBe(22);
	});

	it("should use quota reset when remaining is zero and Retry-After is absent", () => {
		expect.assertions(1);

		expect(
			resolveRetryGuidance({
				headers: { "x-ratelimit-reset": "22" },
				remaining: 0,
			}),
		).toBe(22);
	});

	it("should retain a later Retry-After when quota resets sooner", () => {
		expect.assertions(1);

		expect(
			resolveRetryGuidance({
				headers: { "retry-after": "22", "x-ratelimit-reset": "5" },
				remaining: 0,
			}),
		).toBe(22);
	});

	it("should return undefined when no applicable guidance is valid", () => {
		expect.assertions(1);

		expect(
			resolveRetryGuidance({
				headers: { "retry-after": "invalid", "x-ratelimit-reset": "22" },
				remaining: 3,
			}),
		).toBeUndefined();
	});
});
