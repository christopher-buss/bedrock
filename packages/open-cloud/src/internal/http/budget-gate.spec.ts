import { createFakeClock } from "#tests/helpers/fake-clock";
import { describe, expect, it } from "vitest";

import { BudgetGate } from "./budget-gate.ts";

describe(BudgetGate, () => {
	it("should not wait before any sample is observed", async () => {
		expect.assertions(1);

		const clock = createFakeClock();
		const gate = new BudgetGate(clock.sleep);

		await gate.gate("k");

		expect(clock.waits).toStrictEqual([]);
	});

	it("should sleep until reset once the scope's budget is exhausted", async () => {
		expect.assertions(1);

		const clock = createFakeClock();
		const gate = new BudgetGate(clock.sleep);

		gate.observe("k", { remaining: 1, resetSeconds: 60 });
		await gate.gate("k");
		await gate.gate("k");

		expect(clock.waits).toStrictEqual([60_000]);
	});

	it("should track scopes independently", async () => {
		expect.assertions(1);

		const clock = createFakeClock();
		const gate = new BudgetGate(clock.sleep);

		gate.observe("a", { remaining: 0, resetSeconds: 60 });
		await gate.gate("b");

		expect(clock.waits).toStrictEqual([]);
	});

	it("should ignore an undefined sample and stay on static pacing", async () => {
		expect.assertions(1);

		const clock = createFakeClock();
		const gate = new BudgetGate(clock.sleep);

		gate.observe("k", undefined);
		await gate.gate("k");

		expect(clock.waits).toStrictEqual([]);
	});
});
