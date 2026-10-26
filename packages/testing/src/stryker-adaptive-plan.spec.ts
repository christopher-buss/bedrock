import { describe, it } from "vitest";

import {
	buildLeaseReport,
	buildStrykerLeaseRequest,
	maxStrykerWorkers,
	parseCapacityApplied,
	setCapacityMessage,
	workersToGrow,
} from "./stryker-adaptive-plan.ts";

describe(maxStrykerWorkers, () => {
	it.for([
		{ expected: 2, parallelism: 1 },
		{ expected: 2, parallelism: 2 },
		{ expected: 2, parallelism: 3 },
		{ expected: 3, parallelism: 4 },
		{ expected: 15, parallelism: 16 },
	])(
		"should allow $parallelism logical cores to use $expected workers",
		({ expected, parallelism }, { expect }) => {
			expect.assertions(1);

			expect(maxStrykerWorkers(parallelism)).toBe(expected);
		},
	);
});

describe(buildStrykerLeaseRequest, () => {
	it("should ask for a checker and a test runner up to the core limit at 1 GiB each", ({
		expect,
	}) => {
		expect.assertions(1);

		expect(
			buildStrykerLeaseRequest({ parallelism: 8, project: "packages/actions" }),
		).toStrictEqual({
			cost: { pass: "stryker", project: "packages/actions" },
			isMainLaneOnly: true,
			maxWorkers: 7,
			memoryPerWorker: 1024 * 1024 * 1024,
			minWorkers: 2,
		});
	});
});

describe(workersToGrow, () => {
	it.for([
		{ cap: 8, expected: 4, held: 3, max: 7 },
		{ cap: 5, expected: 2, held: 3, max: 7 },
		{ cap: 3, expected: 0, held: 3, max: 7 },
		{ cap: 2, expected: 0, held: 3, max: 7 },
	])(
		"should grow $expected workers when $held are held under a cap of $cap",
		({ cap, expected, held, max }, { expect }) => {
			expect.assertions(1);

			expect(workersToGrow({ cap, held, max })).toBe(expected);
		},
	);
});

describe(buildLeaseReport, () => {
	it("should report both peaks when the platform reads them", ({ expect }) => {
		expect.assertions(1);

		expect(buildLeaseReport({ peakMemory: 900, peakPerWorker: 300 })).toStrictEqual({
			peakMemory: 900,
			peakPerWorker: 300,
		});
	});

	it("should leave out the worker peak when only the tree peak is known", ({ expect }) => {
		expect.assertions(1);

		expect(buildLeaseReport({ peakMemory: 900, peakPerWorker: undefined })).toStrictEqual({
			peakMemory: 900,
		});
	});

	it("should report nothing when the tree peak is unknown", ({ expect }) => {
		expect.assertions(1);

		expect(buildLeaseReport({ peakMemory: undefined, peakPerWorker: 300 })).toBeUndefined();
	});
});

describe(setCapacityMessage, () => {
	it("should build the resize message the patched Stryker reads", ({ expect }) => {
		expect.assertions(1);

		expect(setCapacityMessage(5)).toStrictEqual({ capacity: 5, type: "stryker:set-capacity" });
	});
});

describe(parseCapacityApplied, () => {
	it("should read the capacity Stryker applied", ({ expect }) => {
		expect.assertions(1);

		expect(parseCapacityApplied({ capacity: 4, type: "stryker:capacity-applied" })).toBe(4);
	});

	it.for([
		["another type", { capacity: 4, type: "stryker:set-capacity" }],
		["a text capacity", { capacity: "4", type: "stryker:capacity-applied" }],
		["no object", "stryker:capacity-applied"],
		["nothing", undefined],
		["null", JSON.parse("null")],
	])("should ignore %s", ([, message], { expect }) => {
		expect.assertions(1);

		expect(parseCapacityApplied(message)).toBeUndefined();
	});
});
