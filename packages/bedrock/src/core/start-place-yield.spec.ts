import { describe, it } from "vitest";

import type { ResolvedConfig } from "./schema.ts";
import { contestedStartPlaceFields, yieldStartPlaceFields } from "./start-place-yield.ts";

const ENVIRONMENTS = { production: {} };

describe(contestedStartPlaceFields, () => {
	it.for<[string, ResolvedConfig]>([
		[
			"no place",
			{
				environments: ENVIRONMENTS,
				universe: { displayName: "My Experience", universeId: "1" },
			},
		],
		[
			"no universe",
			{
				environments: ENVIRONMENTS,
				places: { start: { displayName: "Lobby", placeId: "2" } },
			},
		],
	])("should contest no field when the config declares %s", ([, config], { expect }) => {
		expect.assertions(1);

		expect(contestedStartPlaceFields(config)).toBeEmpty();
	});
});

describe(yieldStartPlaceFields, () => {
	it("should skip nothing when the config declares no place", ({ expect }) => {
		expect.assertions(1);

		const yielded = yieldStartPlaceFields(
			{
				environments: ENVIRONMENTS,
				universe: { displayName: "My Experience", universeId: "1" },
			},
			"2",
		);

		expect(yielded.skipped).toBeEmpty();
	});

	it("should skip nothing when only another place declares the contested field", ({ expect }) => {
		expect.assertions(1);

		const yielded = yieldStartPlaceFields(
			{
				environments: ENVIRONMENTS,
				places: {
					lobby: { displayName: "Side lobby", placeId: "3" },
					start: { placeId: "2" },
				},
				universe: { displayName: "My Experience", universeId: "1" },
			},
			"2",
		);

		expect(yielded.skipped).toBeEmpty();
	});
});
