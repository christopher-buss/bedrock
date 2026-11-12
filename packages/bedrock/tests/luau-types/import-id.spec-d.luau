--!strict
local bedrock = require("@bedrock/config")
local t = require("@jest/typecheck")

t.describe("importId", function()
	t.it("should accept an importId and icon baseline on an Environment passes overlay", function()
		-- Luau widens a string literal inside a collection, so the singleton is typed.
		local baseline: "accept-local-file" = "accept-local-file"
		local config = bedrock.defineConfig({
			environments = {
				dev = {
					passes = {
						vip = { importId = "9876543210", iconBaseline = baseline },
					},
				},
			},
		})
		t.expectTypeOf(config.environments.dev.passes.vip.importId):toEqualType<<string>>()
		t.expectTypeOf(config.environments.dev.passes.vip.iconBaseline):toEqualType<<"accept-local-file">>()
	end)

	t.it("should reject a wrong-typed importId or icon baseline", function()
		-- @expect-error
		bedrock.defineConfig({ environments = { dev = { passes = { vip = { importId = 9876543210 } } } } })
		-- @expect-error
		bedrock.defineConfig({ environments = { dev = { passes = { vip = { iconBaseline = true } } } } })
	end)

	t.it("should reject importId and iconBaseline on a root passes entry", function()
		-- @expect-error
		bedrock.defineConfig({
			environments = { dev = {} },
			passes = {
				vip = {
					name = "VIP",
					description = "Perks",
					icon = { ["en-us"] = "vip.png" },
					importId = "9876543210",
				},
			},
		})
		-- @expect-error
		bedrock.defineConfig({
			environments = { dev = {} },
			passes = {
				vip = {
					name = "VIP",
					description = "Perks",
					icon = { ["en-us"] = "vip.png" },
					iconBaseline = "accept-local-file" :: "accept-local-file",
				},
			},
		})
	end)

	t.it("should accept an importId and icon baseline on Environment products and badges overlays", function()
		local baseline: "accept-local-file" = "accept-local-file"
		local config = bedrock.defineConfig({
			environments = {
				dev = {
					badges = {
						win = { importId = "2468013579", iconBaseline = baseline },
					},
					products = {
						gems = { importId = "8172635495", iconBaseline = baseline },
					},
				},
			},
		})
		t.expectTypeOf(config.environments.dev.products.gems.importId):toEqualType<<string>>()
		t.expectTypeOf(config.environments.dev.products.gems.iconBaseline):toEqualType<<"accept-local-file">>()
		t.expectTypeOf(config.environments.dev.badges.win.importId):toEqualType<<string>>()
		t.expectTypeOf(config.environments.dev.badges.win.iconBaseline):toEqualType<<"accept-local-file">>()
	end)

	t.it("should reject a wrong-typed importId or icon baseline on products and badges overlays", function()
		-- @expect-error
		bedrock.defineConfig({ environments = { dev = { products = { gems = { importId = 8172635495 } } } } })
		-- @expect-error
		bedrock.defineConfig({ environments = { dev = { products = { gems = { iconBaseline = true } } } } })
		-- @expect-error
		bedrock.defineConfig({ environments = { dev = { badges = { win = { importId = 2468013579 } } } } })
		-- @expect-error
		bedrock.defineConfig({ environments = { dev = { badges = { win = { iconBaseline = true } } } } })
	end)

	t.it("should reject importId on a root products or badges entry", function()
		-- @expect-error
		bedrock.defineConfig({
			environments = { dev = {} },
			products = {
				gems = { name = "Gems", description = "Gems", importId = "8172635495" },
			},
		})
		-- @expect-error
		bedrock.defineConfig({
			environments = { dev = {} },
			badges = {
				win = {
					name = "Win",
					description = "Win",
					icon = { ["en-us"] = "win.png" },
					importId = "2468013579",
				},
			},
		})
	end)
end)
