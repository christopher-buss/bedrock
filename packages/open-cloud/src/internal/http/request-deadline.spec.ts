import { describe, expect, it } from "vitest";

import { createFakeClock } from "#tests/helpers/fake-clock";
import {
	elapsedDeadlineFailure,
	requestLifecycle,
	waitDeadlineFailure,
} from "./request-deadline.ts";

describe(requestLifecycle, () => {
	it("should compose caller cancellation with the absolute deadline", () => {
		expect.assertions(3);

		createFakeClock();
		const controller = new AbortController();
		const lifecycle = requestLifecycle(10_000, controller.signal);
		controller.abort("cancelled");

		expect(lifecycle.signal).not.toBe(controller.signal);
		expect(lifecycle.signal!.aborted).toBeTrue();
		expect(lifecycle.signal!.reason).toBe("cancelled");
	});

	it("should treat the exact deadline instant as elapsed", () => {
		expect.assertions(2);

		createFakeClock();
		const failure = elapsedDeadlineFailure(requestLifecycle(0, undefined));

		expect(failure!.message).toBe("Request deadline elapsed");
		expect(failure!.remainingMs).toBe(0);
	});
});

describe(waitDeadlineFailure, () => {
	it("should refuse even a zero-duration wait at the deadline instant", () => {
		expect.assertions(2);

		createFakeClock();
		const failure = waitDeadlineFailure({
			deadlineMs: 0,
			waitMs: 0,
			waitReason: "retry-delay",
		});

		expect(failure!.remainingMs).toBe(0);
		expect(failure!.waitMs).toBe(0);
	});
});
