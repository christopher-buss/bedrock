import { defineConfig } from "@bedrock-rbx/core/config";

/**
 * Every id below is a placeholder. Replace `universeId` and `placeId` with the
 * ids of an experience you own — Open Cloud cannot mint a universe or a place,
 * so both must already exist before the first deploy.
 */
export default defineConfig({
	// Turning codegen on makes `bedrock deploy` write the ids Roblox assigned
	// back out as source. With no `output` set they land in the default
	// directory, `.bedrock/generated/resources.luau`.
	codegen: {
		enabled: true,
	},
	environments: {
		production: {
			places: {
				start: { placeId: "7182930451" },
			},
			universe: { universeId: "3218475962" },
		},
	},
	places: {
		start: {
			description: "The place every player joins first.",
			displayName: "Example Start Place",
			// Written by `.bedrock/build.ts`, uploaded by the publish stage.
			filePath: "build/place.rbxl",
			serverSize: 30,
		},
	},
	products: {
		"coins-small": {
			name: "100 Coins",
			description: "Adds 100 coins to your balance.",
			price: 49,
		},
	},
	// Deployed state lives in a secret GitHub Gist. Bedrock reads the token
	// from BEDROCK_GITHUB_TOKEN; the gist itself holds only resource ids.
	state: {
		backend: "gist",
		gistId: "0000000000000000000000000000000",
	},
	universe: {
		displayName: "Bedrock Example",
	},
});
