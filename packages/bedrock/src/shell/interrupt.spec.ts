import { describe, it, vi } from "vitest";

import { INTERRUPT_GRACE_MS, linkGraceEnd, watchInterrupt } from "./interrupt.ts";

describe(watchInterrupt, () => {
	it("should abort requests only when the grace period after the signal ends", ({
		expect,
		onTestFinished,
	}) => {
		expect.assertions(4);

		vi.useFakeTimers();
		onTestFinished(() => {
			vi.useRealTimers();
		});
		const controller = new AbortController();
		const watch = watchInterrupt(controller.signal);

		vi.advanceTimersByTime(INTERRUPT_GRACE_MS * 2);

		expect(watch.requests.aborted).toBeFalse();

		controller.abort();

		expect(watch.stop.aborted).toBeTrue();

		vi.advanceTimersByTime(INTERRUPT_GRACE_MS - 1);

		expect(watch.requests.aborted).toBeFalse();

		vi.advanceTimersByTime(1);

		expect(watch.requests.aborted).toBeTrue();
	});

	it("should keep the grace period at 5 s", ({ expect }) => {
		expect.assertions(1);

		expect(INTERRUPT_GRACE_MS).toBe(5000);
	});

	it("should start the grace period at once for a signal that already aborted", ({
		expect,
		onTestFinished,
	}) => {
		expect.assertions(2);

		vi.useFakeTimers();
		onTestFinished(() => {
			vi.useRealTimers();
		});
		const watch = watchInterrupt(AbortSignal.abort());

		expect(watch.requests.aborted).toBeFalse();

		vi.advanceTimersByTime(INTERRUPT_GRACE_MS);

		expect(watch.requests.aborted).toBeTrue();
	});

	it("should end the grace period at once when the linked grace end aborts", ({
		expect,
		onTestFinished,
	}) => {
		expect.assertions(2);

		vi.useFakeTimers();
		onTestFinished(() => {
			vi.useRealTimers();
		});
		const controller = new AbortController();
		const graceEnd = new AbortController();
		linkGraceEnd(controller.signal, graceEnd.signal);
		const watch = watchInterrupt(controller.signal);
		controller.abort();

		expect(watch.requests.aborted).toBeFalse();

		graceEnd.abort();

		expect(watch.requests.aborted).toBeTrue();
	});

	it("should not end the grace period before the signal aborts", ({ expect }) => {
		expect.assertions(2);

		const controller = new AbortController();
		const graceEnd = new AbortController();
		linkGraceEnd(controller.signal, graceEnd.signal);
		graceEnd.abort();
		const watch = watchInterrupt(controller.signal);

		expect(watch.requests.aborted).toBeFalse();

		controller.abort();

		expect(watch.requests.aborted).toBeTrue();
	});

	it("should leave requests alone after it is disposed", ({ expect, onTestFinished }) => {
		expect.assertions(2);

		vi.useFakeTimers();
		onTestFinished(() => {
			vi.useRealTimers();
		});
		const controller = new AbortController();
		const graceEnd = new AbortController();
		linkGraceEnd(controller.signal, graceEnd.signal);
		const watch = watchInterrupt(controller.signal);
		watch.dispose();
		controller.abort();
		vi.advanceTimersByTime(INTERRUPT_GRACE_MS);

		expect(watch.requests.aborted).toBeFalse();

		const started = watchInterrupt(controller.signal);
		started.dispose();
		vi.advanceTimersByTime(INTERRUPT_GRACE_MS);
		graceEnd.abort();

		expect(started.requests.aborted).toBeFalse();
	});
});
