--!strict
local bedrock = require("@bedrock/config")
local marker: bedrock.RetiredEntry = { retired = "untrack" }
local product: bedrock.DeveloperProductEntry = marker
local place: bedrock.PlaceEntry = marker
local placeOverlay: bedrock.PlaceOverlay = marker

return bedrock.defineConfig({
	environments = {
		production = {
			passes = { vip = { retired = "untrack" } },
			products = { gems = marker },
			places = { lobby = placeOverlay },
		},
	},
	passes = { vip = marker },
	products = { gems = product },
	places = { lobby = place },
})
