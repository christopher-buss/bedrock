--!strict
local bedrock = require("@bedrock/config")
local t = require("@jest/typecheck")

t.describe("Environment overlays", function()
	t.it("should make game-pass and product fields optional", function()
		type Pass = {
			name: string?,
			description: string?,
			icon: { ["en-us"]: string }?,
			price: (number | "$none")?,
			redacted: (boolean | bedrock.RedactedGamePassOverride)?,
		}
		type Product = {
			name: string?,
			description: string?,
			icon: { ["en-us"]: string }?,
			price: (number | "$none")?,
			redacted: (boolean | bedrock.RedactedDeveloperProductOverride)?,
		}
		t.expectType<<bedrock.GamePassOverlay>>():toEqualType<<Pass>>()
		t.expectType<<bedrock.DeveloperProductOverlay>>():toEqualType<<Product>>()
		type PriceOverlay = { price: (number | "$none")? }
		t.expectType<<bedrock.GamePassOverlay>>():toExtend<<PriceOverlay>>()
		t.expectType<<bedrock.DeveloperProductOverlay>>():toExtend<<PriceOverlay>>()
		t.expectType<<bedrock.GamePassOverlay>>().never:toEqualType<<bedrock.GamePassEntry>>()
		t.expectType<<bedrock.DeveloperProductOverlay>>().never:toEqualType<<bedrock.DeveloperProductEntry>>()
	end)

	t.it("should retain the place identity while making metadata optional", function()
		type Expected = {
			placeId: string,
			description: string?,
			displayName: string?,
			filePath: string?,
			redacted: (boolean | bedrock.RedactedPlaceOverride)?,
			serverSize: number?,
		}
		t.expectType<<bedrock.PlaceOverlay>>():toEqualType<<Expected>>()
		t.expectType<<bedrock.PlaceOverlay>>():toExtend<<bedrock.PlaceEntry>>()
		t.expectType<<bedrock.PlaceOverlay>>().never:toEqualType<<bedrock.PlaceEntry>>()

		-- @expect-error
		local missingIdentity: bedrock.PlaceOverlay = { displayName = "Lobby" }
	end)

	t.it("should mirror all environment settings and reuse the optional universe shape", function()
		type Expected = {
			label: string?,
			passes: { [string]: bedrock.GamePassOverlay }?,
			places: { [string]: bedrock.PlaceOverlay }?,
			products: { [string]: bedrock.DeveloperProductOverlay }?,
			redacted: (boolean | bedrock.RedactedEnvironmentOverride)?,
			state: bedrock.StateConfig?,
			universe: bedrock.UniverseEntry?,
		}
		t.expectType<<bedrock.EnvironmentEntry>>():toEqualType<<Expected>>()

		local partial: bedrock.EnvironmentEntry = {
			passes = { vip = { price = "$none" } },
			products = { gems = {} },
			places = { lobby = { placeId = "123" } },
			universe = {},
		}
		t.expectTypeOf(partial):toExtend<<bedrock.EnvironmentEntry>>()

		-- @expect-error
		local wrongLabel: bedrock.EnvironmentEntry = { label = false }
		-- @expect-error
		local wrongUniverse: bedrock.EnvironmentEntry = { universe = { voiceChatEnabled = "yes" } }
	end)
end)
