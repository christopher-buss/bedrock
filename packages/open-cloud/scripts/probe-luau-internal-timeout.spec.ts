import { describe, expect, it } from "vitest";

import {
	classifyTaskBody,
	parseTaskRef,
	quotaHoldMs,
	zeroFailureUpperBound,
} from "./probe-luau-internal-timeout.ts";

const PINNED_PATH =
	"universes/123/places/456/versions/7/luau-execution-sessions/session-1/tasks/task-1";

describe(parseTaskRef, () => {
	it("should parse a version-pinned session task path", () => {
		expect.assertions(1);

		expect(parseTaskRef(JSON.stringify({ path: PINNED_PATH, state: "QUEUED" }))).toStrictEqual({
			path: PINNED_PATH,
			placeId: "456",
			sessionId: "session-1",
			taskId: "task-1",
			universeId: "123",
			versionId: "7",
		});
	});

	it("should return undefined for a body without a pinned session path", () => {
		expect.assertions(3);

		expect(parseTaskRef("not json")).toBeUndefined();
		expect(parseTaskRef(JSON.stringify({ state: "QUEUED" }))).toBeUndefined();
		expect(
			parseTaskRef(
				JSON.stringify({ path: "universes/1/places/2/luau-execution-session-tasks/t" }),
			),
		).toBeUndefined();
	});
});

describe(classifyTaskBody, () => {
	it("should classify the exact January 2026 signature as internal-timeout", () => {
		expect.assertions(1);

		expect(
			classifyTaskBody({
				error: {
					code: "INTERNAL_ERROR",
					message: "Task timed out due to an internal error",
				},
				path: PINNED_PATH,
				state: "FAILED",
			}),
		).toBe("internal-timeout");
	});

	it("should keep an INTERNAL_ERROR with another message as a separate signature", () => {
		expect.assertions(1);

		expect(
			classifyTaskBody({
				error: { code: "INTERNAL_ERROR", message: "Something else" },
				path: PINNED_PATH,
				state: "FAILED",
			}),
		).toBe("internal-error-other");
	});

	it("should classify a requested-deadline failure as deadline-exceeded", () => {
		expect.assertions(1);

		expect(
			classifyTaskBody({
				error: { code: "DEADLINE_EXCEEDED", message: "Task timed out" },
				path: PINNED_PATH,
				state: "FAILED",
			}),
		).toBe("deadline-exceeded");
	});

	it("should classify any other failure code as failed-other", () => {
		expect.assertions(2);

		expect(
			classifyTaskBody({
				error: { code: "SCRIPT_ERROR", message: "boom" },
				path: PINNED_PATH,
				state: "FAILED",
			}),
		).toBe("failed-other");
		expect(classifyTaskBody({ path: PINNED_PATH, state: "FAILED" })).toBe("failed-other");
	});

	it("should classify COMPLETE and CANCELLED terminal states", () => {
		expect.assertions(2);

		expect(
			classifyTaskBody({ output: { results: ["ok"] }, path: PINNED_PATH, state: "COMPLETE" }),
		).toBe("complete");
		expect(classifyTaskBody({ path: PINNED_PATH, state: "CANCELLED" })).toBe("cancelled");
	});

	it("should report every non-terminal state as pending", () => {
		expect.assertions(3);

		expect(classifyTaskBody({ path: PINNED_PATH, state: "QUEUED" })).toBe("pending");
		expect(classifyTaskBody({ path: PINNED_PATH, state: "PROCESSING" })).toBe("pending");
		expect(classifyTaskBody({ path: PINNED_PATH, state: "STATE_UNSPECIFIED" })).toBe("pending");
	});

	it("should treat a body that is not a task object as unreadable", () => {
		expect.assertions(3);

		expect(classifyTaskBody("nope")).toBe("unreadable");
		expect(classifyTaskBody(JSON.parse("null"))).toBe("unreadable");
		expect(classifyTaskBody({ path: PINNED_PATH })).toBe("unreadable");
	});
});

describe(quotaHoldMs, () => {
	it("should not hold while the reported budget has requests left", () => {
		expect.assertions(1);

		expect(
			quotaHoldMs({
				headers: { "x-ratelimit-remaining": "3, 44", "x-ratelimit-reset": "12" },
				status: 200,
			}),
		).toBe(0);
	});

	it("should hold until the window edge once the reported budget is spent", () => {
		expect.assertions(1);

		expect(
			quotaHoldMs({
				headers: { "x-ratelimit-remaining": "0, 44", "x-ratelimit-reset": "12, 50" },
				status: 200,
			}),
		).toBe(13_000);
	});

	it("should hold on a 429 from x-ratelimit-reset before retry-after", () => {
		expect.assertions(1);

		expect(
			quotaHoldMs({
				headers: {
					"retry-after": "5",
					"x-ratelimit-remaining": "0",
					"x-ratelimit-reset": "44",
				},
				status: 429,
			}),
		).toBe(45_000);
	});

	it("should fall back to retry-after, then a full window, on a bare 429", () => {
		expect.assertions(2);

		expect(quotaHoldMs({ headers: { "retry-after": "5" }, status: 429 })).toBe(5000);
		expect(quotaHoldMs({ headers: {}, status: 429 })).toBe(60_000);
	});

	it("should not hold when the headers are absent or unreadable on a success", () => {
		expect.assertions(2);

		expect(quotaHoldMs({ headers: {}, status: 200 })).toBe(0);
		expect(
			quotaHoldMs({
				headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "soon" },
				status: 200,
			}),
		).toBe(0);
	});
});

describe(zeroFailureUpperBound, () => {
	it("should give the one-sided 95% exact binomial bound for zero failures", () => {
		expect.assertions(2);

		expect(zeroFailureUpperBound(20)).toBeCloseTo(0.1391, 4);
		expect(zeroFailureUpperBound(100)).toBeCloseTo(0.0295, 4);
	});

	it("should accept another confidence level", () => {
		expect.assertions(1);

		expect(zeroFailureUpperBound(20, 0.99)).toBeCloseTo(0.2057, 4);
	});

	it("should bound an empty sample at one", () => {
		expect.assertions(1);

		expect(zeroFailureUpperBound(0)).toBe(1);
	});
});
