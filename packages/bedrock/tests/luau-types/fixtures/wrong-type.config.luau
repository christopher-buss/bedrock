--!strict
local bedrock = require("@bedrock/config")

return bedrock.defineConfig({
	environments = { production = { passes = { vip = { price = "100" } } } },
})
