import { createFakeClock } from "#tests/helpers/fake-clock";
import { describe, expect, it } from "vitest";

import { BudgetGate } from "./budget-gate.ts";

describe(BudgetGate, () => {
	it("should not wait before any sample is observed", async () => {
		expect.assertions(1);

		const clock = createFakeClock();
		const gate = new BudgetGate(clock.sleep);

		await gate.gate(["op"]);

		expect(clock.waits).toStrictEqual([]);
	});

	it("should sleep until reset once a key's budget is exhausted", async () => {
		expect.assertions(1);

		const clock = createFakeClock();
		const gate = new BudgetGate(clock.sleep);

		gate.observe(["op"], { remaining: 1, resetSeconds: 60 });
		await gate.gate(["op"]);
		await gate.gate(["op"]);

		expect(clock.waits).toStrictEqual([60_000]);
	});

	it("should sleep for the most-constrained key when gating on several", async () => {
		expect.assertions(1);

		const clock = createFakeClock();
		const gate = new BudgetGate(clock.sleep);

		gate.observe(["key"], { remaining: 0, resetSeconds: 30 });
		gate.observe(["op"], { remaining: 5, resetSeconds: 60 });
		await gate.gate(["key", "op"]);

		expect(clock.waits).toStrictEqual([30_000]);
	});

	it("should reserve a slot on every gated key", async () => {
		expect.assertions(1);

		const clock = createFakeClock();
		const gate = new BudgetGate(clock.sleep);

		gate.observe(["a", "b"], { remaining: 1, resetSeconds: 60 });
		await gate.gate(["a", "b"]);
		await gate.gate(["b"]);

		expect(clock.waits).toStrictEqual([60_000]);
	});

	it("should ignore an undefined sample and stay on static pacing", async () => {
		expect.assertions(1);

		const clock = createFakeClock();
		const gate = new BudgetGate(clock.sleep);

		gate.observe(["op"], undefined);
		await gate.gate(["op"]);

		expect(clock.waits).toStrictEqual([]);
	});
});
