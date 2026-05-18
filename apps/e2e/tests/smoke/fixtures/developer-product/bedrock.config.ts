import { defineConfig } from "@bedrock-rbx/core";

export default defineConfig({
	environments: { smoke: {} },
	products: {
		"smoke-product": {
			name: "Smoke Test Product",
			description: "Synthetic developer product exercised by the e2e smoke suite.",
			icon: { "en-us": "icon.png" },
			price: 100,
		},
	},
});
