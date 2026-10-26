--!strict
local bedrock = require("@bedrock/config")
local t = require("@jest/typecheck")

t.describe("Wrong-typed prices", function()
	-- Annotate entries before putting them in optional collections: inline
	-- collection literals bypass entry checking (see known-limitations).
	t.it("should reject a string game-pass price before insertion at the root", function()
		-- @expect-error
		local entry: bedrock.GamePassEntry = {
			name = "VIP", description = "Perks", icon = { ["en-us"] = "vip.png" }, price = "100",
		}
	end)

	t.it("should reject a string developer-product price before insertion at the root", function()
		-- @expect-error
		local entry: bedrock.DeveloperProductEntry = { name = "Gems", description = "Pack", price = "100" }
	end)

	t.it("should reject string prices inside an environment overlay collection", function()
		-- @expect-error
		local pass = bedrock.defineConfig({ environments = { production = { passes = { vip = { price = "100" } } } } })
		-- @expect-error
		local product = bedrock.defineConfig({ environments = { production = { products = { gems = { price = "100" } } } } })
	end)

	t.it("should reject string universe prices at the root and inside an environment", function()
		-- @expect-error
		local root = bedrock.defineConfig({ environments = { production = {} }, universe = { privateServerPriceRobux = "100" } })
		-- @expect-error
		local overlay = bedrock.defineConfig({ environments = { production = { universe = { privateServerPriceRobux = "100" } } } })
	end)
end)
