--!strict
local bedrock = require("@bedrock/config")
local marker: bedrock.RetiredEntry = { retired = "untrack" }
local product: bedrock.DeveloperProductEntry | bedrock.RetiredEntry = marker
local place: bedrock.PlaceEntry | bedrock.RetiredEntry = marker
local placeOverlay: bedrock.PlaceOverlay | bedrock.RetiredEntry = marker

return bedrock.defineConfig({
	environments = {
		production = {
			passes = { vip = marker },
			products = { gems = marker },
			places = { lobby = placeOverlay },
		},
	},
	passes = { vip = marker },
	products = { gems = product },
	places = { lobby = place },
})
