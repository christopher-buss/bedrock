--!strict
local bedrock = require("@bedrock/config")
local t = require("@jest/typecheck")

t.describe("Redaction overrides", function()
	t.it("should mirror game-pass and developer-product replacement fields", function()
		type Expected = {
			[string]: never,
			name: string?,
			description: string?,
			icon: { ["en-us"]: string, [string]: never }?,
			price: number?,
		}
		t.expectType<<bedrock.RedactedGamePassOverride>>():toEqualType<<Expected>>()
		t.expectType<<bedrock.RedactedDeveloperProductOverride>>():toEqualType<<Expected>>()
		local pass: bedrock.RedactedGamePassOverride = { name = "Hidden", description = "Preview", icon = { ["en-us"] = "hidden.png" }, price = 1 }
		local product: bedrock.RedactedDeveloperProductOverride = {}
		t.expectTypeOf(pass):toExtend<<Expected>>()
		t.expectTypeOf(product):toExtend<<Expected>>()

		-- @expect-error
		local wrongPass: bedrock.RedactedGamePassOverride = { price = bedrock.none }
		-- @expect-error
		local wrongProduct: bedrock.RedactedDeveloperProductOverride = { price = "100" }
	end)

	t.it("should mirror badge replacement fields", function()
		type Expected = {
			[string]: never,
			name: string?,
			description: string?,
			icon: { ["en-us"]: string, [string]: never }?,
		}
		t.expectType<<bedrock.RedactedBadgeOverride>>():toEqualType<<Expected>>()

		-- @expect-error
		local wrong: bedrock.RedactedBadgeOverride = { price = 1 }
	end)

	t.it("should mirror optional place replacement fields", function()
		type Expected = { description: string?, displayName: string?, [string]: never }
		t.expectType<<bedrock.RedactedPlaceOverride>>():toEqualType<<Expected>>()
		local override: bedrock.RedactedPlaceOverride = { displayName = "Hidden", description = "Preview" }
		t.expectTypeOf(override):toExtend<<Expected>>()

		-- @expect-error
		local wrong: bedrock.RedactedPlaceOverride = { displayName = false }
	end)

	t.it("should mirror environment replacement fields across kinds", function()
		type Expected = {
			[string]: never,
			name: string?,
			description: string?,
			displayName: string?,
			icon: { ["en-us"]: string, [string]: never }?,
			price: number?,
		}
		t.expectType<<bedrock.RedactedEnvironmentOverride>>():toEqualType<<Expected>>()

		-- @expect-error
		local wrong: bedrock.RedactedEnvironmentOverride = { price = "100" }
	end)
end)
