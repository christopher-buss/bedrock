--!strict
local bedrock = require("@bedrock/config")

local defineConfig = bedrock.defineConfig

return defineConfig({
	environments = { production = {} },
	passes = {
		vip = { name = "VIP", description = "Perks", icon = { ["en-us"] = "vip.png" }, price = 100 },
	},
})
