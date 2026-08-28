import { assert, describe, expect, it, vi } from "vitest";

import { createFakeClock } from "#tests/helpers/fake-clock";
import { BudgetGate, type BudgetScope } from "./budget-gate.ts";

const SCOPE = { apiKey: "k", operationKey: "op" } satisfies BudgetScope;

describe(BudgetGate, () => {
	it("should not wait before any sample is observed", async () => {
		expect.assertions(1);

		const clock = createFakeClock();
		const gate = new BudgetGate(clock.sleep);

		await gate.gateAsync(SCOPE);

		expect(clock.waits).toStrictEqual([]);
	});

	it("should sleep until reset once the scope's budget is exhausted", async () => {
		expect.assertions(1);

		const clock = createFakeClock();
		const gate = new BudgetGate(clock.sleep);

		gate.observe(SCOPE, { remaining: 1, resetSeconds: 60 });
		await gate.gateAsync(SCOPE);
		await gate.gateAsync(SCOPE);

		expect(clock.waits).toStrictEqual([60_000]);
	});

	it("should track api keys independently", async () => {
		expect.assertions(1);

		const clock = createFakeClock();
		const gate = new BudgetGate(clock.sleep);

		gate.observe({ ...SCOPE, apiKey: "a" }, { remaining: 0, resetSeconds: 60 });
		await gate.gateAsync({ ...SCOPE, apiKey: "b" });

		expect(clock.waits).toStrictEqual([]);
	});

	it("should track operations on one api key independently", async () => {
		expect.assertions(1);

		const clock = createFakeClock();
		const gate = new BudgetGate(clock.sleep);

		gate.observe({ ...SCOPE, operationKey: "submit" }, { remaining: 0, resetSeconds: 60 });
		await gate.gateAsync({ ...SCOPE, operationKey: "get" });

		expect(clock.waits).toStrictEqual([]);
	});

	it("should ignore an undefined sample and stay on static pacing", async () => {
		expect.assertions(1);

		const clock = createFakeClock();
		const gate = new BudgetGate(clock.sleep);

		gate.observe(SCOPE, undefined);
		await gate.gateAsync(SCOPE);

		expect(clock.waits).toStrictEqual([]);
	});

	it("should space the next send evenly while budget remains", async () => {
		expect.assertions(1);

		const clock = createFakeClock();
		const gate = new BudgetGate(clock.sleep);

		gate.observe(SCOPE, { remaining: 2, resetSeconds: 60 });
		await gate.gateAsync(SCOPE);
		await gate.gateAsync(SCOPE);

		expect(clock.waits).toStrictEqual([60_000]);
	});

	it("should not hold one operation behind another operation's wait", async () => {
		expect.assertions(1);

		let releaseHold: (() => void) | undefined;
		async function holdAsync(): Promise<void> {
			return new Promise<void>((resolve) => {
				releaseHold = resolve;
			});
		}

		const gate = new BudgetGate(holdAsync);

		gate.observe(SCOPE, { remaining: 0, resetSeconds: 60 });
		const held = gate.gateAsync(SCOPE);
		await vi.waitUntil(() => releaseHold !== undefined);

		const first = await Promise.race([
			gate.gateAsync({ ...SCOPE, operationKey: "other" }).then(() => "other"),
			held.then(() => "held"),
		]);

		assert(releaseHold !== undefined);
		releaseHold();
		await held;

		expect(first).toBe("other");
	});

	it("should serialize concurrent gates on the same scope", async () => {
		expect.assertions(1);

		const clock = createFakeClock();
		const gate = new BudgetGate(clock.sleep);

		gate.observe(SCOPE, { remaining: 2, resetSeconds: 60 });
		await gate.gateAsync(SCOPE);
		await Promise.all([gate.gateAsync(SCOPE), gate.gateAsync(SCOPE)]);

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

		gate.observe(SCOPE, { remaining: 1, resetSeconds: 60 });
		await gate.gateAsync(SCOPE);

		await expect(gate.gateAsync(SCOPE)).rejects.toThrow("sleep failed");

		await gate.gateAsync(SCOPE);

		expect(clock.waits).toStrictEqual([60_000]);
	});
});
