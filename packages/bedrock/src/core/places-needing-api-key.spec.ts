import { describe, it } from "vitest";

import { gamePassDesired, placeCurrent, placeDesired } from "#tests/helpers/resources";
import { asResourceKey } from "../types/ids.ts";
import type { Operation } from "./operations.ts";
import { placesNeedingApiKey } from "./places-needing-api-key.ts";

const startPlace = asResourceKey("start-place");

describe(placesNeedingApiKey, () => {
	it("should name a place create with a file", ({ expect }) => {
		expect.assertions(1);

		const ops: ReadonlyArray<Operation> = [
			{ key: startPlace, desired: placeDesired(), type: "create" },
		];

		expect(placesNeedingApiKey(ops)).toStrictEqual([startPlace]);
	});

	it("should name a metadata-only place update with a file", ({ expect }) => {
		expect.assertions(1);

		const ops: ReadonlyArray<Operation> = [
			{
				key: startPlace,
				changedFields: ["displayName"],
				current: placeCurrent(),
				desired: placeDesired({ displayName: "Start" }),
				type: "update",
			},
		];

		expect(placesNeedingApiKey(ops)).toStrictEqual([startPlace]);
	});

	it("should skip a noop place, a place with no file and other kinds", ({ expect }) => {
		expect.assertions(1);

		const ops: ReadonlyArray<Operation> = [
			{ key: startPlace, kind: "place", type: "noop" },
			{
				key: startPlace,
				desired: placeDesired({ fileHash: undefined, filePath: undefined }),
				type: "create",
			},
			{ key: asResourceKey("vip-pass"), desired: gamePassDesired(), type: "create" },
		];

		expect(placesNeedingApiKey(ops)).toStrictEqual([]);
	});
});
