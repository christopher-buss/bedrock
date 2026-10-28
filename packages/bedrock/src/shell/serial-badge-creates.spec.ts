import { BadgeCostMismatchError } from "@bedrock-rbx/ocale";

import { describe, it } from "vitest";

import type { ResourceDriver } from "#src/ports/resource-driver";
import { asResourceKey, type ResourceKey } from "#src/types/ids";
import { badgeCurrent, badgeDesired } from "#tests/helpers/resources";
import { serialBadgeCreates } from "./serial-badge-creates.ts";

const COST_REFUSAL = new BadgeCostMismatchError("Expected badge cost is different.", {
	code: "18",
	expectedCost: 0,
	statusCode: 403,
});

function keys(...names: ReadonlyArray<string>): ReadonlyArray<ResourceKey> {
	return names.map(asResourceKey);
}

function recordingDriver(
	sent: Array<string>,
	outcomes: Readonly<Record<string, "refused" | "throws">>,
): ResourceDriver<"badge"> {
	return {
		async create(desired) {
			sent.push(desired.key);
			const result = outcomes[desired.key] ?? "created";
			if (result === "throws") {
				throw new Error(`create ${desired.key} threw`);
			}

			return result === "refused"
				? { err: COST_REFUSAL, success: false }
				: { data: badgeCurrent({ key: desired.key }), success: true };
		},
		async retire() {
			throw new Error("Unexpected retire");
		},
	};
}

async function createAllAsync(
	driver: ResourceDriver<"badge">,
	names: ReadonlyArray<string>,
): Promise<Array<PromiseSettledResult<unknown>>> {
	return Promise.allSettled(
		names.map(async (name) => driver.create(badgeDesired({ key: asResourceKey(name) }))),
	);
}

describe(serialBadgeCreates, () => {
	it("should repeat the first cost refusal for every later create without sending them", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const sent: Array<string> = [];
		const driver = serialBadgeCreates(
			recordingDriver(sent, { b: "refused" }),
			keys("a", "b", "c", "d"),
		);

		const settled = await createAllAsync(driver, ["d", "c", "b", "a"]);

		expect(sent).toStrictEqual(["a", "b"]);
		expect(settled).toMatchObject([
			{ status: "fulfilled", value: { err: COST_REFUSAL, success: false } },
			{ status: "fulfilled", value: { err: COST_REFUSAL, success: false } },
			{ status: "fulfilled", value: { err: COST_REFUSAL, success: false } },
			{ status: "fulfilled", value: { success: true } },
		]);
	});

	it("should run the next create after one that throws", async ({ expect }) => {
		expect.hasAssertions();

		const sent: Array<string> = [];
		const driver = serialBadgeCreates(recordingDriver(sent, { a: "throws" }), keys("a", "b"));

		const settled = await createAllAsync(driver, ["b", "a"]);

		expect(sent).toStrictEqual(["a", "b"]);
		expect(settled.map(({ status }) => status)).toStrictEqual(["fulfilled", "rejected"]);
	});

	it("should run a create whose key is not in the order without waiting", async ({ expect }) => {
		expect.hasAssertions();

		const sent: Array<string> = [];
		const driver = serialBadgeCreates(recordingDriver(sent, {}), keys("a"));

		const settled = await createAllAsync(driver, ["a", "z"]);

		expect(sent).toStrictEqual(["z", "a"]);
		expect(settled.map(({ status }) => status)).toStrictEqual(["fulfilled", "fulfilled"]);
	});
});
