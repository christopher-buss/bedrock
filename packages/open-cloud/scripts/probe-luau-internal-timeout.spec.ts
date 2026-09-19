import { describe, expect, it } from "vitest";

import { classifyTaskBody, parseTaskRef } from "./probe-luau-internal-timeout.ts";

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
