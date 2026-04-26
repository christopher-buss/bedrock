import { defineConfig } from "@bedrock/core";

export default defineConfig({
	environments: {
		production: {},
	},
	products: {
		"gem-pack": {
			name: "Gem Pack",
			description: "Stocks the player up with 1,000 premium gems.",
		},
	},
	universe: { universeId: "1234567890" },
});
