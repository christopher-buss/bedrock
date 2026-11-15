import { ArkErrors } from "arktype";
import { assert, describe, it } from "vitest";

import { badgeCurrent, badgeDesired } from "#tests/helpers/resources";
import { asResourceKey, asSha256Hex } from "../../types/ids.ts";
import type { ResourceCurrentState } from "../resources.ts";
import { badgeKind } from "./badge.ts";

const ALT_HASH = asSha256Hex("a3f2c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852e1b0");

const DRIFTS = [
	{ current: { description: "Old." }, field: "description" },
	{ current: { enabled: false }, field: "enabled" },
	{ current: { icon: { "en-us": "assets/old.png" } }, field: "icon" },
	{ current: { iconFileHashes: { "en-us": ALT_HASH } }, field: "iconFileHashes" },
	{ current: { name: "Old Name" }, field: "name" },
] as const satisfies ReadonlyArray<{
	current: Partial<ResourceCurrentState<"badge">>;
	field: string;
}>;

describe("badgeKind", () => {
	describe("entrySchema", () => {
		it("should accept an entry that omits icon", ({ expect }) => {
			expect.assertions(1);

			expect(
				badgeKind.entrySchema({ name: "First Win", description: "Win a round." }),
			).not.toBeInstanceOf(ArkErrors);
		});
	});

	describe("flatten", () => {
		it("should omit icon from the flattened input when not declared", ({ expect }) => {
			expect.assertions(1);

			const inputs = badgeKind.flatten({
				badges: { "first-win": { name: "First Win", description: "Win a round." } },
				environments: { production: {} },
			});

			expect(inputs[0]).not.toContainKey("icon");
		});

		it("should propagate icon onto the flattened input when declared", ({ expect }) => {
			expect.assertions(1);

			const inputs = badgeKind.flatten({
				badges: {
					"first-win": {
						name: "First Win",
						description: "Win a round.",
						icon: { "en-us": "assets/first-win.png" },
					},
				},
				environments: { production: {} },
			});

			expect(inputs[0]).toMatchObject({ icon: { "en-us": "assets/first-win.png" } });
		});
	});

	describe("normalize", () => {
		it("should not read files and record no icon hash when icon is absent", async ({
			expect,
		}) => {
			expect.assertions(2);

			const result = await badgeKind.normalize(
				{
					key: asResourceKey("first-win"),
					name: "First Win",
					description: "Win your first round.",
					enabled: true,
					kind: "badge",
				},
				{
					readFile: async () => {
						throw new Error("Unexpected read");
					},
				},
			);

			assert(result.success);

			expect(result.data).not.toContainKey("icon");
			expect(result.data).not.toContainKey("iconFileHashes");
		});

		it("should surface a fileReadFailed error carrying the icon path when readFile rejects", async ({
			expect,
		}) => {
			expect.hasAssertions();

			const result = await badgeKind.normalize(
				{
					key: asResourceKey("first-win"),
					name: "First Win",
					description: "Win your first round.",
					enabled: true,
					icon: { "en-us": "assets/missing.png" },
					kind: "badge",
				},
				{
					readFile: async () => {
						throw new Error("ENOENT");
					},
				},
			);

			expect(result).toMatchObject({
				err: { key: "first-win", filePath: "assets/missing.png", kind: "fileReadFailed" },
				success: false,
			});
		});
	});

	describe("changedFieldsBetween", () => {
		it("should report no changed fields when every managed field matches", ({ expect }) => {
			expect.assertions(2);

			expect(badgeKind.changedFieldsBetween(badgeDesired(), badgeCurrent())).toBeEmpty();
			expect(badgeKind.fieldsEqual(badgeDesired(), badgeCurrent())).toBeTrue();
		});

		it("should report no changed fields when neither side declares an icon", ({ expect }) => {
			expect.assertions(1);

			const { icon: _icon, iconFileHashes: _hashes, ...desired } = badgeDesired();
			const {
				icon: _currentIcon,
				iconFileHashes: _currentHashes,
				...current
			} = badgeCurrent();

			expect(badgeKind.changedFieldsBetween(desired, current)).toBeEmpty();
		});

		it("should report icon and iconFileHashes when desired drops the icon", ({ expect }) => {
			expect.assertions(1);

			const { icon: _icon, iconFileHashes: _hashes, ...desired } = badgeDesired();

			expect(badgeKind.changedFieldsBetween(desired, badgeCurrent())).toStrictEqual([
				"icon",
				"iconFileHashes",
			]);
		});

		it.for(DRIFTS)(
			"should report $field when only it differs",
			({ current, field }, { expect }) => {
				expect.assertions(2);

				expect(
					badgeKind.changedFieldsBetween(badgeDesired(), badgeCurrent(current)),
				).toStrictEqual([field]);
				expect(badgeKind.fieldsEqual(badgeDesired(), badgeCurrent(current))).toBeFalse();
			},
		);
	});
});
