-- Every id below is a placeholder. Open Cloud cannot mint a universe or a
-- place, so both must exist before the first deploy.
return {
	codegen = {
		enabled = true,
	},
	environments = {
		production = {
			places = {
				start = { placeId = "7182930451" },
			},
			universe = { universeId = "3218475962" },
		},
	},
	places = {
		start = {
			description = "The place every player joins first.",
			displayName = "Example Start Place",
			filePath = "place.rbxl",
			serverSize = 30,
		},
	},
	products = {
		["coins-small"] = {
			name = "100 Coins",
			description = "Adds 100 coins to your balance.",
			price = 49,
		},
	},
	state = {
		backend = "gist",
		gistId = "0000000000000000000000000000000",
	},
	universe = {
		displayName = "Bedrock Example",
	},
}
