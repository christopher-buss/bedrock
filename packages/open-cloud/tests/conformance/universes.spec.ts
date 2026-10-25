import { assert, describe, it } from "vitest";

import { parseUniverseResponse } from "#src/domains/cloud-v2/universes/parsers";
import { expectValid, getValidator, loadFixture } from "./_helpers.ts";

describe("universes fixtures", () => {
	it.for([
		{ fixture: "get-response.json", schema: "Universe" },
		{ fixture: "update-response.json", schema: "Universe" },
	])("should validate $fixture against $schema", ({ fixture, schema }, { expect }) => {
		expect.assertions(1);

		const validator = getValidator(schema);
		const body = loadFixture("universes", fixture);

		expectValid(expect, { fixture: body, validator });
	});

	describe(parseUniverseResponse, () => {
		it("should round-trip update-response.json and produce a group-kind owner", ({
			expect,
		}) => {
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
