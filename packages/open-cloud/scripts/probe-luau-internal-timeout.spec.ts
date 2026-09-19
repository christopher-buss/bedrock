import { describe, expect, it } from "vitest";

import {
	classifyTaskBody,
	INTERNAL_TIMEOUT_MESSAGE,
	parseTaskRef,
	type ProbeConfig,
	type ProbeDeps,
	type ProbeRun,
	quotaHoldMs,
	redactJson,
	renderReport,
	runProbeAsync,
	summarize,
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

const CONFIG: ProbeConfig = {
	apiBase: "https://example.test",
	apiKey: "secret-key",
	group: "trivial-baseline",
	maxPollFailures: 2,
	maxSubmits: 4,
	observationMs: 5000,
	placeId: "456",
	pollIntervalMs: 2000,
	script: 'return "ok"',
	targetAccepted: 2,
	universeId: "123",
	versionId: "7",
};

interface Call {
	readonly body: string | undefined;
	readonly method: string;
	readonly url: string;
}

interface Harness {
	readonly calls: Array<Call>;
	readonly deps: ProbeDeps;
	readonly sleeps: Array<number>;
}

interface Reply {
	readonly body: JSONValue;
	readonly headers?: Record<string, string> | undefined;
}

function taskPath(task: string): string {
	return `universes/123/places/456/versions/7/luau-execution-sessions/s/tasks/${task}`;
}

function json(status: number, reply: Reply): Response {
	return new Response(JSON.stringify(reply.body), {
		headers: { "content-type": "application/json", ...reply.headers },
		status,
	});
}

function accepted(task: string, headers?: Record<string, string>): Response {
	return json(200, { body: { path: taskPath(task), state: "QUEUED" }, headers });
}

function complete(task: string): Response {
	return json(200, {
		body: { output: { results: ["ok"] }, path: taskPath(task), state: "COMPLETE" },
	});
}

function processing(task: string): Response {
	return json(200, { body: { path: taskPath(task), state: "PROCESSING" } });
}

function internalTimeout(task: string): Response {
	return json(200, {
		body: {
			error: { code: "INTERNAL_ERROR", message: INTERNAL_TIMEOUT_MESSAGE },
			path: taskPath(task),
			state: "FAILED",
		},
	});
}

/**
 * Builds probe deps over a scripted queue of replies. Once the queue is
 * down to one entry that reply repeats, which lets a stuck-PROCESSING
 * task be scripted with one entry. `now` starts at 0 and advances by 1ms
 * per fetch and by the requested duration per sleep.
 *
 * @param replies - Scripted replies, oldest first; an Error entry is thrown.
 * @returns The deps plus the recorded calls and sleeps.
 */
function harness(replies: ReadonlyArray<Error | Response>): Harness {
	const queue = [...replies];
	const calls: Array<Call> = [];
	const sleeps: Array<number> = [];
	let clock = 0;
	return {
		calls,
		deps: {
			fetch: async (url, init) => {
				clock += 1;
				calls.push({
					body: typeof init.body === "string" ? init.body : undefined,
					method: init.method ?? "GET",
					url,
				});
				const next = queue.length > 1 ? queue.shift() : queue[0];
				if (next instanceof Error) {
					throw next;
				}

				if (next === undefined) {
					throw new Error("no scripted reply");
				}

				return next.clone();
			},
			log: () => {},
			now: () => clock,
			sleep: async (ms) => {
				sleeps.push(ms);
				clock += ms;
			},
		},
		sleeps,
	};
}

describe(runProbeAsync, () => {
	it("should poll each accepted task to a terminal state before submitting the next", async () => {
		expect.assertions(4);

		const { calls, deps } = harness([
			accepted("a"),
			processing("a"),
			complete("a"),
			accepted("b"),
			complete("b"),
		]);

		const run = await runProbeAsync(CONFIG, deps);

		expect(calls.map((call) => call.method)).toStrictEqual([
			"POST",
			"GET",
			"GET",
			"POST",
			"GET",
		]);
		expect(calls[0]).toStrictEqual({
			body: JSON.stringify({ script: 'return "ok"' }),
			method: "POST",
			url: "https://example.test/cloud/v2/universes/123/places/456/versions/7/luau-execution-session-tasks",
		});
		expect(calls[1]!.url).toBe(`https://example.test/cloud/v2/${taskPath("a")}`);
		expect(run.tasks.map((task) => task.classification)).toStrictEqual([
			"complete",
			"complete",
		]);
	});

	it("should stop on the first exact match and preserve that task resource", async () => {
		expect.assertions(4);

		const { calls, deps } = harness([accepted("a"), internalTimeout("a"), accepted("b")]);

		const run = await runProbeAsync(CONFIG, deps);

		expect(run.stoppedOnMatch).toBeTrue();
		expect(calls).toHaveLength(2);
		expect(run.tasks[0]!.classification).toBe("internal-timeout");
		expect(run.tasks[0]!.terminal).toStrictEqual({
			error: { code: "INTERNAL_ERROR", message: INTERNAL_TIMEOUT_MESSAGE },
			path: taskPath("a"),
			state: "FAILED",
		});
	});

	it("should count a task still running at the observation bound in the denominator", async () => {
		expect.assertions(3);

		const { deps } = harness([accepted("a"), processing("a")]);

		const run = await runProbeAsync({ ...CONFIG, targetAccepted: 1 }, deps);

		expect(run.tasks).toHaveLength(1);
		expect(run.tasks[0]!.classification).toBe("observation-bound");
		expect(run.tasks[0]!.observedMs).toBeGreaterThanOrEqual(CONFIG.observationMs);
	});

	it("should hold until the window edge when the submit reply reports no budget", async () => {
		expect.assertions(1);

		const { deps, sleeps } = harness([
			accepted("a", { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "12" }),
			complete("a"),
			accepted("b"),
			complete("b"),
		]);

		await runProbeAsync(CONFIG, deps);

		expect(sleeps).toStrictEqual([2000, 13_000, 2000]);
	});

	it("should keep a 429 out of the denominator, hold, and go on submitting", async () => {
		expect.assertions(3);

		const { deps, sleeps } = harness([
			json(429, {
				body: { errors: [{ code: 0, message: "" }] },
				headers: { "x-ratelimit-reset": "9" },
			}),
			accepted("a"),
			complete("a"),
			accepted("b"),
			complete("b"),
		]);

		const run = await runProbeAsync(CONFIG, deps);

		expect(run.rejections.map((rejection) => rejection.kind)).toStrictEqual(["rate-limited"]);
		expect(run.tasks).toHaveLength(2);
		expect(sleeps[0]).toBe(10_000);
	});

	it("should abort on an authorization or target error without submitting again", async () => {
		expect.assertions(3);

		const { calls, deps } = harness([json(403, { body: { message: "forbidden" } })]);

		const run = await runProbeAsync(CONFIG, deps);

		expect(run.aborted).toBe(
			"submit rejected with HTTP 403; check the key scopes and target ids",
		);
		expect(calls).toHaveLength(1);
		expect(run.tasks).toHaveLength(0);
	});

	it("should record transport and 5xx failures as request-path rejections up to the submit cap", async () => {
		expect.assertions(3);

		const { calls, deps } = harness([
			new Error("socket hang up"),
			json(502, { body: { message: "bad gateway" } }),
			new Error("socket hang up"),
			new Error("socket hang up"),
		]);

		const run = await runProbeAsync(CONFIG, deps);

		expect(calls).toHaveLength(CONFIG.maxSubmits);
		expect(run.rejections.map((rejection) => rejection.kind)).toStrictEqual([
			"request-path",
			"request-path",
			"request-path",
			"request-path",
		]);
		expect(run.rejections[0]!.exchange).toMatchObject({
			status: 0,
			transportError: "socket hang up",
		});
	});

	it("should give up on a task after consecutive unreadable or failed polls", async () => {
		expect.assertions(2);

		const { deps } = harness([
			accepted("a"),
			new Response("<html>", { status: 200 }),
			json(500, { body: { message: "oops" } }),
			accepted("b"),
			complete("b"),
		]);

		const run = await runProbeAsync(CONFIG, deps);

		expect(run.tasks.map((task) => task.classification)).toStrictEqual([
			"poll-failed",
			"complete",
		]);
		expect(run.tasks[0]!.polls).toHaveLength(2);
	});
});

async function greenRunAsync(): Promise<ProbeRun> {
	const { deps } = harness([accepted("a"), complete("a"), accepted("b"), complete("b")]);
	return runProbeAsync(CONFIG, deps);
}

async function matchedRunAsync(): Promise<ProbeRun> {
	const { deps } = harness([accepted("a"), internalTimeout("a")]);
	return runProbeAsync(CONFIG, deps);
}

describe(summarize, () => {
	it("should report the sample size and upper bound for a green run", async () => {
		expect.assertions(1);

		expect(summarize(await greenRunAsync())).toStrictEqual({
			accepted: 2,
			counts: {
				"cancelled": 0,
				"complete": 2,
				"deadline-exceeded": 0,
				"failed-other": 0,
				"internal-error-other": 0,
				"internal-timeout": 0,
				"observation-bound": 0,
				"poll-failed": 0,
			},
			exactMatches: 0,
			rejected: { rateLimited: 0, requestPath: 0 },
			upperBound: zeroFailureUpperBound(2),
		});
	});

	it("should omit the upper bound once an exact match was observed", async () => {
		expect.assertions(2);

		const summary = summarize(await matchedRunAsync());

		expect(summary.exactMatches).toBe(1);
		expect(summary.upperBound).toBeUndefined();
	});
});

describe(redactJson, () => {
	it("should replace every target and task identifier with a placeholder", async () => {
		expect.assertions(2);

		const text = JSON.stringify(redactJson(await matchedRunAsync()));

		expect(text).not.toMatch(/123|456|\/versions\/7|sessions\/s\/|tasks\/a/);
		expect(text).toContain(
			"universes/<universe>/places/<place>/versions/<version>/luau-execution-sessions/<session>/tasks/<task>",
		);
	});

	it("should keep only allow-listed response headers", async () => {
		expect.assertions(1);

		const { deps } = harness([
			accepted("a", { "roblox-machine-id": "MACHINE", "x-ratelimit-remaining": "4" }),
			complete("a"),
		]);
		const run = await runProbeAsync({ ...CONFIG, targetAccepted: 1 }, deps);

		expect(redactJson(run).tasks[0]!.submit.headers).toStrictEqual({
			"content-type": "application/json",
			"x-ratelimit-remaining": "4",
		});
	});
});

describe(renderReport, () => {
	it("should state the bounded green result without claiming a fix", async () => {
		expect.assertions(3);

		const report = renderReport(await greenRunAsync());

		expect(report).toContain("No reproduction in 2 accepted tasks (0/2 exact matches)");
		expect(report).toContain("95% one-sided upper bound on the true rate: 77.6%");
		expect(report).not.toContain("fixed");
	});

	it("should format an exact match as a regression contribution with the task path", async () => {
		expect.assertions(3);

		const report = renderReport(await matchedRunAsync());

		expect(report).toContain("REPRODUCED");
		expect(report).toContain("## Regression contribution");
		expect(report).toContain(taskPath("a"));
	});

	it("should name the abort reason", async () => {
		expect.assertions(1);

		const { deps } = harness([json(401, { body: {} })]);

		expect(renderReport(await runProbeAsync(CONFIG, deps))).toContain(
			"Aborted: submit rejected",
		);
	});
});
