import { describe, expect, it, vi } from "vitest";

import { createFakeClock } from "#tests/helpers/fake-clock";
import { BudgetGate } from "./budget-gate.ts";

describe(BudgetGate, () => {
	it("should not wait before any sample is observed", async () => {
		expect.assertions(1);

		const clock = createFakeClock();
		const gate = new BudgetGate(clock.sleep);

		await gate.gateAsync("k");

		expect(clock.waits).toStrictEqual([]);
	});

	it("should sleep until reset once the scope's budget is exhausted", async () => {
		expect.assertions(1);

		const clock = createFakeClock();
		const gate = new BudgetGate(clock.sleep);

		gate.observe("k", { remaining: 1, resetSeconds: 60 });
		await gate.gateAsync("k");
		await gate.gateAsync("k");

		expect(clock.waits).toStrictEqual([60_000]);
	});

	it("should track scopes independently", async () => {
		expect.assertions(1);

		const clock = createFakeClock();
		const gate = new BudgetGate(clock.sleep);

		gate.observe("a", { remaining: 0, resetSeconds: 60 });
		await gate.gateAsync("b");

		expect(clock.waits).toStrictEqual([]);
	});

	it("should ignore an undefined sample and stay on static pacing", async () => {
		expect.assertions(1);

		const clock = createFakeClock();
		const gate = new BudgetGate(clock.sleep);

		gate.observe("k", undefined);
		await gate.gateAsync("k");

		expect(clock.waits).toStrictEqual([]);
	});

	it("should space the next send evenly while budget remains", async () => {
		expect.assertions(1);

		const clock = createFakeClock();
		const gate = new BudgetGate(clock.sleep);

		gate.observe("k", { remaining: 2, resetSeconds: 60 });
		await gate.gateAsync("k");
		await gate.gateAsync("k");

		expect(clock.waits).toStrictEqual([60_000]);
	});

	it("should serialize concurrent gates on the same scope", async () => {
		expect.assertions(1);

		const clock = createFakeClock();
		const gate = new BudgetGate(clock.sleep);

		gate.observe("k", { remaining: 2, resetSeconds: 60 });
		await gate.gateAsync("k");
		await Promise.all([gate.gateAsync("k"), gate.gateAsync("k")]);

		expect(clock.waits).toStrictEqual([60_000]);
	});

	it("should keep gating after a failed attempt", async () => {
		expect.assertions(2);

		const clock = createFakeClock();
		const sleepAsync = vi
			.fn<(ms: number) => Promise<void>>()
			.mockRejectedValueOnce(new Error("sleep failed"))
			.mockImplementation(clock.sleep);

		const gate = new BudgetGate(sleepAsync);

		gate.observe("k", { remaining: 1, resetSeconds: 60 });
		await gate.gateAsync("k");

		await expect(gate.gateAsync("k")).rejects.toThrow("sleep failed");

		await gate.gateAsync("k");

		expect(clock.waits).toStrictEqual([60_000]);
	});
});
