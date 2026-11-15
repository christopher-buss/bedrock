--!strict
local bedrock = require("@bedrock/config")
local t = require("@jest/typecheck")

t.describe("Optional badge and game-pass icons", function()
	t.it("should accept a badge without an icon", function()
		local badge: bedrock.BadgeEntry = { name = "First Win", description = "Win your first round." }
	end)

	t.it("should accept a game pass without an icon", function()
		local pass: bedrock.GamePassEntry = { name = "VIP", description = "Perks" }
	end)

	t.it("should reject a game-pass icon that is not an en-us locale map", function()
		-- @expect-error
		local pass: bedrock.GamePassEntry = { name = "VIP", description = "Perks", icon = "vip.png" }
	end)

	t.it("should reject an undeclared icon locale through defineConfig", function()
		-- @expect-error
		local passes = bedrock.defineConfig({ environments = { production = {} }, passes = { vip = { name = "VIP", description = "Perks", icon = { ["en-us"] = "vip.png", typo = "bad.png" } } } })
		-- @expect-error
		local badges = bedrock.defineConfig({ environments = { production = {} }, badges = { win = { name = "Win", description = "d", icon = { ["en-us"] = "win.png", typo = "bad.png" } } } })
	end)
end)
