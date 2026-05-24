import { assert, describe, expect, it, vi } from "vitest";

import { createFakeClock } from "../../../tests/helpers/fake-clock.ts";
import { createFakeSleep } from "../../../tests/helpers/fake-sleep.ts";
import type {
	LuauExecutionTask,
	LuauExecutionTaskRef,
} from "../../domains/cloud-v2/luau-execution-tasks/types.ts";
import { ApiError } from "../../errors/api-error.ts";
import { PollAbortedError } from "../../errors/poll-aborted.ts";
import { PollTimeoutError } from "../../errors/poll-timeout.ts";
import {
	DEFAULT_POLL_TIMEOUT_MS,
	defaultPollDelay,
	type PollDeps,
	pollUntilDoneCore,
} from "./polling.ts";

const ref: LuauExecutionTaskRef = {
	placeId: "456",
	sessionId: "session-1",
	taskId: "task-1",
	universeId: "123",
	versionId: "789",
};

function makeTask(state: LuauExecutionTask["state"]): LuauExecutionTask {
	const base = {
		createdAt: new Date("2026-01-01T00:00:00Z"),
		ref,
		updatedAt: new Date("2026-01-01T00:00:01Z"),
		user: "user-1",
	};
	if (state === "COMPLETE") {
		return { ...base, output: { results: [] }, state };
	}

	if (state === "FAILED") {
		return { ...base, error: { code: "SCRIPT_ERROR", message: "oops" }, state };
	}

	return { ...base, state };
}

function makeDeps(overrides: Partial<PollDeps> = {}): PollDeps {
	return {
		fetch: vi
			.fn<PollDeps["fetch"]>()
			.mockResolvedValue({ data: makeTask("COMPLETE"), success: true }),
		now: () => 0,
		sleep: createFakeSleep(),
		...overrides,
	};
}

