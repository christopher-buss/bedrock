import { assert, describe, it } from "vitest";

import { loadFixture } from "#tests/conformance/_helpers";
import { parseUniverseResponse } from "./parsers.ts";

// Reuses the existing shared universe GET fixture unchanged. Its original
// capture date and sanitization provenance were not recorded in the repository;
// this test makes no claim of a new live capture.

describe(parseUniverseResponse, () => {
	it("should parse the existing GET fixture into the public Universe shape", ({ expect }) => {
		expect.assertions(1);

		const body = loadFixture("universes", "get-response.json");

		const result = parseUniverseResponse({ body, headers: {}, status: 200 });

		assert(result.success);

		expect(result.data).toStrictEqual({
			id: "12345",
			ageRating: "13Plus",
			consoleEnabled: false,
			createdAt: new Date("2023-06-10T09:15:42.000Z"),
			description: "Explore the realm with your friends.",
			desktopEnabled: true,
			discordSocialLink: { title: "Discord", uri: "https://discord.gg/example" },
			displayName: "Legendary Adventure",
			facebookSocialLink: { title: "Facebook", uri: "https://facebook.com/example" },
			guildedSocialLink: undefined,
			mobileEnabled: true,
			owner: { id: "7777", kind: "user" },
			privateServerPriceRobux: 25,
			robloxGroupSocialLink: undefined,
			rootPlaceId: "98765",
			tabletEnabled: true,
			twitchSocialLink: undefined,
			twitterSocialLink: undefined,
			updatedAt: new Date("2024-11-02T17:08:21.500Z"),
			visibility: "public",
			voiceChatEnabled: true,
			vrEnabled: false,
			youtubeSocialLink: undefined,
		});
	});
});
