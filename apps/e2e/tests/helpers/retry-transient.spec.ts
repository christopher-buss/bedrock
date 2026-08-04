import type { ApplyError, DeployError } from "@bedrock-rbx/core";
import { asResourceKey } from "@bedrock-rbx/core";
import { ApiError, NetworkError } from "@bedrock-rbx/ocale";

import { describe, expect, it, onTestFinished, vi } from "vitest";

import {
	hasTransientApiFailureText,
	isTransientDeployFailure,
	retryTransient,
} from "./retry-transient.ts";

interface FakeSleep {
	readonly calls: Array<number>;
	readonly sleep: (ms: number) => Promise<void>;
}

interface FakeOperation<T> {
	readonly attempts: { count: number };
	readonly operation: () => Promise<T>;
}

function fakeSleep(): FakeSleep {
	const calls: Array<number> = [];
	async function sleep(ms: number): Promise<void> {
		calls.push(ms);
	}

	return { calls, sleep };
}

function fakeOperation<T>(outcomes: ReadonlyArray<T>): FakeOperation<T> {
	const attempts = { count: 0 };
	async function operation(): Promise<T> {
		const outcome = outcomes[attempts.count];
		if (outcome === undefined) {
			throw new Error(
				`fakeOperation: no outcome queued for attempt ${String(attempts.count + 1)}`,
			);
		}

		attempts.count += 1;
		return outcome;
	}

	return { attempts, operation };
}

const TRANSIENT = "transient";
const SETTLED = "settled";
function isTransient(outcome: string): boolean {
	return outcome === TRANSIENT;
}

function driverFailure(cause: Error): ApplyError {
	return { key: asResourceKey("smoke-place"), cause, kind: "driverFailure" };
}

function applyFailed(failures: readonly [ApplyError, ...ReadonlyArray<ApplyError>]): DeployError {
	return { cause: { applied: [], failures }, kind: "applyFailed" };
}

function apiError(statusCode: number): ApiError {
	return new ApiError(`HTTP ${String(statusCode)}`, { statusCode });
}

describe(retryTransient, () => {
	it("should return the first outcome when it is not transient", async () => {
		expect.assertions(3);

		const { attempts, operation } = fakeOperation([SETTLED]);
		const sleepFake = fakeSleep();

		const outcome = await retryTransient({
			isTransient,
			operation,
			sleep: sleepFake.sleep,
		});

		expect(attempts.count).toBe(1);
		expect(sleepFake.calls).toBeEmpty();
		expect(outcome).toBe(SETTLED);
	});

	it("should retry a transient outcome, sleeping with exponential backoff", async () => {
		expect.assertions(3);

		const { attempts, operation } = fakeOperation([TRANSIENT, TRANSIENT, SETTLED]);
		const sleepFake = fakeSleep();

		const outcome = await retryTransient({
			baseDelayMs: 1000,
			isTransient,
			operation,
			sleep: sleepFake.sleep,
		});

		expect(attempts.count).toBe(3);
		expect(sleepFake.calls).toStrictEqual([1000, 2000]);
		expect(outcome).toBe(SETTLED);
	});

	it("should stop after the attempt budget and return the last transient outcome", async () => {
		expect.assertions(3);

		const { attempts, operation } = fakeOperation([TRANSIENT, TRANSIENT, TRANSIENT]);
		const sleepFake = fakeSleep();

		const outcome = await retryTransient({
			attempts: 3,
			baseDelayMs: 1000,
			isTransient,
			operation,
			sleep: sleepFake.sleep,
		});

		expect(attempts.count).toBe(3);
		expect(sleepFake.calls).toStrictEqual([1000, 2000]);
		expect(outcome).toBe(TRANSIENT);
	});

	it("should fall back to a real timer when no sleep seam is injected", async () => {
		expect.assertions(2);

		vi.useFakeTimers();
		onTestFinished(() => {
			vi.useRealTimers();
		});

		const { attempts, operation } = fakeOperation([TRANSIENT, SETTLED]);

		const pending = retryTransient({ baseDelayMs: 10, isTransient, operation });
		await vi.runAllTimersAsync();
		const outcome = await pending;

		expect(attempts.count).toBe(2);
		expect(outcome).toBe(SETTLED);
	});
});

describe(isTransientDeployFailure, () => {
	it.for<[number]>([[500], [502], [503], [504]])(
		"should treat an apply failure caused by HTTP %i as transient",
		([statusCode]) => {
			expect.assertions(1);

			const err = applyFailed([driverFailure(apiError(statusCode))]);

			expect(isTransientDeployFailure(err)).toBeTrue();
		},
	);

	it("should not treat a client error as transient", () => {
		expect.assertions(1);

		expect(isTransientDeployFailure(applyFailed([driverFailure(apiError(400))]))).toBeFalse();
	});

	it("should not treat a non-api driver failure as transient", () => {
		expect.assertions(1);

		const cause = new NetworkError("Network request failed");

		expect(isTransientDeployFailure(applyFailed([driverFailure(cause)]))).toBeFalse();
	});

	it("should not treat a mixed batch as transient when one failure is permanent", () => {
		expect.assertions(1);

		const err = applyFailed([driverFailure(apiError(500)), driverFailure(apiError(400))]);

		expect(isTransientDeployFailure(err)).toBeFalse();
	});

	it("should not treat a non-apply deploy failure as transient", () => {
		expect.assertions(1);

		const err: DeployError = { environment: "smoke", kind: "stateNotConfigured" };

		expect(isTransientDeployFailure(err)).toBeFalse();
	});
});

describe(hasTransientApiFailureText, () => {
	it("should match a server error rendered by the cli", () => {
		expect.assertions(1);

		const output =
			"place.smoke-place failed: HTTP 500 (body: {}) on POST https://apis.roblox.com";

		expect(hasTransientApiFailureText(output)).toBeTrue();
	});

	it("should not match a client error rendered by the cli", () => {
		expect.assertions(1);

		expect(hasTransientApiFailureText("failed: HTTP 400 (body: {})")).toBeFalse();
	});

	it("should not match output with no api failure at all", () => {
		expect.assertions(1);

		expect(hasTransientApiFailureText("1 resources reconciled")).toBeFalse();
	});
});
