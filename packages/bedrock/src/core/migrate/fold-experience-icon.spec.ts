import { describe, expect, it } from "vitest";

import { foldExperienceIcon } from "./fold-experience-icon.ts";
import { EMPTY_FRAGMENT } from "./fold-universe-shared.ts";
import type { MantleResource } from "./types.ts";

const BLOCKED_REASON =
	"Open Cloud has no route to set a universe's source-language game icon; configure it via the Roblox creator portal.";

function experienceIcon(key: string, inputs: unknown): MantleResource {
	return { key, dependencies: [], inputs, kind: "experienceIcon", outputs: undefined };
}

describe(foldExperienceIcon, () => {
	it("should return EMPTY_FRAGMENT when no experienceIcon resources are present", () => {
		expect.assertions(1);

		const result = foldExperienceIcon([
			{
				key: "singleton",
				dependencies: [],
				inputs: {},
				kind: "experience",
				outputs: undefined,
			},
		]);

		expect(result).toBe(EMPTY_FRAGMENT);
	});

	it("should emit one blocked warning per experienceIcon resource with a readable payload", () => {
		expect.assertions(1);

		const result = foldExperienceIcon([
			experienceIcon("singleton", { filePath: "assets/marketing/icon.png" }),
			experienceIcon("alternate", { filePath: "assets/marketing/alt.png" }),
		]);

		expect(result.warnings).toStrictEqual([
			{
				kind: "blocked",
				mantlePath: "experienceIcon_singleton",
				reason: BLOCKED_REASON,
			},
			{
				kind: "blocked",
				mantlePath: "experienceIcon_alternate",
				reason: BLOCKED_REASON,
			},
		]);
	});

	it("should silently skip an experienceIcon resource whose inputs is not an object", () => {
		expect.assertions(1);

		const result = foldExperienceIcon([experienceIcon("singleton", "not-an-object")]);

		expect(result).toBe(EMPTY_FRAGMENT);
	});

	it("should silently skip an experienceIcon resource whose filePath is non-string", () => {
		expect.assertions(1);

		const result = foldExperienceIcon([experienceIcon("singleton", { filePath: 42 })]);

		expect(result).toBe(EMPTY_FRAGMENT);
	});
});
