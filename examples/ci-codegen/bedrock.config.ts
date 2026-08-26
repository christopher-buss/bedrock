import { defineConfig } from "@bedrock-rbx/core/config";

/**
 * Two environments over one set of resource declarations. Every id is a
 * placeholder — replace them with ids of experiences you own.
 *
 * `development` sets `redacted: true`; see the README for what that does.
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
				start: { placeId: "4471029385" },
			},
			redacted: true,
			universe: { universeId: "3218475960" },
		},
		production: {
			places: {
				start: { placeId: "4471029412" },
			},
			universe: { universeId: "3218475961" },
		},
	},
	passes: {
		"vip-pass": {
			name: "VIP Pass",
			description: "Doubles coin earnings and unlocks the VIP lounge.",
			// See assets/icons/README.md.
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
