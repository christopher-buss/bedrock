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

	t.it("should accept a badge declaring every field", function()
		local badge: bedrock.BadgeEntry = {
			name = "First Win",
			description = "Win your first round.",
			enabled = false,
			icon = { ["en-us"] = "first-win.png" },
		}
		local config = bedrock.defineConfig({
			badges = { ["first-win"] = badge },
			environments = { production = { badges = { ["first-win"] = { enabled = true } } } },
		})
	end)

	t.it("should reject a badge name that is not a string", function()
		-- @expect-error
		local badge: bedrock.BadgeEntry = { name = 1, description = "d", icon = { ["en-us"] = "a.png" } }
	end)

	t.it("should reject a badge description that is not a string", function()
		-- @expect-error
		local badge: bedrock.BadgeEntry = { name = "n", description = false, icon = { ["en-us"] = "a.png" } }
	end)

	t.it("should reject a badge enabled flag that is not a boolean", function()
		-- @expect-error
		local badge: bedrock.BadgeEntry = { name = "n", description = "d", enabled = "yes", icon = { ["en-us"] = "a.png" } }
	end)

	t.it("should reject a badge icon that is not an en-us locale map", function()
		-- @expect-error
		local badge: bedrock.BadgeEntry = { name = "n", description = "d", icon = "a.png" }
	end)

	t.it("should reject a badge overlay enabled flag that is not a boolean", function()
		-- @expect-error
		local overlay: bedrock.BadgeOverlay = { enabled = "no" }
	end)

	t.it("should reject an unknown badge field", function()
		-- @expect-error
		local badge: bedrock.BadgeEntry = { name = "n", description = "d", icon = { ["en-us"] = "a.png" }, isActive = true }
	end)
end)
