--!strict
local bedrock = require("@bedrock/config")
local t = require("@jest/typecheck")

t.describe("Full config", function()
	t.it("should mirror the root schema with optional collections", function()
		type Expected = {
			codegen: { enabled: boolean?, output: string?, typeDeclarations: boolean? }?,
			displayNamePrefix: { enabled: boolean?, format: string? }?,
			environments: { [string]: bedrock.EnvironmentEntry },
			extends: unknown,
			passes: { [string]: bedrock.GamePassEntry }?,
			places: { [string]: bedrock.PlaceEntry }?,
			plugins: { string }?,
			products: { [string]: bedrock.DeveloperProductEntry }?,
			state: bedrock.StateConfig?,
			universe: bedrock.UniverseEntry?,
		}
		t.expectType<<bedrock.Config>>():toEqualType<<Expected>>()
	end)

	t.it("should accept every resource kind and environment overlay", function()
		local config = bedrock.defineConfig({
			codegen = { enabled = true, output = "generated", typeDeclarations = true },
			displayNamePrefix = { enabled = true, format = "[{LABEL}] " },
			extends = "shared.config.luau",
			plugins = { "@bedrock-rbx/state-s3" },
			state = { backend = "gist", gistId = "abc", locking = false },
			passes = {
				vip = {
					name = "VIP", description = "Perks", icon = { ["en-us"] = "vip.png" },
					price = 100, redacted = { name = "Hidden", price = 999 },
				},
			},
			products = {
				gems = {
					name = "Gems", description = "A gem pack", icon = { ["en-us"] = "gems.png" },
					price = "$none", redacted = true,
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
				facebookSocialLink = "$none", guildedSocialLink = "$none",
				robloxGroupSocialLink = "$none", twitchSocialLink = "$none",
				twitterSocialLink = "$none", youtubeSocialLink = "$none",
			},
			environments = {
				staging = {
					label = "Staging", redacted = { name = "Preview", displayName = "Preview", price = 1 },
					passes = { vip = { price = "$none", redacted = false } },
					products = { gems = { price = 1, redacted = { description = "Preview" } } },
					places = { lobby = { placeId = "456", serverSize = 10, redacted = true } },
					universe = { privateServerPriceRobux = "$none", discordSocialLink = "$none" },
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
		type Expected = { backend: string, locking: boolean?, [string]: unknown }
		t.expectType<<bedrock.StateConfig>>():toEqualType<<Expected>>()
		local state: bedrock.StateConfig = { backend = "custom", endpoint = "https://state.example" }
		t.expectTypeOf(state):toExtend<<bedrock.StateConfig>>()
	end)
end)
