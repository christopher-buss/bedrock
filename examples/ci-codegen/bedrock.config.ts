import { defineConfig } from "@bedrock-rbx/core/config";

/**
 * Two environments over one set of resource declarations. Every id is a
 * placeholder — replace them with ids of experiences you own.
 *
 * `development` deploys its game pass redacted: Bedrock pushes placeholder
 * name, description, and price to Roblox so an unreleased product is not
 * readable from the storefront, while the emitter still generates the real
 * values into source (see `.bedrock/codegen/emit.ts`).
 */
export default defineConfig({
	codegen: {
		enabled: true,
		// The directory the emitter's files are written under, and the
		// directory the deploy workflow commits back to the branch.
		output: "src/shared/assets",
	},
	environments: {
		development: {
			places: {
				start: { placeId: "0000000001" },
			},
			redacted: true,
			universe: { universeId: "0000000001" },
		},
		production: {
			places: {
				start: { placeId: "0000000002" },
			},
			universe: { universeId: "0000000002" },
		},
	},
	passes: {
		"vip-pass": {
			name: "VIP Pass",
			description: "Doubles coin earnings and unlocks the VIP lounge.",
			// Supply your own 512x512 image; Bedrock hashes the file so an
			// unchanged icon is never re-uploaded.
			icon: { "en-us": "assets/icons/vip-pass.png" },
			price: 500,
		},
	},
	places: {
		start: {
			description: "The place every player joins first.",
			displayName: "Example Start Place",
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
	state: {
		backend: "gist",
		gistId: "0000000000000000000000000000000",
	},
	universe: {
		displayName: "Bedrock Example",
	},
});
