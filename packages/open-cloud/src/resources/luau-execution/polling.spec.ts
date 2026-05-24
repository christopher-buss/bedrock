import { assert, describe, expect, it, vi } from "vitest";

import { CodedError } from "../../../tests/helpers/coded-error.ts";
import { createFakeClock } from "../../../tests/helpers/fake-clock.ts";
import { createFakeSleep } from "../../../tests/helpers/fake-sleep.ts";
import type {
	LuauExecutionTask,
	LuauExecutionTaskRef,
} from "../../domains/cloud-v2/luau-execution-tasks/types.ts";
import { ApiError } from "../../errors/api-error.ts";
import { NetworkError } from "../../errors/network-error.ts";
import { PollAbortedError } from "../../errors/poll-aborted.ts";
import { PollTimeoutError } from "../../errors/poll-timeout.ts";
import { defaultRetryDelay, TRANSIENT_TRANSPORT_CODES } from "../../internal/http/retry.ts";
import {
	DEFAULT_POLL_FAILURE_CAP,
	DEFAULT_POLL_TIMEOUT_MS,
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

	// Slice 6: polls until terminal with one wait between fetches
	it("should sleep using pollDelay between successive fetches until a terminal state arrives", async () => {
		expect.assertions(2);

		const sleep = createFakeSleep();
		const fetch = vi
			.fn<PollDeps["fetch"]>()
			.mockResolvedValueOnce({ data: makeTask("QUEUED"), success: true })
			.mockResolvedValueOnce({ data: makeTask("PROCESSING"), success: true })
			.mockResolvedValueOnce({ data: makeTask("COMPLETE"), success: true });

		const result = await pollUntilDoneCore(makeDeps({ fetch, sleep }), {
			pollDelay: defaultRetryDelay,
		});

		assert(result.success);

		expect(fetch).toHaveBeenCalledTimes(3);
		expect(sleep.waits).toStrictEqual([defaultRetryDelay(0), defaultRetryDelay(1)]);
	});

	// Slice 7: caps backoff at 30s after attempt 5
	it("should cap the sleep at 30000ms once the backoff curve saturates", async () => {
		expect.assertions(1);

		const sleep = createFakeSleep();
		// Generate enough non-terminal responses to push past attempt 5
		const fetch = vi.fn<PollDeps["fetch"]>();
		for (let index = 0; index < 6; index++) {
			fetch.mockResolvedValueOnce({ data: makeTask("QUEUED"), success: true });
		}

		fetch.mockResolvedValueOnce({ data: makeTask("COMPLETE"), success: true });

		await pollUntilDoneCore(makeDeps({ fetch, sleep }), {
			pollDelay: defaultRetryDelay,
		});

		expect(sleep.waits.at(-1)).toBe(30_000);
	});

	// Slice 8: defaultRetryDelay is the default pollDelay
	it("should fall back to defaultRetryDelay when no pollDelay override is supplied", async () => {
		expect.assertions(1);

		const sleep = createFakeSleep();
		const fetch = vi
			.fn<PollDeps["fetch"]>()
			.mockResolvedValueOnce({ data: makeTask("QUEUED"), success: true })
			.mockResolvedValueOnce({ data: makeTask("COMPLETE"), success: true });

		await pollUntilDoneCore(makeDeps({ fetch, sleep }));

		expect(sleep.waits).toStrictEqual([defaultRetryDelay(0)]);
	});

	// Slice 9: custom pollDelay is honoured
	it("should call the supplied pollDelay function with each zero-indexed attempt and use its return value", async () => {
		expect.assertions(2);

		const sleep = createFakeSleep();
		const pollDelay = vi.fn<(attempt: number) => number>((attempt) => 50 + attempt);
		const fetch = vi
			.fn<PollDeps["fetch"]>()
			.mockResolvedValueOnce({ data: makeTask("QUEUED"), success: true })
			.mockResolvedValueOnce({ data: makeTask("PROCESSING"), success: true })
			.mockResolvedValueOnce({ data: makeTask("COMPLETE"), success: true });

		await pollUntilDoneCore(makeDeps({ fetch, sleep }), { pollDelay });

		expect(pollDelay).toHaveBeenCalledWith(0);
		expect(sleep.waits).toStrictEqual([50, 51]);
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

	function makeNetworkError(): NetworkError {
		const [code = "ECONNRESET"] = TRANSIENT_TRANSPORT_CODES;
		const reset = new CodedError(`read ${code}`, code);
		return new NetworkError("Network request failed", { cause: reset });
	}

	it("should keep polling after a transient network failure and resolve on a terminal state", async () => {
		expect.assertions(2);

		const sleep = createFakeSleep();
		const fetch = vi
			.fn<PollDeps["fetch"]>()
			.mockResolvedValueOnce({ err: makeNetworkError(), success: false })
			.mockResolvedValueOnce({ data: makeTask("COMPLETE"), success: true });

		const result = await pollUntilDoneCore(makeDeps({ fetch, sleep }), {
			pollDelay: () => 100,
		});

		assert(result.success);

		expect(result.data.state).toBe("COMPLETE");
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it("should abort immediately without further polls on a non-network failure", async () => {
		expect.assertions(2);

		const apiError = new ApiError("not found", { statusCode: 404 });
		const fetch = vi
			.fn<PollDeps["fetch"]>()
			.mockResolvedValue({ err: apiError, success: false });

		const result = await pollUntilDoneCore(makeDeps({ fetch }), {
			maxConsecutivePollFailures: 3,
			pollDelay: () => 0,
		});

		assert(!result.success);

		expect(result.err).toBe(apiError);
		expect(fetch).toHaveBeenCalledOnce();
	});

	it("should abort immediately on a self-aborted network failure with no transport code", async () => {
		expect.assertions(2);

		const selfAbort = new NetworkError("Network request failed", {
			cause: new DOMException("timed out", "TimeoutError"),
		});
		const fetch = vi
			.fn<PollDeps["fetch"]>()
			.mockResolvedValue({ err: selfAbort, success: false });

		const result = await pollUntilDoneCore(makeDeps({ fetch }), {
			maxConsecutivePollFailures: 3,
			pollDelay: () => 0,
		});

		assert(!result.success);

		expect(result.err).toBe(selfAbort);
		expect(fetch).toHaveBeenCalledOnce();
	});

	it("should abort immediately on a network failure whose transport code is not transient", async () => {
		expect.assertions(2);

		const nonTransient = new CodedError("weird", "NOT_A_TRANSIENT_CODE");
		const networkError = new NetworkError("Network request failed", { cause: nonTransient });
		const fetch = vi
			.fn<PollDeps["fetch"]>()
			.mockResolvedValue({ err: networkError, success: false });

		const result = await pollUntilDoneCore(makeDeps({ fetch }), {
			maxConsecutivePollFailures: 3,
			pollDelay: () => 0,
		});

		assert(!result.success);

		expect(result.err).toBe(networkError);
		expect(fetch).toHaveBeenCalledOnce();
	});

	it("should abort immediately on an api error even if it carries a transport-style code", async () => {
		expect.assertions(2);

		const apiError = new ApiError("masquerade", { code: "ECONNRESET", statusCode: 500 });
		const fetch = vi
			.fn<PollDeps["fetch"]>()
			.mockResolvedValue({ err: apiError, success: false });

		const result = await pollUntilDoneCore(makeDeps({ fetch }), {
			maxConsecutivePollFailures: 3,
			pollDelay: () => 0,
		});

		assert(!result.success);

		expect(result.err).toBe(apiError);
		expect(fetch).toHaveBeenCalledOnce();
	});

	it("should give up after the configured number of consecutive network failures", async () => {
		expect.assertions(2);

		const networkError = makeNetworkError();
		const fetch = vi
			.fn<PollDeps["fetch"]>()
			.mockResolvedValue({ err: networkError, success: false });

		const result = await pollUntilDoneCore(makeDeps({ fetch }), {
			maxConsecutivePollFailures: 3,
			pollDelay: () => 0,
		});

		assert(!result.success);

		expect(result.err).toBe(networkError);
		expect(fetch).toHaveBeenCalledTimes(3);
	});

	it("should reset the consecutive-failure count after a successful poll", async () => {
		expect.assertions(2);

		const fetch = vi
			.fn<PollDeps["fetch"]>()
			.mockResolvedValueOnce({ err: makeNetworkError(), success: false })
			.mockResolvedValueOnce({ err: makeNetworkError(), success: false })
			.mockResolvedValueOnce({ data: makeTask("PROCESSING"), success: true })
			.mockResolvedValueOnce({ err: makeNetworkError(), success: false })
			.mockResolvedValueOnce({ err: makeNetworkError(), success: false })
			.mockResolvedValueOnce({ data: makeTask("COMPLETE"), success: true });

		const result = await pollUntilDoneCore(makeDeps({ fetch }), {
			maxConsecutivePollFailures: 3,
			pollDelay: () => 0,
		});

		assert(result.success);

		expect(result.data.state).toBe("COMPLETE");
		expect(fetch).toHaveBeenCalledTimes(6);
	});

	it("should default the consecutive-failure cap to three", async () => {
		expect.assertions(2);

		expect(DEFAULT_POLL_FAILURE_CAP).toBe(3);

		const fetch = vi
			.fn<PollDeps["fetch"]>()
			.mockResolvedValue({ err: makeNetworkError(), success: false });

		await pollUntilDoneCore(makeDeps({ fetch }), { pollDelay: () => 0 });

		expect(fetch).toHaveBeenCalledTimes(DEFAULT_POLL_FAILURE_CAP);
	});
});
