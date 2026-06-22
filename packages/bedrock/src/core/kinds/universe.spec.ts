import { PLATFORM_FLAG_ROWS, universeCurrent, universeDesired } from "#tests/helpers/resources";
import { ArkErrors } from "arktype";
import { assert, describe, expect, it } from "vitest";

import { asRobloxAssetId } from "../../types/ids.ts";
import { SOCIAL_LINK_FIELDS, UNIVERSE_SINGLETON_KEY } from "../resources.ts";
import { changedUniverseFields, universeKind } from "./universe.ts";

const NORMALIZE_IO_NEVER = {
	readFile: async (): Promise<Uint8Array> => {
		throw new Error("normalize should not touch the file system");
	},
};

const BlankFlags = {
	consoleEnabled: undefined,
	desktopEnabled: undefined,
	displayName: undefined,
	mobileEnabled: undefined,
	tabletEnabled: undefined,
	vrEnabled: undefined,
} as const;

describe("universeKind", () => {
	it("should tag its kind discriminator as universe", () => {
		expect.assertions(1);

		expect(universeKind.kind).toBe("universe");
	});

	describe("entrySchema", () => {
		it("should accept an entry declaring just universeId", () => {
			expect.assertions(1);

			expect(universeKind.entrySchema({ universeId: "1234567890" })).not.toBeInstanceOf(
				ArkErrors,
			);
		});
	});

	describe("flatten", () => {
		it("should emit one singleton input stamped with the universe key when present", () => {
			expect.assertions(1);

			expect(
				universeKind.flatten({
					environments: { production: {} },
					universe: { universeId: "1234567890", voiceChatEnabled: true },
				}),
			).toStrictEqual([
				{
					...BlankFlags,
					key: UNIVERSE_SINGLETON_KEY,
					kind: "universe",
					universeId: asRobloxAssetId("1234567890"),
					voiceChatEnabled: true,
				},
			]);
		});

		it("should emit an empty list when the config has no universe block", () => {
			expect.assertions(1);

			expect(universeKind.flatten({ environments: { production: {} } })).toBeEmpty();
		});

		it("should pass voiceChatEnabled through as undefined when omitted", () => {
			expect.assertions(1);

			const inputs = universeKind.flatten({
				environments: { production: {} },
				universe: { universeId: "1234567890" },
			});

			expect(inputs[0]?.voiceChatEnabled).toBeUndefined();
		});
	});

	describe("normalize", () => {
		it("should pass every declared field through unchanged without touching I/O", async () => {
			expect.assertions(1);

			const result = await universeKind.normalize(
				{
					...BlankFlags,
					key: UNIVERSE_SINGLETON_KEY,
					kind: "universe",
					universeId: asRobloxAssetId("1234567890"),
					voiceChatEnabled: true,
				},
				NORMALIZE_IO_NEVER,
			);

			assert(result.success);

			expect(result.data).toStrictEqual({
				...BlankFlags,
				key: UNIVERSE_SINGLETON_KEY,
				kind: "universe",
				universeId: asRobloxAssetId("1234567890"),
				voiceChatEnabled: true,
			});
		});
	});

	describe("fieldsEqual", () => {
		it("should return true when every managed field matches", () => {
			expect.assertions(1);

			expect(universeKind.fieldsEqual(universeDesired(), universeCurrent())).toBeTrue();
		});

		it.for<[label: string, currentOverrides: Partial<ResourceCurrentStateUniverse>]>([
			["universeId", { universeId: asRobloxAssetId("9999999999") }],
		])("should return false when %s differs", ([, overrides]) => {
			expect.assertions(1);

			expect(
				universeKind.fieldsEqual(universeDesired(), universeCurrent(overrides)),
			).toBeFalse();
		});
	});

	describe("changedFieldsBetween", () => {
		const sampleLink = { title: "Old", uri: "https://example.com/old" };

		it("should return an empty list when every managed field matches", () => {
			expect.assertions(1);

			expect(
				universeKind.changedFieldsBetween(universeDesired(), universeCurrent()),
			).toStrictEqual([]);
		});

		it("should return [universeId] when only the universeId differs", () => {
			expect.assertions(1);

			expect(
				universeKind.changedFieldsBetween(
					universeDesired(),
					universeCurrent({ universeId: asRobloxAssetId("9999999999") }),
				),
			).toStrictEqual(["universeId"]);
		});

		it.for(PLATFORM_FLAG_ROWS)(
			"should return [%s] when a declared %s flag flips from current",
			([flag]) => {
				expect.assertions(1);

				expect(
					universeKind.changedFieldsBetween(
						universeDesired({ [flag]: true }),
						universeCurrent({ [flag]: false }),
					),
				).toStrictEqual([flag]);
			},
		);

		it.for(PLATFORM_FLAG_ROWS)(
			"should return an empty list when desired leaves %s unmanaged but current carries a value",
			([flag]) => {
				expect.assertions(1);

				expect(
					universeKind.changedFieldsBetween(
						universeDesired(),
						universeCurrent({ [flag]: true }),
					),
				).toStrictEqual([]);
			},
		);

		it("should return [voiceChatEnabled] when a declared voiceChatEnabled flips from current", () => {
			expect.assertions(1);

			expect(
				universeKind.changedFieldsBetween(
					universeDesired({ voiceChatEnabled: true }),
					universeCurrent({ voiceChatEnabled: false }),
				),
			).toStrictEqual(["voiceChatEnabled"]);
		});

		it("should return [displayName] when a declared displayName differs from current", () => {
			expect.assertions(1);

			expect(
				universeKind.changedFieldsBetween(
					universeDesired({ displayName: "New Name" }),
					universeCurrent({ displayName: "Old Name" }),
				),
			).toStrictEqual(["displayName"]);
		});

		it("should return an empty list when desired leaves displayName unmanaged but current carries a value", () => {
			expect.assertions(1);

			expect(
				universeKind.changedFieldsBetween(
					universeDesired(),
					universeCurrent({ displayName: "Server Owned" }),
				),
			).toStrictEqual([]);
		});

		it("should return [privateServerPriceRobux] when the key is present and the value differs from current", () => {
			expect.assertions(1);

			expect(
				universeKind.changedFieldsBetween(
					universeDesired({ privateServerPriceRobux: 250 }),
					universeCurrent({ privateServerPriceRobux: 100 }),
				),
			).toStrictEqual(["privateServerPriceRobux"]);
		});

		it("should return [privateServerPriceRobux] when the key is present with undefined and current has a value", () => {
			expect.assertions(1);

			expect(
				universeKind.changedFieldsBetween(
					universeDesired({ privateServerPriceRobux: undefined }),
					universeCurrent({ privateServerPriceRobux: 100 }),
				),
			).toStrictEqual(["privateServerPriceRobux"]);
		});

		it("should return an empty list when privateServerPriceRobux key is absent in desired", () => {
			expect.assertions(1);

			expect(
				universeKind.changedFieldsBetween(
					universeDesired(),
					universeCurrent({ privateServerPriceRobux: 100 }),
				),
			).toStrictEqual([]);
		});

		it.for(SOCIAL_LINK_FIELDS)(
			"should return [%s] when a declared %s social link drifts from current",
			(field) => {
				expect.assertions(1);

				expect(
					universeKind.changedFieldsBetween(
						universeDesired({
							[field]: { title: "New", uri: "https://example.com/new" },
						}),
						universeCurrent({ [field]: sampleLink }),
					),
				).toStrictEqual([field]);
			},
		);

		it.for(SOCIAL_LINK_FIELDS)(
			"should return [%s] when desired declares %s as undefined and current has a link",
			(field) => {
				expect.assertions(1);

				expect(
					universeKind.changedFieldsBetween(
						universeDesired({ [field]: undefined }),
						universeCurrent({ [field]: sampleLink }),
					),
				).toStrictEqual([field]);
			},
		);

		it.for(SOCIAL_LINK_FIELDS)(
			"should return an empty list when %s is absent from desired regardless of current",
			(field) => {
				expect.assertions(1);

				expect(
					universeKind.changedFieldsBetween(
						universeDesired(),
						universeCurrent({ [field]: sampleLink }),
					),
				).toStrictEqual([]);
			},
		);

		it("should return every changed field in declaration order when many differ", () => {
			expect.assertions(1);

			expect(
				universeKind.changedFieldsBetween(
					universeDesired({
						desktopEnabled: true,
						discordSocialLink: { title: "New", uri: "https://discord.gg/new" },
						displayName: "New",
						privateServerPriceRobux: 250,
						voiceChatEnabled: true,
					}),
					universeCurrent({
						desktopEnabled: false,
						discordSocialLink: sampleLink,
						displayName: "Old",
						privateServerPriceRobux: 100,
						voiceChatEnabled: false,
					}),
				),
			).toStrictEqual([
				"desktopEnabled",
				"voiceChatEnabled",
				"displayName",
				"privateServerPriceRobux",
				"discordSocialLink",
			]);
		});
	});
});

