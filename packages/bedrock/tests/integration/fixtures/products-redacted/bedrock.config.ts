import { defineConfig } from "@bedrock-rbx/core";

export default defineConfig({
	environments: {
		production: {},
	},
	products: {
		"gem-pack": {
			name: "Gem Pack",
			description: "Stocks the player up with 1,000 premium gems.",
			icon: { "en-us": "assets/gems.png" },
			price: 100,
			redacted: true,
		},
	},
	universe: { universeId: "1234567890" },
});
