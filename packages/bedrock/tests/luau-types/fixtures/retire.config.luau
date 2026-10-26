--!strict
local bedrock = require("@bedrock/config")
local marker: bedrock.RetiredEntry = { retired = true }
local pass: bedrock.GamePassEntry = marker
local overlay: bedrock.GamePassOverlay = marker

return bedrock.defineConfig({
    environments = { production = { passes = { vip = overlay } } },
    passes = { vip = pass },
})