describe(changedUniverseFields, () => {
	const sampleLink = { title: "Old", uri: "https://example.com/old" };

	it("should return every declared field when no current state is given", () => {
		expect.assertions(1);

		expect(
			changedUniverseFields(
				universeDesired({
					discordSocialLink: { title: "New", uri: "https://discord.gg/new" },
					displayName: "Fun Universe",
					privateServerPriceRobux: 250,
					voiceChatEnabled: true,
				}),
			),
		).toStrictEqual(
			new Set([
				"discordSocialLink",
				"displayName",
				"privateServerPriceRobux",
				"voiceChatEnabled",
			]),
		);
	});

	it("should return an empty set when nothing is declared on create", () => {
		expect.assertions(1);

		expect(changedUniverseFields(universeDesired())).toStrictEqual(new Set());
	});

	it("should narrow to only the drifted fields when a current state is given", () => {
		expect.assertions(1);

		expect(
			changedUniverseFields(
				universeDesired({
					discordSocialLink: sampleLink,
					displayName: "Same",
					privateServerPriceRobux: 250,
					voiceChatEnabled: true,
				}),
				universeCurrent({
					discordSocialLink: sampleLink,
					displayName: "Same",
					privateServerPriceRobux: 250,
					voiceChatEnabled: false,
				}),
			),
		).toStrictEqual(new Set(["voiceChatEnabled"]));
	});
});

type ResourceCurrentStateUniverse = Parameters<typeof universeKind.fieldsEqual>[1];