describe(pollUntilDoneCore, () => {
	// Slice 3: resolves with COMPLETE on first poll
	it("should resolve with the task when the first fetch returns COMPLETE", async () => {
		expect.assertions(3);

		const completeTask = makeTask("COMPLETE");
		const sleep = createFakeSleep();
		const fetch = vi
			.fn<PollDeps["fetch"]>()
			.mockResolvedValue({ data: completeTask, success: true });
		const deps = makeDeps({ fetch, sleep });

		const result = await pollUntilDoneCore(deps);

		assert(result.success);

		expect(result.data.state).toBe("COMPLETE");
		expect(fetch).toHaveBeenCalledOnce();
		expect(sleep.waits).toStrictEqual([]);
	});

	// Slice 4: resolves with FAILED on first poll
	it("should resolve with the task when the first fetch returns FAILED", async () => {
		expect.assertions(3);

		const failedTask = makeTask("FAILED");
		const sleep = createFakeSleep();
		const fetch = vi
			.fn<PollDeps["fetch"]>()
			.mockResolvedValue({ data: failedTask, success: true });
		const deps = makeDeps({ fetch, sleep });

		const result = await pollUntilDoneCore(deps);

		assert(result.success);

		expect(result.data.state).toBe("FAILED");
		expect(fetch).toHaveBeenCalledOnce();
		expect(sleep.waits).toStrictEqual([]);
	});

	// Slice 5: treats CANCELLED as terminal
	it("should resolve with the task when the first fetch returns CANCELLED", async () => {
		expect.assertions(3);

		const cancelledTask = makeTask("CANCELLED");
		const sleep = createFakeSleep();
		const fetch = vi
			.fn<PollDeps["fetch"]>()
			.mockResolvedValue({ data: cancelledTask, success: true });
		const deps = makeDeps({ fetch, sleep });

		const result = await pollUntilDoneCore(deps);

		assert(result.success);

		expect(result.data.state).toBe("CANCELLED");
		expect(fetch).toHaveBeenCalledOnce();
		expect(sleep.waits).toStrictEqual([]);
	});

	// Sleeps the pollDelay result between successive non-terminal fetches.
	it("should sleep the pollDelay result between successive fetches until a terminal state arrives", async () => {
		expect.assertions(2);

		const sleep = createFakeSleep();
		const fetch = vi
			.fn<PollDeps["fetch"]>()
			.mockResolvedValueOnce({ data: makeTask("QUEUED"), success: true })
			.mockResolvedValueOnce({ data: makeTask("PROCESSING"), success: true })
			.mockResolvedValueOnce({ data: makeTask("COMPLETE"), success: true });

		const result = await pollUntilDoneCore(makeDeps({ fetch, sleep }), {
			pollDelay: () => 100,
		});

		assert(result.success);

		expect(fetch).toHaveBeenCalledTimes(3);
		expect(sleep.waits).toStrictEqual([100, 100]);
	});

	// The schedule is keyed on elapsed wall-clock time, not the attempt index.
	it("should call pollDelay with elapsed time since start, not the attempt index", async () => {
		expect.assertions(2);

		const clock = createFakeClock();
		const pollDelay = vi.fn<(elapsedMs: number) => number>(() => 100);
		const fetch = vi
			.fn<PollDeps["fetch"]>()
			.mockResolvedValueOnce({ data: makeTask("QUEUED"), success: true })
			.mockResolvedValueOnce({ data: makeTask("PROCESSING"), success: true })
			.mockResolvedValueOnce({ data: makeTask("COMPLETE"), success: true });

		await pollUntilDoneCore({ fetch, now: Date.now, sleep: clock.sleep }, { pollDelay });

		// Each 100ms sleep advances the clock, so successive calls observe
		// 0, 100, 200, proving elapsed time, not attempt index (0, 1, 2).
		// pollDelay is computed once per iteration, including the terminal one.
		expect(pollDelay.mock.calls).toStrictEqual([[0], [100], [200]]);
		expect(clock.waits).toStrictEqual([100, 100]);
	});

	// Defaults to the elapsed-keyed defaultPollDelay when no override is given.
	it("should fall back to defaultPollDelay when no pollDelay override is supplied", async () => {
		expect.assertions(1);

		const sleep = createFakeSleep();
		const fetch = vi
			.fn<PollDeps["fetch"]>()
			.mockResolvedValueOnce({ data: makeTask("QUEUED"), success: true })
			.mockResolvedValueOnce({ data: makeTask("COMPLETE"), success: true });

		await pollUntilDoneCore(makeDeps({ fetch, sleep }));

		expect(sleep.waits).toStrictEqual([defaultPollDelay(0)]);
	});

	// Slice 10: PollTimeoutError with last-observed task on exhaustion
	it("should resolve with PollTimeoutError carrying the last observed task when the wall-clock budget is exhausted", async () => {
		expect.assertions(5);

		const clock = createFakeClock();
		// Advance before the call so startedAt > 0; this makes now()-startedAt
		// arithmetically distinct from now()+startedAt (kills a Stryker mutant).
		clock.advance(1000);
		const processingTask = makeTask("PROCESSING");
		const fetch = vi
			.fn<PollDeps["fetch"]>()
			.mockResolvedValue({ data: processingTask, success: true });

		const result = await pollUntilDoneCore(
			{ fetch, now: Date.now, sleep: clock.sleep },
			{
				pollDelay: () => 100,
				timeoutMs: 300,
			},
		);

		assert(!result.success);

		expect(result.err).toBeInstanceOf(PollTimeoutError);

		const err = result.err as PollTimeoutError<LuauExecutionTask>;

		expect(err.lastObservedTask).toBe(processingTask);
		expect(err.timeoutMs).toBe(300);
		expect(err.message).toBe("Polling timed out after 300 ms");
		expect(fetch).toHaveBeenCalledTimes(3);
	});

	// Slice 11: default timeoutMs is 300_000
	it("should default timeoutMs to 300000 when no override is supplied", () => {
		expect.assertions(1);

		expect(DEFAULT_POLL_TIMEOUT_MS).toBe(300_000);
	});

	// Slice 12: PollAbortedError when signal is pre-aborted
	it("should resolve with PollAbortedError without issuing a fetch when the signal is already aborted", async () => {
		expect.assertions(4);

		const controller = new AbortController();
		controller.abort("pre-aborted reason");
		const fetch = vi.fn<PollDeps["fetch"]>();

		const result = await pollUntilDoneCore(makeDeps({ fetch }), {
			signal: controller.signal,
		});

		assert(!result.success);

		const err = result.err as PollAbortedError;

		expect(err).toBeInstanceOf(PollAbortedError);
		expect(err.message).toBe("Polling was aborted");
		expect(err.reason).toBe("pre-aborted reason");
		expect(fetch).not.toHaveBeenCalled();
	});

	// Slice 13: PollAbortedError mid-sleep
	it("should resolve with PollAbortedError when the signal fires while the loop is sleeping between polls", async () => {
		expect.assertions(2);

		const controller = new AbortController();
		let resolveSlowSleep: (() => void) | undefined;

		async function slowSleep(_ms: number): Promise<void> {
			return new Promise<void>((resolve) => {
				resolveSlowSleep = resolve;
			});
		}

		const fetch = vi
			.fn<PollDeps["fetch"]>()
			.mockResolvedValueOnce({ data: makeTask("PROCESSING"), success: true });

		const pollingPromise = pollUntilDoneCore(makeDeps({ fetch, sleep: slowSleep }), {
			signal: controller.signal,
		});

		// Let the first fetch complete, then abort mid-sleep
		await vi.waitUntil(() => resolveSlowSleep !== undefined);
		controller.abort("mid-sleep abort");

		const result = await pollingPromise;

		assert(!result.success);

		expect(result.err).toBeInstanceOf(PollAbortedError);
		// The mid-sleep return short-circuits the loop; without it the next
		// iteration would call fetch a second time before catching the abort.
		expect(fetch).toHaveBeenCalledOnce();

		// The slow sleep promise never resolved; the loop returned early.
		resolveSlowSleep?.();
	});

	it("should remove the abort listener after polling resolves", async () => {
		expect.assertions(2);

		const controller = new AbortController();
		const removeSpy = vi.spyOn(controller.signal, "removeEventListener");
		const fetch = vi
			.fn<PollDeps["fetch"]>()
			.mockResolvedValueOnce({ data: makeTask("QUEUED"), success: true })
			.mockResolvedValueOnce({ data: makeTask("COMPLETE"), success: true });

		const result = await pollUntilDoneCore(makeDeps({ fetch }), {
			pollDelay: () => 0,
			signal: controller.signal,
		});

		assert(result.success);

		expect(result.data.state).toBe("COMPLETE");
		expect(removeSpy).toHaveBeenCalledWith("abort", expect.any(Function));
	});

	// Kills sleepWithAbort's sleep-completion branch: sleep(ms).then(() => false
	// as const)
	it("should continue polling normally when signal is live but never fires and sleep completes", async () => {
		expect.assertions(3);

		const controller = new AbortController();
		const sleep = createFakeSleep();
		const fetch = vi
			.fn<PollDeps["fetch"]>()
			.mockResolvedValueOnce({ data: makeTask("QUEUED"), success: true })
			.mockResolvedValueOnce({ data: makeTask("COMPLETE"), success: true });

		const result = await pollUntilDoneCore(makeDeps({ fetch, sleep }), {
			pollDelay: () => 100,
			signal: controller.signal,
		});

		assert(result.success);

		expect(result.data.state).toBe("COMPLETE");
		expect(fetch).toHaveBeenCalledTimes(2);
		expect(sleep.waits).toStrictEqual([100]);
	});

	// Slice 14: PollAbortedError between fetch and next sleep
	it("should resolve with PollAbortedError when the signal fires after a fetch returns but before the next sleep starts", async () => {
		expect.assertions(3);

		const controller = new AbortController();
		const fetch = vi.fn<PollDeps["fetch"]>().mockImplementation(async () => {
			// Abort on the way back from the fetch
			controller.abort("post-fetch abort");
			return { data: makeTask("PROCESSING"), success: true };
		});

		const sleep = createFakeSleep();
		const result = await pollUntilDoneCore(makeDeps({ fetch, sleep }), {
			signal: controller.signal,
		});

		assert(!result.success);

		expect(result.err).toBeInstanceOf(PollAbortedError);
		expect(fetch).toHaveBeenCalledOnce();
		expect(sleep.waits).toStrictEqual([]);
	});

	it("should resolve with PollAbortedError when the signal fires while a fetch is in-flight", async () => {
		expect.assertions(1);

		const controller = new AbortController();
		let resolveSlowFetch: (() => void) | undefined;

		async function slowFetch(): ReturnType<PollDeps["fetch"]> {
			return new Promise((resolve) => {
				resolveSlowFetch = (): void => {
					resolve({ data: makeTask("PROCESSING"), success: true });
				};
			});
		}

		const sleep = createFakeSleep();
		const pollingPromise = pollUntilDoneCore(makeDeps({ fetch: slowFetch, sleep }), {
			signal: controller.signal,
		});

		await vi.waitUntil(() => resolveSlowFetch !== undefined);
		controller.abort("mid-fetch abort");

		const result = await pollingPromise;

		assert(!result.success);

		expect(result.err).toBeInstanceOf(PollAbortedError);

		// The slow fetch never resolved; the loop returned early.
		resolveSlowFetch?.();
	});

	// Slice 15: underlying transport error is propagated
	it("should propagate the transport error when the underlying fetch returns Result.err", async () => {
		expect.assertions(1);

		const transportError = new ApiError("server error", { statusCode: 500 });
		const fetch = vi
			.fn<PollDeps["fetch"]>()
			.mockResolvedValue({ err: transportError, success: false });

		const result = await pollUntilDoneCore(makeDeps({ fetch }));

		assert(!result.success);

		expect(result.err).toBe(transportError);
	});
});

describe(defaultPollDelay, () => {
	it.for([
		{ elapsedMs: 0, expected: 500 },
		{ elapsedMs: 19_999, expected: 500 },
		{ elapsedMs: 20_000, expected: 1_000 },
		{ elapsedMs: 59_999, expected: 1_000 },
		{ elapsedMs: 60_000, expected: 5_000 },
		{ elapsedMs: 300_000, expected: 5_000 },
	])("should return $expected ms when $elapsedMs ms have elapsed", ({ elapsedMs, expected }) => {
		expect.assertions(1);

		expect(defaultPollDelay(elapsedMs)).toBe(expected);
	});
});
