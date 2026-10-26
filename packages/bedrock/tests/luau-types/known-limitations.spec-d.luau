--!strict
local bedrock = require("@bedrock/config")
local t = require("@jest/typecheck")

t.describe("Known Luau limitations", function()
	t.it("should currently accept an unknown resource kind at the root", function()
		local config = bedrock.defineConfig({ environments = { production = {} }, badges = {} })
		t.expectTypeOf(config):toEqualType<<bedrock.Config>>()
	end)

	t.it("should currently accept misspelled optional fields", function()
		local config = bedrock.defineConfig({
			environments = { production = { pases = {} } },
			pases = {},
		})
		t.expectTypeOf(config):toEqualType<<bedrock.Config>>()
	end)

	t.it("should currently accept wrong-typed entries inside optional root collections", function()
		local config = bedrock.defineConfig({
			environments = { production = {} },
			passes = { vip = { name = "VIP", description = "Perks", icon = { ["en-us"] = "vip.png" }, price = "100" } },
			products = { gems = { name = "Gems", description = "Pack", price = "100" } },
			places = { lobby = { serverSize = "20" } },
		})
		t.expectTypeOf(config):toEqualType<<bedrock.Config>>()
	end)

	t.it("should currently accept missing required fields inside optional root collections", function()
		local config = bedrock.defineConfig({
			environments = { production = {} },
			passes = { vip = { description = "Perks", icon = { ["en-us"] = "vip.png" } } },
			products = { gems = { description = "Pack" } },
		})
		t.expectTypeOf(config):toEqualType<<bedrock.Config>>()
	end)
end)
