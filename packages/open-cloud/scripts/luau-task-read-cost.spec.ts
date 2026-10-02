import { describe, expect, it } from "vitest";

import { buildGetUrl, parseTaskRef, summarizeReadCost } from "./luau-task-read-cost.ts";
import type { ReadSample } from "./luau-task-read-cost.ts";

function sample(remaining: number, timeMs: number): ReadSample {
	return { limit: 200, remaining, status: 200, timeMs };
}

describe(parseTaskRef, () => {
	it("should parse a version-pinned session task path into a GET url", () => {
		expect.assertions(1);

		const body = JSON.stringify({
			path: "universes/1/places/2/versions/3/luau-execution-sessions/s-1/tasks/t-1",
		});

		expect(buildGetUrl(parseTaskRef(body))).toBe(
			"/cloud/v2/universes/1/places/2/versions/3/luau-execution-sessions/s-1/tasks/t-1",
		);
	});

	it("should return undefined for a body without a session task path", () => {
		expect.assertions(4);

		expect(parseTaskRef("not json")).toBeUndefined();
		expect(parseTaskRef("[]")).toBeUndefined();
		expect(parseTaskRef(JSON.stringify({ path: 7 }))).toBeUndefined();
		expect(parseTaskRef(JSON.stringify({ path: "universes/1/places/2" }))).toBeUndefined();
	});

	it("should build no url when the ref is undefined or not version-pinned", () => {
		expect.assertions(2);

		expect(buildGetUrl(undefined)).toBeUndefined();
		expect(
			buildGetUrl(
				parseTaskRef(
					JSON.stringify({
						path: "universes/1/places/2/luau-execution-session-tasks/t-1",
					}),
				),
			),
		).toBeUndefined();
	});
});

describe(summarizeReadCost, () => {
	it("should report one unit per read when the counter falls by one per call", () => {
		expect.assertions(1);

		const burst = [sample(199, 0), sample(198, 100), sample(197, 200)];

		expect(
			summarizeReadCost({ burst, idle: { after: sample(196, 10_200), before: burst[2] } }),
		).toStrictEqual({
			burstDeltas: [1, 1],
			burstDropPerSecond: 10,
			effectiveReadsPerWindow: 200,
			idleDrainPerSecond: 0,
			unitsPerRead: 1,
			verdict: "each read costs 1 unit of the 200 window; no background drain observed",
		});
	});

	it("should report the median step and the window ceiling it implies when reads cost more", () => {
		expect.assertions(1);

		const burst = [sample(127, 0), sample(123, 100), sample(119, 200), sample(115, 300)];

		expect(
			summarizeReadCost({ burst, idle: { after: sample(111, 10_300), before: burst[3] } }),
		).toMatchObject({
			burstDeltas: [4, 4, 4],
			effectiveReadsPerWindow: 50,
			idleDrainPerSecond: 0,
			unitsPerRead: 4,
			verdict: "each read costs 4 units of the 200 window; no background drain observed",
		});
	});

	it("should attribute time-correlated loss to background drain when the counter falls while idle", () => {
		expect.assertions(1);

		const burst = [sample(127, 0), sample(126, 100), sample(125, 200)];

		expect(
			summarizeReadCost({ burst, idle: { after: sample(89, 10_200), before: burst[2] } }),
		).toMatchObject({
			idleDrainPerSecond: 3.5,
			unitsPerRead: 1,
			verdict:
				"each read costs 1 unit of the 200 window; background drain of 3.5 units/s from another consumer on this key or IP",
		});
	});

	it("should ignore steps that cross a window reset and non-2xx reads", () => {
		expect.assertions(1);

		const burst = [
			sample(3, 0),
			sample(2, 100),
			sample(200, 200),
			sample(199, 300),
			{ ...sample(199, 400), status: 429 },
			{ ...sample(199, 450), remaining: undefined },
			sample(198, 500),
		];

		expect(
			summarizeReadCost({ burst, idle: { after: sample(198, 10_500), before: burst[6] } }),
		).toMatchObject({ burstDeltas: [1, 1, 1], unitsPerRead: 1 });
	});

	it("should leave the drain unmeasured when the pause is bracketed by uncounted reads or a reset", () => {
		expect.assertions(4);

		const burst = [sample(10, 0), sample(9, 100)];
		const idleWithReset = { after: sample(200, 10_100), before: burst[1] };
		const idleAfterThrottle = {
			after: { ...sample(9, 10_100), status: 429 },
			before: burst[1],
		};
		const idleWithoutBefore = { after: sample(8, 10_100), before: undefined };
		const idleWithoutElapsed = { after: sample(8, 100), before: burst[1] };

		expect(
			summarizeReadCost({ burst, idle: idleWithReset }).idleDrainPerSecond,
		).toBeUndefined();
		expect(
			summarizeReadCost({ burst, idle: idleAfterThrottle }).idleDrainPerSecond,
		).toBeUndefined();
		expect(
			summarizeReadCost({ burst, idle: idleWithoutBefore }).idleDrainPerSecond,
		).toBeUndefined();
		expect(
			summarizeReadCost({ burst, idle: idleWithoutElapsed }).idleDrainPerSecond,
		).toBeUndefined();
	});

	it("should average an even number of deltas and omit the ceiling when the limit header is absent", () => {
		expect.assertions(1);

		const burst = [
			{ ...sample(10, 0), limit: undefined },
			{ ...sample(9, 100), limit: undefined },
			{ ...sample(6, 200), limit: undefined },
		];

		expect(
			summarizeReadCost({ burst, idle: { after: sample(4, 10_200), before: burst[2] } }),
		).toMatchObject({
			burstDeltas: [1, 3],
			effectiveReadsPerWindow: undefined,
			unitsPerRead: 2,
			verdict: "each read costs 2 units of the window; no background drain observed",
		});
	});

	it("should be inconclusive when fewer than two successful reads were captured", () => {
		expect.assertions(1);

		const burst = [sample(10, 0)];

		expect(
			summarizeReadCost({ burst, idle: { after: sample(10, 10_000), before: burst[0] } }),
		).toStrictEqual({
			burstDeltas: [],
			burstDropPerSecond: undefined,
			effectiveReadsPerWindow: undefined,
			idleDrainPerSecond: undefined,
			unitsPerRead: undefined,
			verdict: "INCONCLUSIVE (fewer than two successful reads)",
		});
	});

	it("should omit the ceiling when every read reports zero cost", () => {
		expect.assertions(1);

		const burst = [sample(10, 0), sample(10, 100)];

		expect(
			summarizeReadCost({ burst, idle: { after: sample(10, 10_100), before: burst[1] } }),
		).toMatchObject({ effectiveReadsPerWindow: undefined, unitsPerRead: 0 });
	});
});
