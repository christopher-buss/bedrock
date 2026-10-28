--!strict
local bedrock = require("@bedrock/config")
local marker: bedrock.RetiredEntry = { retired = true }
local pass: bedrock.GamePassEntry | bedrock.RetiredEntry = marker
local overlay: bedrock.GamePassOverlay | bedrock.RetiredEntry = marker

return bedrock.defineConfig({
    environments = { production = { passes = { vip = overlay } } },
    passes = { vip = pass },
})
