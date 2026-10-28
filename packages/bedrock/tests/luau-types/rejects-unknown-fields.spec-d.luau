--!strict
local bedrock = require("@bedrock/config")
local t = require("@jest/typecheck")

t.describe("Config field checking", function()
	t.it("should reject an unknown resource kind at the root", function()
		-- @expect-error
		local config = bedrock.defineConfig({ environments = { production = {} }, gadgets = {} })
	end)

	t.it("should reject misspelled optional fields at root and environment scope", function()
		-- @expect-error
		local root = bedrock.defineConfig({ environments = { production = {} }, pases = {} })
		-- @expect-error
		local environment = bedrock.defineConfig({ environments = { production = { pases = {} } } })
	end)

	t.it("should reject wrong-typed entries inside optional root collections", function()
		-- @expect-error
		local pass = bedrock.defineConfig({ environments = { production = {} }, passes = { vip = { name = "VIP", description = "Perks", icon = { ["en-us"] = "vip.png" }, price = "100" } } })
		-- @expect-error
		local product = bedrock.defineConfig({ environments = { production = {} }, products = { gems = { name = "Gems", description = "Pack", price = "100" } } })
		-- @expect-error
		local place = bedrock.defineConfig({ environments = { production = {} }, places = { lobby = { serverSize = "20" } } })
	end)

	t.it("should reject missing required fields inside optional root collections", function()
		-- @expect-error
		local pass = bedrock.defineConfig({ environments = { production = {} }, passes = { vip = { description = "Perks", icon = { ["en-us"] = "vip.png" } } } })
		-- @expect-error
		local product = bedrock.defineConfig({ environments = { production = {} }, products = { gems = { description = "Pack" } } })
	end)
end)
