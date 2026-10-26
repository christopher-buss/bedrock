--!strict
local bedrock = require("@bedrock/config")
local t = require("@jest/typecheck")

t.describe("Config", function()
	t.it("should reject a string price", function()
		-- @expect-error
		local pass: bedrock.GamePassEntry = {
			name = "VIP",
			description = "Perks",
			icon = { ["en-us"] = "vip.png" },
			price = "100",
		}
	end)
end)
