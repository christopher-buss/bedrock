import { describe, it } from "vitest";

import { foldExperienceIcon } from "./fold-experience-icon.ts";
import { EMPTY_FRAGMENT } from "./fold-universe-shared.ts";
import type { MantleResource } from "./types.ts";

const HASH = "86890ed405cabad0fcdabf52225d528981790fa551e915c070348761c28373c1";
const START_PLACE_ID = "17613681043";
const INPUTS = { fileHash: HASH, filePath: "assets/marketing/icon.png" };
const OUTPUTS = { assetId: 707633946677216 };

function experienceIcon(
	key: string,
	{ inputs = INPUTS, outputs = OUTPUTS }: { inputs?: unknown; outputs?: unknown } = {},
): MantleResource {
	return { key, dependencies: [], inputs, kind: "experienceIcon", outputs };
}

describe(foldExperienceIcon, () => {
	it("should return EMPTY_FRAGMENT when no experienceIcon resources are present", ({
		expect,
	}) => {
		expect.assertions(1);

		const result = foldExperienceIcon(
			[{ key: "singleton", dependencies: [], inputs: {}, kind: "experience", outputs: {} }],
			START_PLACE_ID,
		);

		expect(result).toBe(EMPTY_FRAGMENT);
	});

	it("should fold the singleton icon into the universe icon and its outputs", ({ expect }) => {
		expect.assertions(1);

		const result = foldExperienceIcon([experienceIcon("singleton")], START_PLACE_ID);

		expect(result).toStrictEqual({
			entryFragment: { icon: { "en-us": "assets/marketing/icon.png" } },
			mantleIcon: {
				icon: { "en-us": "assets/marketing/icon.png" },
				iconFileHashes: { "en-us": HASH },
			},
			outputsFragment: {
				iconAssetIds: { "en-us": "707633946677216" },
				iconStartPlaceId: START_PLACE_ID,
			},
			warnings: [],
		});
	});

	it.for([
		{ inputs: "not-an-object", label: "inputs that are not an object" },
		{ label: "outputs that are not an object", outputs: "not-an-object" },
		{ inputs: { fileHash: HASH, filePath: 42 }, label: "a non-string filePath" },
		{ inputs: { fileHash: 42, filePath: "icon.png" }, label: "a non-string fileHash" },
		{ inputs: { fileHash: "deadbeef", filePath: "icon.png" }, label: "an invalid fileHash" },
		{ label: "a missing assetId", outputs: {} },
	])("should silently skip an icon with $label", ({ inputs, outputs }, { expect }) => {
		expect.assertions(1);

		const result = foldExperienceIcon(
			[experienceIcon("singleton", { inputs, outputs })],
			START_PLACE_ID,
		);

		expect(result).toBe(EMPTY_FRAGMENT);
	});
});
