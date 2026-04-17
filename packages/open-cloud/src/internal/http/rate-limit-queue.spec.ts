import { createFakeClock } from "#tests/helpers/fake-clock";
import { describe, expect, it, vi } from "vitest";

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

		const result = await queue.acquire(async () => "ok");

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

		await queue.acquire(async () => "first");
		const result = await queue.acquire(async () => "second");

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

		await queue.acquire(async () => "a");
		await queue.acquire(async () => "b");
		await queue.acquire(async () => "c");
		await queue.acquire(async () => "d");

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

		await queue.acquire(async () => "a");
		await queue.acquire(async () => "b");
		await queue.acquire(async () => "c");
		await queue.acquire(async () => "d");
		await queue.acquire(async () => "e");

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
			queue.acquire(async () => "a"),
			queue.acquire(async () => "b"),
			queue.acquire(async () => "c"),
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

		await queue.acquire(async () => "a");
		await queue.acquire(async () => "b");
		clock.advance(500);
		await queue.acquire(async () => "c");

		expect(clock.waits).toStrictEqual([]);
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
				await queue.acquire(async () => index);
			}

			await queue.acquire(async () => "overflow");

			expect(clock.waits).toStrictEqual([expectedWaitMs]);
		},
	);
});
