import { parseUniverseResponse } from "#src/resources/universes/parsers";
import { assert, describe, expect, it } from "vitest";

import { expectValid, getValidator, loadFixture } from "./_helpers.ts";

describe("universes fixtures", () => {
	it.for([
		{ fixture: "get-response.json", schema: "Universe" },
		{ fixture: "update-response.json", schema: "Universe" },
	])("should validate $fixture against $schema", ({ fixture, schema }) => {
		expect.assertions(1);

		const validator = getValidator(schema);
		const body = loadFixture("universes", fixture);

		expectValid(validator, body);
	});

	describe(parseUniverseResponse, () => {
		it("should round-trip get-response.json into the public Universe shape", () => {
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

		it("should round-trip update-response.json and produce a group-kind owner", () => {
			expect.assertions(1);

			const body = loadFixture("universes", "update-response.json");

			const result = parseUniverseResponse({ body, headers: {}, status: 200 });

			assert(result.success);

			expect(result.data).toStrictEqual({
				id: "54321",
				ageRating: "all",
				consoleEnabled: true,
				createdAt: new Date("2024-01-15T10:30:00.000Z"),
				description: "Competitive matchmaking operated by the community group.",
				desktopEnabled: true,
				discordSocialLink: undefined,
				displayName: "Group Arena",
				facebookSocialLink: undefined,
				guildedSocialLink: undefined,
				mobileEnabled: false,
				owner: { id: "42", kind: "group" },
				privateServerPriceRobux: undefined,
				robloxGroupSocialLink: undefined,
				rootPlaceId: "11111",
				tabletEnabled: false,
				twitchSocialLink: undefined,
				twitterSocialLink: undefined,
				updatedAt: new Date("2024-12-20T12:00:00.000Z"),
				visibility: "private",
				voiceChatEnabled: false,
				vrEnabled: false,
				youtubeSocialLink: undefined,
			});
		});
	});
});
