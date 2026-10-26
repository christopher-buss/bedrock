--!strict
local bedrock = require("@bedrock/config")
local t = require("@jest/typecheck")

t.describe("Full config", function()
	t.it("should check a complete root config without losing its declared type", function()
		type Value = {
			codegen: { enabled: boolean, output: string, typeDeclarations: boolean },
			displayNamePrefix: { enabled: boolean, format: string },
			environments: { production: {} },
			extends: string,
			passes: { [string]: bedrock.GamePassEntry },
			places: { [string]: bedrock.PlaceEntry },
			plugins: { string },
			products: { [string]: bedrock.DeveloperProductEntry },
			state: bedrock.StateConfig,
			universe: { universeId: string },
		}
		t.expectType<<bedrock.Config<Value>>>():toExtend<<Value>>()
		type Checked = bedrock.Config<Value>
	end)

	t.it("should accept every resource kind and environment overlay", function()
		local config = bedrock.defineConfig({
			codegen = { enabled = true, output = "generated", typeDeclarations = true },
			displayNamePrefix = { enabled = true, format = "[{LABEL}] " },
			extends = "shared.config.luau",
			plugins = { "@bedrock-rbx/state-s3" },
			state = { backend = bedrock.gistBackend, gistId = "abc", locking = false },
			passes = {
				vip = {
					name = "VIP", description = "Perks", icon = { ["en-us"] = "vip.png" },
					price = 100, redacted = { name = "Hidden", price = 999 },
				},
			},
			products = {
				gems = {
					name = "Gems", description = "A gem pack", icon = { ["en-us"] = "gems.png" },
					price = bedrock.none, redacted = true,
				},
			},
			places = {
				lobby = {
					description = "Welcome", displayName = "Lobby", filePath = "lobby.rbxl",
					serverSize = 20, redacted = { displayName = "Hidden" },
				},
				metadataOnly = { description = "Config-only place" },
			},
			universe = {
				universeId = "123", displayName = "My game", privateServerPriceRobux = 50,
				consoleEnabled = true, desktopEnabled = true, mobileEnabled = true,
				tabletEnabled = true, voiceChatEnabled = false, vrEnabled = false,
				discordSocialLink = { title = "Chat", uri = "https://discord.gg/example" },
				facebookSocialLink = bedrock.none, guildedSocialLink = bedrock.none,
				robloxGroupSocialLink = bedrock.none, twitchSocialLink = bedrock.none,
				twitterSocialLink = bedrock.none, youtubeSocialLink = bedrock.none,
			},
			environments = {
				staging = {
					label = "Staging", redacted = { name = "Preview", displayName = "Preview", price = 1 },
					passes = { vip = { price = bedrock.none, redacted = false } },
					products = { gems = { price = 1, redacted = { description = "Preview" } } },
					places = { lobby = { placeId = "456", serverSize = 10, redacted = true } },
					universe = { privateServerPriceRobux = bedrock.none, discordSocialLink = bedrock.none },
					state = { backend = "s3", bucket = "staging", locking = true },
				},
				production = { places = { lobby = { placeId = "789" } } },
			},
		})
		t.expectTypeOf(config.passes.vip.name):toEqualType<<string>>()
		t.expectTypeOf(config.products.gems.price):toEqualType<<"$none">>()
		t.expectTypeOf(config.places.lobby.serverSize):toEqualType<<number>>()
		t.expectTypeOf(config.environments.staging.places.lobby.placeId):toEqualType<<string>>()
	end)

	t.it("should preserve optional plugin state settings", function()
		type Gist = { read backend: "gist", read gistId: string, read locking: boolean?, [string]: never }
		type Plugin = { read backend: string | "gist", read locking: boolean?, [string]: unknown }
		type Expected = Gist | Plugin
		t.expectType<<bedrock.StateConfig>>():toEqualType<<Expected>>()
		local state: bedrock.StateConfig = { backend = "custom", endpoint = "https://state.example" }
		t.expectTypeOf(state):toExtend<<bedrock.StateConfig>>()
	end)
end)
