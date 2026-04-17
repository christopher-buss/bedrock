import { createFakeClock } from "#tests/helpers/fake-clock";
import { describe, expect, it } from "vitest";

describe(createFakeClock, () => {
	it("should mock Date.now to start at zero", () => {
		expect.assertions(1);

		createFakeClock();

		expect(Date.now()).toBe(0);
	});

	it("should advance the mocked clock forward by the slept duration", async () => {
		expect.assertions(2);

		const clock = createFakeClock();

		await clock.sleep(100);

		expect(Date.now()).toBe(100);

		await clock.sleep(50);

		expect(Date.now()).toBe(150);
	});

	it("should record every sleep duration in waits in order", async () => {
		expect.assertions(1);

		const clock = createFakeClock();

		await clock.sleep(10);
		await clock.sleep(20);

		expect(clock.waits).toStrictEqual([10, 20]);
	});

	it("should advance the mocked clock when advance is called directly", () => {
		expect.assertions(1);

		const clock = createFakeClock();

		clock.advance(500);

		expect(Date.now()).toBe(500);
	});

	it("should restore Date.now between tests so the real clock is visible", () => {
		expect.assertions(1);

		expect(Date.now()).toBeGreaterThan(1_000_000_000_000);
	});
});
