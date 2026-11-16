import {
	ApiError,
	BadgeCostMismatchError,
	NetworkError,
	OpenCloudError,
	RequestAbortedError,
} from "@bedrock-rbx/ocale";

import { assert, describe, it, vi } from "vitest";

import { PaidSendNotStartedError } from "#src/core/paid-send-not-started";
import { unconfirmedPaidCost } from "#src/core/unconfirmed-paid-create";
import type { ResourceDriver } from "#src/ports/resource-driver";
import { asResourceKey } from "#src/types/ids";
import { badgeCurrent, badgeDesired } from "#tests/helpers/resources";
import { watchInterrupt } from "./interrupt.ts";
import { paidBadgeCreates } from "./paid-badge-creates.ts";

const COST_REFUSAL = new BadgeCostMismatchError("Expected badge cost is different.", {
	code: "18",
	expectedCost: 0,
	statusCode: 403,
});

/**
 * A badge Driver that answers each send with the next outcome, in order, and
 * records the cost each send offered.
 *
 * @param sent - Receives `<key>@<cost>` for each send.
 * @param outcomes - The failures to answer with, `undefined` for a create,
 *   or another `Error` to throw.
 * @returns A badge Driver that follows the script.
 */
function scriptedDriver(
	sent: Array<string>,
	outcomes: Array<Error | undefined>,
): ResourceDriver<"badge"> {
	return {
		async create(desired, context) {
			sent.push(`${desired.key}@${context?.expectedCost ?? 0}`);
			const err = outcomes.shift();
			if (err === undefined) {
				return { data: badgeCurrent({ key: desired.key }), success: true };
			}

			if (err instanceof OpenCloudError) {
				return { err, success: false };
			}

			throw err;
		},
		async retire() {
			throw new Error("Unexpected retire");
		},
	};
}

