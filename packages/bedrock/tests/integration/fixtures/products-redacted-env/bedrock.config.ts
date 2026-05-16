import { defineConfig } from "@bedrock-rbx/core";

export default defineConfig({
	environments: {
		dev: {
			products: { "carve-out-pack": { redacted: false } },
			redacted: true,
		},
		production: {},
	},
	products: {
		"carve-out-pack": {
			name: "Carve Out",
			description: "Stays real in dev.",
			icon: { "en-us": "assets/carve.png" },
			price: 50,
		},
		"gem-pack": {
			name: "Gem Pack",
			description: "Stocks the player up with 1,000 premium gems.",
			icon: { "en-us": "assets/gems.png" },
			price: 100,
		},
	},
	universe: { universeId: "1234567890" },
});
