import { ApiError, BadgeCostMismatchError, type OpenCloudError } from "@bedrock-rbx/ocale";

import { describe, it } from "vitest";

import type { ResourceDriver } from "#src/ports/resource-driver";
import { asResourceKey } from "#src/types/ids";
import { badgeCurrent, badgeDesired } from "#tests/helpers/resources";
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
 * @param outcomes - The failures to answer with, `undefined` for a create.
 * @returns A badge Driver that follows the script.
 */
function scriptedDriver(
	sent: Array<string>,
	outcomes: Array<OpenCloudError | undefined>,
): ResourceDriver<"badge"> {
	return {
		async create(desired, context) {
			sent.push(`${desired.key}@${context?.expectedCost ?? 0}`);
			const err = outcomes.shift();
			return err === undefined
				? { data: badgeCurrent({ key: desired.key }), success: true }
				: { err, success: false };
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
});
