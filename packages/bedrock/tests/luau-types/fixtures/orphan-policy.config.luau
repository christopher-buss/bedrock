--!strict
local bedrock = require("@bedrock/config")
local retire: bedrock.OrphanPolicy = "retire"
local error: bedrock.OrphanPolicy = "error"
local automatic = bedrock.defineConfig({ environments = { production = {} }, orphans = retire })
local explicit = bedrock.defineConfig({ environments = { production = {} }, orphans = error })
local checked: bedrock.Config<typeof(automatic)> = automatic
return { automatic, explicit, checked }

