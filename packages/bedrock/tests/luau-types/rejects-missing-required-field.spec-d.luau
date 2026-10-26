--!strict
local bedrock = require("@bedrock/config")
local t = require("@jest/typecheck")

t.describe("Required resource fields", function()
	t.it("should reject a game-pass entry without a name before insertion in a collection", function()
		-- @expect-error
		local entry: bedrock.GamePassEntry = { description = "Perks", icon = { ["en-us"] = "vip.png" } }
	end)

	t.it("should reject a developer-product entry without a name before insertion in a collection", function()
		-- @expect-error
		local entry: bedrock.DeveloperProductEntry = { description = "Pack" }
	end)

	t.it("should reject a config without environments", function()
		-- @expect-error
		local config = bedrock.defineConfig({})
	end)

	t.it("should reject wrong-typed place settings at the entry boundary", function()
		-- @expect-error
		local root: bedrock.PlaceEntry = { serverSize = "20" }
		-- @expect-error
		local overlay: bedrock.PlaceOverlay = { placeId = 123 }
	end)

	t.it("should reject an environment place overlay without its identity", function()
		-- @expect-error
		local config = bedrock.defineConfig({ environments = { production = { places = { lobby = { serverSize = 20 } } } } })
	end)

	t.it("should reject wrong-typed universe and environment entries", function()
		-- @expect-error
		local universe: bedrock.UniverseEntry = { universeId = 123 }
		-- @expect-error
		local environment = bedrock.defineConfig({ environments = { production = { label = 123 } } })
	end)
end)
