--!strict
local bedrock = require("@bedrock/config")

local defineConfig = bedrock.defineConfig

return defineConfig({
	environments = {
		production = {},
		staging = { passes = { vip = { price = "$none", redacted = { description = "Soon" } } } },
	},
	passes = {
		vip = {
			name = "VIP",
			description = "Perks",
			icon = { ["en-us"] = "vip.png" },
			price = 100,
			redacted = { name = "Preview", icon = { ["en-us"] = "preview.png" }, price = 5 },
		},
		beta = { name = "Beta", description = "Early", icon = { ["en-us"] = "beta.png" }, price = "$none" },
	},
})
