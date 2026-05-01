import { assert, describe, expect, it } from "vitest";

import type { SocialLinkField } from "../resources.ts";
import { foldUniverse } from "./fold-universe.ts";
import type { MantleResource } from "./types.ts";

function experience(outputs: unknown): MantleResource {
	return {
		key: "singleton",
		dependencies: [],
		inputs: { groupId: undefined },
		kind: "experience",
		outputs,
	};
}

const DEFAULT_EXPERIENCE_OUTPUTS = { assetId: 1, startPlaceId: 2 };

type DeviceFlag = "consoleEnabled" | "desktopEnabled" | "mobileEnabled" | "tabletEnabled";

function experienceConfiguration(inputs: unknown): MantleResource {
	return {
		key: "singleton",
		dependencies: [],
		inputs,
		kind: "experienceConfiguration",
		outputs: undefined,
	};
}

function spatialVoice(inputs: unknown): MantleResource {
	return {
		key: "singleton",
		dependencies: [],
		inputs,
		kind: "spatialVoice",
		outputs: undefined,
	};
}

function experienceActivation(inputs: unknown): MantleResource {
	return {
		key: "singleton",
		dependencies: [],
		inputs,
		kind: "experienceActivation",
		outputs: undefined,
	};
}

function socialLink(domain: string, inputs: unknown): MantleResource {
	return {
		key: domain,
		dependencies: [],
		inputs,
		kind: "socialLink",
		outputs: { assetId: 1234567890 },
	};
}

function place(key: string, inputs: unknown): MantleResource {
	return {
		key,
		dependencies: [],
		inputs,
		kind: "place",
		outputs: { assetId: 17613681043 },
	};
}

function placeConfiguration(key: string, inputs: unknown): MantleResource {
	return {
		key,
		dependencies: [],
		inputs,
		kind: "placeConfiguration",
		outputs: undefined,
	};
}

