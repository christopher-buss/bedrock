import { assert, describe, it, vi } from "vitest";

import { createFakeClock } from "#tests/helpers/fake-clock";
import type { AdmissionWaitObserver } from "../../client/types.ts";
import { RateLimitWaitRefusedError } from "../../errors/rate-limit-wait-refused.ts";
import { hasServerRetryGuidance, RateLimitError } from "../../errors/rate-limit.ts";
import { RequestAbortedError } from "../../errors/request-aborted.ts";
import { BudgetGate, type BudgetScope } from "./budget-gate.ts";

const SCOPE = {
	credentialKey: "k",
	documentedWindow: { capacity: 2, windowSeconds: 1 },
	operationKey: "op",
} satisfies BudgetScope;

describe(BudgetGate, () => {
	it("should reject a pre-aborted gate without reserving its budget", async ({ expect }) => {
		expect.assertions(4);

		const clock = createFakeClock();
		const gate = new BudgetGate(clock.sleep);
		const signal = AbortSignal.abort("cancelled");
		gate.observe(SCOPE, { remaining: 1, resetSeconds: 60 });

		await expect(gate.gateAsync(SCOPE, { signal })).rejects.toMatchObject({
			message: "Request was aborted",
			reason: "cancelled",
		});

		await Promise.resolve();

		expect(signal.aborted).toBeTrue();
		await expect(gate.gateAsync(SCOPE)).resolves.toBeDefined();
		expect(clock.waits).toStrictEqual([]);
	});

	it("should not reserve budget when cancellation interrupts its sleep", async ({ expect }) => {
		expect.assertions(2);

		const clock = createFakeClock();
		const firstSleepStarted = Promise.withResolvers<void>();
		let sleepCount = 0;
		async function sleepAsync(): Promise<void> {
			sleepCount += 1;
			firstSleepStarted.resolve();
			await new Promise<void>(() => {});
		}

		const gate = new BudgetGate(sleepAsync);
		const controller = new AbortController();
		gate.observe(SCOPE, { remaining: 2, resetSeconds: 60 });
		await gate.gateAsync(SCOPE);

		const cancelled = gate.gateAsync(SCOPE, { signal: controller.signal });
		await firstSleepStarted.promise;
		controller.abort("cancelled");

		await expect(cancelled).rejects.toBeInstanceOf(RequestAbortedError);

		clock.advance(30_000);
		await gate.gateAsync(SCOPE);

		expect(sleepCount).toBe(1);
	});

	it("should not wait before any sample is observed", async ({ expect }) => {
		expect.assertions(1);

		const clock = createFakeClock();
		const gate = new BudgetGate(clock.sleep);

		await gate.gateAsync(SCOPE);

		expect(clock.waits).toStrictEqual([]);
	});

	it("should give a released slot back to the next gate", async ({ expect }) => {
		expect.assertions(1);

		const clock = createFakeClock();
		const gate = new BudgetGate(clock.sleep);

		gate.observe(SCOPE, { remaining: 1, resetSeconds: 60 });
		const reservation = await gate.gateAsync(SCOPE);
		reservation.release();
		await gate.gateAsync(SCOPE);

		expect(clock.waits).toStrictEqual([]);
	});

	it("should sleep until reset once the scope's budget is exhausted", async ({ expect }) => {
		expect.assertions(1);

		const clock = createFakeClock();
		const gate = new BudgetGate(clock.sleep);

		gate.observe(SCOPE, { remaining: 1, resetSeconds: 60 });
		await gate.gateAsync(SCOPE);
		await gate.gateAsync(SCOPE);

		expect(clock.waits).toStrictEqual([60_000]);
	});

	it("should track api keys independently", async ({ expect }) => {
		expect.assertions(1);

		const clock = createFakeClock();
		const gate = new BudgetGate(clock.sleep);

		gate.observe({ ...SCOPE, credentialKey: "a" }, { remaining: 0, resetSeconds: 60 });
		await gate.gateAsync({ ...SCOPE, credentialKey: "b" });

		expect(clock.waits).toStrictEqual([]);
	});

	it("should track operations on one api key independently", async ({ expect }) => {
		expect.assertions(1);

		const clock = createFakeClock();
		const gate = new BudgetGate(clock.sleep);

		gate.observe({ ...SCOPE, operationKey: "submit" }, { remaining: 0, resetSeconds: 60 });
		await gate.gateAsync({ ...SCOPE, operationKey: "get" });

		expect(clock.waits).toStrictEqual([]);
	});

	it("should admit queued gates at no more than the documented capacity per window after a reset", async ({
		expect,
	}) => {
		expect.assertions(1);

		const clock = createFakeClock();
		const gate = new BudgetGate(clock.sleep);

		gate.observe(SCOPE, { remaining: 0, resetSeconds: 5 });
		await Promise.all([
			gate.gateAsync(SCOPE),
			gate.gateAsync(SCOPE),
			gate.gateAsync(SCOPE),
			gate.gateAsync(SCOPE),
		]);

		expect(clock.waits).toStrictEqual([5000, 500, 500, 500]);
	});

	it("should ignore an undefined sample and stay on static pacing", async ({ expect }) => {
		expect.assertions(1);

		const clock = createFakeClock();
		const gate = new BudgetGate(clock.sleep);

		gate.observe(SCOPE, undefined);
		await gate.gateAsync(SCOPE);

		expect(clock.waits).toStrictEqual([]);
	});

	it("should space the next send evenly while budget remains", async ({ expect }) => {
		expect.assertions(1);

		const clock = createFakeClock();
		const gate = new BudgetGate(clock.sleep);

		gate.observe(SCOPE, { remaining: 2, resetSeconds: 60 });
		await gate.gateAsync(SCOPE);
		await gate.gateAsync(SCOPE);

		expect(clock.waits).toStrictEqual([60_000]);
	});

	it("should refuse a budget wait beyond the deadline but allow an exact fit", async ({
		expect,
	}) => {
		expect.assertions(4);

		const clock = createFakeClock();
		const gate = new BudgetGate(clock.sleep);
		gate.observe(SCOPE, { remaining: 0, resetSeconds: 60 });

		await expect(gate.gateAsync(SCOPE, { deadlineMs: 59_999 })).rejects.toMatchObject({
			name: "RequestDeadlineExceededError",
			deadlineMs: 59_999,
			remainingMs: 59_999,
			waitMs: 60_000,
			waitReason: "reported-budget",
		});
		expect(clock.waits).toStrictEqual([]);
		await expect(gate.gateAsync(SCOPE, { deadlineMs: 60_000 })).resolves.toBeDefined();
		expect(clock.waits).toStrictEqual([60_000]);
	});

	it("should not hold one operation behind another operation's wait", async ({ expect }) => {
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

	it("should serialize concurrent gates on the same scope", async ({ expect }) => {
		expect.assertions(1);

		const clock = createFakeClock();
		const gate = new BudgetGate(clock.sleep);

		gate.observe(SCOPE, { remaining: 2, resetSeconds: 60 });
		await gate.gateAsync(SCOPE);
		await Promise.all([gate.gateAsync(SCOPE), gate.gateAsync(SCOPE)]);

		// One gate holds for the reset; the other is paced in the window after
		// it.
		expect(clock.waits).toStrictEqual([60_000, 500]);
	});

	it("should report one request's wait behind another gate", async ({ expect }) => {
		expect.assertions(4);

		const releases: Array<() => void> = [];
		async function holdAsync(): Promise<void> {
			return new Promise<void>((resolve) => {
				releases.push(resolve);
			});
		}

		const gate = new BudgetGate(holdAsync);
		const firstObserver = vi.fn<AdmissionWaitObserver>();
		const secondObserver = vi.fn<AdmissionWaitObserver>();

		gate.observe(SCOPE, { remaining: 0, resetSeconds: 60 });
		const first = gate.gateAsync(SCOPE, { observer: firstObserver });
		await vi.waitUntil(() => releases.length === 1);
		const second = gate.gateAsync(SCOPE, { observer: secondObserver });

		expect(secondObserver).toHaveBeenCalledExactlyOnceWith({
			phase: "started",
			reason: "reported-budget",
		});

		releases[0]!();
		await vi.waitUntil(() => releases.length === 2);
		releases[1]!();
		await Promise.all([first, second]);

		expect(secondObserver.mock.calls).toStrictEqual([
			[{ phase: "started", reason: "reported-budget" }],
			[{ phase: "ended", reason: "reported-budget" }],
		]);

		const nextObserver = vi.fn<AdmissionWaitObserver>();
		const next = gate.gateAsync(SCOPE, { observer: nextObserver });
		await vi.waitUntil(() => releases.length === 3);

		expect(
			nextObserver.mock.calls.map(([event]) => {
				return {
					...event,
					durationMs: typeof event.durationMs,
				};
			}),
		).toStrictEqual([
			{
				durationMs: "number",
				phase: "started",
				reason: "reported-budget",
			},
		]);

		releases[2]!();
		await next;

		expect(nextObserver).toHaveBeenCalledTimes(2);
	});

	it("should keep gating after a failed attempt", async ({ expect }) => {
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

describe("budgetGate lockout", () => {
	function lockout(retryAfterSeconds = 100): RateLimitError {
		return new RateLimitError("Rate limited", {
			code: "RESOURCE_EXHAUSTED",
			details: { reason: "locked" },
			remaining: 3,
			responseHeaders: { "retry-after": String(retryAfterSeconds) },
			retryAfterSeconds,
			source: "service",
			statusCode: 429,
		});
	}

	it("should refuse a gate during a lockout without sleeping", async ({ expect }) => {
		expect.assertions(4);

		const clock = createFakeClock();
		const gate = new BudgetGate(clock.sleep);
		const original = lockout();
		gate.lockOut(SCOPE, original);

		const refusal = await gate.gateAsync(SCOPE).catch((err: unknown) => err);

		assert(refusal instanceof RateLimitWaitRefusedError);

		expect(refusal.message).toBe(
			"Rate limit lockout on this operation lasts another 100s; request not sent",
		);
		expect(refusal.retryAfterSeconds).toBe(100);
		expect(refusal.cause.cause).toBe(original);
		expect(clock.waits).toStrictEqual([]);
	});

	it("should carry the locking 429's evidence as guided retry advice", async ({ expect }) => {
		expect.assertions(2);

		const clock = createFakeClock();
		const gate = new BudgetGate(clock.sleep);
		gate.lockOut(SCOPE, lockout());

		const refusal = await gate.gateAsync(SCOPE).catch((err: unknown) => err);

		assert(refusal instanceof RateLimitWaitRefusedError);

		expect(refusal.cause).toMatchObject({
			code: "RESOURCE_EXHAUSTED",
			details: { reason: "locked" },
			remaining: 3,
			responseHeaders: { "retry-after": "100" },
			source: "service",
			statusCode: 429,
		});
		expect(hasServerRetryGuidance(refusal.cause)).toBeTrue();
	});

	it("should count the lockout's remaining seconds down, rounded up", async ({ expect }) => {
		expect.assertions(2);

		const clock = createFakeClock();
		const gate = new BudgetGate(clock.sleep);
		gate.lockOut(SCOPE, lockout());

		clock.advance(30_500);

		await expect(gate.gateAsync(SCOPE)).rejects.toMatchObject({ retryAfterSeconds: 70 });

		clock.advance(69_499);

		await expect(gate.gateAsync(SCOPE)).rejects.toMatchObject({ retryAfterSeconds: 1 });
	});

	it("should admit gates once the lockout's reset instant arrives", async ({ expect }) => {
		expect.assertions(2);

		const clock = createFakeClock();
		const gate = new BudgetGate(clock.sleep);
		gate.lockOut(SCOPE, lockout());

		clock.advance(100_000);

		await expect(gate.gateAsync(SCOPE)).resolves.toBeDefined();
		expect(clock.waits).toStrictEqual([]);
	});

	it("should not reserve budget for a refused gate", async ({ expect }) => {
		expect.assertions(2);

		const clock = createFakeClock();
		const gate = new BudgetGate(clock.sleep);
		gate.observe(SCOPE, { remaining: 1, resetSeconds: 200 });
		gate.lockOut(SCOPE, lockout());

		await expect(gate.gateAsync(SCOPE)).rejects.toBeInstanceOf(RateLimitWaitRefusedError);

		clock.advance(100_000);
		await gate.gateAsync(SCOPE);
		await gate.gateAsync(SCOPE);

		expect(clock.waits).toStrictEqual([100_000]);
	});

	it("should refuse a gate whose pacing wait a lockout lands during", async ({ expect }) => {
		expect.assertions(2);

		const clock = createFakeClock();
		const sleepStarted = Promise.withResolvers<void>();
		const sleepEnded = Promise.withResolvers<void>();
		async function sleepAsync(ms: number): Promise<void> {
			sleepStarted.resolve();
			await sleepEnded.promise;
			clock.advance(ms);
		}

		const gate = new BudgetGate(sleepAsync);
		gate.observe(SCOPE, { remaining: 0, resetSeconds: 10 });
		const pending = gate.gateAsync(SCOPE);
		await sleepStarted.promise;
		gate.lockOut(SCOPE, lockout());
		sleepEnded.resolve();

		await expect(pending).rejects.toMatchObject({ retryAfterSeconds: 90 });

		clock.advance(90_000);

		await expect(gate.gateAsync(SCOPE)).resolves.toBeDefined();
	});

	it("should not lock out another operation or credential", async ({ expect }) => {
		expect.assertions(2);

		const clock = createFakeClock();
		const gate = new BudgetGate(clock.sleep);
		gate.lockOut(SCOPE, lockout());

		await expect(gate.gateAsync({ ...SCOPE, operationKey: "other" })).resolves.toBeDefined();
		await expect(gate.gateAsync({ ...SCOPE, credentialKey: "other" })).resolves.toBeDefined();
	});
});
