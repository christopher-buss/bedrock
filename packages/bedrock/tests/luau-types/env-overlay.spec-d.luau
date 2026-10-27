--!strict
local bedrock = require("@bedrock/config")
local t = require("@jest/typecheck")

t.describe("Environment overlays", function()
	t.it("should make game-pass and product fields optional", function()
		type Pass = {
			[string]: never,
			isManagedPricingEnabled: boolean?,
			name: string?,
			description: string?,
			icon: { ["en-us"]: string, [string]: never }?,
			price: (number | "$none")?,
			redacted: (boolean | bedrock.RedactedGamePassOverride)?,
		}
		type Product = {
			[string]: never,
			isManagedPricingEnabled: boolean?,
			name: string?,
			description: string?,
			icon: { ["en-us"]: string, [string]: never }?,
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

	t.it("should make every badge field optional", function()
		type Expected = {
			[string]: never,
			name: string?,
			description: string?,
			enabled: boolean?,
			icon: { ["en-us"]: string, [string]: never }?,
		}
		t.expectType<<bedrock.BadgeOverlay>>():toEqualType<<Expected>>()
		t.expectType<<bedrock.BadgeOverlay>>().never:toEqualType<<bedrock.BadgeEntry>>()
	end)

	t.it("should retain the place identity while making metadata optional", function()
		type Expected = {
			[string]: never,
			placeId: string,
			description: string?,
			displayName: string?,
			filePath: string?,
			redacted: (boolean | bedrock.RedactedPlaceOverride)?,
			serverSize: number?,
		}
		t.expectType<<bedrock.PlaceOverlay>>():toEqualType<<Expected>>()
		type Metadata = { description: string?, displayName: string?, filePath: string?, redacted: (boolean | bedrock.RedactedPlaceOverride)?, serverSize: number? }
		t.expectType<<bedrock.PlaceOverlay>>():toExtend<<Metadata>>()
		t.expectType<<bedrock.PlaceOverlay>>().never:toEqualType<<bedrock.PlaceEntry>>()

		-- @expect-error
		local missingIdentity: bedrock.PlaceOverlay = { displayName = "Lobby" }
	end)

	t.it("should mirror all environment settings and reuse the optional universe shape", function()
		type Expected = {
			label: string?,
			passes: { [string]: bedrock.GamePassOverlay | bedrock.RetiredEntry }?,
			places: { [string]: bedrock.PlaceOverlay | bedrock.RetiredEntry }?,
			products: { [string]: bedrock.DeveloperProductOverlay | bedrock.RetiredEntry }?,
			redacted: (boolean | bedrock.RedactedEnvironmentOverride)?,
			state: bedrock.StateConfig?,
			universe: bedrock.UniverseEntry?,
		}
		t.expectType<<bedrock.EnvironmentEntry<Expected>>>():toExtend<<Expected>>()
		local function validate(value: Expected): bedrock.EnvironmentEntry<Expected>
			return bedrock.defineEnvironment(value)
		end
		t.expectTypeOf(validate):toExtend<<(Expected) -> Expected>>()

		local value = {
			passes = { vip = { price = bedrock.none } },
			products = { gems = {} },
			places = { lobby = { placeId = "123" } },
			universe = {},
		}
		local partial: bedrock.EnvironmentEntry<typeof(value)> = bedrock.defineEnvironment(value)
		t.expectTypeOf(partial.passes.vip.price):toEqualType<<bedrock.None>>()

		-- @expect-error
		type WrongLabel = bedrock.EnvironmentEntry<{ label: boolean }>
		-- @expect-error
		type WrongUniverse = bedrock.EnvironmentEntry<{ universe: { voiceChatEnabled: string } }>
	end)
end)
