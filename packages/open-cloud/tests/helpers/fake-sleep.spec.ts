import type { SleepFunc } from "#src/internal/utils/sleep";
import { describe, expect, it } from "vitest";

import { createFakeSleep } from "./fake-sleep.ts";

describe(createFakeSleep, () => {
	it("should expose an empty waits log before any invocation", () => {
		expect.assertions(1);

		const fakeSleep = createFakeSleep();

		expect(fakeSleep.waits).toStrictEqual([]);
	});

	it("should record each invocation in call order", async () => {
		expect.assertions(1);

		const fakeSleep = createFakeSleep();

		await fakeSleep(100);
		await fakeSleep(250);
		await fakeSleep(50);

		expect(fakeSleep.waits).toStrictEqual([100, 250, 50]);
	});

	it("should resolve immediately without a real delay", async () => {
		expect.assertions(1);

		const fakeSleep = createFakeSleep();

		const start = Date.now();
		await fakeSleep(1_000_000);
		const elapsed = Date.now() - start;

		expect(elapsed).toBeLessThan(50);
	});

	it("should be assignable to SleepFunc", () => {
		expect.assertions(1);

		const fakeSleep = createFakeSleep();
		const asSleepFunc: SleepFunc = fakeSleep;

		expect(asSleepFunc).toBeFunction();
	});
});
