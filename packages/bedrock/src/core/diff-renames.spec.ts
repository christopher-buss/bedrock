import { describe, it } from "vitest";

import {
	developerProductCurrent,
	developerProductDesired,
	gamePassCurrent,
	gamePassDesired,
	placeCurrent,
	placeDesired,
} from "#tests/helpers/resources";
import { asResourceKey, asRobloxAssetId } from "../types/ids.ts";
import { diff } from "./diff.ts";

describe("diff rename declarations", () => {
	it("should treat an absent previous key as an ordinary entry in this environment", ({
		expect,
	}) => {
		expect.assertions(2);

		const desired = gamePassDesired({ movedFrom: "absent" });

		expect(diff([desired], [gamePassCurrent()])[0]!.type).toBe("noop");
		expect(diff([desired], [])[0]!.type).toBe("create");
	});

	it("should reject occupied old and new keys naming both", ({ expect }) => {
		expect.assertions(1);
		expect(() => {
			return diff(
				[gamePassDesired({ movedFrom: "old" })],
				[gamePassCurrent(), gamePassCurrent({ key: asResourceKey("old") })],
			);
		}).toThrow(/old.*vip-pass|vip-pass.*old/);
	});

	it("should reject a previous key that is still declared", ({ expect }) => {
		expect.assertions(1);
		expect(() => {
			return diff(
				[
					gamePassDesired({ key: asResourceKey("old") }),
					gamePassDesired({ movedFrom: "old" }),
				],
				[gamePassCurrent({ key: asResourceKey("old") })],
			);
		}).toThrow(
			"Cannot move 'old' to 'vip-pass' (gamePass): 'old' is still declared in config.",
		);
	});

	it("should reject a previous key that belongs only to another kind", ({ expect }) => {
		expect.assertions(1);
		expect(() => {
			return diff(
				[gamePassDesired({ movedFrom: "gems" })],
				[developerProductCurrent({ key: asResourceKey("gems") })],
			);
		}).toThrow(/gamePass.*developerProduct|developerProduct.*gamePass/);
	});

	it("should prefer a same-kind source when another kind shares its key", ({ expect }) => {
		expect.assertions(1);
		expect(
			diff(
				[
					gamePassDesired({ movedFrom: "old" }),
					developerProductDesired({ key: asResourceKey("old") }),
				],
				[
					gamePassCurrent({ key: asResourceKey("old") }),
					developerProductCurrent({ key: asResourceKey("old") }),
				],
			),
		).toStrictEqual([
			{ key: "vip-pass", kind: "gamePass", type: "noop" },
			{ key: "old", kind: "developerProduct", type: "noop" },
		]);
	});

	it("should refuse two declarations claiming one live resource", ({ expect }) => {
		expect.assertions(1);
		expect(() => {
			return diff(
				[
					gamePassDesired({ movedFrom: "old" }),
					gamePassDesired({ key: asResourceKey("second"), movedFrom: "old" }),
				],
				[gamePassCurrent({ key: asResourceKey("old") })],
			);
		}).toThrow(/old.*second|second.*old/);
	});

	it("should allow the destination key to be occupied by another kind", ({ expect }) => {
		expect.assertions(1);
		expect(
			diff(
				[
					gamePassDesired({ movedFrom: "old" }),
					developerProductDesired({ key: asResourceKey("vip-pass") }),
				],
				[
					gamePassCurrent({ key: asResourceKey("old") }),
					developerProductCurrent({ key: asResourceKey("vip-pass") }),
				],
			),
		).toStrictEqual([
			{ key: "vip-pass", kind: "gamePass", type: "noop" },
			{ key: "vip-pass", kind: "developerProduct", type: "noop" },
		]);
	});

	it("should recognize an orphaned place even when another kind still declares its old key", ({
		expect,
	}) => {
		expect.assertions(1);
		expect(
			diff(
				[
					developerProductDesired({ key: asResourceKey("start-place") }),
					placeDesired({ key: asResourceKey("new") }),
				],
				[developerProductCurrent({ key: asResourceKey("start-place") }), placeCurrent()],
			),
		).toStrictEqual([
			{ key: "start-place", kind: "developerProduct", type: "noop" },
			{ key: "new", kind: "place", type: "noop" },
		]);
	});

	it("should implicitly rename a place when another kind occupies its destination key", ({
		expect,
	}) => {
		expect.assertions(1);
		expect(
			diff(
				[
					placeDesired({ key: asResourceKey("new") }),
					developerProductDesired({ key: asResourceKey("new") }),
				],
				[placeCurrent(), developerProductCurrent({ key: asResourceKey("new") })],
			),
		).toStrictEqual([
			{ key: "new", kind: "place", type: "noop" },
			{ key: "new", kind: "developerProduct", type: "noop" },
		]);
	});

	it("should infer a place rename only from an orphan with the same placeId", ({ expect }) => {
		expect.assertions(4);

		const desired = placeDesired({ key: asResourceKey("new") });

		expect(diff([desired], [placeCurrent()])).toStrictEqual([
			{ key: "new", kind: "place", type: "noop" },
		]);
		expect(
			diff([placeDesired(), desired], [placeCurrent()]).map((op) => op.type),
		).toStrictEqual(["noop", "create"]);
		expect(() => diff([desired], [placeCurrent({ placeId: asRobloxAssetId("999") })])).toThrow(
			"place:start-place",
		);
		expect(() => {
			return diff([desired], [placeCurrent(), placeCurrent({ key: asResourceKey("new") })]);
		}).toThrow("place:start-place");
	});
});
