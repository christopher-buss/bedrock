--!strict
local bedrock = require("@bedrock/config")

local defineConfig = bedrock.defineConfig

return defineConfig({
	environments = { production = { passes = { vip = { price = "100" } } } },
})
