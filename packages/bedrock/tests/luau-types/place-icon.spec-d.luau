--!strict
local bedrock = require("@bedrock/config")
local t = require("@jest/typecheck")

t.describe("Place icon", function()
	t.it("should accept an en-us icon map on a place", function()
		local place: bedrock.PlaceEntry = { icon = { ["en-us"] = "assets/lobby.png" } }
	end)

	t.it("should accept none on a place icon in an environment overlay", function()
		local overlay: bedrock.PlaceOverlay = { placeId = "4712", icon = bedrock.none }
	end)

	t.it("should accept a place icon through defineConfig", function()
		local config = bedrock.defineConfig({
			environments = { production = { places = { lobby = { placeId = "4712" } } } },
			places = { lobby = { icon = { ["en-us"] = "assets/lobby.png" } } },
			universe = { universeId = "123" },
		})
	end)

	t.it("should reject a place icon that is a bare path", function()
		-- @expect-error
		local place: bedrock.PlaceEntry = { icon = "assets/lobby.png" }
	end)
end)