describe(paidBadgeCreates, () => {
	it("should let a later create spend the Robux a refused paid send did not", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const sent: Array<string> = [];
		const paying = paidBadgeCreates(
			scriptedDriver(sent, [
				COST_REFUSAL,
				new ApiError("HTTP 400", { statusCode: 400 }),
				COST_REFUSAL,
				undefined,
			]),
			{ limit: 100, price: 100 },
		);

		const first = await paying.driver.create(badgeDesired({ key: asResourceKey("a") }));
		const second = await paying.driver.create(badgeDesired({ key: asResourceKey("b") }));

		expect([first.success, second.success]).toStrictEqual([false, true]);
		expect(sent).toStrictEqual(["a@0", "a@100", "b@0", "b@100"]);
		expect(paying.spent()).toStrictEqual({ paid: ["b"], robux: 100 });
	});

	it("should not re-send a create Roblox refuses for cost when the price is 0", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const sent: Array<string> = [];
		const paying = paidBadgeCreates(scriptedDriver(sent, [COST_REFUSAL]), {
			limit: 100,
			price: 0,
		});

		const result = await paying.driver.create(badgeDesired({ key: asResourceKey("a") }));

		expect(result.success).toBe(false);
		expect(sent).toStrictEqual(["a@0"]);
		expect(paying.spent()).toStrictEqual({ paid: [], robux: 0 });
	});

	it("should still pay for a later create after a paid send throws", async ({ expect }) => {
		expect.hasAssertions();

		const sent: Array<string> = [];
		const paying = paidBadgeCreates(
			scriptedDriver(sent, [COST_REFUSAL, COST_REFUSAL, new Error("boom"), undefined]),
			{ limit: 200, price: 100 },
		);

		const first = paying.driver.create(badgeDesired({ key: asResourceKey("a") }));
		const second = paying.driver.create(badgeDesired({ key: asResourceKey("b") }));

		await expect(first).rejects.toThrow("boom");
		await expect(second).resolves.toMatchObject({ success: true });
		expect(sent).toStrictEqual(["a@0", "b@0", "a@100", "b@100"]);
		expect(paying.spent()).toStrictEqual({ paid: ["b"], robux: 100 });
	});

	it("should record a paid send an Interrupt aborts as an Unconfirmed paid create", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const sent: Array<string> = [];
		const paying = paidBadgeCreates(
			scriptedDriver(sent, [COST_REFUSAL, new RequestAbortedError("Request aborted")]),
			{ limit: 100, price: 100 },
		);

		const controller = new AbortController();
		const result = await paying.driver.create(badgeDesired({ key: asResourceKey("a") }), {
			signal: controller.signal,
		});

		assert(!result.success);

		expect(result.err).toBeInstanceOf(RequestAbortedError);
		expect(unconfirmedPaidCost(result.err)).toBe(100);
		expect(paying.unconfirmed().map(({ key }) => key)).toStrictEqual(["a"]);
		expect(sent).toStrictEqual(["a@0", "a@100"]);
	});

	it("should not record a free create an Interrupt aborts", async ({ expect }) => {
		expect.hasAssertions();

		const sent: Array<string> = [];
		const paying = paidBadgeCreates(
			scriptedDriver(sent, [new RequestAbortedError("Request aborted")]),
			{ limit: 100, price: 100 },
		);

		const result = await paying.driver.create(badgeDesired({ key: asResourceKey("a") }));

		expect(!result.success && result.err).toBeInstanceOf(RequestAbortedError);
		expect(sent).toStrictEqual(["a@0"]);
		expect(paying.unconfirmed()).toStrictEqual([]);
	});

	it("should not start a paid send once the Interrupt aborted the requests", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const sent: Array<string> = [];
		const paying = paidBadgeCreates(scriptedDriver(sent, [COST_REFUSAL]), {
			limit: 100,
			price: 100,
		});

		const result = await paying.driver.create(badgeDesired({ key: asResourceKey("a") }), {
			signal: AbortSignal.abort(),
		});

		expect(result).toStrictEqual({ err: COST_REFUSAL, success: false });
		expect(sent).toStrictEqual(["a@0"]);
		expect(paying.unconfirmed()).toStrictEqual([]);
	});

	it("should not start a paid send once the Interrupt began, inside the grace period", async ({
		expect,
	}) => {
		expect.hasAssertions();

		vi.useFakeTimers();
		const stop = new AbortController();
		const watch = watchInterrupt(stop.signal, undefined);
		const sent: Array<string> = [];
		const free = scriptedDriver(sent, [COST_REFUSAL]);
		const paying = paidBadgeCreates(
			{
				...free,
				create: async (desired, context) => {
					const result = await free.create(desired, context);
					stop.abort();
					return result;
				},
			},
			{ limit: 100, price: 100, stop: stop.signal },
		);

		const result = await paying.driver.create(badgeDesired({ key: asResourceKey("a") }), {
			signal: watch.requests,
		});
		watch.dispose();
		vi.useRealTimers();

		expect(watch.requests.aborted).toBeFalse();
		expect(result).toStrictEqual({ err: COST_REFUSAL, success: false });
		expect(sent).toStrictEqual(["a@0"]);
	});

	it("should give the paid send the stop signal and record no send the Driver did not start", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const stop = new AbortController();
		const stops: Array<AbortSignal | undefined> = [];
		const free = scriptedDriver([], [COST_REFUSAL, new PaidSendNotStartedError()]);
		const paying = paidBadgeCreates(
			{
				...free,
				create: async (desired, context) => {
					stops.push(context!.stop);
					return free.create(desired, context);
				},
			},
			{ limit: 100, price: 100, stop: stop.signal },
		);

		const result = await paying.driver.create(badgeDesired({ key: asResourceKey("a") }), {});

		expect(stops).toStrictEqual([undefined, stop.signal]);
		expect(result).toStrictEqual({ err: COST_REFUSAL, success: false });
		expect(paying.unconfirmed()).toStrictEqual([]);
		expect(paying.spent()).toStrictEqual({ paid: [], robux: 0 });
	});

	it("should record a paid send that timed out as an Unconfirmed paid create", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const timedOut = new NetworkError("Network request failed", {
			cause: new DOMException("The operation timed out.", "TimeoutError"),
		});
		const sent: Array<string> = [];
		const paying = paidBadgeCreates(
			scriptedDriver(sent, [COST_REFUSAL, timedOut, COST_REFUSAL]),
			{
				limit: 1000,
				price: 100,
			},
		);

		const first = await paying.driver.create(badgeDesired({ key: asResourceKey("a") }));
		const second = await paying.driver.create(badgeDesired({ key: asResourceKey("b") }));

		expect(!first.success && first.err).toBe(timedOut);
		expect(paying.unconfirmed().map(({ key }) => key)).toStrictEqual(["a"]);
		expect(sent).toStrictEqual(["a@0", "a@100", "b@0"]);
		expect(second.success).toBeFalse();
	});

	it("should not record a paid send that failed to connect", async ({ expect }) => {
		expect.hasAssertions();

		const refused = new NetworkError("Network request failed", {
			cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
		});
		const sent: Array<string> = [];
		const paying = paidBadgeCreates(scriptedDriver(sent, [COST_REFUSAL, refused]), {
			limit: 1000,
			price: 100,
		});

		const result = await paying.driver.create(badgeDesired({ key: asResourceKey("a") }));

		expect(!result.success && result.err).toBe(refused);
		expect(paying.unconfirmed()).toStrictEqual([]);
	});
});
