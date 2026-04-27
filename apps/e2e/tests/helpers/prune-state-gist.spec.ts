import { describe, expect, it } from "vitest";

import { selectFilesToDelete } from "./prune-state-gist.ts";

describe(selectFilesToDelete, () => {
	it.for<[label: string, input: ReadonlyArray<string>]>([
		["empty list", []],
		["only non-matching files", ["other.json", "state.cli-smoke-1.json"]],
		["fewer matches than keep", ["state.smoke-1.json", "state.smoke-2.json"]],
		[
			"exactly keep matches",
			["state.smoke-1.json", "state.smoke-2.json", "state.smoke-3.json"],
		],
	])("should return no deletions when prefix matches do not exceed keep: %s", ([, input]) => {
		expect.assertions(1);

		expect(selectFilesToDelete(input, "state.smoke-", 3)).toStrictEqual([]);
	});

	it("should return the oldest excess matches, sorting unordered input by filename", () => {
		expect.assertions(1);

		const filenames = [
			"state.smoke-1737900000003.json",
			"state.smoke-1737900000001.json",
			"state.smoke-1737900000005.json",
			"state.smoke-1737900000002.json",
			"state.smoke-1737900000004.json",
		];

		expect(selectFilesToDelete(filenames, "state.smoke-", 3)).toStrictEqual([
			"state.smoke-1737900000001.json",
			"state.smoke-1737900000002.json",
		]);
	});

	it("should consider only prefix-matching files when computing the prune set", () => {
		expect.assertions(1);

		const filenames = [
			"state.cli-smoke-1737900000010.json",
			"state.smoke-1737900000001.json",
			"state.smoke-1737900000002.json",
			"state.smoke-1737900000003.json",
			"state.smoke-1737900000004.json",
			"state.other.json",
		];

		expect(selectFilesToDelete(filenames, "state.smoke-", 3)).toStrictEqual([
			"state.smoke-1737900000001.json",
		]);
	});
});
