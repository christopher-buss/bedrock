--!strict
local bedrock = require("@bedrock/config")
local t = require("@jest/typecheck")

t.describe("Resource entry shapes", function()
	t.it("should mirror the universe schema without enforcing universe-id placement", function()
		type SocialLink = { title: string, uri: string }
		type Expected = {
			consoleEnabled: boolean?,
			desktopEnabled: boolean?,
			discordSocialLink: (SocialLink | "$none")?,
			displayName: string?,
			facebookSocialLink: (SocialLink | "$none")?,
			guildedSocialLink: (SocialLink | "$none")?,
			mobileEnabled: boolean?,
			privateServerPriceRobux: (number | "$none")?,
			robloxGroupSocialLink: (SocialLink | "$none")?,
			tabletEnabled: boolean?,
			twitchSocialLink: (SocialLink | "$none")?,
			twitterSocialLink: (SocialLink | "$none")?,
			universeId: string?,
			voiceChatEnabled: boolean?,
			vrEnabled: boolean?,
			youtubeSocialLink: (SocialLink | "$none")?,
		}
		t.expectType<<bedrock.UniverseEntry>>():toEqualType<<Expected>>()
	end)

	t.it("should mirror the game-pass schema", function()
		type Expected = {
			name: string,
			description: string,
			icon: { ["en-us"]: string },
			price: (number | "$none")?,
			redacted: (boolean | bedrock.RedactedGamePassOverride)?,
		}
		t.expectType<<bedrock.GamePassEntry>>():toEqualType<<Expected>>()
	end)

	t.it("should mirror the place schema", function()
		type Expected = {
			description: string?,
			displayName: string?,
			filePath: string?,
			redacted: (boolean | bedrock.RedactedPlaceOverride)?,
			serverSize: number?,
		}
		t.expectType<<bedrock.PlaceEntry>>():toEqualType<<Expected>>()
	end)

	t.it("should mirror the developer-product schema", function()
		type Expected = {
			name: string,
			description: string,
			icon: { ["en-us"]: string }?,
			price: (number | "$none")?,
			redacted: (boolean | bedrock.RedactedDeveloperProductOverride)?,
		}
		t.expectType<<bedrock.DeveloperProductEntry>>():toEqualType<<Expected>>()
	end)
end)
