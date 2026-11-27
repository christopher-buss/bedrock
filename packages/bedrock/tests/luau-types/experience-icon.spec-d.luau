--!strict
local bedrock = require("@bedrock/config")
local t = require("@jest/typecheck")

t.describe("Experience icon", function()
	t.it("should accept an en-us icon map on the universe", function()
		local universe: bedrock.UniverseEntry = { universeId = "123", icon = { ["en-us"] = "assets/icon.png" } }
	end)

	t.it("should accept none on the universe icon through defineConfig", function()
		local config = bedrock.defineConfig({ environments = { production = {} }, universe = { universeId = "123", icon = bedrock.none } })
		t.expectTypeOf(config.universe.icon):toEqualType<<"$none">>()
	end)

	t.it("should reject a universe icon that is a bare path", function()
		-- @expect-error
		local universe: bedrock.UniverseEntry = { universeId = "123", icon = "assets/icon.png" }
	end)
end)
