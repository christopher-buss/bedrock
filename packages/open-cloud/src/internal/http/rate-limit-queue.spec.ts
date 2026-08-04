import { describe, expect, it, vi } from "vitest";

import { createFakeClock } from "#tests/helpers/fake-clock";
import { RateLimitQueue } from "./rate-limit-queue.ts";

describe(RateLimitQueue, () => {
	it("should invoke the task immediately when the bucket has tokens", async () => {
		expect.assertions(3);

		const onRateLimit = vi.fn<(waitMs: number) => void>();
		const clock = createFakeClock();
		const queue = new RateLimitQueue(
			{ maxPerSecond: 5, operationKey: "test.op" },
			{ onRateLimit },
			clock.sleep,
		);

		const result = await queue.acquireAsync(async () => "ok");

		expect(result).toBe("ok");
		expect(clock.waits).toStrictEqual([]);
		expect(onRateLimit).not.toHaveBeenCalled();
	});

	it("should sleep for one refill interval when the bucket is empty", async () => {
		expect.assertions(2);

		const clock = createFakeClock();
		const queue = new RateLimitQueue(
			{ maxPerSecond: 1, operationKey: "test.op" },
			{},
			clock.sleep,
		);

		await queue.acquireAsync(async () => "first");
		const result = await queue.acquireAsync(async () => "second");

		expect(result).toBe("second");
		expect(clock.waits).toStrictEqual([1000]);
	});

	it("should regenerate tokens at the configured rate after exhausting the burst", async () => {
		expect.assertions(1);

		const clock = createFakeClock();
		const queue = new RateLimitQueue(
			{ maxPerSecond: 2, operationKey: "test.op" },
			{},
			clock.sleep,
		);

		await queue.acquireAsync(async () => "a");
		await queue.acquireAsync(async () => "b");
		await queue.acquireAsync(async () => "c");
		await queue.acquireAsync(async () => "d");

		expect(clock.waits).toStrictEqual([500, 500]);
	});

	it("should fire onRateLimit with the same waitMs passed to sleep", async () => {
		expect.assertions(2);

		const onRateLimit = vi.fn<(waitMs: number) => void>();
		const clock = createFakeClock();
		const queue = new RateLimitQueue(
			{ maxPerSecond: 4, operationKey: "test.op" },
			{ onRateLimit },
			clock.sleep,
		);

		await queue.acquireAsync(async () => "a");
		await queue.acquireAsync(async () => "b");
		await queue.acquireAsync(async () => "c");
		await queue.acquireAsync(async () => "d");
		await queue.acquireAsync(async () => "e");

		expect(clock.waits).toStrictEqual([250]);
		expect(onRateLimit).toHaveBeenCalledExactlyOnceWith(250);
	});

	it("should serialize concurrent acquires so each waits for the prior token", async () => {
		expect.assertions(2);

		const clock = createFakeClock();
		const queue = new RateLimitQueue(
			{ maxPerSecond: 1, operationKey: "test.op" },
			{},
			clock.sleep,
		);

		const results = await Promise.all([
			queue.acquireAsync(async () => "a"),
			queue.acquireAsync(async () => "b"),
			queue.acquireAsync(async () => "c"),
		]);

		expect(results).toStrictEqual(["a", "b", "c"]);
		expect(clock.waits).toStrictEqual([1000, 1000]);
	});

	it("should drain the bucket in proportion to elapsed wall time", async () => {
		expect.assertions(1);

		const clock = createFakeClock();
		const queue = new RateLimitQueue(
			{ maxPerSecond: 2, operationKey: "test.op" },
			{},
			clock.sleep,
		);

		await queue.acquireAsync(async () => "a");
		await queue.acquireAsync(async () => "b");
		clock.advance(500);
		await queue.acquireAsync(async () => "c");

		expect(clock.waits).toStrictEqual([]);
	});

	it.for<[label: string, maxPerSecond: number]>([
		["binary-input create", 5 / 60],
		["place publish", 0.5],
		["log listing", 45 / 60],
		["task submission", 40 / 60],
	])(
		"should grant the first request immediately for %s, slower than one per second",
		async ([, maxPerSecond]) => {
			expect.assertions(2);

			const onRateLimit = vi.fn<(waitMs: number) => void>();
			const clock = createFakeClock();
			const queue = new RateLimitQueue(
				{ maxPerSecond, operationKey: "test.op" },
				{ onRateLimit },
				clock.sleep,
			);

			await queue.acquireAsync(async () => "first");

			expect(clock.waits).toStrictEqual([]);
			expect(onRateLimit).not.toHaveBeenCalled();
		},
	);

	it("should grant the whole burst before pacing the next request", async () => {
		expect.assertions(1);

		const clock = createFakeClock();
		const queue = new RateLimitQueue(
			{ burstCapacity: 5, maxPerSecond: 5 / 60, operationKey: "test.op" },
			{},
			clock.sleep,
		);

		for (let index = 0; index < 5; index++) {
			await queue.acquireAsync(async () => index);
		}

		await queue.acquireAsync(async () => "overflow");

		expect(clock.waits).toStrictEqual([12_000]);
	});

	it("should restore the whole burst after idling long enough to drain", async () => {
		expect.assertions(1);

		const clock = createFakeClock();
		const queue = new RateLimitQueue(
			{ burstCapacity: 5, maxPerSecond: 5 / 60, operationKey: "test.op" },
			{},
			clock.sleep,
		);

		for (let index = 0; index < 5; index++) {
			await queue.acquireAsync(async () => index);
		}

		clock.advance(60_000);

		for (let index = 0; index < 5; index++) {
			await queue.acquireAsync(async () => index);
		}

		expect(clock.waits).toStrictEqual([]);
	});

	it("should default a sub-one-per-second operation to a burst of one request", async () => {
		expect.assertions(1);

		const clock = createFakeClock();
		const queue = new RateLimitQueue(
			{ maxPerSecond: 5 / 60, operationKey: "test.op" },
			{},
			clock.sleep,
		);

		await queue.acquireAsync(async () => "first");
		await queue.acquireAsync(async () => "second");

		expect(clock.waits).toStrictEqual([12_000]);
	});

	it.for<[maxPerSecond: number, expectedWaitMs: number]>([
		[1, 1000],
		[2, 500],
		[10, 100],
	])(
		"should size the refill interval for maxPerSecond=%i to %ims",
		async ([maxPerSecond, expectedWaitMs]) => {
			expect.assertions(1);

			const clock = createFakeClock();
			const queue = new RateLimitQueue(
				{ maxPerSecond, operationKey: "test.op" },
				{},
				clock.sleep,
			);

			for (let index = 0; index < maxPerSecond; index++) {
				await queue.acquireAsync(async () => index);
			}

			await queue.acquireAsync(async () => "overflow");

			expect(clock.waits).toStrictEqual([expectedWaitMs]);
		},
	);
});
