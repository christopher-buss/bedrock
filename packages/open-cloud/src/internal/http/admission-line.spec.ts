import { describe, expect, it } from "vitest";

import { createFakeSleep } from "#tests/helpers/fake-sleep";
import type { AdmissionWait } from "../../client/types.ts";
import { RequestAbortedError } from "../../errors/request-aborted.ts";
import { ABORTED } from "../utils/abort.ts";
import type { SleepFunc } from "../utils/sleep.ts";
import { AdmissionLine } from "./admission-line.ts";

function createObserver(): {
	readonly observer: (wait: AdmissionWait) => void;
	readonly waits: ReadonlyArray<AdmissionWait>;
} {
	const waits: Array<AdmissionWait> = [];
	return {
		observer(wait) {
			waits.push(wait);
		},
		waits,
	};
}

/**
 * A sleep whose first call blocks until the returned trigger fires, so a test
 * can hold the line while other requests queue on it.
 *
 * @returns The sleep, a promise for its first call, and its release trigger.
 */
function createHoldingSleep(): {
	readonly release: () => void;
	readonly sleep: SleepFunc;
	readonly started: Promise<void>;
} {
	const started = Promise.withResolvers<void>();
	const released = Promise.withResolvers<void>();
	const holds = [released.promise];

	async function sleepAsync(): Promise<void> {
		const hold = holds.pop();
		started.resolve();
		await hold;
	}

	return { release: released.resolve, sleep: sleepAsync, started: started.promise };
}

describe(AdmissionLine, () => {
	it("should report nothing for a turn that never sleeps", async () => {
		expect.assertions(1);

		const { observer, waits } = createObserver();
		const line = new AdmissionLine("operation-queue", createFakeSleep());

		await line.admitAsync(async () => {}, { onAdmissionWait: observer });

		expect(waits).toStrictEqual([]);
	});

	it("should report the sleeping turn's own wait with its duration", async () => {
		expect.assertions(1);

		const { observer, waits } = createObserver();
		const line = new AdmissionLine("reported-budget", createFakeSleep());

		await line.admitAsync(
			async (span) => void (await line.sleepAsync(750, { signal: undefined, span })),
			{
				onAdmissionWait: observer,
			},
		);

		expect(waits).toStrictEqual([
			{ phase: "start", reason: "reported-budget", waitMs: 750 },
			{ phase: "end", reason: "reported-budget", waitMs: 750 },
		]);
	});

	it("should report a wait without a duration for a request queued before the sleep", async () => {
		expect.assertions(1);

		const { observer, waits } = createObserver();
		const holdingSleep = createHoldingSleep();
		const line = new AdmissionLine("operation-queue", holdingSleep.sleep);

		const holder = line.admitAsync(
			async (span) => void (await line.sleepAsync(100, { signal: undefined, span })),
			{},
		);
		const queued = line.admitAsync(async () => {}, { onAdmissionWait: observer });
		await holdingSleep.started;
		holdingSleep.release();
		await holder;
		await queued;

		expect(waits).toStrictEqual([
			{ phase: "start", reason: "operation-queue" },
			{ phase: "end", reason: "operation-queue" },
		]);
	});

	it("should report a wait without a duration for a request joining a sleeping line", async () => {
		expect.assertions(1);

		const { observer, waits } = createObserver();
		const holdingSleep = createHoldingSleep();
		const line = new AdmissionLine("operation-queue", holdingSleep.sleep);

		const holder = line.admitAsync(
			async (span) => void (await line.sleepAsync(100, { signal: undefined, span })),
			{},
		);
		await holdingSleep.started;
		const queued = line.admitAsync(async () => {}, { onAdmissionWait: observer });
		holdingSleep.release();
		await holder;
		await queued;

		expect(waits).toStrictEqual([
			{ phase: "start", reason: "operation-queue" },
			{ phase: "end", reason: "operation-queue" },
		]);
	});

	it("should end a wait when cancellation takes the request off the line", async () => {
		expect.assertions(2);

		const { observer, waits } = createObserver();
		const holdingSleep = createHoldingSleep();
		const line = new AdmissionLine("operation-queue", holdingSleep.sleep);
		const controller = new AbortController();

		const cancelled = line.admitAsync(
			async (span) => void (await line.sleepAsync(100, { signal: controller.signal, span })),
			{ onAdmissionWait: observer, signal: controller.signal },
		);
		await holdingSleep.started;
		controller.abort("no longer needed");

		await expect(cancelled).rejects.toBeInstanceOf(RequestAbortedError);

		expect(waits).toStrictEqual([
			{ phase: "start", reason: "operation-queue", waitMs: 100 },
			{ phase: "end", reason: "operation-queue", waitMs: 100 },
		]);
	});

	it("should run the next turn after one rejects", async () => {
		expect.assertions(2);

		const line = new AdmissionLine("operation-queue", createFakeSleep());

		const failed = line.admitAsync(async () => {
			throw new Error("turn failed");
		}, {});

		await expect(failed).rejects.toThrow("turn failed");

		let ran = false;
		await line.admitAsync(async () => {
			ran = true;
		}, {});

		expect(ran).toBeTrue();
	});

	it("should report the cancelled sleep to the turn that ran it", async () => {
		expect.assertions(2);

		const holdingSleep = createHoldingSleep();
		const line = new AdmissionLine("reported-budget", holdingSleep.sleep);
		const controller = new AbortController();
		let sleepOutcome: unknown;

		const cancelled = line.admitAsync(
			async (span) => {
				sleepOutcome = await line.sleepAsync(50, { signal: controller.signal, span });
			},
			{ signal: controller.signal },
		);
		await holdingSleep.started;
		controller.abort("no longer needed");

		await expect(cancelled).rejects.toBeInstanceOf(RequestAbortedError);

		expect(sleepOutcome).toBe(ABORTED);
	});

	it("should report nothing for a request joining after the line woke up", async () => {
		expect.assertions(1);

		const { observer, waits } = createObserver();
		const line = new AdmissionLine("operation-queue", createFakeSleep());

		await line.admitAsync(
			async (span) => void (await line.sleepAsync(100, { signal: undefined, span })),
			{},
		);
		await line.admitAsync(async () => {}, { onAdmissionWait: observer });

		expect(waits).toStrictEqual([]);
	});
});