describe(foldUniverse, () => {
	it("should map experience.outputs.assetId to universe.universeId", () => {
		expect.assertions(1);

		const result = foldUniverse([
			experience({ assetId: 6031475575, startPlaceId: 17613681043 }),
		]);

		assert(result !== undefined);

		expect(result.entry).toStrictEqual({ universeId: "6031475575" });
	});

	it("should map experience.outputs.startPlaceId to outputs.rootPlaceId", () => {
		expect.assertions(1);

		const result = foldUniverse([
			experience({ assetId: 6031475575, startPlaceId: 17613681043 }),
		]);

		assert(result !== undefined);

		expect(result.outputs).toStrictEqual({ rootPlaceId: "17613681043" });
	});

	it("should accept string-formatted ids in experience outputs", () => {
		expect.assertions(2);

		const result = foldUniverse([
			experience({ assetId: "6031475575", startPlaceId: "17613681043" }),
		]);

		assert(result !== undefined);

		expect(result.entry.universeId).toBe("6031475575");
		expect(result.outputs.rootPlaceId).toBe("17613681043");
	});

	it("should emit no warnings when only the experience resource is present", () => {
		expect.assertions(1);

		const result = foldUniverse([
			experience({ assetId: 6031475575, startPlaceId: 17613681043 }),
		]);

		assert(result !== undefined);

		expect(result.warnings).toStrictEqual([]);
	});

	it("should return undefined when no experience resource is present", () => {
		expect.assertions(1);

		const result = foldUniverse([
			{
				key: "singleton",
				dependencies: [],
				inputs: { filePath: "icon.png" },
				kind: "experienceIcon",
				outputs: undefined,
			},
		]);

		expect(result).toBeUndefined();
	});

	it("should return undefined when experience outputs is not an object", () => {
		expect.assertions(1);

		const result = foldUniverse([experience(undefined)]);

		expect(result).toBeUndefined();
	});

	it("should return undefined when experience outputs is null", () => {
		expect.assertions(1);

		// eslint-disable-next-line unicorn/no-null -- exercising the null branch of the defensive guard
		const result = foldUniverse([experience(null)]);

		expect(result).toBeUndefined();
	});

	it("should return undefined when experience outputs is an array", () => {
		expect.assertions(1);

		const result = foldUniverse([experience([])]);

		expect(result).toBeUndefined();
	});

	it("should return undefined when experience outputs lacks assetId or startPlaceId", () => {
		expect.assertions(2);

		expect(foldUniverse([experience({ startPlaceId: 1 })])).toBeUndefined();
		expect(foldUniverse([experience({ assetId: 1 })])).toBeUndefined();
	});

	it("should return undefined when experience outputs has non-integer ids", () => {
		expect.assertions(2);

		expect(foldUniverse([experience({ assetId: 1.5, startPlaceId: 2 })])).toBeUndefined();
		expect(
			foldUniverse([experience({ assetId: { nested: 1 }, startPlaceId: 2 })]),
		).toBeUndefined();
	});

	describe("playableDevices fold", () => {
		it.for<[label: string, device: string, flag: DeviceFlag]>([
			["desktop", "Computer", "desktopEnabled"],
			["console", "Console", "consoleEnabled"],
			["mobile", "Phone", "mobileEnabled"],
			["tablet", "Tablet", "tabletEnabled"],
		])("should fold the %s device into its enabled flag", ([, device, flag]) => {
			expect.assertions(2);

			const result = foldUniverse([
				experience(DEFAULT_EXPERIENCE_OUTPUTS),
				experienceConfiguration({ playableDevices: [device] }),
			]);

			assert(result !== undefined);

			expect(result.entry[flag]).toBeTrue();
			expect(result.entry).toStrictEqual({ [flag]: true, universeId: "1" });
		});

		it("should fold every known device into its enabled flag for the full list", () => {
			expect.assertions(1);

			const result = foldUniverse([
				experience(DEFAULT_EXPERIENCE_OUTPUTS),
				experienceConfiguration({
					playableDevices: ["Computer", "Console", "Phone", "Tablet"],
				}),
			]);

			assert(result !== undefined);

			expect(result.entry).toStrictEqual({
				consoleEnabled: true,
				desktopEnabled: true,
				mobileEnabled: true,
				tabletEnabled: true,
				universeId: "1",
			});
		});

		it("should leave other device flags omitted for a subset list", () => {
			expect.assertions(3);

			const result = foldUniverse([
				experience(DEFAULT_EXPERIENCE_OUTPUTS),
				experienceConfiguration({ playableDevices: ["Computer"] }),
			]);

			assert(result !== undefined);

			expect(result.entry.desktopEnabled).toBeTrue();
			expect(result.entry.consoleEnabled).toBeNil();
			expect(result.entry.mobileEnabled).toBeNil();
		});

		it("should emit one interpretive warning per matched device flag", () => {
			expect.assertions(2);

			const result = foldUniverse([
				experience(DEFAULT_EXPERIENCE_OUTPUTS),
				experienceConfiguration({ playableDevices: ["Computer", "Console"] }),
			]);

			assert(result !== undefined);

			expect(result.warnings).toHaveLength(2);
			expect(result.warnings).toIncludeAllPartialMembers([
				{
					bedrockPath: "universe.desktopEnabled",
					kind: "interpretive",
					mantlePath: "experienceConfiguration_singleton.playableDevices",
					rule: "list-to-flag",
				},
				{
					bedrockPath: "universe.consoleEnabled",
					kind: "interpretive",
					mantlePath: "experienceConfiguration_singleton.playableDevices",
					rule: "list-to-flag",
				},
			]);
		});

		it("should emit a blocked warning for an unknown device string", () => {
			expect.assertions(3);

			const result = foldUniverse([
				experience(DEFAULT_EXPERIENCE_OUTPUTS),
				experienceConfiguration({ playableDevices: ["Toaster"] }),
			]);

			assert(result !== undefined);

			expect(result.entry).toStrictEqual({ universeId: "1" });
			expect(result.warnings).toHaveLength(1);

			const [warning] = result.warnings;
			assert(warning?.kind === "blocked");

			expect(warning).toStrictEqual({
				kind: "blocked",
				mantlePath: "experienceConfiguration_singleton.playableDevices",
				reason: "Unknown playableDevices value: Toaster",
			});
		});

		it("should emit a blocked warning for a non-string entry in playableDevices", () => {
			expect.assertions(2);

			const result = foldUniverse([
				experience(DEFAULT_EXPERIENCE_OUTPUTS),
				experienceConfiguration({ playableDevices: [42] }),
			]);

			assert(result !== undefined);

			expect(result.warnings).toHaveLength(1);

			const [warning] = result.warnings;
			assert(warning?.kind === "blocked");

			expect(warning.reason).toMatch(/Unknown playableDevices value/);
		});

		it("should fold known devices and warn on unknowns in a mixed list", () => {
			expect.assertions(2);

			const result = foldUniverse([
				experience(DEFAULT_EXPERIENCE_OUTPUTS),
				experienceConfiguration({
					playableDevices: ["Computer", "Toaster", "Tablet"],
				}),
			]);

			assert(result !== undefined);

			expect(result.entry).toStrictEqual({
				desktopEnabled: true,
				tabletEnabled: true,
				universeId: "1",
			});
			expect(result.warnings).toHaveLength(3);
		});

		it("should leave the entry untouched when no experienceConfiguration is present", () => {
			expect.assertions(2);

			const result = foldUniverse([experience(DEFAULT_EXPERIENCE_OUTPUTS)]);

			assert(result !== undefined);

			expect(result.entry).toStrictEqual({ universeId: "1" });
			expect(result.warnings).toStrictEqual([]);
		});

		it("should ignore an experienceConfiguration whose inputs is not an object", () => {
			expect.assertions(2);

			const result = foldUniverse([
				experience(DEFAULT_EXPERIENCE_OUTPUTS),
				experienceConfiguration("not-an-object"),
			]);

			assert(result !== undefined);

			expect(result.entry).toStrictEqual({ universeId: "1" });
			expect(result.warnings).toStrictEqual([]);
		});

		it("should ignore an experienceConfiguration whose playableDevices is not an array", () => {
			expect.assertions(2);

			const result = foldUniverse([
				experience(DEFAULT_EXPERIENCE_OUTPUTS),
				experienceConfiguration({ playableDevices: "Computer" }),
			]);

			assert(result !== undefined);

			expect(result.entry).toStrictEqual({ universeId: "1" });
			expect(result.warnings).toStrictEqual([]);
		});

		it("should ignore an experienceConfiguration with no playableDevices field", () => {
			expect.assertions(2);

			const result = foldUniverse([
				experience(DEFAULT_EXPERIENCE_OUTPUTS),
				experienceConfiguration({ allowPrivateServers: undefined }),
			]);

			assert(result !== undefined);

			expect(result.entry).toStrictEqual({ universeId: "1" });
			expect(result.warnings).toStrictEqual([]);
		});

		it("should produce no warnings when playableDevices is an empty array", () => {
			expect.assertions(2);

			const result = foldUniverse([
				experience(DEFAULT_EXPERIENCE_OUTPUTS),
				experienceConfiguration({ playableDevices: [] }),
			]);

			assert(result !== undefined);

			expect(result.entry).toStrictEqual({ universeId: "1" });
			expect(result.warnings).toStrictEqual([]);
		});
	});

	describe("privateServerPrice fold", () => {
		it.for<[label: string, price: number]>([
			["a non-zero price", 25],
			["a zero price", 0],
		])("should fold %s into privateServerPriceRobux", ([, price]) => {
			expect.assertions(1);

			const result = foldUniverse([
				experience(DEFAULT_EXPERIENCE_OUTPUTS),
				experienceConfiguration({
					allowPrivateServers: true,
					privateServerPrice: price,
				}),
			]);

			assert(result !== undefined);

			expect(result.entry).toStrictEqual({
				privateServerPriceRobux: price,
				universeId: "1",
			});
		});

		it("should emit one interpretive warning when private servers are priced", () => {
			expect.assertions(1);

			const result = foldUniverse([
				experience(DEFAULT_EXPERIENCE_OUTPUTS),
				experienceConfiguration({
					allowPrivateServers: true,
					privateServerPrice: 50,
				}),
			]);

			assert(result !== undefined);

			expect(result.warnings).toStrictEqual([
				{
					bedrockPath: "universe.privateServerPriceRobux",
					kind: "interpretive",
					mantlePath: "experienceConfiguration_singleton.privateServerPrice",
					rule: "private-servers-priced",
				},
			]);
		});

		it("should omit privateServerPriceRobux when allowPrivateServers is false", () => {
			expect.assertions(1);

			const result = foldUniverse([
				experience(DEFAULT_EXPERIENCE_OUTPUTS),
				experienceConfiguration({
					allowPrivateServers: false,
					privateServerPrice: 25,
				}),
			]);

			assert(result !== undefined);

			expect(result.entry).toStrictEqual({ universeId: "1" });
		});

		it("should emit one interpretive omission warning when private servers are disabled", () => {
			expect.assertions(1);

			const result = foldUniverse([
				experience(DEFAULT_EXPERIENCE_OUTPUTS),
				experienceConfiguration({ allowPrivateServers: false }),
			]);

			assert(result !== undefined);

			expect(result.warnings).toStrictEqual([
				{
					bedrockPath: "universe.privateServerPriceRobux",
					kind: "interpretive",
					mantlePath: "experienceConfiguration_singleton.allowPrivateServers",
					rule: "private-servers-disabled-omitted",
				},
			]);
		});

		it("should leave the entry untouched when allowPrivateServers is true but the price is missing", () => {
			expect.assertions(2);

			const result = foldUniverse([
				experience(DEFAULT_EXPERIENCE_OUTPUTS),
				experienceConfiguration({ allowPrivateServers: true }),
			]);

			assert(result !== undefined);

			expect(result.entry).toStrictEqual({ universeId: "1" });
			expect(result.warnings).toStrictEqual([]);
		});

		it("should leave the entry untouched when the price is non-numeric", () => {
			expect.assertions(2);

			const result = foldUniverse([
				experience(DEFAULT_EXPERIENCE_OUTPUTS),
				experienceConfiguration({
					allowPrivateServers: true,
					privateServerPrice: "free",
				}),
			]);

			assert(result !== undefined);

			expect(result.entry).toStrictEqual({ universeId: "1" });
			expect(result.warnings).toStrictEqual([]);
		});

		it("should leave the entry untouched when allowPrivateServers is missing", () => {
			expect.assertions(2);

			const result = foldUniverse([
				experience(DEFAULT_EXPERIENCE_OUTPUTS),
				experienceConfiguration({ privateServerPrice: 25 }),
			]);

			assert(result !== undefined);

			expect(result.entry).toStrictEqual({ universeId: "1" });
			expect(result.warnings).toStrictEqual([]);
		});
	});

	describe("voiceChat fold", () => {
		it.for<[label: string, enabled: boolean]>([
			["enabled true", true],
			["enabled false", false],
		])("should fold spatialVoice with %s into voiceChatEnabled", ([, enabled]) => {
			expect.assertions(1);

			const result = foldUniverse([
				experience(DEFAULT_EXPERIENCE_OUTPUTS),
				spatialVoice({ enabled }),
			]);

			assert(result !== undefined);

			expect(result.entry).toStrictEqual({
				universeId: "1",
				voiceChatEnabled: enabled,
			});
		});

		it("should emit one interpretive warning when voice chat is folded", () => {
			expect.assertions(1);

			const result = foldUniverse([
				experience(DEFAULT_EXPERIENCE_OUTPUTS),
				spatialVoice({ enabled: true }),
			]);

			assert(result !== undefined);

			expect(result.warnings).toStrictEqual([
				{
					bedrockPath: "universe.voiceChatEnabled",
					kind: "interpretive",
					mantlePath: "spatialVoice_singleton.enabled",
					rule: "voice-chat-enabled",
				},
			]);
		});

		it("should leave the entry untouched when no spatialVoice resource is present", () => {
			expect.assertions(2);

			const result = foldUniverse([experience(DEFAULT_EXPERIENCE_OUTPUTS)]);

			assert(result !== undefined);

			expect(result.entry).toStrictEqual({ universeId: "1" });
			expect(result.warnings).toStrictEqual([]);
		});

		it("should leave the entry untouched when spatialVoice inputs is not an object", () => {
			expect.assertions(2);

			const result = foldUniverse([
				experience(DEFAULT_EXPERIENCE_OUTPUTS),
				spatialVoice("not-an-object"),
			]);

			assert(result !== undefined);

			expect(result.entry).toStrictEqual({ universeId: "1" });
			expect(result.warnings).toStrictEqual([]);
		});

		it("should leave the entry untouched when spatialVoice.enabled is non-boolean", () => {
			expect.assertions(2);

			const result = foldUniverse([
				experience(DEFAULT_EXPERIENCE_OUTPUTS),
				spatialVoice({ enabled: "yes" }),
			]);

			assert(result !== undefined);

			expect(result.entry).toStrictEqual({ universeId: "1" });
			expect(result.warnings).toStrictEqual([]);
		});
	});

	describe("experienceActivation fold", () => {
		it.for<[label: string, isActive: boolean]>([
			["isActive true", true],
			["isActive false", false],
		])("should emit a blocked warning when %s", ([, isActive]) => {
			expect.assertions(2);

			const result = foldUniverse([
				experience(DEFAULT_EXPERIENCE_OUTPUTS),
				experienceActivation({ isActive }),
			]);

			assert(result !== undefined);

			expect(result.entry).toStrictEqual({ universeId: "1" });
			expect(result.warnings).toStrictEqual([
				{
					kind: "blocked",
					mantlePath: "experienceActivation_singleton.isActive",
					reason: "isActive has no Open Cloud equivalent",
				},
			]);
		});

		it("should never set universe.visibility from isActive", () => {
			expect.assertions(1);

			const result = foldUniverse([
				experience(DEFAULT_EXPERIENCE_OUTPUTS),
				experienceActivation({ isActive: true }),
				experienceConfiguration({ isFriendsOnly: false }),
			]);

			assert(result !== undefined);

			expect(result.entry).not.toContainKey("visibility");
		});

		it("should leave the entry untouched when experienceActivation is absent", () => {
			expect.assertions(2);

			const result = foldUniverse([
				experience(DEFAULT_EXPERIENCE_OUTPUTS),
				experienceConfiguration({ isFriendsOnly: false }),
			]);

			assert(result !== undefined);

			expect(result.entry).toStrictEqual({ universeId: "1" });
			expect(
				result.warnings.filter(
					(warning) => warning.mantlePath === "experienceActivation_singleton.isActive",
				),
			).toStrictEqual([]);
		});

		it("should leave the entry untouched when experienceActivation.isActive is non-boolean", () => {
			expect.assertions(2);

			const result = foldUniverse([
				experience(DEFAULT_EXPERIENCE_OUTPUTS),
				experienceActivation({ isActive: "maybe" }),
			]);

			assert(result !== undefined);

			expect(result.entry).toStrictEqual({ universeId: "1" });
			expect(result.warnings).toStrictEqual([]);
		});

		it("should leave the entry untouched when experienceActivation inputs is not an object", () => {
			expect.assertions(2);

			const result = foldUniverse([
				experience(DEFAULT_EXPERIENCE_OUTPUTS),
				experienceActivation("not-an-object"),
			]);

			assert(result !== undefined);

			expect(result.entry).toStrictEqual({ universeId: "1" });
			expect(result.warnings).toStrictEqual([]);
		});
	});

	describe("socialLink fold", () => {
		it.for<[label: string, domain: string, field: SocialLinkField]>([
			["facebook", "facebook.com", "facebookSocialLink"],
			["twitter", "twitter.com", "twitterSocialLink"],
			["youtube", "youtube.com", "youtubeSocialLink"],
			["twitch", "twitch.tv", "twitchSocialLink"],
			["discord", "discord.gg", "discordSocialLink"],
			["roblox group via roblox.com", "roblox.com", "robloxGroupSocialLink"],
			["roblox group via www.roblox.com", "www.roblox.com", "robloxGroupSocialLink"],
			["guilded", "guilded.gg", "guildedSocialLink"],
		])("should fold the %s domain into the matching universe field", ([, domain, field]) => {
			expect.assertions(1);

			const result = foldUniverse([
				experience(DEFAULT_EXPERIENCE_OUTPUTS),
				socialLink(domain, {
					linkType: "Discord",
					title: "Join us",
					url: `https://${domain}/example`,
				}),
			]);

			assert(result !== undefined);

			expect(result.entry).toStrictEqual({
				[field]: { title: "Join us", uri: `https://${domain}/example` },
				universeId: "1",
			});
		});

		it("should rename mantle 'url' onto bedrock 'uri' on the SocialLink", () => {
			expect.assertions(1);

			const result = foldUniverse([
				experience(DEFAULT_EXPERIENCE_OUTPUTS),
				socialLink("discord.gg", {
					linkType: "Discord",
					title: "Join our Discord",
					url: "https://discord.gg/example",
				}),
			]);

			assert(result !== undefined);

			expect(result.entry.discordSocialLink).toStrictEqual({
				title: "Join our Discord",
				uri: "https://discord.gg/example",
			});
		});

		it("should emit one interpretive warning per matched social link", () => {
			expect.assertions(1);

			const result = foldUniverse([
				experience(DEFAULT_EXPERIENCE_OUTPUTS),
				socialLink("discord.gg", {
					linkType: "Discord",
					title: "Join our Discord",
					url: "https://discord.gg/example",
				}),
			]);

			assert(result !== undefined);

			expect(result.warnings).toStrictEqual([
				{
					bedrockPath: "universe.discordSocialLink",
					kind: "interpretive",
					mantlePath: "socialLink_discord.gg",
					rule: "domain-to-field",
				},
			]);
		});

		it("should drop unknown-domain socialLink resources and emit blocked", () => {
			expect.assertions(2);

			const result = foldUniverse([
				experience(DEFAULT_EXPERIENCE_OUTPUTS),
				socialLink("tiktok.com", {
					linkType: "TikTok",
					title: "Follow us",
					url: "https://tiktok.com/example",
				}),
			]);

			assert(result !== undefined);

			expect(result.entry).toStrictEqual({ universeId: "1" });
			expect(result.warnings).toStrictEqual([
				{
					kind: "blocked",
					mantlePath: "socialLink_tiktok.com",
					reason: "Unknown socialLink domain: tiktok.com",
				},
			]);
		});

		it("should fold multiple known-domain socialLink resources into distinct fields", () => {
			expect.assertions(1);

			const result = foldUniverse([
				experience(DEFAULT_EXPERIENCE_OUTPUTS),
				socialLink("discord.gg", {
					linkType: "Discord",
					title: "Discord",
					url: "https://discord.gg/a",
				}),
				socialLink("twitter.com", {
					linkType: "Twitter",
					title: "Twitter",
					url: "https://twitter.com/a",
				}),
			]);

			assert(result !== undefined);

			expect(result.entry).toStrictEqual({
				discordSocialLink: { title: "Discord", uri: "https://discord.gg/a" },
				twitterSocialLink: { title: "Twitter", uri: "https://twitter.com/a" },
				universeId: "1",
			});
		});

		it("should drop a socialLink resource whose title or url is non-string", () => {
			expect.assertions(2);

			const result = foldUniverse([
				experience(DEFAULT_EXPERIENCE_OUTPUTS),
				socialLink("discord.gg", { linkType: "Discord", title: 1, url: "https://x" }),
				socialLink("twitter.com", { linkType: "Twitter", title: "x", url: 2 }),
			]);

			assert(result !== undefined);

			expect(result.entry).toStrictEqual({ universeId: "1" });
			expect(result.warnings).toStrictEqual([]);
		});

		it("should drop a socialLink resource whose inputs is not an object", () => {
			expect.assertions(2);

			const result = foldUniverse([
				experience(DEFAULT_EXPERIENCE_OUTPUTS),
				socialLink("discord.gg", "not-an-object"),
			]);

			assert(result !== undefined);

			expect(result.entry).toStrictEqual({ universeId: "1" });
			expect(result.warnings).toStrictEqual([]);
		});

		it("should leave the entry untouched when no socialLink resources are present", () => {
			expect.assertions(2);

			const result = foldUniverse([experience(DEFAULT_EXPERIENCE_OUTPUTS)]);

			assert(result !== undefined);

			expect(result.entry).toStrictEqual({ universeId: "1" });
			expect(result.warnings).toStrictEqual([]);
		});

		it("should let the later resource win when two domains map to the same universe field", () => {
			expect.assertions(2);

			const result = foldUniverse([
				experience(DEFAULT_EXPERIENCE_OUTPUTS),
				socialLink("roblox.com", {
					linkType: "RobloxGroup",
					title: "Bare",
					url: "https://roblox.com/group/1",
				}),
				socialLink("www.roblox.com", {
					linkType: "RobloxGroup",
					title: "WWW",
					url: "https://www.roblox.com/group/1",
				}),
			]);

			assert(result !== undefined);

			expect(result.entry.robloxGroupSocialLink).toStrictEqual({
				title: "WWW",
				uri: "https://www.roblox.com/group/1",
			});
			expect(
				result.warnings.filter((warning) => {
					return (
						warning.kind === "interpretive" &&
						warning.bedrockPath === "universe.robloxGroupSocialLink"
					);
				}),
			).toHaveLength(2);
		});
	});

	describe("displayName cross-fold", () => {
		it("should fold the start place's placeConfiguration.name into universe.displayName", () => {
			expect.assertions(1);

			const result = foldUniverse([
				experience(DEFAULT_EXPERIENCE_OUTPUTS),
				place("start", { isStart: true }),
				placeConfiguration("start", { name: "My Place" }),
			]);

			assert(result !== undefined);

			expect(result.entry).toStrictEqual({
				displayName: "My Place",
				universeId: "1",
			});
		});

		it("should emit one interpretive warning for the displayName mapping", () => {
			expect.assertions(1);

			const result = foldUniverse([
				experience(DEFAULT_EXPERIENCE_OUTPUTS),
				place("start", { isStart: true }),
				placeConfiguration("start", { name: "My Place" }),
			]);

			assert(result !== undefined);

			expect(result.warnings).toStrictEqual([
				{
					bedrockPath: "universe.displayName",
					kind: "interpretive",
					mantlePath: "placeConfiguration_start.name",
					rule: "start-place-name-to-display-name",
				},
			]);
		});

		it("should emit blocked for non-start placeConfiguration.name and not include it in displayName", () => {
			expect.assertions(2);

			const result = foldUniverse([
				experience(DEFAULT_EXPERIENCE_OUTPUTS),
				place("start", { isStart: true }),
				place("lobby", { isStart: false }),
				placeConfiguration("start", { name: "My Place" }),
				placeConfiguration("lobby", { name: "Lobby" }),
			]);

			assert(result !== undefined);

			expect(result.entry.displayName).toBe("My Place");
			expect(result.warnings).toIncludeAllPartialMembers([
				{
					kind: "blocked",
					mantlePath: "placeConfiguration_lobby.name",
					reason: "non-start placeConfiguration.name has no Open Cloud equivalent",
				},
			]);
		});

		it("should leave displayName untouched when no places have isStart true", () => {
			expect.assertions(2);

			const result = foldUniverse([
				experience(DEFAULT_EXPERIENCE_OUTPUTS),
				place("start", { isStart: false }),
				placeConfiguration("start", { name: "My Place" }),
			]);

			assert(result !== undefined);

			expect(result.entry.displayName).toBeNil();
			expect(result.warnings).toStrictEqual([
				{
					kind: "blocked",
					mantlePath: "placeConfiguration_start.name",
					reason: "non-start placeConfiguration.name has no Open Cloud equivalent",
				},
			]);
		});

		it("should not treat isStart=true on a non-place resource as a start place", () => {
			expect.assertions(2);

			const result = foldUniverse([
				experience(DEFAULT_EXPERIENCE_OUTPUTS),
				experienceConfiguration({ isStart: true }),
				place("start", { isStart: true }),
				placeConfiguration("start", { name: "My Place" }),
			]);

			assert(result !== undefined);

			expect(result.entry.displayName).toBe("My Place");
			expect(result.warnings).toStrictEqual([
				{
					bedrockPath: "universe.displayName",
					kind: "interpretive",
					mantlePath: "placeConfiguration_start.name",
					rule: "start-place-name-to-display-name",
				},
			]);
		});

		it("should leave displayName untouched when no placeConfiguration matches the start key", () => {
			expect.assertions(2);

			const result = foldUniverse([
				experience(DEFAULT_EXPERIENCE_OUTPUTS),
				place("start", { isStart: true }),
			]);

			assert(result !== undefined);

			expect(result.entry).toStrictEqual({ universeId: "1" });
			expect(result.warnings).toStrictEqual([]);
		});

		it("should omit displayName and emit ambiguous when multiple places have isStart true", () => {
			expect.assertions(3);

			const result = foldUniverse([
				experience(DEFAULT_EXPERIENCE_OUTPUTS),
				place("start", { isStart: true }),
				place("alt-start", { isStart: true }),
				placeConfiguration("start", { name: "Primary" }),
				placeConfiguration("alt-start", { name: "Alternate" }),
			]);

			assert(result !== undefined);

			expect(result.entry.displayName).toBeNil();
			expect(result.warnings).toIncludeAllPartialMembers([
				{
					kind: "ambiguous",
					mantlePath: "place_*.isStart",
				},
			]);
			expect(result.warnings.filter((warning) => warning.kind === "blocked")).toHaveLength(2);
		});

		it("should silently skip a placeConfiguration whose name is non-string", () => {
			expect.assertions(2);

			const result = foldUniverse([
				experience(DEFAULT_EXPERIENCE_OUTPUTS),
				place("start", { isStart: true }),
				placeConfiguration("start", { name: 42 }),
			]);

			assert(result !== undefined);

			expect(result.entry).toStrictEqual({ universeId: "1" });
			expect(result.warnings).toStrictEqual([]);
		});

		it("should silently skip a placeConfiguration whose inputs is not an object", () => {
			expect.assertions(2);

			const result = foldUniverse([
				experience(DEFAULT_EXPERIENCE_OUTPUTS),
				place("start", { isStart: true }),
				placeConfiguration("start", "not-an-object"),
			]);

			assert(result !== undefined);

			expect(result.entry).toStrictEqual({ universeId: "1" });
			expect(result.warnings).toStrictEqual([]);
		});

		it("should silently skip a place resource whose inputs is not an object", () => {
			expect.assertions(2);

			const result = foldUniverse([
				experience(DEFAULT_EXPERIENCE_OUTPUTS),
				place("start", "not-an-object"),
				placeConfiguration("start", { name: "My Place" }),
			]);

			assert(result !== undefined);

			expect(result.entry).toStrictEqual({ universeId: "1" });
			expect(result.warnings).toIncludeAllPartialMembers([
				{
					kind: "blocked",
					mantlePath: "placeConfiguration_start.name",
				},
			]);
		});
	});

	describe("blocked experienceConfiguration fields fold", () => {
		it.for<[label: string, field: string, value: unknown, reason: string]>([
			["genre", "genre", "All", "Roblox does not expose `genre` via Open Cloud"],
			["isForSale", "isForSale", false, "paid-access flag has no Open Cloud equivalent"],
			["price", "price", 25, "paid-access flag has no Open Cloud equivalent"],
			[
				"studioAccessToApisAllowed",
				"studioAccessToApisAllowed",
				true,
				"Open Cloud does not currently expose a write endpoint for studio API access",
			],
			[
				"permissions",
				"permissions",
				{ IsThirdPartyTeleportAllowed: false },
				"experienceConfiguration.permissions has no Open Cloud equivalent",
			],
			["isArchived", "isArchived", false, "isArchived has no Open Cloud equivalent"],
			["isFriendsOnly", "isFriendsOnly", true, "isFriendsOnly has no Open Cloud equivalent"],
		])("should emit a blocked warning when %s is set", ([, field, value, reason]) => {
			expect.assertions(1);

			const result = foldUniverse([
				experience(DEFAULT_EXPERIENCE_OUTPUTS),
				experienceConfiguration({ [field]: value }),
			]);

			assert(result !== undefined);

			expect(result.warnings).toStrictEqual([
				{
					kind: "blocked",
					mantlePath: `experienceConfiguration_singleton.${field}`,
					reason,
				},
			]);
		});

		it("should emit no warning for a tracked field whose value is undefined", () => {
			expect.assertions(2);

			const result = foldUniverse([
				experience(DEFAULT_EXPERIENCE_OUTPUTS),
				experienceConfiguration({ genre: undefined, isArchived: undefined }),
			]);

			assert(result !== undefined);

			expect(result.entry).toStrictEqual({ universeId: "1" });
			expect(result.warnings).toStrictEqual([]);
		});

		it("should emit one warning per tracked field when several are populated together", () => {
			expect.assertions(1);

			const result = foldUniverse([
				experience(DEFAULT_EXPERIENCE_OUTPUTS),
				experienceConfiguration({
					genre: "All",
					isArchived: false,
					isForSale: false,
				}),
			]);

			assert(result !== undefined);

			expect(result.warnings).toIncludeAllPartialMembers([
				{ kind: "blocked", mantlePath: "experienceConfiguration_singleton.genre" },
				{ kind: "blocked", mantlePath: "experienceConfiguration_singleton.isForSale" },
				{ kind: "blocked", mantlePath: "experienceConfiguration_singleton.isArchived" },
			]);
		});

		it("should emit no warning when no experienceConfiguration is present", () => {
			expect.assertions(2);

			const result = foldUniverse([experience(DEFAULT_EXPERIENCE_OUTPUTS)]);

			assert(result !== undefined);

			expect(result.entry).toStrictEqual({ universeId: "1" });
			expect(result.warnings).toStrictEqual([]);
		});

		it("should emit no warning when experienceConfiguration inputs is not an object", () => {
			expect.assertions(2);

			const result = foldUniverse([
				experience(DEFAULT_EXPERIENCE_OUTPUTS),
				experienceConfiguration("not-an-object"),
			]);

			assert(result !== undefined);

			expect(result.entry).toStrictEqual({ universeId: "1" });
			expect(result.warnings).toStrictEqual([]);
		});

		it.for<[label: string, key: string]>([
			["universeAvatarType", "universeAvatarType"],
			["universeAvatarMinScales", "universeAvatarMinScales"],
			["universeAvatarMaxScales", "universeAvatarMaxScales"],
			["universeAvatarAssetOverrides", "universeAvatarAssetOverrides"],
			["a forward-looking universeAvatarFoo", "universeAvatarFoo"],
		])("should emit a blocked warning for the %s glob match", ([, key]) => {
			expect.assertions(1);

			const result = foldUniverse([
				experience(DEFAULT_EXPERIENCE_OUTPUTS),
				experienceConfiguration({ [key]: "PlayerChoice" }),
			]);

			assert(result !== undefined);

			expect(result.warnings).toStrictEqual([
				{
					kind: "blocked",
					mantlePath: `experienceConfiguration_singleton.${key}`,
					reason: "avatar configuration has no Open Cloud equivalent",
				},
			]);
		});

		it("should not glob-match keys that lack the universeAvatar prefix", () => {
			expect.assertions(2);

			const result = foldUniverse([
				experience(DEFAULT_EXPERIENCE_OUTPUTS),
				experienceConfiguration({ universeAnimationType: "PlayerChoice" }),
			]);

			assert(result !== undefined);

			expect(result.entry).toStrictEqual({ universeId: "1" });
			expect(result.warnings).toStrictEqual([]);
		});

		it("should skip a universeAvatar key whose value is undefined", () => {
			expect.assertions(1);

			const result = foldUniverse([
				experience(DEFAULT_EXPERIENCE_OUTPUTS),
				experienceConfiguration({ universeAvatarType: undefined }),
			]);

			assert(result !== undefined);

			expect(result.warnings).toStrictEqual([]);
		});

		it("should emit a blocked warning when experience.inputs.groupId is set", () => {
			expect.assertions(1);

			const result = foldUniverse([
				{
					key: "singleton",
					dependencies: [],
					inputs: { groupId: 12345 },
					kind: "experience",
					outputs: DEFAULT_EXPERIENCE_OUTPUTS,
				},
			]);

			assert(result !== undefined);

			expect(result.warnings).toStrictEqual([
				{
					kind: "blocked",
					mantlePath: "experience_singleton.groupId",
					reason: "Open Cloud does not support transferring experience ownership",
				},
			]);
		});

		it("should not emit a groupId blocked warning when groupId is undefined", () => {
			expect.assertions(1);

			const result = foldUniverse([experience(DEFAULT_EXPERIENCE_OUTPUTS)]);

			assert(result !== undefined);

			expect(result.warnings).toStrictEqual([]);
		});

		it("should read groupId from the experience resource even when other resources precede it", () => {
			expect.assertions(2);

			const result = foldUniverse([
				experienceConfiguration({ allowPrivateServers: undefined }),
				{
					key: "singleton",
					dependencies: [],
					inputs: { groupId: 12345 },
					kind: "experience",
					outputs: DEFAULT_EXPERIENCE_OUTPUTS,
				},
			]);

			assert(result !== undefined);

			const groupIdBlocked = result.warnings.filter((warning) => {
				return (
					warning.kind === "blocked" &&
					warning.mantlePath === "experience_singleton.groupId"
				);
			});

			expect(groupIdBlocked).toHaveLength(1);

			assert(groupIdBlocked[0]?.kind === "blocked");

			expect(groupIdBlocked[0].reason).toBe(
				"Open Cloud does not support transferring experience ownership",
			);
		});
	});
});
