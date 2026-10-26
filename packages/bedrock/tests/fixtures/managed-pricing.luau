--!strict
local bedrock = require("../../src/luau/config")

local config = bedrock.defineConfig({
	environments = {
		production = {},
		staging = {
			passes = { vip = { isManagedPricingEnabled = false } },
			products = { gems = { isManagedPricingEnabled = true, price = 100 } },
		},
	},
	passes = {
		vip = {
			name = "VIP",
			description = "Perks",
			icon = { ["en-us"] = "vip.png" },
			price = 100,
			isManagedPricingEnabled = true,
		},
	},
	products = {
		gems = { name = "Gems", description = "Gems", isManagedPricingEnabled = false },
	},
})

if config.passes then
	local _enabled: boolean? = config.passes.vip.isManagedPricingEnabled
end
if config.products then
	local _enabled: boolean? = config.products.gems.isManagedPricingEnabled
end

return config
