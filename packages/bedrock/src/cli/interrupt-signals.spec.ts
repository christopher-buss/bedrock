import { describe, it, vi } from "vitest";

import { fakeSignalSource } from "#tests/helpers/signals";
import { INTERRUPT_GRACE_MS, watchInterrupt } from "../shell/interrupt.ts";
import { type InterruptSignal, listenForInterrupt } from "./interrupt-signals.ts";

describe(listenForInterrupt, () => {
	it.for<[InterruptSignal, number]>([
		["SIGINT", 130],
		["SIGTERM", 143],
	])("should abort the signal on %s and owe exit code %i", ([name, code], { expect }) => {
		expect.assertions(3);

		const source = fakeSignalSource();
		const listener = listenForInterrupt(source);

		expect(listener.exitCode()).toBeUndefined();

		source.send(name);

		expect(listener.signal.reason).toStrictEqual(new Error(`received ${name}`));
		expect(listener.exitCode()).toBe(code);
	});

	it("should keep the exit code of the first signal", ({ expect }) => {
		expect.assertions(1);

		const source = fakeSignalSource();
		const listener = listenForInterrupt(source);
		source.send("SIGTERM");
		source.send("SIGINT");
		source.send("SIGINT");

		expect(listener.exitCode()).toBe(143);
	});

	it("should end the grace period at once on a second signal", ({ expect, onTestFinished }) => {
		expect.assertions(2);

		vi.useFakeTimers();
		onTestFinished(() => {
			vi.useRealTimers();
		});
		const source = fakeSignalSource();
		const listener = listenForInterrupt(source);
		const watch = watchInterrupt(listener.signal, listener.graceEnd);
		source.send("SIGINT");
		vi.advanceTimersByTime(INTERRUPT_GRACE_MS - 1);

		expect(watch.requests.aborted).toBeFalse();

		source.send("SIGINT");

		expect(watch.requests.aborted).toBeTrue();
	});

	it("should stop listening once disposed", ({ expect }) => {
		expect.assertions(1);

		const source = fakeSignalSource();
		listenForInterrupt(source).dispose();

		expect(source.count()).toBe(0);
	});
});
